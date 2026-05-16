// ルートガイドの作成・編集

export function isEditingMode() { return editingMode; }
export function getRouteGuides() { return routeGuides; }
export function setMarkerColors({ selectedPoint, selectedRoute, otherPoint, otherRoute } = {}) {
    if (selectedPoint !== undefined) ROUTE_GUIDE_POINT_STYLE.fillColor = selectedPoint;
    if (selectedRoute !== undefined) ROUTE_GUIDE_ROUTE_STYLE.color = selectedRoute;
    if (otherPoint  !== undefined) ROUTE_GUIDE_POINT_STYLE_OTHER.fillColor = otherPoint;
    if (otherRoute  !== undefined) ROUTE_GUIDE_ROUTE_STYLE_OTHER.color = otherRoute;
    renderRouteGuideOverlay();
}

export function loadRouteGuides(newRouteGuides) {
    if (editingMode) exitEditingMode();
    closeNameArea();
    routeGuides.length = 0;
    newRouteGuides.forEach(rg => routeGuides.push(rg));
    nextId = routeGuides.reduce((max, rg) => Math.max(max, rg.id), 0) + 1;
    currentIndex = routeGuides.length > 0 ? 0 : -1;
    selectedPointIndex = -1;
    renderSelect();
    renderPointList();
    updateButtons();
}

// routeGuides[i] = { id, name, points: [{ pointId, name }], segmentRoutes: [coords|null,...], fixed: bool }
// segmentRoutes[i] = points[i] → points[i+1] 間のルート座標（一度確定したら保持）
const routeGuides = [];
let currentIndex = -1;
let nextId = 1;
let editingMode = false;
let nameAreaMode = null; // 'new' | 'rename' | null
let selectedPointIndex = -1; // 選択中のポイント行インデックス
let _map = null;
let _markerStore = null;
let _routeFeatureStore = null;
let routeGuideLayer = null;

// ルートガイドオーバーレイ: 赤マーカー（interactive: false でクリックを元マーカーに透過）
const ROUTE_GUIDE_POINT_STYLE = {
    radius: 8,
    fillColor: '#ff0000',
    color: '#ffffff',
    weight: 1,
    stroke: true,
    opacity: 1,
    fillOpacity: 0.9,
    interactive: false
};

// ルートガイドオーバーレイ: オレンジルート（interactive: false でマーカーへのクリックを妨げない）
const ROUTE_GUIDE_ROUTE_STYLE = {
    color: '#ff8c00',
    weight: 4,
    opacity: 0.9,
    interactive: false
};

// 非選択ルートガイドのスタイル
const ROUTE_GUIDE_POINT_STYLE_OTHER = {
    radius: 8,
    fillColor: '#f08080',
    color: '#ffffff',
    weight: 1,
    stroke: true,
    opacity: 1,
    fillOpacity: 0.9,
    interactive: false
};
const ROUTE_GUIDE_ROUTE_STYLE_OTHER = {
    color: '#d2b48c',
    weight: 4,
    opacity: 0.9,
    interactive: false
};

// ========================================
// 初期化
// ========================================
export function setupRouteGuideEditor(map, markerStore, routeFeatureStore) {
    _map = map;
    _markerStore = markerStore;
    _routeFeatureStore = routeFeatureStore;
    routeGuideLayer = L.layerGroup().addTo(map);

    document.getElementById('routeGuideNewBtn').addEventListener('click', openNewMode);
    document.getElementById('routeGuideRenameBtn').addEventListener('click', openRenameMode);
    document.getElementById('routeGuideDeleteBtn').addEventListener('click', deleteRouteGuide);
    document.getElementById('routeGuideSelect').addEventListener('change', onSelectChange);
    document.getElementById('routeGuideConfirmBtn').addEventListener('click', confirmName);
    document.getElementById('routeGuideCancelBtn').addEventListener('click', closeNameArea);
    document.getElementById('routeGuideName').addEventListener('keydown', e => {
        if (e.key === 'Enter') confirmName();
        if (e.key === 'Escape') closeNameArea();
    });
    document.getElementById('editStartBtn').addEventListener('click', startEditing);
    document.getElementById('fixBtn').addEventListener('click', fixRouteGuide);
    document.getElementById('pointUpBtn').addEventListener('click', movePointUp);
    document.getElementById('pointDownBtn').addEventListener('click', movePointDown);
    document.getElementById('pointRemoveBtn').addEventListener('click', removePoint);

    document.addEventListener('gpsPointClicked', onGpsPointClicked);

    renderSelect();
    updateButtons();
}

