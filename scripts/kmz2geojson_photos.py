#!/usr/bin/env python3
"""
KMZ → GeoJSON バッチ処理スクリプト

Google Drive上のKMZファイルを走査し、KMZごとにGeoJSONを生成する。
画像(サムネ/元写真)は同フォルダ内の images/, photos/ サブフォルダから fileId を解決し、
Drive直リンクURLを properties に埋め込む(案A方式)。

[想定するDrive上のフォルダ構造]
  ROOT_FOLDER/
    {KMZ単位のサブフォルダ}/
      *.kmz
      images/  ← サムネイルJPEG (例: IMG_0001.jpg)
      photos/  ← 元写真JPEG    (例: IMG_0001.jpg)
    ...

[出力]
  {output-dir}/individual/{driveFileId}.geojson  ... KMZ単位
  {output-dir}/all.geojson                        ... 全件マージ

[使い方]
  pip install -r requirements.txt
  python build_photos.py \
      --root-folder-id <DriveフォルダID> \
      --service-account service_account.json \
      --output-dir ../photos

[認証]
  Google Cloud Console でサービスアカウントを作成し、Drive API を有効化、
  JSONキーを取得して --service-account に指定する。
  対象のDriveフォルダはサービスアカウントのメールアドレスに「閲覧者」権限で共有しておくこと。
  写真(JPEG)は <img> タグで参照するため、フォルダごと「リンクを知っている全員が閲覧可能」に共有が必要。

[差分判定]
  KMZの modifiedTime と出力GeoJSONのファイルmtime を比較し、変更があるもののみ再処理する。
  --force で全件強制再処理。

[Driveから削除されたKMZ]
  対応する出力 GeoJSON を自動削除し、all.geojson も再構成する。
"""

import argparse
import json
import re
import sys
import zipfile
from io import BytesIO
from pathlib import Path
from datetime import datetime, timezone

try:
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    from lxml import etree
except ImportError as e:
    sys.stderr.write(
        f"必要なライブラリが不足しています: {e}\n"
        "  pip install -r requirements.txt を実行してください。\n"
    )
    sys.exit(1)


KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
KML_NS_URI = "http://www.opengis.net/kml/2.2"
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# 画像ファイル名抽出用 (<img src="..."> または <a href="..."> から JPEG ファイル名を取り出す)
IMG_REF_RE = re.compile(r'(?:src|href)=["\']([^"\']+\.(?:jpg|jpeg))["\']', re.IGNORECASE)


# ============================================================
# Drive API
# ============================================================

