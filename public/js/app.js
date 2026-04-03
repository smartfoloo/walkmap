const T = {
  ja: {
    title: 'Walkmap',
    subtitle: '出発点から徒歩で行ける範囲を可視化します',
    hintDefault: '地図上をクリックして出発点を設定してください',
    hintSelected: (lat, lng) => `出発点: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    sliderLabel: '徒歩時間',
    sliderUnit: '分',
    sliderMin: '1 分',
    sliderMax: '30 分',
    btnRun: '表示',
    btnAnalyzing: '解析中...',
    legendTitle: '出発点からの距離',
    labelNear: '近い',
    labelFar: '遠い',
    statusDefault: '地図をクリックして出発点を設定してください',
    statusFetching: m => `${m}分の徒歩エリアを取得中...`,
    statusDone: n => `完了 — ${n.toLocaleString()} ノード到達`,
    statusError: e => `エラー: ${e}`,
    statMinutes: '分',
    statMeters: '最大距離 (m)',
    statNodes: '到達ノード数',
    clearTitle: 'クリア',
    docTitle: 'Walkmap',
  },
  en: {
    title: 'Walkmap',
    subtitle: 'Visualize the area reachable on foot from a starting point',
    hintDefault: 'Click anywhere on the map to set your starting point',
    hintSelected: (lat, lng) => `Start: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    sliderLabel: 'Walking time',
    sliderUnit: 'min',
    sliderMin: '1 min',
    sliderMax: '30 min',
    btnRun: 'Analyze',
    btnAnalyzing: 'Analyzing...',
    legendTitle: 'Street distance from origin',
    labelNear: 'Near',
    labelFar: 'Far',
    statusDefault: 'Click the map to set a starting point, then click Analyze',
    statusFetching: m => `Fetching street network for ${m} min walk...`, 
    statusDone: n => `Done — ${n.toLocaleString()} nodes reached`,
    statusError: e => `Error: ${e}`,
    statMinutes: 'minutes',
    statMeters: 'max distance (m)',
    statNodes: 'nodes reached',
    clearTitle: 'Clear',
    docTitle: 'Walkmap',
  },
};

let lang = 'ja';
let minutes = 10;
let clickedPoint = null;
let isLoading = false;
let marker = null;

const $ = id => document.getElementById(id);
const elBtnJa = $('btn-ja');
const elBtnEn = $('btn-en');
const elPanelTitle = $('panel-title');
const elSubtitle = $('panel-subtitle');
const elHintText = $('hint-text');
const elSliderLabel = $('slider-label');
const elSliderBadge = $('slider-badge');
const elSliderMin = $('lbl-slider-min');
const elSliderMax = $('lbl-slider-max');
const elDistHint = $('dist-hint');
const elBtnRun = $('btn-run');
const elBtnRunText = $('btn-run-text');
const elBtnClear = $('btn-clear');
const elLegendTitle = $('legend-title');
const elLblNear = $('lbl-near');
const elLblFar = $('lbl-far');
const elStatusText = $('status-text');
const elStatusIcon = $('status-icon-wrap');
const elStatsBar = $('stats-bar');
const elStatMin = $('stat-min');
const elStatM = $('stat-m');
const elStatNodes = $('stat-nodes');
const elLblMinutes = $('lbl-minutes');
const elLblMeters = $('lbl-meters');
const elLblNodes = $('lbl-nodes');

function setLang(l) {
  lang = l;
  elBtnJa.className = l === 'ja' ? 'active' : '';
  elBtnEn.className = l === 'en' ? 'active' : '';
  document.documentElement.lang = l;
  applyTranslations();
}

function applyTranslations() {
  const t = T[lang];
  document.title = t.docTitle;
  elPanelTitle.textContent = t.title;
  elSubtitle.textContent = t.subtitle;
  elHintText.textContent = clickedPoint ? t.hintSelected(clickedPoint.lat, clickedPoint.lng) : t.hintDefault;
  elSliderLabel.textContent = t.sliderLabel;
  elSliderBadge.textContent = `${minutes} ${t.sliderUnit}`;
  elSliderMin.textContent = t.sliderMin;
  elSliderMax.textContent = t.sliderMax;
  if (!isLoading) elBtnRunText.textContent = t.btnRun;
  elLegendTitle.textContent = t.legendTitle;
  elLblNear.textContent = t.labelNear;
  elLblFar.textContent = t.labelFar;
  elLblMinutes.textContent = t.statMinutes;
  elLblMeters.textContent = t.statMeters;
  elLblNodes.textContent = t.statNodes;
  elBtnClear.title = t.clearTitle;
}

