const byId = (id) => document.getElementById(id);

const map = L.map('map', { zoomControl: true }).setView([39.5, -98.35], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const mapLayers = {
  earthquakes: L.layerGroup().addTo(map),
  volcanoes: L.layerGroup().addTo(map),
  categorical: L.layerGroup().addTo(map),
  tornadoProbability: L.layerGroup().addTo(map),
  tornadoAlerts: L.layerGroup().addTo(map)
};

L.control.layers({}, {
  'Earthquakes · observed': mapLayers.earthquakes,
  'Volcanoes · USGS status': mapLayers.volcanoes,
  'SPC categorical outlook': mapLayers.categorical,
  'SPC tornado probability': mapLayers.tornadoProbability,
  'NWS tornado alerts': mapLayers.tornadoAlerts
}, { collapsed: true, position: 'topright' }).addTo(map);

let lastData = null;
let selectedHorizon = 6;
let activeEventFilter = 'ALL';

const escapeHtml = (value='') => String(value)
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#039;');

function scoreLabel(score) {
  if (!Number.isFinite(score)) return 'Insufficient live-source coverage';
  if (score >= 85) return 'Extreme operational severity';
  if (score >= 65) return 'High operational severity';
  if (score >= 40) return 'Elevated conditions';
  if (score >= 20) return 'Guarded conditions';
  return 'Low current signal';
}

function humanBand(value='') {
  const x = String(value).toLowerCase();
  return ({ extreme:'Extreme', high:'High', elevated:'Elevated', guarded:'Guarded', low:'Low', unknown:'Unknown' })[x] || value || 'Unknown';
}

function humanTrend(value='') {
  return ({ rising:'Rising', easing:'Easing', steady:'Steady', unknown:'Unknown' })[String(value).toLowerCase()] || value || 'Unknown';
}

function humanAge(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return 'age unknown';
  if (n < 60) return `${Math.round(n)}s old`;
  if (n < 3600) return `${Math.round(n / 60)}m old`;
  if (n < 86400) return `${(n / 3600).toFixed(n < 10800 ? 1 : 0)}h old`;
  return `${(n / 86400).toFixed(1)}d old`;
}

function parseCompactUtc(value) {
  const s = String(value || '').replace(/\D/g, '');
  if (s.length < 12) return null;
  const ms = Date.UTC(
    Number(s.slice(0,4)), Number(s.slice(4,6)) - 1, Number(s.slice(6,8)),
    Number(s.slice(8,10)), Number(s.slice(10,12))
  );
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function formatSpcTime(value) {
  const d = parseCompactUtc(value);
  return d ? d.toLocaleString([], { timeZoneName: 'short' }) : (value || '—');
}

function setCard(prefix, hazard) {
  byId(`${prefix}Score`).textContent = Number.isFinite(hazard?.score) ? hazard.score : '--';
  byId(`${prefix}Detail`).textContent = hazard?.detail || 'Source unavailable';
}

function popup(title, lines) {
  return `<strong>${escapeHtml(title)}</strong><br>${lines.filter(Boolean).map(escapeHtml).join('<br>')}`;
}

function categoryStyle(value) {
  const weight = Number(value) >= 6 ? 2.4 : Number(value) >= 4 ? 2 : 1.5;
  return { weight, fillOpacity: .055, opacity: .65, dashArray: '3 6' };
}

function clearMapLayers() {
  Object.values(mapLayers).forEach(layer => layer.clearLayers());
}

function plot(data) {
  clearMapLayers();

  for (const eq of data.earthquake?.events || []) {
    if (!Number.isFinite(eq.lat) || !Number.isFinite(eq.lng)) continue;
    const radius = Math.max(4, Math.min(16, (eq.magnitude || 0) * 1.55));
    L.circleMarker([eq.lat, eq.lng], {
      radius,
      weight: Math.max(1, (eq.magnitude || 0) >= 6 ? 2 : 1),
      fillOpacity: .68
    }).addTo(mapLayers.earthquakes)
      .bindPopup(popup(`M${eq.magnitude} earthquake`, [
        eq.place,
        `Depth: ${Number.isFinite(eq.depth) ? eq.depth + ' km' : 'unknown'}`,
        eq.time ? new Date(eq.time).toLocaleString() : ''
      ]));
  }

  for (const volcano of data.volcano?.volcanoes || []) {
    if (!Number.isFinite(volcano.lat) || !Number.isFinite(volcano.lng)) continue;
    L.circleMarker([volcano.lat, volcano.lng], {
      radius: 7,
      weight: 2,
      fillOpacity: .78
    }).addTo(mapLayers.volcanoes)
      .bindPopup(popup(volcano.name, [
        `Alert: ${volcano.alertLevel || 'unknown'}`,
        `Aviation: ${volcano.colorCode || 'unknown'}`,
        volcano.synopsis || 'USGS notice'
      ]));
  }

  for (const outlook of data.tornado?.outlook?.categoricalPolygons || []) {
    if (!outlook.geometry) continue;
    try {
      L.geoJSON(outlook.geometry, { style: categoryStyle(outlook.categoryValue) })
        .addTo(mapLayers.categorical)
        .bindPopup(popup('SPC Day 1 categorical outlook', [
          outlook.categoryLabel || 'Convective outlook',
          outlook.valid ? `Valid: ${formatSpcTime(outlook.valid)}` : ''
        ]));
    } catch (_) {}
  }

  for (const outlook of data.tornado?.outlook?.tornadoPolygons || []) {
    if (!outlook.geometry) continue;
    try {
      L.geoJSON(outlook.geometry, { style: { weight: 2.4, fillOpacity: .12, dashArray: '7 5' } })
        .addTo(mapLayers.tornadoProbability)
        .bindPopup(popup('SPC Day 1 tornado probability', [
          `${outlook.probabilityPct || 0}% within 25 miles of a point`,
          outlook.valid ? `Valid: ${formatSpcTime(outlook.valid)}` : 'Official NOAA/NWS SPC outlook'
        ]));
    } catch (_) {}
  }

  for (const alert of data.tornado?.alerts || []) {
    if (!alert.geometry) continue;
    try {
      L.geoJSON(alert.geometry, { style: { weight: 3, fillOpacity: .22 } })
        .addTo(mapLayers.tornadoAlerts)
        .bindPopup(popup(alert.event, [
          alert.areaDesc || '',
          alert.headline || '',
          alert.expires ? `Expires: ${new Date(alert.expires).toLocaleString()}` : ''
        ]));
    } catch (_) {}
  }
}

function buildEventRows(data) {
  const rows = [];
  const spc = data.tornado?.outlook;
  if (spc?.ok && Number(spc.maxTornadoProbabilityPct) > 0) {
    rows.push({
      rank: 40 + Number(spc.maxTornadoProbabilityPct), filter: 'TO',
      type: 'TORNADO OUTLOOK', severity: `${spc.maxTornadoProbabilityPct}% DAY 1`,
      title: 'SPC Day 1 tornado probability',
      text: `${spc.categorical?.label || 'Convective outlook'} · official probability within 25 miles of a point`
    });
  }

  for (const a of data.tornado?.alerts || []) rows.push({
    rank: a.event === 'Tornado Warning' ? 100 : 70, filter: 'TO',
    type: 'TORNADO', severity: a.severity || a.event,
    title: a.headline || a.event,
    text: [a.areaDesc || 'NWS active alert', a.expires ? `Expires ${new Date(a.expires).toLocaleString()}` : ''].filter(Boolean).join(' · ')
  });

  for (const t of (data.tsunami?.messages || []).filter(t => t.fresh24h)) rows.push({
    rank: t.level === 'WARNING' ? 95 : t.level === 'ADVISORY' ? 75 : t.level === 'WATCH' ? 60 : 25,
    filter: 'TS', type: 'TSUNAMI', severity: t.level || 'MESSAGE',
    title: t.title,
    text: t.updated ? `Updated ${new Date(t.updated).toLocaleString()} · ${t.center || 'NOAA'}` : 'NOAA warning-center message'
  });

  for (const v of data.volcano?.volcanoes || []) {
    if (!['WARNING','WATCH','ADVISORY'].includes((v.alertLevel || '').toUpperCase())) continue;
    rows.push({
      rank: v.alertLevel === 'WARNING' ? 90 : v.alertLevel === 'WATCH' ? 70 : 45,
      filter: 'VO', type: 'VOLCANO', severity: v.alertLevel,
      title: v.name, text: v.synopsis || 'USGS volcano notice'
    });
  }

  for (const e of (data.earthquake?.events || []).filter(e => e.magnitude >= 4.0).slice(0, 14)) rows.push({
    rank: Math.round((e.magnitude || 0) * 10), filter: 'EQ',
    type: 'EARTHQUAKE', severity: `M${e.magnitude}`,
    title: e.place,
    text: [e.time ? new Date(e.time).toLocaleString() : '', Number.isFinite(e.depth) ? `Depth ${e.depth} km` : ''].filter(Boolean).join(' · ')
  });

  return rows.sort((a,b) => b.rank - a.rank);
}

function renderEventFilters(rows) {
  const defs = [['ALL','All'],['EQ','Earthquake'],['TS','Tsunami'],['VO','Volcano'],['TO','Tornado']];
  byId('eventFilters').innerHTML = defs.map(([key,label]) => {
    const count = key === 'ALL' ? rows.length : rows.filter(r => r.filter === key).length;
    return `<button class="filter-btn ${activeEventFilter === key ? 'active' : ''}" data-filter="${key}">${label}<span>${count}</span></button>`;
  }).join('');
  byId('eventFilters').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeEventFilter = btn.dataset.filter || 'ALL';
      renderEvents(lastData);
    });
  });
}

