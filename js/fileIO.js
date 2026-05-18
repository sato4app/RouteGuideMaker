// ファイル入出力機能

import { createMarker, getLineStyle } from './markerSettings.js';
import { showMessage } from './message.js';
import { loadExcelFile } from './excelLoader.js';
import { getRouteGuides, loadRouteGuides } from './routeGuideEditor.js';

// ========================================
// ポイント・スポットのストア（ルート端点検索用）
// ========================================
// ポイントGPS (Excel): pointId -> {lat, lng}
const gpsPointStore = new Map();
// 標高 (Excel): pointId -> elevation
const elevationStore = new Map();
// GeoJSONポイント (type=point): pointId -> {lat, lng}
const geojsonPointStore = new Map();
// スポット: [{name, lat, lng}]
const spotStore = [];

// ========================================
// 種別ごとのマーカー生成データ（refreshMarkersでの再生成に使用）
// ========================================
const markerDataByType = {
    pointGps: [], // { id, name, lat, lng }
    point:    [], // { id, lat, lng }
    spot:     [], // { name, lat, lng }
    photo:    []  // { lat, lng, thumbnailUrl, fullUrl, fileName, sourceKmz }
};

// 現在地図に表示中のマーカーインスタンス（種別ごと）
// refreshMarkers時にこれらを地図から除去してから再生成する
// photo はルート選択時のみ routeGuideEditor 側で描画するためここでは管理しない
const markerInstancesByType = {
    pointGps: [],
    point:    [],
    spot:     []
};

// 写真データ参照用エクスポート (routeGuideEditorから利用)
export function getPhotoData() {
    return markerDataByType.photo;
}

// dataLayer の参照（setup関数で設定）
let _dataLayer = null;

// ========================================
// ルートガイドオーバーレイ用ストア（routeGuideEditorが参照）
// ========================================
// GPS・GeoJSONポイント: pointId -> Leafletマーカー
export const markerStore = new Map();
// ルートフィーチャー: [{startId, endId, coords: [[lat,lng],...]}]
export const routeFeatureStore = [];
// ルート線レイヤー: ルート線(LineString)はここに集約し、設定変更時にスタイル更新
export const routeLineLayer = L.layerGroup();

/**
 * ルート端点の座標を検索する
 * 優先順位: ポイントGPS > GeoJSONポイント > スポット(名称一致、複数なら最近傍)
 */
function findEndpoint(id, refLat, refLng) {
    if (gpsPointStore.has(id)) return gpsPointStore.get(id);
    if (geojsonPointStore.has(id)) return geojsonPointStore.get(id);

    const matches = spotStore.filter(s => s.name === id);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    let nearest = null;
    let minDist = Infinity;
    for (const s of matches) {
        const d = Math.pow(s.lat - refLat, 2) + Math.pow(s.lng - refLng, 2);
        if (d < minDist) { minDist = d; nearest = s; }
    }
    return nearest;
}

// ========================================
// フィーチャー種別判定
// ========================================
function classifyFeature(f) {
    if (!f.geometry) return null;
    const geomType = f.geometry.type;
    const type = f.properties && f.properties.type;

    if (geomType === 'LineString') return 'route';
    if (geomType === 'Point') {
        if (type === 'spot')  return 'spot';
        if (type === 'photo') return 'photo';
        return 'point';
    }
    return null;
}

// ========================================
// マーカー生成ヘルパー（種別に応じてポップアップも設定）
// ========================================
function buildPointGpsMarker(data) {
    const m = createMarker('pointGps', [data.lat, data.lng]);
    m.bindPopup(`${data.id}<br>${data.name}<br>(PointGPS)`);
    return m;
}

function buildPointMarker(data) {
    const m = createMarker('point', [data.lat, data.lng]);
    m.bindPopup(`${data.id}<br>(Point)`);
    return m;
}

function buildSpotMarker(data) {
    const m = createMarker('spot', [data.lat, data.lng]);
    m.bindPopup(`${data.name}<br>(Spot)`);
    return m;
}

// ========================================
// 全ルート線のスタイル更新（マーカー設定変更時に呼び出す）
// ========================================
export function refreshRoutes() {
    const style = getLineStyle('route');
    routeLineLayer.eachLayer(layer => {
        if (typeof layer.setStyle === 'function') {
            layer.setStyle(style);
        }
    });
}

