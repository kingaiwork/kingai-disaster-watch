const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=60',
  'x-content-type-options': 'nosniff'
};
const UA = 'KINGAI-Disaster-Watch/0.2 (https://hazard.kingai.work)';
const HOUR = 3600 * 1000;

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

function tsunamiLevel(title='') {
  const t = title.toUpperCase();
  if (t.includes('WARNING')) return ['WARNING', 96];
  if (t.includes('ADVISORY')) return ['ADVISORY', 72];
  if (t.includes('WATCH')) return ['WATCH', 55];
  if (t.includes('INFORMATION')) return ['INFORMATION', 12];
  return ['MESSAGE', 8];
}

function textTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : '';
}

function decodeXml(s='') {
  return s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'");
}

function parseAtom(xml, center) {
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].slice(0, 20).map(m => {
    const block = m[0];
    const title = decodeXml(textTag(block, 'title'));
    const updated = textTag(block, 'updated');
    const link = block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || '';
    const [level, score] = tsunamiLevel(title);
    return { center, title, updated, ageSeconds: ageSeconds(updated), link, level, score, fresh24h: isFresh(updated, 24) };
  });
}

async function earthquakes() {
  const start = new Date(Date.now() - 24 * HOUR).toISOString();
  const boxes = [
    [24, 50, -125, -66],
    [50, 72, -180, -129],
    [18, 23, -161, -154]
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
  return { score: eqScore(largest, events.length), detail: `${events.length} M2.5+ / 24h · largest M${largest.toFixed(1)}`, count: events.length, largest, windowHours: 24, events: events.slice(0, 250) };
}

async function tornadoes() {
  const base = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
  const [warnings, watches] = await Promise.all([
    fetchJson(`${base}&event=${encodeURIComponent('Tornado Warning')}`),
    fetchJson(`${base}&event=${encodeURIComponent('Tornado Watch')}`)
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
    geometry: f.geometry || null
  }));
  const warningCount = alerts.filter(a => a.event === 'Tornado Warning').length;
  const watchCount = alerts.filter(a => a.event === 'Tornado Watch').length;
  return { score: tornadoScore(warningCount, watchCount), detail: `${warningCount} warning(s) · ${watchCount} watch(es)`, warningCount, watchCount, alerts };
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
    messages: messages.slice(0, 20)
  };
}

export async function onRequestGet() {
  const generatedAt = new Date().toISOString();
  const tasks = { earthquake: earthquakes, tornado: tornadoes, volcano: volcanoes, tsunami: tsunamis };
  const data = {};
  const sources = {};

  await Promise.all(Object.entries(tasks).map(async ([name, fn]) => {
    try {
      data[name] = await fn();
      sources[name] = { ok: true, checkedAt: generatedAt };
    } catch (error) {
      data[name] = { score: null, detail: 'Source unavailable', error: String(error?.message || error) };
      sources[name] = { ok: false, checkedAt: generatedAt, error: String(error?.message || error) };
    }
  }));

  const availableScores = Object.values(data).map(v => v.score).filter(Number.isFinite);
  const base = availableScores.length ? Math.max(...availableScores) : null;
  const elevatedCount = availableScores.filter(s => s >= 50).length;
  const overall = base == null ? null : clamp(base + Math.max(0, elevatedCount - 1) * 5);

  return new Response(JSON.stringify({
    generatedAt,
    index: {
      score: overall,
      model: 'EMHSI-v1.1',
      interpretation: 'Normalized current scenario severity; not an apocalypse probability',
      elevatedHazards: elevatedCount,
      caveat: 'Official warnings and evacuation instructions always take precedence.'
    },
    ...data,
    sources
  }), { headers: JSON_HEADERS });
}