function renderEvents(data) {
  const rows = buildEventRows(data);
  renderEventFilters(rows);
  const visible = activeEventFilter === 'ALL' ? rows : rows.filter(r => r.filter === activeEventFilter);
  byId('events').innerHTML = visible.length ? visible.slice(0, 30).map(r => `
    <article class="event">
      <div class="event-top"><span class="event-type">${escapeHtml(r.type)}</span><span class="event-severity">${escapeHtml(r.severity)}</span></div>
      <h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(r.text)}</p>
    </article>`).join('') : '<div class="loading">No signals match this filter.</div>';
}

function renderQuality(data) {
  const coverage = Number(data.index?.coverage);
  const confidence = Number(data.index?.sourceConfidence);
  byId('coverageValue').textContent = Number.isFinite(coverage) ? `${Math.round(coverage * 100)}%` : '--';
  byId('confidenceValue').textContent = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : '--';
  byId('modelValue').textContent = data.index?.model || '--';
  byId('projectionModel').textContent = data.prediction?.model?.version || '--';

  const unknown = data.index?.unknownHazards || [];
  const latencyValues = Object.entries(data.sources || {})
    .filter(([,v]) => v?.ok && Number.isFinite(v.latencyMs))
    .map(([name,v]) => `${name} ${v.latencyMs}ms`);

  byId('sourceState').textContent = unknown.length
    ? `Partial source coverage. Unknown: ${unknown.join(', ')}. Missing data is never treated as safe.`
    : `All four authoritative source families responded. ${latencyValues.join(' · ')}`;
}

