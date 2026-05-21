// ルートガイドの作成・編集

import { PHOTO_FILTER_RADIUS_METERS } from './constants.js';
import { createMarker, getLineStyle } from './markerSettings.js';
import { getPhotoData } from './fileIO.js';

let _map = null;
let _markerStore = null;
let _routeFeatureStore = null;
let highlightLayer = null;
let photoLayer = null;

// 選択状態
let selectedRouteIndex = -1;
let preStartPointId = '';
let postEndPointId = '';

// fileIO 互換用スタブ（旧データモデルは未使用）
export function isEditingMode() { return false; }
export function getRouteGuides() { return []; }
export function loadRouteGuides() { /* no-op: 新データモデル未定 */ }

// ========================================
// 初期化
// ========================================
export function setupRouteGuideEditor(map, markerStore, routeFeatureStore) {
    _map = map;
    _markerStore = markerStore;
    _routeFeatureStore = routeFeatureStore;
    highlightLayer = L.layerGroup().addTo(map);
    photoLayer = L.layerGroup().addTo(map);

    document.getElementById('routeStart').addEventListener('change', onStartFilterChange);
    document.getElementById('routeEnd').addEventListener('change', onEndFilterChange);
    document.getElementById('routePath').addEventListener('change', onRoutePathChange);
    document.getElementById('preStartPoint').addEventListener('change', onPreStartChange);
    document.getElementById('postEndPoint').addEventListener('change', onPostEndChange);
    document.getElementById('resetDropdownBtn').addEventListener('click', resetDropdowns);

    // ルート読み込み時にドロップダウンを更新
    document.addEventListener('routeStoreUpdated', updateAllDropdowns);
    // 写真読み込み時に写真フィルタを更新 (ルートが既に選択されていれば再描画)
    document.addEventListener('photoStoreUpdated', renderFilteredPhotos);
    // マーカー設定変更時にハイライト/写真を再描画
    document.addEventListener('markerSettingsChanged', () => {
        renderHighlights();
        renderFilteredPhotos();
    });

    updateAllDropdowns();
    renderPointsList();
}

// ========================================
// ドロップダウン更新
// ========================================
function updateAllDropdowns() {
    updateStartDropdown();
    updateEndDropdown();
    updatePathDropdown();
}

function getValidRoutes() {
    return _routeFeatureStore.filter(r => r.startId && r.endId);
}

function updateStartDropdown() {
    const sel = document.getElementById('routeStart');
    const prev = sel.value;

    const firstChars = new Set();
    getValidRoutes().forEach(r => {
        firstChars.add(r.startId.charAt(0));
        firstChars.add(r.endId.charAt(0));
    });
    const sorted = [...firstChars].sort();

    sel.innerHTML = '<option value="">－</option>';
    sorted.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
    });
    if (prev && sorted.includes(prev)) sel.value = prev;
}

function updateEndDropdown() {
    const startSel = document.getElementById('routeStart');
    const endSel = document.getElementById('routeEnd');
    const startChar = startSel.value;
    const prev = endSel.value;

    const ids = new Set();
    getValidRoutes().forEach(r => {
        if (!startChar || r.startId.charAt(0) === startChar) ids.add(r.startId);
        if (!startChar || r.endId.charAt(0) === startChar) ids.add(r.endId);
    });
    const sorted = [...ids].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );

    endSel.innerHTML = '<option value="">選択</option>';
    sorted.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        endSel.appendChild(opt);
    });
    if (prev && sorted.includes(prev)) endSel.value = prev;
}

