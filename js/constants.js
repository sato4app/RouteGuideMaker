// アプリケーション全体で使用する定数定義

export const DEFAULTS = {
    // 地図設定
    MAP_CENTER: [34.853667, 135.472041], // 箕面大滝
    MAP_ZOOM: 15,
    MAP_MAX_ZOOM: 18,

    // 地理院地図タイル
    GSI_TILE_URL: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    GSI_ATTRIBUTION: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',

    // Excel読み込み制限
    MAX_EXCEL_ROWS: 1000,

    // ルートスタイル（interactive: false でマーカーへのクリックを妨げない）
    ROUTE_STYLE: {
        color: '#4682b4',
        weight: 3,
        opacity: 0.8,
        interactive: false
    }
};

// マーカー／ルート種別ごとのデフォルト設定
// kind: 'point' (マーカー) | 'line' (ルート線)
// shape: kind=='point' で有効。'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'line'
// size: kind=='point' は半径相当ピクセル、kind=='line' は線の太さ
export const MARKER_DEFAULTS = {
    pointGps: {
        label: 'ポイントGPS',
        kind: 'point',
        color: '#008000',
        shape: 'circle',
        size: 6
    },
    point: {
        label: 'ポイント',
        kind: 'point',
        color: '#7fffd4',
        shape: 'circle',
        size: 6
    },
    selectedPoint: {
        label: '選択中ポイント',
        kind: 'point',
        color: '#ff0000',
        shape: 'circle',
        size: 6
    },
    route: {
        label: 'ルート',
        kind: 'line',
        color: '#4682b4',
        shape: 'line',
        size: 3
    },
    selectedRoute: {
        label: '選択中ルート',
        kind: 'line',
        color: '#ff8c00',
        shape: 'line',
        size: 5
    },
    routeAdjacent: {
        label: 'ルート前後',
        kind: 'line',
        color: '#ffa500',
        shape: 'line',
        size: 4
    },
    spot: {
        label: 'スポット',
        kind: 'point',
        color: '#9acd32',
        shape: 'square',
        size: 6
    }
};

// 選択可能なマーカー形状
export const MARKER_SHAPES = [
    { value: 'circle', label: '円' },
    { value: 'square', label: '四角' },
    { value: 'triangle', label: '三角' },
    { value: 'diamond', label: 'ひし形' },
    { value: 'star', label: '星形' },
    { value: 'line', label: '線' }
];

// モード定数
export const MODES = {
    FILEIO: 'fileio',
    ROUTE_GUIDE: 'routeGuide',
    PHOTO: 'photo',
    MARKER: 'marker'
};