function renderSourceHealth(data) {
  const labels = { earthquake:'USGS earthquakes', tsunami:'NOAA tsunami', volcano:'USGS volcano', tornado:'NWS / SPC tornado' };
  byId('sourceHealth').innerHTML = Object.entries(labels).map(([key,label]) => {
    const s = data.sources?.[key];
    const ok = Boolean(s?.ok);
    return `<div class="source-row">
      <div><span class="health-dot ${ok ? 'ok' : 'bad'}"></span><strong>${escapeHtml(label)}</strong></div>
      <div class="source-meta">${ok ? escapeHtml(humanAge(s.evidenceAgeSeconds)) : 'unavailable'} · ${Number.isFinite(s?.latencyMs) ? s.latencyMs + 'ms' : 'latency —'}</div>
    </div>`;
  }).join('');
}

function renderSpc(data) {
  const o = data.tornado?.outlook;
  if (!o?.ok) {
    byId('spcPanel').innerHTML = '<div class="status-callout bad">SPC outlook is currently unavailable. This is treated as unknown, not safe.</div>';
    return;
  }
  byId('spcPanel').innerHTML = `
    <div class="big-metric"><span>${escapeHtml(o.maxTornadoProbabilityPct ?? 0)}%</span><small>maximum Day 1 tornado probability</small></div>
    <div class="intel-kv"><span>Convective category</span><strong>${escapeHtml(o.categorical?.label || '—')}</strong></div>
    <div class="intel-kv"><span>Valid</span><strong>${escapeHtml(formatSpcTime(o.valid))}</strong></div>
    <div class="intel-kv"><span>Expires</span><strong>${escapeHtml(formatSpcTime(o.expire))}</strong></div>
    <div class="intel-kv"><span>Spatial evidence</span><strong>${(o.categoricalPolygons || []).length} categorical · ${(o.tornadoPolygons || []).length} tornado contours</strong></div>
    <p class="fine-print">${escapeHtml(o.semantics || 'Official NOAA/NWS SPC forecast evidence.')}</p>`;
}