// ========================================
// 名称入力エリア
// ========================================
function openNewMode() {
    nameAreaMode = 'new';
    document.getElementById('routeGuideName').value = '';
    document.getElementById('routeGuideNameArea').style.display = 'block';
    document.getElementById('routeGuideName').focus();
}

function openRenameMode() {
    if (currentIndex < 0) return;
    nameAreaMode = 'rename';
    document.getElementById('routeGuideName').value = routeGuides[currentIndex].name;
    document.getElementById('routeGuideNameArea').style.display = 'block';
    document.getElementById('routeGuideName').focus();
}

function closeNameArea() {
    nameAreaMode = null;
    document.getElementById('routeGuideNameArea').style.display = 'none';
    document.getElementById('routeGuideName').value = '';
}

function confirmName() {
    const name = document.getElementById('routeGuideName').value.trim();
    if (!name) return;

    if (nameAreaMode === 'new') {
        routeGuides.push({ id: nextId++, name, points: [], segmentRoutes: [], fixed: false });
        currentIndex = routeGuides.length - 1;
        renderSelect();
        renderPointList();
    } else if (nameAreaMode === 'rename' && currentIndex >= 0) {
        routeGuides[currentIndex].name = name;
        const opt = document.getElementById('routeGuideSelect').options[currentIndex];
        if (opt) opt.textContent = name;
    }

    closeNameArea();
    updateButtons();
}

// ========================================
// ルートガイド操作
// ========================================
function deleteRouteGuide() {
    if (currentIndex < 0 || currentIndex >= routeGuides.length) return;
    if (editingMode) exitEditingMode();
    closeNameArea();
    selectedPointIndex = -1;
    routeGuides.splice(currentIndex, 1);
    currentIndex = routeGuides.length > 0 ? Math.min(currentIndex, routeGuides.length - 1) : -1;
    renderSelect();
    renderPointList();
    updateButtons();
}

function onSelectChange() {
    if (editingMode) exitEditingMode();
    closeNameArea();
    selectedPointIndex = -1;
    const val = parseInt(document.getElementById('routeGuideSelect').value, 10);
    currentIndex = isNaN(val) ? -1 : val;
    renderPointList();
    updateButtons();
}

// ========================================
// ルートガイド選択リスト描画
// ========================================
function renderSelect() {
    const sel = document.getElementById('routeGuideSelect');
    sel.innerHTML = '';
    if (routeGuides.length === 0) {
        const opt = document.createElement('option');
        opt.value = -1;
        opt.textContent = '（ルートガイドなし）';
        sel.appendChild(opt);
        currentIndex = -1;
    } else {
        routeGuides.forEach((rg, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = rg.name;
            sel.appendChild(opt);
        });
        sel.value = currentIndex;
    }
}

// ========================================
// 編集モード
// ========================================
function startEditing() {
    if (currentIndex < 0) return;
    const routeGuide = routeGuides[currentIndex];
    // 既にポイントが設定済みの場合はクリアせず、そのまま編集を続ける
    if (routeGuide.points.length === 0) {
        routeGuide.points = [];
    }
    routeGuide.fixed = false;
    editingMode = true;
    if (_map) _map.getContainer().style.cursor = 'crosshair';
    renderPointList();
    updateButtons();
}

function fixRouteGuide() {
    if (currentIndex < 0) return;
    routeGuides[currentIndex].fixed = true;
    exitEditingMode();
    renderPointList();
}

function exitEditingMode() {
    editingMode = false;
    if (_map) _map.getContainer().style.cursor = '';
    updateButtons();
}