// ========================================
// 全マーカー再生成（マーカー設定変更時に呼び出す）
// ========================================
export function refreshMarkers() {
    if (!_dataLayer) return;

    // 既存マーカー(全種別)を地図から除去
    Object.values(markerInstancesByType).forEach(arr => {
        arr.forEach(m => _dataLayer.removeLayer(m));
        arr.length = 0;
    });
    markerStore.clear();

    // ポイントGPS
    markerDataByType.pointGps.forEach(d => {
        const m = buildPointGpsMarker(d);
        markerInstancesByType.pointGps.push(m);
        markerStore.set(d.id, m);
        _dataLayer.addLayer(m);
    });
    // ポイント (GeoJSON)
    markerDataByType.point.forEach(d => {
        const m = buildPointMarker(d);
        markerInstancesByType.point.push(m);
        if (d.id) markerStore.set(d.id, m);
        _dataLayer.addLayer(m);
    });
    // スポット (GeoJSON)
    markerDataByType.spot.forEach(d => {
        const m = buildSpotMarker(d);
        markerInstancesByType.spot.push(m);
        _dataLayer.addLayer(m);
    });
}

// ========================================
// 読み込み種別選択モーダル
// ========================================
function showImportModal(features) {
    return new Promise((resolve) => {
        const counts = { point: 0, route: 0, spot: 0 };
        features.forEach(f => {
            const cls = classifyFeature(f);
            if (cls === 'point' || cls === 'route' || cls === 'spot') counts[cls]++;
        });

        document.getElementById('importPointCount').textContent = `${counts.point}点`;
        document.getElementById('importRouteCount').textContent = `${counts.route}本`;
        document.getElementById('importSpotCount').textContent = `${counts.spot}個`;

        document.getElementById('importPoint').checked = false;
        document.getElementById('importRoute').checked = counts.route > 0;
        document.getElementById('importSpot').checked = counts.spot > 0;

        const modal = document.getElementById('geojsonImportModal');
        modal.style.display = 'flex';

        const confirmBtn = document.getElementById('importConfirmBtn');
        const cancelBtn = document.getElementById('importCancelBtn');

        const cleanup = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        };

        const onConfirm = () => {
            const selection = {
                point: document.getElementById('importPoint').checked,
                route: document.getElementById('importRoute').checked,
                spot: document.getElementById('importSpot').checked
            };
            cleanup();
            resolve(selection);
        };

        const onCancel = () => { cleanup(); resolve(null); };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// ========================================
// ポイントGPS(Excel)の読み込み
// ========================================
export function setupExcelInput(dataLayer) {
    _dataLayer = dataLayer;
    // ルート線レイヤーをdataLayer配下に組み込む（最初の1回だけ）
    if (!dataLayer.hasLayer(routeLineLayer)) {
        dataLayer.addLayer(routeLineLayer);
    }
    document.getElementById('excelInput').addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const points = await loadExcelFile(file);

            if (!points || points.length === 0) {
                showMessage('有効なポイントデータが見つかりませんでした', 'warning');
                return;
            }

            points.forEach(p => {
                const pid = String(p.pointId);
                const pname = p.name || '';

                gpsPointStore.set(pid, { lat: p.lat, lng: p.lng });
                if (p.elevation !== undefined) elevationStore.set(pid, p.elevation);

                const data = { id: pid, name: pname, lat: p.lat, lng: p.lng };
                markerDataByType.pointGps.push(data);

                const marker = buildPointGpsMarker(data);
                markerInstancesByType.pointGps.push(marker);
                markerStore.set(pid, marker);
                dataLayer.addLayer(marker);
            });

            showMessage(`${points.length}件のポイントGPSを読み込みました`);
        } catch (error) {
            showMessage(`読み込みエラー: ${error.message}`, 'error');
        } finally {
            this.value = '';
        }
    });
}