def auth_drive(service_account_path: str):
    creds = Credentials.from_service_account_file(service_account_path, scopes=DRIVE_SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_children(drive, parent_id: str, mime_type_filter: str = None):
    """指定フォルダ直下の子要素を返す。mime_type_filter で絞り込み可能。"""
    items = []
    q_parts = [f"'{parent_id}' in parents", "trashed=false"]
    if mime_type_filter == "folder":
        q_parts.append("mimeType='application/vnd.google-apps.folder'")
    elif mime_type_filter == "file":
        q_parts.append("mimeType!='application/vnd.google-apps.folder'")
    q = " and ".join(q_parts)

    page_token = None
    while True:
        resp = drive.files().list(
            q=q,
            fields="nextPageToken, files(id, name, mimeType, modifiedTime, size)",
            pageToken=page_token,
            pageSize=500,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        items.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return items


def find_kmz_folders(drive, root_id: str) -> dict:
    """ROOT 配下を再帰的にスキャンし、KMZファイルを含むフォルダを探す。
    返値: { kmzFileId: { kmzId, kmzName, kmzModifiedTime, folderId, folderName } }
    """
    result = {}

    def walk(folder_id: str, folder_name: str):
        files = list_children(drive, folder_id, mime_type_filter="file")
        for f in files:
            if f["name"].lower().endswith(".kmz"):
                result[f["id"]] = {
                    "kmzId": f["id"],
                    "kmzName": f["name"],
                    "kmzModifiedTime": f["modifiedTime"],
                    "folderId": folder_id,
                    "folderName": folder_name,
                }
        # サブフォルダ再帰 (images/, photos/ は除外しても効率化できるが念のため全走査)
        subs = list_children(drive, folder_id, mime_type_filter="folder")
        for sub in subs:
            if sub["name"] in ("images", "photos"):
                continue  # 内部の画像フォルダは再帰対象外
            walk(sub["id"], sub["name"])

    walk(root_id, "ROOT")
    return result


def download_file_bytes(drive, file_id: str) -> bytes:
    """指定ファイルの中身をバイト列で取得"""
    request = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
    buf = BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


def build_name_to_id_map(drive, folder_id: str) -> dict:
    """フォルダ内のファイル名→fileId のマップを作る
    キーは lower-case にして、拡張子の大文字小文字差 (.jpg / .JPG) を吸収する。
    """
    name_map = {}
    for f in list_children(drive, folder_id, mime_type_filter="file"):
        name_map[f["name"].lower()] = f["id"]
    return name_map


# ============================================================
# KMZ / KML パース
# ============================================================

def parse_kmz(kmz_bytes: bytes) -> list:
    """KMZからKMLを取り出してPlacemark配列を返す。
    返値: [{ lat, lng, alt, name, imageFile }]
    """
    placemarks = []
    with zipfile.ZipFile(BytesIO(kmz_bytes)) as z:
        kml_name = next((n for n in z.namelist() if n.lower().endswith(".kml")), None)
        if not kml_name:
            return placemarks
        kml_bytes = z.read(kml_name)

    try:
        root = etree.fromstring(kml_bytes)
    except etree.XMLSyntaxError as e:
        print(f"    警告: KML XMLパース失敗 ({e})")
        return placemarks

    for pm in root.iter(f"{{{KML_NS_URI}}}Placemark"):
        coord_elem = pm.find(".//k:Point/k:coordinates", KML_NS)
        if coord_elem is None or not (coord_elem.text and coord_elem.text.strip()):
            continue
        coord_str = coord_elem.text.strip().split()[0]  # 複数座標がある場合は最初
        parts = coord_str.split(",")
        try:
            lng = float(parts[0])
            lat = float(parts[1])
            alt = float(parts[2]) if len(parts) > 2 else None
        except (ValueError, IndexError):
            continue

        name_elem = pm.find("k:name", KML_NS)
        name = name_elem.text.strip() if name_elem is not None and name_elem.text else None

        desc_elem = pm.find("k:description", KML_NS)
        desc = desc_elem.text if desc_elem is not None and desc_elem.text else ""

        # 画像ファイル名の解決
        # 優先順: description内の <img src> または <a href> → name自体がjpgファイル名
        image_file = None
        m = IMG_REF_RE.search(desc)
        if m:
            image_file = Path(m.group(1)).name  # 相対パスからファイル名のみ抽出
        elif name and name.lower().endswith((".jpg", ".jpeg")):
            image_file = name

        placemarks.append({
            "lat": lat,
            "lng": lng,
            "alt": alt,
            "name": name,
            "imageFile": image_file,
        })

    return placemarks


# ============================================================
# GeoJSON 生成
# ============================================================

def build_features(placemarks: list, images_map: dict, photos_map: dict, kmz_info: dict) -> list:
    """Placemark配列 + 画像名→fileId マップから GeoJSON Feature 配列を作成"""
    features = []
    for pm in placemarks:
        img = pm.get("imageFile")
        img_key = img.lower() if img else None  # ケース非依存照合用
        thumb_id = images_map.get(img_key) if img_key else None
        photo_id = photos_map.get(img_key) if img_key else None

        props = {
            "type": "photo",
            "sourceKmz": kmz_info["kmzName"],
            "sourceKmzId": kmz_info["kmzId"],
        }
        if img:
            props["fileName"] = img
        if pm.get("name"):
            props["name"] = pm["name"]
        if thumb_id:
            props["thumbnailUrl"] = f"https://drive.google.com/thumbnail?id={thumb_id}&sz=w400"
        if photo_id:
            props["fullUrl"] = f"https://drive.google.com/uc?id={photo_id}&export=view"

        coords = [pm["lng"], pm["lat"]]
        if pm.get("alt") is not None:
            coords.append(pm["alt"])

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": coords},
            "properties": props,
        })
    return features


# ============================================================
# 差分判定 / 個別ファイル処理
# ============================================================

def needs_rebuild(out_path: Path, kmz_modified_time: str) -> bool:
    if not out_path.exists():
        return True
    local_mtime = datetime.fromtimestamp(out_path.stat().st_mtime, tz=timezone.utc)
    try:
        remote_mtime = datetime.fromisoformat(kmz_modified_time.replace("Z", "+00:00"))
    except ValueError:
        return True
    return remote_mtime > local_mtime