function onGpsPointClicked(e) {
    if (!editingMode || currentIndex < 0) return;
    const { pointId, name } = e.detail;
    const routeGuide = routeGuides[currentIndex];

    if (selectedPointIndex >= 0 && selectedPointIndex < routeGuide.points.length) {
        // 選択行の次に挿入
        const insertIndex = selectedPointIndex + 1;
        routeGuide.points.splice(insertIndex, 0, { pointId, name });

        const N = routeGuide.points.length; // 挿入後の要素数
        if (insertIndex >= N - 1) {
            // 末尾への追加
            routeGuide.segmentRoutes.push(null);
        } else {
            // 中間への挿入: 既存セグメントを2つのnullスロットに置換
            routeGuide.segmentRoutes.splice(insertIndex - 1, 1, null, null);
        }

        selectedPointIndex = insertIndex;
    } else {
        // 選択なし: 末尾に追加
        routeGuide.points.push({ pointId, name });
        if (routeGuide.segmentRoutes.length < routeGuide.points.length - 1) {
            routeGuide.segmentRoutes.push(null);
        }
    }

    renderPointList(true);
}

// ========================================
// ポイント移動・削除
// ========================================
function movePointUp() {
    if (currentIndex < 0 || selectedPointIndex <= 0) return;
    const { points, segmentRoutes } = routeGuides[currentIndex];
    const i = selectedPointIndex;
    [points[i - 1], points[i]] = [points[i], points[i - 1]];
    // 前後の隣接セグメントを無効化（接続先が変わるため）
    if (i - 2 >= 0) segmentRoutes[i - 2] = null;
    if (i < segmentRoutes.length) segmentRoutes[i] = null;
    selectedPointIndex = i - 1;
    renderPointList();
}

function movePointDown() {
    if (currentIndex < 0 || selectedPointIndex < 0) return;
    const { points, segmentRoutes } = routeGuides[currentIndex];
    const i = selectedPointIndex;
    if (i >= points.length - 1) return;
    [points[i], points[i + 1]] = [points[i + 1], points[i]];
    // 前後の隣接セグメントを無効化
    if (i - 1 >= 0) segmentRoutes[i - 1] = null;
    if (i + 1 < segmentRoutes.length) segmentRoutes[i + 1] = null;
    selectedPointIndex = i + 1;
    renderPointList();
}

function removePoint() {
    if (currentIndex < 0 || selectedPointIndex < 0) return;
    const { points, segmentRoutes } = routeGuides[currentIndex];
    const i = selectedPointIndex;
    points.splice(i, 1);
    if (points.length === 0) {
        segmentRoutes.length = 0;
    } else if (i === 0) {
        segmentRoutes.splice(0, 1);
    } else if (i >= points.length) {
        // 末尾ポイントを削除した場合
        segmentRoutes.splice(segmentRoutes.length - 1, 1);
    } else {
        // 中間ポイントを削除: 前後2セグメントを除去し、新しい接続にnullを挿入
        segmentRoutes.splice(i - 1, 2, null);
    }
    selectedPointIndex = -1;
    renderPointList();
}

// ========================================
// ボタン有効/無効
// ========================================
function updateButtons() {
    const hasRouteGuide = currentIndex >= 0 && currentIndex < routeGuides.length;
    const total = hasRouteGuide ? routeGuides[currentIndex].points.length : 0;
    const sel = selectedPointIndex;
    document.getElementById('routeGuideRenameBtn').disabled = !hasRouteGuide;
    document.getElementById('routeGuideDeleteBtn').disabled = !hasRouteGuide;
    document.getElementById('editStartBtn').disabled = !hasRouteGuide || editingMode;
    document.getElementById('fixBtn').disabled = !editingMode;
    document.getElementById('pointUpBtn').disabled = sel <= 0;
    document.getElementById('pointDownBtn').disabled = sel < 0 || sel >= total - 1;
    document.getElementById('pointRemoveBtn').disabled = sel < 0;
}

// ========================================
// ルートガイドオーバーレイ描画（赤マーカー＋オレンジルート）
// ========================================
function calcRouteLength(coords) {
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
        const dlat = coords[i][0] - coords[i - 1][0];
        const dlng = coords[i][1] - coords[i - 1][1];
        len += Math.sqrt(dlat * dlat + dlng * dlng);
    }
    return len;
}