// ========================================
// ルート(GeoJSON)ファイルの読み込み
// ========================================
export function setupGeoJsonInput(dataLayer) {
    _dataLayer = dataLayer;
    document.getElementById('geojsonInput').addEventListener('change', async function (e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const allFeatures = [];
        for (const file of files) {
            try {
                const text = await file.text();
                const json = JSON.parse(text);
                if (!json.features || !Array.isArray(json.features)) {
                    showMessage(`読み込みエラー (${file.name}): 有効なGeoJSONではありません`, 'error');
                    continue;
                }
                allFeatures.push(...json.features);
            } catch (error) {
                showMessage(`読み込みエラー (${file.name}): ${error.message}`, 'error');
            }
        }

        if (allFeatures.length === 0) { this.value = ''; return; }

        const selection = await showImportModal(allFeatures);
        if (!selection) { this.value = ''; return; }

        // ─── 第1パス: ポイント・スポットをストアに登録（ルート端点検索用） ───
        allFeatures.forEach(f => {
            const cls = classifyFeature(f);
            const props = f.properties || {};

            if (cls === 'point') {
                const [lng, lat] = f.geometry.coordinates;
                const id = String(props.id || props.pointId || '');
                if (id && !gpsPointStore.has(id)) {
                    geojsonPointStore.set(id, { lat, lng });
                }
            } else if (cls === 'spot') {
                const [lng, lat] = f.geometry.coordinates;
                const name = props.name || '';
                if (name) spotStore.push({ name, lat, lng });
            }
        });

        // ─── 第2パス: 全ルートをストアに登録し、選択された場合は地図に表示 ───
        let count = 0;
        allFeatures.forEach(f => {
            if (classifyFeature(f) !== 'route') return;
            const props = f.properties || {};
            const waypointCoords = f.geometry.coordinates.map(c => [c[1], c[0]]);

            const startId = props.startPoint != null ? String(props.startPoint) : null;
            const endId   = props.endPoint   != null ? String(props.endPoint)   : null;

            const refFirst = waypointCoords.length > 0 ? waypointCoords[0] : [0, 0];
            const refLast  = waypointCoords.length > 0 ? waypointCoords[waypointCoords.length - 1] : [0, 0];

            const startCoord = startId ? findEndpoint(startId, refFirst[0], refFirst[1]) : null;
            const endCoord   = endId   ? findEndpoint(endId,   refLast[0],  refLast[1])  : null;

            const fullCoords = [
                ...(startCoord ? [[startCoord.lat, startCoord.lng]] : []),
                ...waypointCoords,
                ...(endCoord   ? [[endCoord.lat,   endCoord.lng]]   : [])
            ];

            routeFeatureStore.push({ startId, endId, coords: fullCoords });

            if (selection.route) {
                L.polyline(fullCoords, getLineStyle('route')).addTo(routeLineLayer);
                count++;
            }
        });

        // ─── 第3パス: ポイント・スポットを選択された場合に登録 ───
        // (写真は「ルートガイド用写真の選択」パネルから別途読み込む)
        allFeatures.forEach(f => {
            const cls = classifyFeature(f);
            if (cls !== 'point' && cls !== 'spot') return;
            if (!selection[cls]) return;

            const props = f.properties || {};
            const name = props.name || '';

            if (cls === 'point') {
                const [lng, lat] = f.geometry.coordinates;
                const id = String(props.id || props.pointId || '');
                const data = { id, lat, lng };
                markerDataByType.point.push(data);
                const marker = buildPointMarker(data);
                markerInstancesByType.point.push(marker);
                if (id) markerStore.set(id, marker);
                dataLayer.addLayer(marker);
                count++;

            } else if (cls === 'spot') {
                const [lng, lat] = f.geometry.coordinates;
                const data = { name, lat, lng };
                markerDataByType.spot.push(data);
                const marker = buildSpotMarker(data);
                markerInstancesByType.spot.push(marker);
                dataLayer.addLayer(marker);
                count++;
            }
        });

        if (count > 0) showMessage(`${count}件のデータを読み込みました`);

        document.dispatchEvent(new CustomEvent('routeStoreUpdated'));

        this.value = '';
    });
}

// ========================================
// 写真GeoJSONの読み込み (ファイル入出力パネル)
// ========================================
export function setupPhotoInput() {
    document.getElementById('photoGeojsonInput').addEventListener('change', async function (e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        let count = 0;
        for (const file of files) {
            try {
                const text = await file.text();
                const json = JSON.parse(text);
                if (!json.features || !Array.isArray(json.features)) {
                    showMessage(`読み込みエラー (${file.name}): 有効なGeoJSONではありません`, 'error');
                    continue;
                }
                json.features.forEach(f => {
                    if (!f.geometry || f.geometry.type !== 'Point') return;
                    const props = f.properties || {};
                    if (props.type !== 'photo') return;
                    const [lng, lat] = f.geometry.coordinates;
                    markerDataByType.photo.push({
                        lat, lng,
                        thumbnailUrl: props.thumbnailUrl || '',
                        fullUrl: props.fullUrl || '',
                        fileName: props.fileName || '',
                        sourceKmz: props.sourceKmz || ''
                    });
                    count++;
                });
            } catch (error) {
                showMessage(`読み込みエラー (${file.name}): ${error.message}`, 'error');
            }
        }

        if (count > 0) {
            showMessage(`${count}枚の写真を読み込みました`);
            document.dispatchEvent(new CustomEvent('photoStoreUpdated'));
        } else {
            showMessage('写真フィーチャー(type=photo)が見つかりませんでした', 'warning');
        }

        this.value = '';
    });
}

