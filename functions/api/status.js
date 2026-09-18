import { parseAtom } from './lib/tsunami.js';
import { buildPrediction } from './lib/prediction.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=60',
  'x-content-type-options': 'nosniff'
};
const UA = 'KINGAI-Disaster-Watch/0.3 (https://hazard.kingai.work)';
const HOUR = 3600 * 1000;
const EXPECTED_HAZARDS = ['earthquake', 'tsunami', 'volcano', 'tornado'];

const clamp = (n, min=0, max=100) => Math.max(min, Math.min(max, Math.round(n)));
const timestamp = (value) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
};
const ageSeconds = (value) => {
  const ms = timestamp(value);
  return ms == null ? null : Math.max(0, Math.round((Date.now() - ms) / 1000));
};
const isFresh = (value, hours) => {
  const ms = timestamp(value);
  return ms != null && ms <= Date.now() + 5 * 60 * 1000 && Date.now() - ms <= hours * HOUR;
};
const minFinite = (values) => {
  const xs = values.filter(Number.isFinite);
  return xs.length ? Math.min(...xs) : null;
};

async function fetchJson(url, extraHeaders={}) {
  const r = await fetch(url, {
    headers: { 'accept': 'application/json', 'user-agent': UA, ...extraHeaders },
    cf: { cacheTtl: 45, cacheEverything: true }
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 45, cacheEverything: true } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function eqScore(largest, count) {
  let base = largest >= 8 ? 95 : largest >= 7 ? 82 : largest >= 6 ? 65 : largest >= 5 ? 45 : largest >= 4 ? 28 : largest >= 3 ? 16 : largest > 0 ? 8 : 0;
  return clamp(base + Math.min(10, Math.log2(Math.max(1, count)) * 2));
}

function tornadoScore(warnings, watches) {
  if (warnings > 0) return clamp(55 + warnings * 9 + Math.min(10, watches * 2));
  if (watches > 0) return clamp(22 + watches * 7);
  return 0;
}

function volcanoLevelScore(level) {
  const x = String(level || '').toUpperCase();
  return ({ NORMAL: 5, ADVISORY: 35, WATCH: 62, WARNING: 92 })[x] ?? 10;
}

async function earthquakes() {
  const start = new Date(Date.now() - 24 * HOUR).toISOString();
  const boxes = [
    [24, 50, -125, -66],       // contiguous U.S.
    [50, 72, -180, -129],      // Alaska, western hemisphere
    [50, 56, 170, 180],        // far-west Aleutians
    [18, 23, -161, -154],      // Hawaii
    [17, 19, -68, -64],        // Puerto Rico + U.S. Virgin Islands
    [13, 21, 143, 147],        // Guam + Northern Mariana Islands
    [-15, -11, -172, -167]     // American Samoa
  ];
  const urls = boxes.map(([minlat,maxlat,minlon,maxlon]) =>
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${encodeURIComponent(start)}&minmagnitude=2.5&minlatitude=${minlat}&maxlatitude=${maxlat}&minlongitude=${minlon}&maxlongitude=${maxlon}&orderby=time`
  );
  const feeds = await Promise.all(urls.map(u => fetchJson(u)));
  const seen = new Set();
  const events = [];
  for (const feed of feeds) for (const f of feed.features || []) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const [lng, lat, depth] = f.geometry?.coordinates || [];
    events.push({
      id: f.id,
      magnitude: Number(f.properties?.mag || 0),
      place: f.properties?.place || 'Unknown location',
      time: f.properties?.time || null,
      ageSeconds: f.properties?.time ? Math.max(0, Math.round((Date.now() - Number(f.properties.time)) / 1000)) : null,
      url: f.properties?.url || '',
      lat, lng, depth
    });
  }
  events.sort((a,b) => (b.magnitude || 0) - (a.magnitude || 0));
  const largest = events[0]?.magnitude || 0;
  const newestEventAgeSeconds = minFinite(events.map(e => e.ageSeconds));
  return {
    score: eqScore(largest, events.length),
    detail: `${events.length} M2.5+ / 24h · largest M${largest.toFixed(1)}`,
    count: events.length,
    largest,
    windowHours: 24,
    evidenceAgeSeconds: newestEventAgeSeconds,
    events: events.slice(0, 250)
  };
}

async function spcDay1Outlook() {
  const base = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/FeatureServer';
  const fields = 'dn,valid,expire,issue,label,label2,idp_source,idp_filedate,idp_ingestdate';
  const query = 'where=1%3D1&outFields=' + encodeURIComponent(fields) + '&returnGeometry=true&f=geojson';
  const categoryLabels = { 2: 'Thunderstorm', 3: 'Marginal', 4: 'Slight', 5: 'Enhanced', 6: 'Moderate', 8: 'High' };

  const arcAgeSeconds = (value) => {
    const ms = typeof value === 'number' ? value : timestamp(value);
    return Number.isFinite(ms) ? Math.max(0, Math.round((Date.now() - ms) / 1000)) : null;
  };

  try {
    const [categorical, tornado] = await Promise.all([
      fetchJson(`${base}/1/query?${query}`),
      fetchJson(`${base}/3/query?${query}`)
    ]);
    const catFeatures = Array.isArray(categorical?.features) ? categorical.features : [];
    const tornadoFeatures = Array.isArray(tornado?.features) ? tornado.features : [];
    const topCategory = catFeatures.reduce((best, feature) => {
      const value = Number(feature?.properties?.dn || 0);
      return !best || value > Number(best?.properties?.dn || 0) ? feature : best;
    }, null);
    const maxTornadoProbabilityPct = tornadoFeatures.reduce(
      (max, feature) => Math.max(max, Number(feature?.properties?.dn || 0)), 0
    );
    const metadataFeature = topCategory || tornadoFeatures[0] || null;
    const metadata = metadataFeature?.properties || {};
    const evidenceAgeSeconds = minFinite(
      [...catFeatures, ...tornadoFeatures].map(feature => arcAgeSeconds(feature?.properties?.idp_filedate))
    );

    return {
      ok: true,
      source: 'NOAA/NWS Storm Prediction Center',
      layer: 'Day 1 Probabilistic Tornado Outlook',
      semantics: 'Probability of a tornado within 25 miles of a point during the Day 1 valid period.',
      maxTornadoProbabilityPct,
      categorical: {
        value: Number(topCategory?.properties?.dn || 0),
        label: categoryLabels[Number(topCategory?.properties?.dn || 0)] || topCategory?.properties?.label || 'None'
      },
      issue: metadata.issue || '',
      valid: metadata.valid || '',
      expire: metadata.expire || '',
      evidenceAgeSeconds,
      categoricalPolygons: catFeatures.map(feature => {
        const value = Number(feature?.properties?.dn || 0);
        return {
          categoryValue: value,
          categoryLabel: categoryLabels[value] || feature?.properties?.label || 'Unknown',
          valid: feature?.properties?.valid || '',
          expire: feature?.properties?.expire || '',
          issue: feature?.properties?.issue || '',
          geometry: feature?.geometry || null
        };
      }).filter(feature => feature.geometry),
      tornadoPolygons: tornadoFeatures.map(feature => ({
        probabilityPct: Number(feature?.properties?.dn || 0),
        valid: feature?.properties?.valid || '',
        expire: feature?.properties?.expire || '',
        issue: feature?.properties?.issue || '',
        geometry: feature?.geometry || null
      })).filter(feature => feature.geometry)
    };
  } catch (error) {
    return {
      ok: false,
      source: 'NOAA/NWS Storm Prediction Center',
      maxTornadoProbabilityPct: null,
      categorical: { value: null, label: 'Unavailable' },
      evidenceAgeSeconds: null,
      categoricalPolygons: [],
      tornadoPolygons: [],
      error: String(error?.message || error)
    };
  }
}

async function tornadoes() {
  const base = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
  const [warnings, watches, outlook] = await Promise.all([
    fetchJson(`${base}&event=${encodeURIComponent('Tornado Warning')}`),
    fetchJson(`${base}&event=${encodeURIComponent('Tornado Watch')}`),
    spcDay1Outlook()
  ]);
  const features = [...(warnings.features || []), ...(watches.features || [])];
  const alerts = features.map(f => ({
    id: f.id,
    event: f.properties?.event || 'Tornado alert',
    severity: f.properties?.severity || '',
    certainty: f.properties?.certainty || '',
    urgency: f.properties?.urgency || '',
    headline: f.properties?.headline || '',
    areaDesc: f.properties?.areaDesc || '',
    sent: f.properties?.sent || '',
    expires: f.properties?.expires || '',
    ageSeconds: ageSeconds(f.properties?.sent || ''),
    geometry: f.geometry || null
  }));
  const warningCount = alerts.filter(a => a.event === 'Tornado Warning').length;
  const watchCount = alerts.filter(a => a.event === 'Tornado Watch').length;
  const spcText = outlook.ok
    ? `SPC D1 tornado max ${outlook.maxTornadoProbabilityPct}% · ${outlook.categorical.label}`
    : 'SPC D1 outlook unavailable';
  return {
    score: tornadoScore(warningCount, watchCount),
    detail: `${warningCount} warning(s) · ${watchCount} watch(es) · ${spcText}`,
    warningCount,
    watchCount,
    evidenceAgeSeconds: minFinite([...alerts.map(a => a.ageSeconds), outlook.evidenceAgeSeconds]),
    scoringPolicy: 'EMHSI tornado score remains based on active NWS watches/warnings; SPC probability is displayed as official forecast evidence pending calibration.',
    outlook,
    alerts
  };
}

async function volcanoes() {
  const notices = await fetchJson('https://volcanoes.usgs.gov/vsc/api/hansApi/newest');
  const byVolcano = new Map();
  for (const notice of notices || []) for (const s of notice.noticeSections || []) {
    if (!s.vName || !Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lng))) continue;
    const key = s.vnum || `${s.vName}:${s.lat}:${s.lng}`;
    const sentUtc = notice.sentUtc || '';
    const candidate = {
      name: s.vName,
      vnum: s.vnum || '',
      lat: Number(s.lat), lng: Number(s.lng),
      alertLevel: s.alertLevel || notice.obsAlertLevel || 'UNASSIGNED',
      colorCode: s.colorCode || notice.obsColorCode || 'UNASSIGNED',
      synopsis: s.synopsis || '',
      url: s.vUrl || notice.noticeUrl || '',
      sentUtc,
      ageSeconds: ageSeconds(sentUtc)
    };
    const current = byVolcano.get(key);
    const candidateTime = timestamp(candidate.sentUtc) ?? -Infinity;
    const currentTime = timestamp(current?.sentUtc) ?? -Infinity;
    if (!current || candidateTime > currentTime) byVolcano.set(key, candidate);
  }
  const volcanoes = [...byVolcano.values()].sort((a,b) => volcanoLevelScore(b.alertLevel) - volcanoLevelScore(a.alertLevel));
  const max = volcanoes.reduce((m,v) => Math.max(m, volcanoLevelScore(v.alertLevel)), 0);
  const elevated = volcanoes.filter(v => ['ADVISORY','WATCH','WARNING'].includes(String(v.alertLevel).toUpperCase())).length;
  return {
    score: max,
    detail: `${elevated} elevated volcano status(es) · latest notice per volcano`,
    elevated,
    evidenceAgeSeconds: minFinite(volcanoes.map(v => v.ageSeconds)),
    selectionPolicy: 'latest notice per volcano; never historical maximum',
    volcanoes: volcanoes.slice(0, 120)
  };
}

async function tsunamis() {
  const feeds = [
    ['NTWC', 'https://www.tsunami.gov/events/xml/PAAQAtom.xml'],
    ['PTWC', 'https://www.tsunami.gov/events/xml/PHEBAtom.xml']
  ];
  const docs = await Promise.all(feeds.map(async ([center,url]) => [center, await fetchText(url)]));
  const messages = docs.flatMap(([center,xml]) => parseAtom(xml, center));
  messages.sort((a,b) => (timestamp(b.updated) ?? 0) - (timestamp(a.updated) ?? 0));
  const activeCritical = messages.filter(m => m.fresh24h && ['WARNING','ADVISORY','WATCH'].includes(m.level));
  const score = activeCritical.reduce((m,x) => Math.max(m, x.score), 0);
  return {
    score,
    detail: `${activeCritical.length} fresh warning/watch/advisory message(s) in last 24h`,
    freshnessWindowHours: 24,
    evidenceAgeSeconds: minFinite(messages.map(m => m.ageSeconds)),
    messages: messages.slice(0, 20)
  };
}

export async function onRequestGet() {
  const generatedAt = new Date().toISOString();
  const tasks = { earthquake: earthquakes, tornado: tornadoes, volcano: volcanoes, tsunami: tsunamis };
  const data = {};
  const sources = {};

  await Promise.all(Object.entries(tasks).map(async ([name, fn]) => {
    const started = Date.now();
    try {
      data[name] = await fn();
      sources[name] = {
        ok: true,
        checkedAt: generatedAt,
        latencyMs: Date.now() - started,
        evidenceAgeSeconds: Number.isFinite(data[name]?.evidenceAgeSeconds) ? data[name].evidenceAgeSeconds : null
      };
    } catch (error) {
      data[name] = { score: null, detail: 'Source unavailable', error: String(error?.message || error) };
      sources[name] = {
        ok: false,
        checkedAt: generatedAt,
        latencyMs: Date.now() - started,
        evidenceAgeSeconds: null,
        error: String(error?.message || error)
      };
    }
  }));

  const available = EXPECTED_HAZARDS.filter(name => Number.isFinite(data[name]?.score) && sources[name]?.ok);
  const unknownHazards = EXPECTED_HAZARDS.filter(name => !available.includes(name));
  const availableScores = available.map(name => data[name].score);
  const base = availableScores.length ? Math.max(...availableScores) : null;
  const elevatedCount = availableScores.filter(s => s >= 50).length;
  const overall = base == null ? null : clamp(base + Math.max(0, elevatedCount - 1) * 5);
  const coverage = available.length / EXPECTED_HAZARDS.length;
  const sourceConfidence = Number(coverage.toFixed(3));
  const quality = coverage === 1 ? 'complete' : coverage >= 0.75 ? 'partial' : 'degraded';

  const index = {
    score: overall,
    model: 'EMHSI-v1.4.0',
    interpretation: 'Normalized current scenario severity; not an apocalypse probability',
    scope: 'United States, Alaska, Hawaii and U.S. territories where authoritative feeds provide coverage',
    elevatedHazards: elevatedCount,
    coverage: Number(coverage.toFixed(3)),
    sourceConfidence,
    quality,
    availableHazards: available,
    unknownHazards,
    caveat: 'Source confidence describes authoritative-feed coverage, not the probability that a disaster will occur. Official warnings and evacuation instructions always take precedence.'
  };
  const payload = { generatedAt, index, ...data, sources };
  payload.prediction = buildPrediction(payload, generatedAt);

  return new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
}
