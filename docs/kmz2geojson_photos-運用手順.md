# `kmz2geojson_photos.py` 運用手順

Google Drive 上の KMZ ファイル群から、ルートガイド用写真情報 (GeoJSON) を生成するバッチ処理の運用手順をまとめる。

## 概要

スクリプト本体: [`scripts/kmz2geojson_photos.py`](../scripts/kmz2geojson_photos.py)

### 想定する Drive のフォルダ構造

```
ROOT_FOLDER/
  {trip-1}/
    trip-1.kmz
    images/   ← サムネイルJPEG (例: IMG_0001.jpg)
    photos/   ← 元写真JPEG    (例: IMG_0001.jpg)
  {trip-2}/
    trip-2.kmz
    images/
    photos/
  ...
```

### 出力

```
scripts/photos/
  individual/{driveFileId}.geojson  ... KMZ単位のGeoJSON
  all.geojson                        ... 全件マージ
```

各 Feature の properties に Drive 直リンク URL (`thumbnailUrl`, `fullUrl`) を埋め込む。アプリ側は `<img>` で参照する。

---

## 事前準備 (初回のみ)

### 1. Python と依存ライブラリ

```powershell
cd scripts
pip install -r requirements.txt
```

Python 3.10 以降を想定。仮想環境を使う場合は `py -3.13 -m venv .venv` → `Activate.ps1` してから。

### 2. Google Cloud 側

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成 (既存可)
2. **APIとサービス → ライブラリ → Google Drive API** を有効化
3. **IAMと管理 → サービスアカウント** で新規サービスアカウントを作成
4. 作成したサービスアカウント → **キー** タブ → **鍵を追加 → 新しい鍵を作成 → JSON**
5. ダウンロードされた JSON を `scripts/service_account.json` に配置 (リネーム)

> ⚠️ `service_account.json` は秘密鍵を含むため Git にコミットしない。
> `.gitignore` で除外済み。

### 3. Drive 側の共有設定

サービスアカウントのメールアドレス (`client_email` の値、例: `xxx@project.iam.gserviceaccount.com`) を取得し、以下を実施:

1. 写真ルートフォルダを右クリック → **共有** → サービスアカウントのメールに **閲覧者** 権限で共有
2. 同フォルダの「一般的なアクセス」を **「リンクを知っている全員」 → 閲覧者** に変更
   (アプリで `<img src="https://drive.google.com/...">` 表示するため)

### 4. ルートフォルダ ID の取得

ブラウザで Drive のルートフォルダを開き、URL から ID をコピー:

```
https://drive.google.com/drive/folders/1AbCdEfGhIj...XyZ
                                       └─── ID ────┘
```

---

## 通常運用: 差分更新

KMZ が追加・更新された場合に変更分のみ処理する。**運用フェーズでの標準操作**。

```powershell
cd scripts
python kmz2geojson_photos.py --root-folder-id <Drive上のルートフォルダID>
```

### 動作概要

| 状況 | 動作 |
|---|---|
| 既存 GeoJSON が無い KMZ | 新規処理してファイル生成 |
| KMZ の更新日時 > 出力 GeoJSON のファイル mtime | 再処理 |
| KMZ の更新日時 ≤ 出力 GeoJSON のファイル mtime | スキップ |
| Drive 上から削除された KMZ | 該当 `individual/*.geojson` を削除 |

最後に `individual/` を全マージして `all.geojson` を更新。

### 想定実行時間

| 状況 | 時間目安 |
|---|---|
| 変更なし | 5〜15秒 (一覧取得のみ) |
| 1〜2ファイル追加/更新 | 10〜30秒 |
| 数件追加/更新 | 30秒〜数分 |

### 期待される出力ログ

```
============================================================
KMZ → GeoJSON バッチ処理
  Drive root   : 1AbCdEfGhIj...XyZ
  Output dir   : photos/
  Force rebuild: False
============================================================
Drive 探索中 ...
  KMZ NN件発見
  → 処理: trip-1/trip-1.kmz
    Placemark XX件抽出
    XX件保存 → {driveFileId}.geojson
  ...

処理 N件 / スキップ(変更なし) M件

クリーンアップ ...
  (削除対象なし)

マージ ...
  XX件 → photos\all.geojson
============================================================
完了
```

---

## すべて再作成 (フル再構築)

差分判定を無視して全 KMZ を再処理する。**以下のケースで使用**:

- スクリプトのロジックを変更した (例: 画像 URL 形式変更、properties 追加)
- 出力ファイルが壊れている / 内容が古い疑い
- 初回実行
- アプリ側の仕様変更で再出力が必要

```powershell
cd scripts
python kmz2geojson_photos.py --root-folder-id <Drive上のルートフォルダID> --force
```

### 動作概要

`--force` オプションで差分判定を無視し、全 KMZ をダウンロード・パース・出力。
個別ファイル削除とマージは差分更新と同じ。

### 想定実行時間

| KMZ数 | 時間目安 |
|---|---|
| 10ファイル | 30秒〜2分 |
| 30ファイル | 2〜6分 |
| 50ファイル | 4〜10分 |
| 100ファイル | 10〜20分 |

主にネットワーク律速 (KMZ ダウンロード時間)。

---

## オプション一覧

| オプション | デフォルト | 説明 |
|---|---|---|
| `--root-folder-id` | (必須) | Drive 上の写真ルートフォルダ ID |
| `--service-account` | `service_account.json` | サービスアカウントJSONキーのパス |
| `--output-dir` | `photos` | 出力先ディレクトリ |
| `--force` | (なし) | 差分判定を無視して全件再処理 |

実行例 (出力先を変更):
```powershell
python kmz2geojson_photos.py --root-folder-id <ID> --output-dir ../data/photos
```

---

## トラブルシュート

| エラー / 症状 | 原因 | 対処 |
|---|---|---|
| `必要なライブラリが不足しています` | `pip install` 未実行 | `pip install -r requirements.txt` |
| `エラー: サービスアカウントJSON ... が見つかりません` | パス違い | `--service-account` を確認 |
| `HttpError 403: ...does not have access...` | Drive 共有がサービスアカウントに無い | 写真ルートフォルダを `client_email` に「閲覧者」で共有 |
| `HttpError 404: File not found` | ルートフォルダ ID 違い、または共有不足 | URL のフォルダ ID を再確認 |
| `KMZ 0件発見` | ルートフォルダ違い、または KMZ が無い | フォルダ構造を確認 |
| 各 KMZ で `注意: images/ フォルダ未検出` | 子フォルダ名が `images` 以外 | フォルダ名を `images` に統一 (or スクリプトを修正) |
| 各 KMZ で `注意: photos/ フォルダ未検出` | 子フォルダ名が `photos` 以外 | フォルダ名を `photos` に統一 (or スクリプトを修正) |
| 出力 GeoJSON で `thumbnailUrl` が空 | KMZ Placemark の description に `<img src>` が無い、または `images/` に対応 JPEG なし | KMZ の構造と `images/` の中身を確認 |
| 画像が表示されない (アプリ側で) | Drive 共有が「リンクを知っている全員」になっていない | 共有設定を変更 |

---

## 関連ファイル

- [`scripts/kmz2geojson_photos.py`](../scripts/kmz2geojson_photos.py) — スクリプト本体
- [`scripts/requirements.txt`](../scripts/requirements.txt) — Python 依存パッケージ
- `scripts/service_account.json` — Google Drive API 認証 (.gitignore 済)
- `scripts/photos/individual/*.geojson` — KMZ 単位の出力
- `scripts/photos/all.geojson` — 全件マージ (アプリ読み込み用)