elBtnJa.addEventListener('click', () => setLang('ja'));
elBtnEn.addEventListener('click', () => setLang('en'));

$('slider').addEventListener('input', function () {
  minutes = parseInt(this.value);
  elSliderBadge.textContent = `${minutes} ${T[lang].sliderUnit}`;
  elDistHint.textContent = `≈ ${(minutes * 80).toLocaleString()} m`;
});

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [139.7528, 35.6852],
  zoom: 14,
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.getCanvas().style.cursor = 'crosshair';

map.on('load', () => {
  map.addSource('edges', { type: 'geojson', data: emptyFC() });
  map.addSource('polygon', { type: 'geojson', data: emptyFC() });

  map.addLayer({
    id: 'poly-fill', type: 'fill', source: 'polygon',
    paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.10 }
  });
  map.addLayer({
    id: 'poly-line', type: 'line', source: 'polygon',
    paint: { 'line-color': '#1d4ed8', 'line-width': 1.5, 'line-opacity': 0.6 }
  });
  map.addLayer({
    id: 'edges-line', type: 'line', source: 'edges',
    paint: {
      'line-color': ['interpolate', ['linear'], ['get', 'progress'],
        0, '#22c55e', 0.5, '#f59e0b', 1, '#ef4444'],
      'line-width': 2.5,
      'line-opacity': 0.9,
    }
  });

  setStatus('idle');
});

map.on('click', e => {
  clickedPoint = { lat: e.lngLat.lat, lng: e.lngLat.lng };

  if (marker) marker.remove();
  marker = new maplibregl.Marker({ color: '#1e66f5' })
    .setLngLat([clickedPoint.lng, clickedPoint.lat])
    .addTo(map);

  elBtnRun.disabled = false;
  elHintText.textContent = T[lang].hintSelected(clickedPoint.lat, clickedPoint.lng);
  setStatus('idle');
});

elBtnRun.addEventListener('click', runAnalysis);
elBtnClear.addEventListener('click', clearMap);

async function runAnalysis() {
  if (!clickedPoint || isLoading) return;

  isLoading = true;
  elBtnRun.disabled = true;
  elBtnRun.innerHTML = `<div class="spinner"></div><span id="btn-run-text">${T[lang].btnAnalyzing}</span>`;
  elStatsBar.hidden = true;
  setStatus('loading', T[lang].statusFetching);

  try {
    const result = await computeIsochrone(clickedPoint.lat, clickedPoint.lng, minutes);

    map.getSource('edges').setData(result.reachableEdges);
    map.getSource('polygon').setData(
      result.polygon ? { type: 'FeatureCollection', features: [result.polygon] } : emptyFC()
    );

    elStatMin.textContent = minutes;
    elStatM.textContent = (minutes * 80).toLocaleString();
    elStatNodes.textContent = result.reachableCount.toLocaleString();
    elStatsBar.hidden = false;

    setStatus('done', T[lang].statusDone(result.reachableCount));
  } catch (e) {
    setStatus('error', T[lang].statusError(e.message));
  }

  resetBtn();
}

function clearMap() {
  if (marker) { marker.remove(); marker = null; }
  clickedPoint = null;

  if (map.isStyleLoaded()) {
    map.getSource('edges')?.setData(emptyFC());
    map.getSource('polygon')?.setData(emptyFC());
  }

  elStatsBar.hidden = true;
  elBtnRun.disabled = true;
  elHintText.textContent = T[lang].hintDefault;
  setStatus('idle');
}

function resetBtn() {
  isLoading = false;
  elBtnRun.disabled = !clickedPoint;
  elBtnRun.innerHTML = `
    <i class="bi bi-play-fill"></i>
    <span id="btn-run-text">${T[lang].btnRun}</span>`;
}

const STATUS_ICONS = {
  idle: `<i class="bi bi-geo-alt" style="color:#3b82f6"></i>`,
  loading: `<i class="bi bi-arrow-repeat spin" style="color:#3b82f6"></i>`,
  done: `<i class="bi bi-check-circle-fill" style="color:#16a34a"></i>`,
  error: `<i class="bi bi-exclamation-circle-fill" style="color:#dc2626"></i>`,
};

function setStatus(type, msg) {
  elStatusIcon.innerHTML = STATUS_ICONS[type] || STATUS_ICONS.idle;
  elStatusText.textContent = msg ?? T[lang].statusDefault;
  elStatusText.style.color = type === 'error' ? '#dc2626' : '#374151';
}

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

applyTranslations();