function renderForecastTabs(prediction) {
  const horizons = prediction?.horizons || [];
  if (!horizons.some(h => h.hours === selectedHorizon) && horizons[0]) selectedHorizon = horizons[0].hours;
  byId('horizonTabs').innerHTML = horizons.map(h =>
    `<button class="${h.hours === selectedHorizon ? 'active' : ''}" data-hours="${h.hours}">${h.hours}h</button>`
  ).join('');
  byId('horizonTabs').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedHorizon = Number(btn.dataset.hours);
      renderForecast(lastData);
    });
  });
}

function renderForecast(data) {
  const prediction = data.prediction;
  if (!prediction?.horizons?.length) return;
  renderForecastTabs(prediction);
  const h = prediction.horizons.find(x => x.hours === selectedHorizon) || prediction.horizons[0];

  byId('forecastScore').textContent = Number.isFinite(h.score) ? h.score : '--';
  byId('forecastLabel').textContent = `${humanBand(h.label)} projected operational attention · ${selectedHorizon}h horizon`;
  byId('forecastRange').textContent = Array.isArray(h.interval) ? `${h.interval[0]}–${h.interval[1]}` : '--';
  byId('forecastConfidence').textContent = Number.isFinite(h.confidence) ? `${Math.round(h.confidence * 100)}%` : '--';
  byId('forecastTrend').textContent = humanTrend(h.trend);

  const names = { earthquake:'Earthquake', tsunami:'Tsunami', volcano:'Volcano', tornado:'Tornado' };
  const codes = { earthquake:'EQ', tsunami:'TS', volcano:'VO', tornado:'TO' };
  byId('forecastHazards').innerHTML = Object.entries(names).map(([key,name]) => {
    const p = h.hazards?.[key] || {};
    const range = Array.isArray(p.interval) ? `${p.interval[0]}–${p.interval[1]}` : '—';
    const official = Number.isFinite(p.officialForecastPct) ? ` · official SPC ${p.officialForecastPct}%` : '';
    return `<article class="projection-card">
      <div class="projection-top"><span class="projection-code">${codes[key]}</span><span class="projection-trend">${escapeHtml(humanTrend(p.trend))}</span></div>
      <div class="projection-score">${Number.isFinite(p.score) ? p.score : '--'}</div>
      <div class="projection-name">${name} · ${escapeHtml(humanBand(p.label))}</div>
      <div class="projection-meta">range ${range} · confidence ${Number.isFinite(p.confidence) ? Math.round(p.confidence * 100) + '%' : '—'}${official}</div>
      <div class="projection-support">${escapeHtml(p.support || '')}</div>
    </article>`;
  }).join('');

  byId('forecastDrivers').innerHTML = (h.drivers || []).map((d,i) =>
    `<div class="driver"><span>#${i + 1} ${escapeHtml(names[d.hazard] || d.hazard)}</span><strong>${d.score}</strong></div>`
  ).join('');

  const model = prediction.model || {};
  byId('modelTransparency').innerHTML = `
    <div class="intel-kv"><span>Model</span><strong>${escapeHtml(model.name || '—')} · ${escapeHtml(model.version || '')}</strong></div>
    <div class="intel-kv"><span>Status</span><strong>${escapeHtml(model.status || '—')}</strong></div>
    <div class="intel-kv"><span>Architecture</span><strong>${escapeHtml(model.architecture || '—')}</strong></div>
    <div class="status-callout">Not an occurrence probability. No exact-event prediction. Official alerts always take precedence.</div>
    <ul class="limitations">${(prediction.limitations || []).slice(0,5).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
}

async function load() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    lastData = data;

    byId('overallScore').textContent = Number.isFinite(data.index?.score) ? data.index.score : '--';
    byId('overallLabel').textContent = scoreLabel(data.index?.score);
    setCard('eq', data.earthquake);
    setCard('ts', data.tsunami);
    setCard('vo', data.volcano);
    setCard('to', data.tornado);

    const generated = data.generatedAt ? new Date(data.generatedAt) : new Date();
    byId('freshness').textContent = `Updated ${generated.toLocaleTimeString()} · official-source aggregation`;

    renderQuality(data);
    renderSourceHealth(data);
    renderSpc(data);
    renderForecast(data);
    plot(data);
    renderEvents(data);
  } catch (error) {
    byId('freshness').textContent = 'Live source aggregation unavailable';
    byId('sourceState').textContent = `Dashboard API error: ${error.message}. Do not interpret missing data as low risk.`;
    byId('coverageValue').textContent = '--';
    byId('confidenceValue').textContent = '--';
  }
}

load();
setInterval(load, 5 * 60 * 1000);
