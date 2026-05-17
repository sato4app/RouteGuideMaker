// ルートガイドの作成・編集

let _map = null;
let _markerStore = null;
let _routeFeatureStore = null;
let highlightLayer = null;

const SELECTED_ROUTE_STYLE = {
    color: '#ff8c00',
    weight: 5,
    opacity: 0.95,
    interactive: false
};

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

    document.getElementById('routeStart').addEventListener('change', onStartFilterChange);
    document.getElementById('routeEnd').addEventListener('change', onEndFilterChange);
    document.getElementById('routePath').addEventListener('change', onRoutePathChange);
    document.getElementById('preStartPoint').addEventListener('change', onPreStartChange);
    document.getElementById('postEndPoint').addEventListener('change', onPostEndChange);
    document.getElementById('resetDropdownBtn').addEventListener('click', resetDropdowns);

    // ルート読み込み時にドロップダウンを更新
    document.addEventListener('routeStoreUpdated', updateAllDropdowns);

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
        renderSelectedRoute();
    }

    updateAdjacentDropdowns();
}

// ========================================
// 開始前ポイント／終了後ポイントの選択候補
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
        return;
    }

    const basic = _routeFeatureStore[selectedRouteIndex];
    const preCandidates = getConnectedPoints(basic.startId, basic.endId);
    const postCandidates = getConnectedPoints(basic.endId, basic.startId);

    fillDropdown(preSel, preCandidates, preStartPointId);
    fillDropdown(postSel, postCandidates, postEndPointId);

    preSel.disabled = preCandidates.length === 0;
    postSel.disabled = postCandidates.length === 0;

    // 候補に含まれない選択値はクリア
    if (preStartPointId && !preCandidates.includes(preStartPointId)) preStartPointId = '';
    if (postEndPointId && !postCandidates.includes(postEndPointId)) postEndPointId = '';
    preSel.value = preStartPointId;
    postSel.value = postEndPointId;

    renderPointsList();
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
    input.value = [preStartPointId, startId, endId, postEndPointId].join(' → ');
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
}

function onRoutePathChange() {
    const val = document.getElementById('routePath').value;
    selectedRouteIndex = val === '' ? -1 : parseInt(val, 10);
    // 基本ルートが変わったら隣接ポイント選択をクリア
    preStartPointId = '';
    postEndPointId = '';
    renderSelectedRoute();
    updateAdjacentDropdowns();
}

function onPreStartChange() {
    preStartPointId = document.getElementById('preStartPoint').value;
    renderPointsList();
}

function onPostEndChange() {
    postEndPointId = document.getElementById('postEndPoint').value;
    renderPointsList();
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
    renderSelectedRoute();
}

// ========================================
// 選択ルートのハイライト描画
// ========================================
function renderSelectedRoute() {
    if (!highlightLayer) return;
    highlightLayer.clearLayers();
    if (selectedRouteIndex < 0 || selectedRouteIndex >= _routeFeatureStore.length) return;
    const r = _routeFeatureStore[selectedRouteIndex];
    if (!r || !r.coords || r.coords.length === 0) return;
    L.polyline(r.coords, SELECTED_ROUTE_STYLE).addTo(highlightLayer);
}