function renderOneRouteGuide(routeGuide, pointStyle, routeStyle) {
    const { points, segmentRoutes } = routeGuide;

    points.forEach(p => {
        const m = _markerStore && _markerStore.get(p.pointId);
        if (!m) return;
        L.circleMarker(m.getLatLng(), pointStyle).addTo(routeGuideLayer);
    });

    for (let i = 1; i < points.length; i++) {
        const segIdx = i - 1;

        if (segmentRoutes[segIdx]) {
            L.polyline(segmentRoutes[segIdx], routeStyle).addTo(routeGuideLayer);
            continue;
        }

        if (!_routeFeatureStore) break;
        const prevId = points[i - 1].pointId;
        const currId = points[i].pointId;
        const candidates = _routeFeatureStore.filter(r =>
            (r.startId === prevId && r.endId === currId) ||
            (r.startId === currId && r.endId === prevId)
        );
        if (candidates.length === 0) {
            const prevMarker = _markerStore && _markerStore.get(prevId);
            const currMarker = _markerStore && _markerStore.get(currId);
            if (prevMarker && currMarker) {
                L.polyline([prevMarker.getLatLng(), currMarker.getLatLng()], routeStyle).addTo(routeGuideLayer);
            }
            continue;
        }

        let best = candidates[0];
        if (candidates.length > 1) {
            let minLen = Infinity;
            for (const r of candidates) {
                const len = calcRouteLength(r.coords);
                if (len < minLen) { minLen = len; best = r; }
            }
        }

        segmentRoutes[segIdx] = best.coords;
        L.polyline(best.coords, routeStyle).addTo(routeGuideLayer);
    }
}

function renderRouteGuideOverlay() {
    if (!routeGuideLayer) return;
    routeGuideLayer.clearLayers();
    if (routeGuides.length === 0) return;

    // 非選択ルートガイドを先に描画（選択ルートガイドが上に重なるよう）
    routeGuides.forEach((rg, i) => {
        if (i !== currentIndex) {
            renderOneRouteGuide(rg, ROUTE_GUIDE_POINT_STYLE_OTHER, ROUTE_GUIDE_ROUTE_STYLE_OTHER);
        }
    });

    // 選択ルートガイドを後から描画
    if (currentIndex >= 0 && currentIndex < routeGuides.length) {
        renderOneRouteGuide(routeGuides[currentIndex], ROUTE_GUIDE_POINT_STYLE, ROUTE_GUIDE_ROUTE_STYLE);
    }
}

// ========================================
// ポイントリスト描画
// ========================================
function getNoLabel(index, total, fixed) {
    if (index === 0) return '開始';
    if (fixed && index === total - 1) return '終了';
    return `中間${index}`;
}

function renderPointList(redrawOverlay = true) {
    const container = document.getElementById('pointListContainer');
    container.innerHTML = '';
    if (currentIndex < 0 || currentIndex >= routeGuides.length) {
        if (redrawOverlay) renderRouteGuideOverlay();
        return;
    }

    const { points, fixed } = routeGuides[currentIndex];
    const total = points.length;

    points.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'point-row' + (i === selectedPointIndex ? ' point-row-selected' : '');
        row.addEventListener('click', () => {
            selectedPointIndex = (selectedPointIndex === i) ? -1 : i;
            // 行選択の変更はオーバーレイに影響しないため再描画しない
            renderPointList(false);
            updateButtons();
        });

        const noCell = document.createElement('span');
        noCell.className = 'point-no';
        noCell.textContent = getNoLabel(i, total, fixed);

        const idCell = document.createElement('span');
        idCell.className = 'point-id-cell';
        idCell.textContent = p.pointId;

        const nameCell = document.createElement('span');
        nameCell.className = 'point-name-cell';
        nameCell.textContent = p.name;

        row.appendChild(noCell);
        row.appendChild(idCell);
        row.appendChild(nameCell);
        container.appendChild(row);
    });

    if (redrawOverlay) renderRouteGuideOverlay();
}