function updatePathDropdown() {
    const startChar = document.getElementById('routeStart').value;
    const endId = document.getElementById('routeEnd').value;
    const pathSel = document.getElementById('routePath');
    const prev = pathSel.value;

    let filtered = getValidRoutes();
    if (startChar) {
        filtered = filtered.filter(r =>
            r.startId.charAt(0) === startChar || r.endId.charAt(0) === startChar
        );
    }
    if (endId) {
        filtered = filtered.filter(r => r.startId === endId || r.endId === endId);
    }

    filtered.sort((a, b) => {
        const c = a.startId.localeCompare(b.startId, undefined, { numeric: true });
        return c !== 0 ? c : a.endId.localeCompare(b.endId, undefined, { numeric: true });
    });

    pathSel.innerHTML = '<option value="">開始 ～ 終了ポイント</option>';
    filtered.forEach(r => {
        const idx = _routeFeatureStore.indexOf(r);
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${r.startId} ～ ${r.endId}`;
        pathSel.appendChild(opt);
    });

    if (prev && filtered.some(r => String(_routeFeatureStore.indexOf(r)) === prev)) {
        pathSel.value = prev;
        selectedRouteIndex = parseInt(prev, 10);
    } else {
        selectedRouteIndex = -1;
        renderHighlights();
    }

    updateAdjacentDropdowns();
}

// ========================================
// 前ポイント／後ポイントの選択候補
// ========================================
function getConnectedPoints(anchorId, excludeId) {
    const candidates = new Set();
    _routeFeatureStore.forEach((r, i) => {
        if (i === selectedRouteIndex) return; // 基本ルート自身は除外
        if (!r.startId || !r.endId) return;
        if (r.startId === anchorId && r.endId !== excludeId) candidates.add(r.endId);
        else if (r.endId === anchorId && r.startId !== excludeId) candidates.add(r.startId);
    });
    return [...candidates].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );
}

function updateAdjacentDropdowns() {
    const preSel = document.getElementById('preStartPoint');
    const postSel = document.getElementById('postEndPoint');

    if (selectedRouteIndex < 0) {
        preSel.innerHTML = '<option value="">選択</option>';
        postSel.innerHTML = '<option value="">選択</option>';
        preSel.disabled = true;
        postSel.disabled = true;
        preStartPointId = '';
        postEndPointId = '';
        renderPointsList();
        renderHighlights();
        return;
    }

    const basic = _routeFeatureStore[selectedRouteIndex];
    const preCandidates = getConnectedPoints(basic.startId, basic.endId);
    const postCandidates = getConnectedPoints(basic.endId, basic.startId);

    fillDropdown(preSel, preCandidates, preStartPointId);
    fillDropdown(postSel, postCandidates, postEndPointId);

    preSel.disabled = preCandidates.length === 0;
    postSel.disabled = postCandidates.length === 0;

    if (preStartPointId && !preCandidates.includes(preStartPointId)) preStartPointId = '';
    if (postEndPointId && !postCandidates.includes(postEndPointId)) postEndPointId = '';
    preSel.value = preStartPointId;
    postSel.value = postEndPointId;

    renderPointsList();
    renderHighlights();
}

function fillDropdown(sel, ids, currentValue) {
    sel.innerHTML = '<option value="">選択</option>';
    ids.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        sel.appendChild(opt);
    });
    if (currentValue && ids.includes(currentValue)) sel.value = currentValue;
}

// ========================================
// 4ポイント列挙テキスト
// ========================================
function renderPointsList() {
    const input = document.getElementById('routeGuidePointsList');
    let startId = '';
    let endId = '';
    if (selectedRouteIndex >= 0 && selectedRouteIndex < _routeFeatureStore.length) {
        const basic = _routeFeatureStore[selectedRouteIndex];
        startId = basic.startId || '';
        endId = basic.endId || '';
    }
    const pre  = preStartPointId ? `[${preStartPointId}]` : '';
    const post = postEndPointId  ? `[${postEndPointId}]`  : '';
    input.value = [pre, startId, endId, post].join(' ⇒ ');
}

// ========================================
// ハンドラ
// ========================================
function onStartFilterChange() {
    updateEndDropdown();
    updatePathDropdown();
}

function onEndFilterChange() {
    updatePathDropdown();
    // 絞り込みポイントが選択中ポイントに含まれるためハイライト更新
    renderHighlights();
}

function onRoutePathChange() {
    const val = document.getElementById('routePath').value;
    selectedRouteIndex = val === '' ? -1 : parseInt(val, 10);
    // 基本ルートが変わったら隣接ポイント選択をクリア
    preStartPointId = '';
    postEndPointId = '';
    updateAdjacentDropdowns();
    renderFilteredPhotos();
}

function onPreStartChange() {
    preStartPointId = document.getElementById('preStartPoint').value;
    renderPointsList();
    renderHighlights();
    renderFilteredPhotos();
}

function onPostEndChange() {
    postEndPointId = document.getElementById('postEndPoint').value;
    renderPointsList();
    renderHighlights();
    renderFilteredPhotos();
}

function resetDropdowns() {
    document.getElementById('routeStart').value = '';
    document.getElementById('routeEnd').value = '';
    document.getElementById('routePath').value = '';
    selectedRouteIndex = -1;
    preStartPointId = '';
    postEndPointId = '';
    updateEndDropdown();
    updatePathDropdown();
    renderFilteredPhotos();
}

// ========================================
// ハイライト描画
//   ・ルート前後（開始↔前ルートのうち、開始側から中間点数1/3まで／終了↔後の終了側から1/3まで）
//   ・基本ルート（選択中ルート）
//   ・選択中ポイント（基本ルートの開始/終了、絞り込みで選択したポイント）
// ========================================
function findRouteBetween(idA, idB) {
    return _routeFeatureStore.find(r =>
        (r.startId === idA && r.endId === idB) ||
        (r.startId === idB && r.endId === idA)
    );
}

// ルートのうち anchorId 端点側から、中間点数の一定割合までの座標列を返す
// 中間点 = 端点を除いた内部の点
// 割合: 中間点数 <= 9 なら 2/3、> 9 なら 1/3 (切り上げ)
// 端点を1点 + 割合分の中間点 を含めた連続座標を返す
function getPartialFromAnchor(route, anchorId) {
    if (!route || !route.coords || route.coords.length < 2) return null;
    const n = route.coords.length;
    const waypointCount = Math.max(0, n - 2);
    const numerator = waypointCount <= 9 ? 2 : 1;
    const takeWaypoints = Math.ceil(waypointCount * numerator / 3);
    const takeCoords = Math.max(2, takeWaypoints + 1); // 最低2点で線を成立

    if (route.startId === anchorId) {
        return route.coords.slice(0, Math.min(takeCoords, n));
    } else if (route.endId === anchorId) {
        return route.coords.slice(Math.max(0, n - takeCoords));
    }
    return null;
}

function renderHighlights() {
    if (!highlightLayer) return;
    highlightLayer.clearLayers();

    const hasBasic = selectedRouteIndex >= 0 && selectedRouteIndex < _routeFeatureStore.length;
    const basic = hasBasic ? _routeFeatureStore[selectedRouteIndex] : null;

    // ─── ルート前後（基本ルート/選択中ポイントの下に重ねるため先に描画） ───
    if (basic && preStartPointId && basic.startId) {
        const r = findRouteBetween(preStartPointId, basic.startId);
        const partial = getPartialFromAnchor(r, basic.startId);
        if (partial && partial.length >= 2) {
            L.polyline(partial, getLineStyle('routeAdjacent')).addTo(highlightLayer);
        }
    }
    if (basic && postEndPointId && basic.endId) {
        const r = findRouteBetween(basic.endId, postEndPointId);
        const partial = getPartialFromAnchor(r, basic.endId);
        if (partial && partial.length >= 2) {
            L.polyline(partial, getLineStyle('routeAdjacent')).addTo(highlightLayer);
        }
    }

    // ─── 選択中ルート ───
    if (basic && basic.coords && basic.coords.length > 0) {
        L.polyline(basic.coords, getLineStyle('selectedRoute')).addTo(highlightLayer);
    }

    // ─── 選択中ポイント（基本ルートの開始・終了 + 絞り込みで選択したポイント） ───
    //     前ポイント・後ポイントは含めない
    const selectedIds = new Set();
    if (basic) {
        if (basic.startId) selectedIds.add(basic.startId);
        if (basic.endId)   selectedIds.add(basic.endId);
    }
    const routeEndFilter = document.getElementById('routeEnd').value;
    if (routeEndFilter) selectedIds.add(routeEndFilter);

    selectedIds.forEach(id => {
        const m = _markerStore && _markerStore.get(id);
        if (!m) return;
        const overlay = createMarker('selectedPoint', m.getLatLng());
        overlay.addTo(highlightLayer);
    });
}

// ========================================
// 写真フィルタ表示
//   基本ルートの開始/終了ポイントから半径 PHOTO_FILTER_RADIUS_METERS 以内の
//   写真のみマップに表示する。ルート未選択時は全て非表示。
// ========================================
function buildPhotoPopupHtml(p) {
    const parts = [];
    if (p.thumbnailUrl) {
        parts.push(
            `<img src="${p.thumbnailUrl}" referrerpolicy="no-referrer" ` +
            `style="max-width:240px;max-height:240px;display:block;margin-bottom:6px;">`
        );
    }
    if (p.fileName) {
        parts.push(`<div style="font-size:12px;">${p.fileName}</div>`);
    }
    if (p.sourceKmz) {
        parts.push(`<div style="font-size:11px;color:#666;">${p.sourceKmz}</div>`);
    }
    if (p.fullUrl) {
        parts.push(
            `<div style="margin-top:6px;"><a href="${p.fullUrl}" target="_blank" rel="noopener">元画像を開く</a></div>`
        );
    }
    return `<div>${parts.join('')}</div>`;
}

// フィルタ基準となる座標群を集める:
//   ・基本ルートの全座標 (開始・中間点・終了)
//   ・ルート前後ハイライト範囲 (1/3部分) の全座標
function collectPhotoAnchorCoords() {
    const anchors = [];
    if (selectedRouteIndex < 0 || selectedRouteIndex >= _routeFeatureStore.length) return anchors;
    const basic = _routeFeatureStore[selectedRouteIndex];

    if (basic.coords && basic.coords.length > 0) {
        basic.coords.forEach(c => anchors.push(L.latLng(c[0], c[1])));
    }

    if (preStartPointId && basic.startId) {
        const r = findRouteBetween(preStartPointId, basic.startId);
        const partial = getPartialFromAnchor(r, basic.startId);
        if (partial) partial.forEach(c => anchors.push(L.latLng(c[0], c[1])));
    }
    if (postEndPointId && basic.endId) {
        const r = findRouteBetween(basic.endId, postEndPointId);
        const partial = getPartialFromAnchor(r, basic.endId);
        if (partial) partial.forEach(c => anchors.push(L.latLng(c[0], c[1])));
    }

    return anchors;
}

function renderFilteredPhotos() {
    if (!photoLayer) return;
    photoLayer.clearLayers();

    const anchors = collectPhotoAnchorCoords();
    if (anchors.length === 0) return;

    const radius = PHOTO_FILTER_RADIUS_METERS;
    const photos = getPhotoData();
    photos.forEach(p => {
        const ll = L.latLng(p.lat, p.lng);
        const nearAny = anchors.some(a => ll.distanceTo(a) <= radius);
        if (!nearAny) return;
        const marker = createMarker('photo', ll, { thumbnailUrl: p.thumbnailUrl });
        marker.bindPopup(buildPhotoPopupHtml(p), { maxWidth: 260 });
        marker.addTo(photoLayer);
    });
}
