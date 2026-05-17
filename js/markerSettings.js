// マーカーの現在の設定とマーカー生成ヘルパー
// 設定はMARKER_DEFAULTSをディープコピーした可変オブジェクトとして保持し、
// UIからの変更を受けてここを書き換える。createMarker は常に現在の設定を参照する。

import { MARKER_DEFAULTS } from './constants.js';

// 現在の設定（初期値は MARKER_DEFAULTS のディープコピー）
export const markerSettings = JSON.parse(JSON.stringify(MARKER_DEFAULTS));

// デフォルト値に戻す
export function resetMarkerSettings() {
    Object.keys(MARKER_DEFAULTS).forEach(type => {
        Object.assign(markerSettings[type], MARKER_DEFAULTS[type]);
    });
}

// 線(ルート/選択中ルート/ルート前後)用のスタイル取得
// kind='line' の項目で使用する Leaflet polyline オプション
export function getLineStyle(type) {
    const cfg = markerSettings[type];
    return {
        color: cfg.color,
        weight: cfg.size,
        opacity: 0.85,
        interactive: false
    };
}

// 指定された種別の現在の設定でマーカーを生成
// shape='circle' は L.circleMarker、その他は L.marker + divIcon
export function createMarker(type, latlng) {
    const cfg = markerSettings[type];
    if (cfg.shape === 'circle') {
        return L.circleMarker(latlng, {
            radius: cfg.size,
            fillColor: cfg.color,
            color: cfg.color,
            weight: 0,
            stroke: false,
            opacity: 1,
            fillOpacity: 1
        });
    }
    const px = cfg.size * 2;
    let html = '';
    if (cfg.shape === 'square') {
        html = `<div style="width:${px}px;height:${px}px;background:${cfg.color};border:1px solid white;box-shadow:0 0 2px rgba(0,0,0,0.5);"></div>`;
    } else if (cfg.shape === 'triangle') {
        html = `<div style="width:0;height:0;border-left:${cfg.size}px solid transparent;border-right:${cfg.size}px solid transparent;border-bottom:${px}px solid ${cfg.color};filter:drop-shadow(0 0 1px rgba(0,0,0,0.6));"></div>`;
    } else if (cfg.shape === 'diamond') {
        const inner = `<div style="width:${cfg.size}px;height:${cfg.size}px;background:${cfg.color};transform:rotate(45deg);border:1px solid white;box-shadow:0 0 2px rgba(0,0,0,0.5);"></div>`;
        html = `<div style="display:flex;justify-content:center;align-items:center;width:${px}px;height:${px}px;">${inner}</div>`;
    } else if (cfg.shape === 'star') {
        const clip = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
        html = `<div style="width:${px}px;height:${px}px;background:${cfg.color};clip-path:${clip};filter:drop-shadow(0 0 1px rgba(0,0,0,0.6));"></div>`;
    } else if (cfg.shape === 'line') {
        const thickness = 3;
        const margin = (px - thickness) / 2;
        html = `<div style="width:${px}px;height:${thickness}px;background:${cfg.color};margin-top:${margin}px;box-shadow:0 0 2px rgba(0,0,0,0.5);"></div>`;
    }
    const icon = L.divIcon({
        className: '',
        html,
        iconSize: [px, px],
        iconAnchor: [cfg.size, cfg.size]
    });
    return L.marker(latlng, { icon });
}
