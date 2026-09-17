const byId = (id) => document.getElementById(id);

const map = L.map('map', { zoomControl: true }).setView([39.5, -98.35], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
const hazardLayer = L.layerGroup().addTo(map);

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

function setCard(prefix, hazard) {
  byId(`${prefix}Score`).textContent = Number.isFinite(hazard?.score) ? hazard.score : '--';
  byId(`${prefix}Detail`).textContent = hazard?.detail || 'Source unavailable';
}

function popup(title, lines) {
  return `<strong>${escapeHtml(title)}</strong><br>${lines.map(escapeHtml).join('<br>')}`;
}

function plot(data) {
  hazardLayer.clearLayers();

  for (const eq of data.earthquake?.events || []) {
    if (!Number.isFinite(eq.lat) || !Number.isFinite(eq.lng)) continue;
    const radius = Math.max(4, Math.min(14, (eq.magnitude || 0) * 1.5));
    L.circleMarker([eq.lat, eq.lng], {
      radius,
      weight: 1,
      fillOpacity: .72
    }).addTo(hazardLayer).bindPopup(popup(`M${eq.magnitude} earthquake`, [eq.place, new Date(eq.time).toLocaleString()]));
  }

  for (const volcano of data.volcano?.volcanoes || []) {
    if (!Number.isFinite(volcano.lat) || !Number.isFinite(volcano.lng)) continue;
    L.marker([volcano.lat, volcano.lng]).addTo(hazardLayer)
      .bindPopup(popup(volcano.name, [`Alert: ${volcano.alertLevel || 'unknown'}`, volcano.synopsis || 'USGS notice']));
  }

  for (const alert of data.tornado?.alerts || []) {
    if (!alert.geometry) continue;
    try {
      L.geoJSON(alert.geometry, { style: { weight: 2, fillOpacity: .22 } })
        .addTo(hazardLayer)
        .bindPopup(popup(alert.event, [alert.areaDesc || '', alert.headline || '']));
    } catch (_) {}
  }
}

function renderEvents(data) {
  const rows = [];

  for (const a of data.tornado?.alerts || []) rows.push({
    rank: a.event === 'Tornado Warning' ? 100 : 70,
    type: 'TORNADO',
    severity: a.severity || a.event,
    title: a.headline || a.event,
    text: a.areaDesc || 'NWS active alert'
  });

  for (const t of (data.tsunami?.messages || []).filter(t => t.fresh24h)) rows.push({
    rank: /WARNING/i.test(t.title) ? 95 : /ADVISORY/i.test(t.title) ? 75 : /WATCH/i.test(t.title) ? 60 : 25,
    type: 'TSUNAMI',
    severity: t.level || 'MESSAGE',
    title: t.title,
    text: t.updated ? `Updated ${new Date(t.updated).toLocaleString()}` : 'NOAA warning-center message'
  });

  for (const v of data.volcano?.volcanoes || []) {
    if (!['WARNING','WATCH','ADVISORY'].includes((v.alertLevel || '').toUpperCase())) continue;
    rows.push({
      rank: v.alertLevel === 'WARNING' ? 90 : v.alertLevel === 'WATCH' ? 70 : 45,
      type: 'VOLCANO',
      severity: v.alertLevel,
      title: v.name,
      text: v.synopsis || 'USGS volcano notice'
    });
  }

  for (const e of (data.earthquake?.events || []).filter(e => e.magnitude >= 4.5).slice(0, 8)) rows.push({
    rank: Math.round((e.magnitude || 0) * 10),
    type: 'EARTHQUAKE',
    severity: `M${e.magnitude}`,
    title: e.place,
    text: new Date(e.time).toLocaleString()
  });

  rows.sort((a,b) => b.rank - a.rank);
  byId('events').innerHTML = rows.length ? rows.slice(0, 20).map(r => `
    <article class="event">
      <div class="event-top"><span class="event-type">${escapeHtml(r.type)}</span><span class="event-severity">${escapeHtml(r.severity)}</span></div>
      <h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(r.text)}</p>
    </article>`).join('') : '<div class="loading">No high-priority signals in the current feed set.</div>';
}

function renderQuality(data) {
  const coverage = Number(data.index?.coverage);
  const confidence = Number(data.index?.sourceConfidence);
  byId('coverageValue').textContent = Number.isFinite(coverage) ? `${Math.round(coverage * 100)}%` : '--';
  byId('confidenceValue').textContent = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : '--';
  byId('modelValue').textContent = data.index?.model || '--';

  const unknown = data.index?.unknownHazards || [];
  const latencies = Object.entries(data.sources || {})
    .filter(([,v]) => v?.ok && Number.isFinite(v.latencyMs))
    .map(([name,v]) => `${name} ${v.latencyMs}ms`);

  if (unknown.length) {
    byId('sourceState').textContent = `Partial source coverage. Unknown: ${unknown.join(', ')}. Missing data is never treated as safe.`;
  } else {
    byId('sourceState').textContent = `All four authoritative source families responded. ${latencies.join(' · ')}`;
  }
}

async function load() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();

    byId('overallScore').textContent = Number.isFinite(data.index?.score) ? data.index.score : '--';
    byId('overallLabel').textContent = scoreLabel(data.index?.score);
    setCard('eq', data.earthquake);
    setCard('ts', data.tsunami);
    setCard('vo', data.volcano);
    setCard('to', data.tornado);

    const generated = data.generatedAt ? new Date(data.generatedAt) : new Date();
    byId('freshness').textContent = `Updated ${generated.toLocaleTimeString()} · official-source aggregation`;

    renderQuality(data);
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