def process_kmz(drive, kmz_info: dict, individual_dir: Path) -> int:
    """1つのKMZを処理してGeoJSONを書き出す。
    返値: 書き出したフィーチャー数
    """
    print(f"  → 処理: {kmz_info['folderName']}/{kmz_info['kmzName']}")

    kmz_bytes = download_file_bytes(drive, kmz_info["kmzId"])
    placemarks = parse_kmz(kmz_bytes)
    print(f"    Placemark {len(placemarks)}件抽出")

    # 同フォルダ内の images/, photos/ サブフォルダを探索
    siblings = list_children(drive, kmz_info["folderId"], mime_type_filter="folder")
    images_id = next((s["id"] for s in siblings if s["name"] == "images"), None)
    photos_id = next((s["id"] for s in siblings if s["name"] == "photos"), None)

    images_map = build_name_to_id_map(drive, images_id) if images_id else {}
    photos_map = build_name_to_id_map(drive, photos_id) if photos_id else {}

    if not images_id:
        print("    注意: images/ フォルダ未検出")
    if not photos_id:
        print("    注意: photos/ フォルダ未検出")

    features = build_features(placemarks, images_map, photos_map, kmz_info)

    geojson = {
        "type": "FeatureCollection",
        "properties": {
            "sourceKmz": kmz_info["kmzName"],
            "sourceKmzId": kmz_info["kmzId"],
            "folderName": kmz_info["folderName"],
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "features": features,
    }

    out_path = individual_dir / f"{kmz_info['kmzId']}.geojson"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(geojson, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"    {len(features)}件保存 → {out_path.name}")
    return len(features)


# ============================================================
# 後処理 (削除されたKMZのクリーンアップ / マージ)
# ============================================================

def cleanup_removed(individual_dir: Path, current_kmz_ids: set) -> int:
    """Driveから削除されたKMZの個別GeoJSONを削除"""
    if not individual_dir.exists():
        return 0
    removed = 0
    for p in individual_dir.glob("*.geojson"):
        if p.stem not in current_kmz_ids:
            p.unlink()
            removed += 1
            print(f"  削除: {p.name} (Drive上に存在せず)")
    return removed


def merge_all(individual_dir: Path, output_path: Path) -> int:
    """個別GeoJSONをマージして一つのファイルに"""
    all_features = []
    sources = []
    if individual_dir.exists():
        for p in sorted(individual_dir.glob("*.geojson")):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                all_features.extend(data.get("features", []))
                sources.append(data.get("properties", {}).get("sourceKmz", p.stem))
            except Exception as e:
                print(f"  警告: {p.name} のマージ失敗: {e}")

    output = {
        "type": "FeatureCollection",
        "properties": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "totalFeatures": len(all_features),
            "sourceCount": len(sources),
        },
        "features": all_features,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return len(all_features)


# ============================================================
# メイン
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Google Drive上のKMZをGeoJSONに変換するバッチ処理",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--root-folder-id", required=True, help="Drive側のルートフォルダID")
    parser.add_argument("--service-account", default="service_account.json", help="サービスアカウントJSONキーのパス")
    parser.add_argument("--output-dir", default="photos", help="出力先ディレクトリ (デフォルト: photos)")
    parser.add_argument("--force", action="store_true", help="差分判定を無視して全件再処理")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    individual_dir = output_dir / "individual"
    merged_path = output_dir / "all.geojson"

    print("=" * 60)
    print("KMZ → GeoJSON バッチ処理")
    print(f"  Drive root  : {args.root_folder_id}")
    print(f"  Output dir  : {output_dir}/")
    print(f"  Force rebuild: {args.force}")
    print("=" * 60)

    if not Path(args.service_account).exists():
        sys.stderr.write(f"エラー: サービスアカウントJSON '{args.service_account}' が見つかりません。\n")
        sys.exit(1)

    drive = auth_drive(args.service_account)

    print("Drive 探索中 ...")
    kmz_map = find_kmz_folders(drive, args.root_folder_id)
    print(f"  KMZ {len(kmz_map)}件発見")

    processed = 0
    skipped = 0
    total_features = 0
    for kmz_id, kmz_info in kmz_map.items():
        out_path = individual_dir / f"{kmz_id}.geojson"
        if args.force or needs_rebuild(out_path, kmz_info["kmzModifiedTime"]):
            try:
                total_features += process_kmz(drive, kmz_info, individual_dir)
                processed += 1
            except Exception as e:
                print(f"  エラー: {kmz_info['kmzName']} の処理失敗: {e}")
        else:
            skipped += 1

    print(f"\n処理 {processed}件 / スキップ(変更なし) {skipped}件")

    print("\nクリーンアップ ...")
    removed = cleanup_removed(individual_dir, set(kmz_map.keys()))
    if removed == 0:
        print("  (削除対象なし)")

    print("\nマージ ...")
    merged_count = merge_all(individual_dir, merged_path)
    print(f"  {merged_count}件 → {merged_path}")

    print("=" * 60)
    print("完了")


if __name__ == "__main__":
    main()
