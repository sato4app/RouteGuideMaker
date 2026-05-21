// メインアプリケーション

import { MODES, MARKER_SHAPES } from './constants.js';
import { initializeMap } from './mapCore.js';
import { setupExcelInput, setupGeoJsonInput, setupExportButton, setupImportRouteGuideButton, setupPhotoInput, refreshMarkers, refreshRoutes, markerStore, routeFeatureStore } from './fileIO.js';
import { setupRouteGuideEditor, setRouteGuideModeActive } from './routeGuideEditor.js';
import { markerSettings, resetMarkerSettings } from './markerSettings.js';

// 地図とレイヤーの初期化
const { map, dataLayer } = initializeMap();

// ファイル入出力の設定
setupExcelInput(dataLayer);
setupGeoJsonInput(dataLayer);
setupExportButton();
setupImportRouteGuideButton();
setupPhotoInput();

// ルートガイドエディタの設定
setupRouteGuideEditor(map, markerStore, routeFeatureStore);

// モード切り替え処理
document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', function () {
        document.querySelectorAll('.control-section label span').forEach(span => {
            span.classList.remove('selected');
        });
        if (this.checked) {
            this.nextElementSibling.classList.add('selected');
        }

        document.getElementById('fileIoPanel').style.display =
            this.value === MODES.FILEIO ? 'block' : 'none';
        document.getElementById('routeGuidePanel').style.display =
            this.value === MODES.ROUTE_GUIDE ? 'block' : 'none';
        document.getElementById('markerPanel').style.display =
            this.value === MODES.MARKER ? 'block' : 'none';

        // ルートガイドモード以外では写真表示・写真一覧パネルを隠す
        setRouteGuideModeActive(this.value === MODES.ROUTE_GUIDE);
    });
});

// ========================================
// マーカー設定パネル
// ========================================
function renderMarkerSettings() {
    const container = document.getElementById('markerSettingsContainer');
    container.innerHTML = '';

    Object.entries(markerSettings).forEach(([type, cfg]) => {
        const section = document.createElement('div');
        section.className = 'marker-settings-section';

        const name = document.createElement('span');
        name.className = 'marker-type-name';
        name.textContent = cfg.label;

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'marker-color-input';
        colorInput.dataset.type = type;
        colorInput.dataset.attr = 'color';
        colorInput.value = cfg.color;
        colorInput.addEventListener('change', onMarkerSettingChange);

        const shapeSelect = document.createElement('select');
        shapeSelect.className = 'marker-shape-select';
        shapeSelect.dataset.type = type;
        shapeSelect.dataset.attr = 'shape';
        MARKER_SHAPES.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.value;
            opt.textContent = s.label;
            if (s.value === cfg.shape) opt.selected = true;
            shapeSelect.appendChild(opt);
        });
        shapeSelect.addEventListener('change', onMarkerSettingChange);

        const sizeInput = document.createElement('input');
        sizeInput.type = 'number';
        sizeInput.className = 'marker-size-input';
        sizeInput.dataset.type = type;
        sizeInput.dataset.attr = 'size';
        sizeInput.value = cfg.size;
        sizeInput.min = '1';
        sizeInput.max = '20';
        sizeInput.addEventListener('change', onMarkerSettingChange);

        const sizeUnit = document.createElement('span');
        sizeUnit.className = 'marker-size-unit';
        sizeUnit.textContent = 'px';

        section.append(name, colorInput, shapeSelect, sizeInput, sizeUnit);
        container.appendChild(section);
    });
}

function applyAllSettings() {
    refreshMarkers();
    refreshRoutes();
    document.dispatchEvent(new CustomEvent('markerSettingsChanged'));
}

function onMarkerSettingChange(e) {
    const type = e.target.dataset.type;
    const attr = e.target.dataset.attr;
    let value = e.target.value;
    if (attr === 'size') {
        value = parseInt(value, 10);
        if (isNaN(value) || value < 1) value = 1;
        if (value > 20) value = 20;
        e.target.value = value;
    }
    markerSettings[type][attr] = value;
    applyAllSettings();
}

// デフォルト値に戻すボタン
document.getElementById('markerResetBtn').addEventListener('click', () => {
    resetMarkerSettings();
    renderMarkerSettings();
    applyAllSettings();
});

// 初期描画
renderMarkerSettings();