// ========================================
// ルートガイドのファイル出力（GeoJSON）
// ========================================

function withElev(lng, lat, pointId) {
    const e = elevationStore.get(pointId);
    return e !== undefined ? [lng, lat, e] : [lng, lat];
}

function buildRouteGuideCoords(routeGuide) {
    const { points, segmentRoutes } = routeGuide;
    if (points.length === 0) return [];

    if (points.length === 1) {
        const m = markerStore.get(points[0].pointId);
        if (!m) return [];
        const { lat, lng } = m.getLatLng();
        return [withElev(lng, lat, points[0].pointId)];
    }

    const coords = [];
    for (let i = 0; i < points.length - 1; i++) {
        const seg = segmentRoutes[i];
        const startId = points[i].pointId;
        const endId   = points[i + 1].pointId;

        if (seg && seg.length > 0) {
            const converted = seg.map((c, idx) => {
                if (idx === 0)             return withElev(c[1], c[0], startId);
                if (idx === seg.length - 1) return withElev(c[1], c[0], endId);
                return [c[1], c[0]];
            });
            if (i === 0) {
                coords.push(...converted);
            } else {
                coords.push(...converted.slice(1));
            }
        } else {
            if (i === 0) {
                const m0 = markerStore.get(startId);
                if (m0) {
                    const ll = m0.getLatLng();
                    coords.push(withElev(ll.lng, ll.lat, startId));
                }
            }
            const m1 = markerStore.get(endId);
            if (m1) {
                const ll = m1.getLatLng();
                coords.push(withElev(ll.lng, ll.lat, endId));
            }
        }
    }
    return coords;
}

export function setupExportButton() {
    document.getElementById('exportBtn').addEventListener('click', function () {
        const routeGuides = getRouteGuides();
        if (routeGuides.length === 0) {
            showMessage('出力するルートガイドがありません', 'warning');
            return;
        }

        const features = routeGuides
            .filter(rg => rg.points.length > 0)
            .map(rg => ({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: buildRouteGuideCoords(rg)
                },
                properties: {
                    id: rg.id,
                    name: rg.name,
                    fixed: rg.fixed,
                    points: rg.points.map(p => ({ pointId: p.pointId, name: p.name })),
                    segments: rg.segmentRoutes.map(seg =>
                        seg ? seg.map(coord => [coord[1], coord[0]]) : null
                    )
                }
            }));

        const geojson = { type: 'FeatureCollection', features };
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
        const url = URL.createObjectURL(blob);

        const today = new Date();
        const yyyymmdd = today.getFullYear().toString()
            + String(today.getMonth() + 1).padStart(2, '0')
            + String(today.getDate()).padStart(2, '0');
        const filename = `route-guides_${yyyymmdd}.geojson`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        showMessage(`${features.length}件のルートガイドを ${filename} に出力しました`);
    });
}

// ========================================
// ルートガイドのファイル読み込み（GeoJSON）
// ========================================
export function setupImportRouteGuideButton() {
    document.getElementById('routeGuideImportInput').addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const geojson = JSON.parse(text);

            if (!geojson.features || !Array.isArray(geojson.features)) {
                showMessage('有効なGeoJSONではありません', 'error');
                return;
            }

            const imported = geojson.features
                .filter(f => f.properties && Array.isArray(f.properties.points))
                .map(f => {
                    const props = f.properties;
                    const points = props.points.map(p => ({
                        pointId: String(p.pointId),
                        name: p.name || ''
                    }));
                    const segsRaw = Array.isArray(props.segments)
                        ? props.segments
                        : new Array(Math.max(0, points.length - 1)).fill(null);
                    const segmentRoutes = segsRaw.map(seg =>
                        seg ? seg.map(c => [c[1], c[0]]) : null
                    );
                    return {
                        id: Number(props.id) || 0,
                        name: props.name || '',
                        fixed: Boolean(props.fixed),
                        points,
                        segmentRoutes
                    };
                });

            if (imported.length === 0) {
                showMessage('読み込めるルートガイドがありませんでした', 'warning');
                return;
            }

            loadRouteGuides(imported);
            showMessage(`${imported.length}件のルートガイドを読み込みました`);
        } catch (err) {
            showMessage(`読み込みエラー: ${err.message}`, 'error');
        } finally {
            this.value = '';
        }
    });
}
