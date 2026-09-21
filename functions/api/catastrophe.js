import { parseAtom } from './lib/tsunami.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=60',
  'x-content-type-options': 'nosniff'
};

const UA = 'KINGAI-Global-Anomaly-Radar/1.0 (https://hazard.kingai.work)';
const HOUR = 3600 * 1000;
const LEVELS = ['C0','C1','C2','C3','C4','C5'];
const LEVEL_INDEX = Object.fromEntries(LEVELS.map((x,i) => [x,i]));
const LEVEL_SCORE = { C0: 5, C1: 25, C2: 50, C3: 75, C4: 92, C5: 100 };

const clamp = (n,min=0,max=100) => Math.max(min,Math.min(max,Math.round(Number(n)||0)));
const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const maxLevel = (items) => items.reduce((best,item) =>
  (LEVEL_INDEX[item?.level] ?? -1) > (LEVEL_INDEX[best] ?? -1) ? item.level : best, 'C0');
const isoAgeSeconds = (value) => {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d\d:?\d\d)$/.test(String(value)) ? String(value) : String(value) + 'Z';
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? Math.max(0,Math.round((Date.now()-ms)/1000)) : null;
};

async function fetchJson(url, opts={}) {
  const r = await fetch(url, {
    headers: { accept: 'application/json,text/plain,*/*', 'user-agent': UA, ...(opts.headers||{}) },
    cf: { cacheTtl: opts.cacheTtl ?? 45, cacheEverything: true }
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 45, cacheEverything: true } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
function sourceMeta(ok, started, extra={}) {
  return { ok, checkedAt: new Date().toISOString(), latencyMs: Date.now()-started, ...extra };
}
function truthyLevel(x) { return LEVELS.includes(x) ? x : 'C0'; }

async function asteroidRadar() {
  const payload = await fetchJson('https://ssd-api.jpl.nasa.gov/sentry.api', { cacheTtl: 300 });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const parsed = rows.map(row => ({
    id: row.id || row.des || '',
    name: row.fullname || row.des || row.id || 'Unknown object',
    diameterKm: n(row.diameter),
    impactProbability: n(row.ip),
    palermoCumulative: n(row.ps_cum),
    palermoMax: n(row.ps_max),
    torinoMax: n(row.ts_max),
    encounterRange: row.range || '',
    lastObservation: row.last_obs || ''
  })).filter(x => x.impactProbability != null);

  const material = parsed.filter(x => (x.diameterKm ?? 0) >= 0.14);
  const civilization = parsed.filter(x => (x.diameterKm ?? 0) >= 1);
  material.sort((a,b) => (b.palermoCumulative ?? -99) - (a.palermoCumulative ?? -99));
  const top = material[0] || null;
  let level = 'C0';
  if (top) {
    const ps = top.palermoCumulative ?? -99;
    if ((top.diameterKm ?? 0) >= 10 && (top.impactProbability ?? 0) > 0 && ps >= 0) level = 'C5';
    else if (ps >= 1) level = 'C4';
    else if (ps >= 0) level = 'C3';
    else if (ps >= -1) level = 'C2';
    else if (ps >= -2) level = 'C1';
  }
  const anomalyScore = top ? clamp(15 + Math.max(0,((top.palermoCumulative ?? -5)+3))*18) : 0;
  return {
    key: 'asteroid',
    title: 'Asteroid impact',
    level,
    anomalyScore,
    confidence: 98,
    reality: 'REAL',
    scope: 'Global',
    semantics: 'NASA/JPL Sentry production impact-monitoring results. Palermo scale drives escalation; raw probability alone does not.',
    trackedObjects: parsed.length,
    materialObjects: material.length,
    civilizationScaleObjects: civilization.length,
    officialProbability: top?.impactProbability ?? null,
    probabilityUnit: top ? 'fraction for highest-ranked material Sentry object' : null,
    topCandidate: top,
    evidence: top ? [
      `Top material object: ${top.name}`,
      `Diameter estimate: ${top.diameterKm ?? 'unknown'} km`,
      `Impact probability: ${top.impactProbability}`,
      `Palermo cumulative: ${top.palermoCumulative ?? 'unknown'}`
    ] : ['No >=140 m object was returned by the current Sentry result set.']
  };
}

async function megaquakeRadar() {
  const feed = await fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
  const events = (feed?.features || []).map(f => {
    const p=f.properties||{}; const c=f.geometry?.coordinates||[];
    return {
      id:f.id, magnitude:n(p.mag)??0, place:p.place||'Unknown location',
      time:p.time ? new Date(Number(p.time)).toISOString() : null,
      depthKm:n(c[2]), tsunamiFlag:Number(p.tsunami||0)===1,
      significance:n(p.sig), url:p.url||''
    };
  }).sort((a,b)=>b.magnitude-a.magnitude);
  const top=events[0]||null;
  const m=top?.magnitude ?? 0;
  let level='C0';
  if (m>=9) level='C4';
  else if (m>=8.5) level='C3';
  else if (m>=8) level='C2';
  else if (m>=7.5) level='C1';
  const anomalyScore = clamp(m >= 7 ? (m-7)*38 + 18 : Math.max(0,(m-5)*8));
  return {
    key:'megaquake', title:'Megaquake', level, anomalyScore, confidence:97, reality:'REAL',
    scope:'Global', largest24h:top, eventCount45Plus24h:events.length,
    semantics:'Observed global seismic activity, not a forecast of a future earthquake.',
    officialProbability:null,
    evidence: top ? [
      `Largest M4.5+ event in current 24 h feed: M${m.toFixed(1)}`,
      `Depth: ${top.depthKm ?? 'unknown'} km`,
      `USGS tsunami flag: ${top.tsunamiFlag ? 'yes' : 'no'}`
    ] : ['No M4.5+ event in the current USGS daily feed.']
  };
}

async function tsunamiRadar() {
  const feeds=[
    ['NTWC','https://www.tsunami.gov/events/xml/PAAQAtom.xml'],
    ['PTWC','https://www.tsunami.gov/events/xml/PHEBAtom.xml']
  ];
  const docs=await Promise.all(feeds.map(async ([center,url]) => [center,await fetchText(url)]));
  const messages=docs.flatMap(([center,xml])=>parseAtom(xml,center))
    .sort((a,b)=>(Date.parse(b.updated||'')||0)-(Date.parse(a.updated||'')||0));
  const fresh=messages.filter(m=>m.fresh24h);
  const critical=fresh.filter(m=>['WARNING','ADVISORY','WATCH'].includes(String(m.level||'').toUpperCase()));
  let level='C0';
  if (critical.some(m=>String(m.level).toUpperCase()==='WARNING')) level='C3';
  else if (critical.some(m=>['ADVISORY','WATCH'].includes(String(m.level).toUpperCase()))) level='C2';
  else if (fresh.some(m=>String(m.level||'').toUpperCase()==='INFORMATION')) level='C1';
  return {
    key:'tsunami', title:'Mega-tsunami / tsunami', level,
    anomalyScore: level==='C3'?88:level==='C2'?58:level==='C1'?22:0,
    confidence:97, reality:'REAL', scope:'Pacific / U.S. warning-center coverage',
    semantics:'Official NOAA/U.S. Tsunami Warning System message state. No new tsunami is predicted without a source event.',
    activeCritical:critical.length,
    messages:fresh.slice(0,8).map(m=>({
      center:m.center,level:m.level,title:m.title,updated:m.updated,ageSeconds:m.ageSeconds,url:m.url||''
    })),
    officialProbability:null,
    evidence:critical.length ? critical.slice(0,3).map(m=>`${m.center}: ${m.level} — ${m.title}`) : ['No fresh Warning, Advisory or Watch in the monitored NOAA feeds.']
  };
}

function volcanoRank(level) {
  return ({NORMAL:0,UNASSIGNED:0,ADVISORY:1,WATCH:2,WARNING:3})[String(level||'').toUpperCase()] ?? 0;
}
async function volcanoRadar() {
  const notices=await fetchJson('https://volcanoes.usgs.gov/vsc/api/hansApi/newest');
  const byVolcano=new Map();
  for (const notice of notices||[]) for (const s of notice.noticeSections||[]) {
    if (!s.vName) continue;
    const key=s.vnum||s.vName;
    const candidate={
      name:s.vName,vnum:s.vnum||'',alertLevel:String(s.alertLevel||notice.obsAlertLevel||'UNASSIGNED').toUpperCase(),
      colorCode:String(s.colorCode||notice.obsColorCode||'UNASSIGNED').toUpperCase(),
      synopsis:s.synopsis||'',sentUtc:notice.sentUtc||'',url:s.vUrl||notice.noticeUrl||''
    };
    const old=byVolcano.get(key);
    if (!old || (Date.parse(candidate.sentUtc)||0) > (Date.parse(old.sentUtc)||0)) byVolcano.set(key,candidate);
  }
  const volcanoes=[...byVolcano.values()].sort((a,b)=>volcanoRank(b.alertLevel)-volcanoRank(a.alertLevel));
  const elevated=volcanoes.filter(v=>volcanoRank(v.alertLevel)>=1);
  const highest=elevated[0]||volcanoes[0]||null;
  const r=volcanoRank(highest?.alertLevel);
  const level=r>=3?'C2':r>=2?'C1':r>=1?'C1':'C0';
  const yellowstone=volcanoes.find(v=>/yellowstone/i.test(v.name));
  return {
    key:'volcano', title:'Volcanic escalation', level,
    anomalyScore:r>=3?62:r>=2?40:r>=1?25:5,
    confidence:92,reality:'REAL',scope:'USGS-monitored U.S. volcanoes',
    semantics:'Latest USGS HANS notices. This is unrest/alert-state monitoring, not an eruption-date prediction and not complete global volcano coverage.',
    elevatedCount:elevated.length,
    highest:highest ? {name:highest.name,alertLevel:highest.alertLevel,colorCode:highest.colorCode,sentUtc:highest.sentUtc,url:highest.url}:null,
    yellowstoneNotice:yellowstone ? {alertLevel:yellowstone.alertLevel,colorCode:yellowstone.colorCode,sentUtc:yellowstone.sentUtc}:null,
    officialProbability:null,
    evidence:elevated.length ? elevated.slice(0,4).map(v=>`${v.name}: ${v.alertLevel}/${v.colorCode}`) : ['No elevated volcano notice in the current USGS HANS result set.']
  };
}

function maxGScale(items) {
  let max=0;
  for (const item of items||[]) {
    const txt=`${item?.noaa_scale||''} ${item?.message||''}`;
    for (const m of txt.matchAll(/\bG([1-5])\b/g)) max=Math.max(max,Number(m[1]));
  }
  return max;
}
async function solarRadar() {
  const [alerts,kpSeries,magSummary,speedSummary] = await Promise.all([
    fetchJson('https://services.swpc.noaa.gov/products/alerts.json'),
    fetchJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'),
    fetchJson('https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json'),
    fetchJson('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json')
  ]);
  const now=Date.now();
  const relevantKp=(kpSeries||[]).filter(x=>{
    const t=Date.parse((x.time_tag||'')+(String(x.time_tag||'').endsWith('Z')?'':'Z'));
    return Number.isFinite(t) && t>=now-6*HOUR && t<=now+24*HOUR;
  });
  const maxKp=relevantKp.reduce((m,x)=>Math.max(m,n(x.kp)??0),0);
  const gScale=maxGScale(relevantKp);
  const recentAlerts=(alerts||[]).filter(x=>{
    const t=Date.parse(String(x.issue_datetime||'').replace(' ','T')+'Z');
    return Number.isFinite(t) && t>=now-24*HOUR;
  });
  const alertG=maxGScale(recentAlerts);
  const bz=n(magSummary?.[0]?.bz_gsm);
  const bt=n(magSummary?.[0]?.bt);
  const speed=n(speedSummary?.[0]?.proton_speed);
  const compound = (speed??0)>=900 && (bz??0)<=-15;
  const extremeCompound = (speed??0)>=1400 && (bz??0)<=-25 && maxKp>=9;
  let level='C0';
  if (extremeCompound) level='C3';
  else if (compound && maxKp>=8) level='C2';
  else if (Math.max(gScale,alertG)>=3 || maxKp>=7 || ((speed??0)>=700 && (bz??0)<=-10)) level='C1';
  const anomalyScore=clamp(
    Math.max(0,(maxKp-4)*10) +
    Math.max(0,((speed??300)-450)/20) +
    Math.max(0,-(bz??0))*1.4
  );
  return {
    key:'solar',title:'Extreme solar storm',level,anomalyScore,confidence:94,reality:'REAL',scope:'Earth space-weather environment',
    semantics:'NOAA SWPC operational measurements/forecasts. G5 by itself is not labeled a civilization-ending Carrington event.',
    maxKp24h:Number(maxKp.toFixed(2)), noaaGScale:Math.max(gScale,alertG), bzGsmNt:bz, btNt:bt, solarWindKms:speed,
    compoundExtremeSignal:compound, officialProbability:null,
    evidence:[
      `Max observed/forecast Kp in analysis window: ${maxKp.toFixed(2)}`,
      `Solar wind: ${speed ?? 'unknown'} km/s`,
      `Bz GSM: ${bz ?? 'unknown'} nT`,
      `NOAA G-scale evidence: G${Math.max(gScale,alertG)}`
    ]
  };
}

export async function onRequestGet() {
  const generatedAt=new Date().toISOString();
  const tasks={asteroid:asteroidRadar,megaquake:megaquakeRadar,tsunami:tsunamiRadar,volcano:volcanoRadar,solar:solarRadar};
  const modules={}; const sources={};

  await Promise.all(Object.entries(tasks).map(async ([key,fn])=>{
    const started=Date.now();
    try {
      modules[key]=await fn();
      modules[key].level=truthyLevel(modules[key].level);
      sources[key]=sourceMeta(true,started);
    } catch (error) {
      modules[key]={
        key,title:key,level:null,anomalyScore:null,confidence:0,reality:'UNKNOWN',scope:'Unknown',
        semantics:'Authoritative source unavailable; missing data is unknown, never safe.',
        error:String(error?.message||error),officialProbability:null,evidence:[`Source failure: ${String(error?.message||error)}`]
      };
      sources[key]=sourceMeta(false,started,{error:String(error?.message||error)});
    }
  }));

  const available=Object.values(modules).filter(x=>LEVELS.includes(x.level));
  const unavailable=Object.values(modules).filter(x=>!LEVELS.includes(x.level)).map(x=>x.key);
  const globalLevel=maxLevel(available);
  const catastropheIndex=available.length ? Math.max(...available.map(x=>Math.max(LEVEL_SCORE[x.level]||0,n(x.anomalyScore)??0))) : null;
  const coverage=Number((available.length/Object.keys(tasks).length).toFixed(3));
  const weakSignals=available
    .filter(x=>(LEVEL_INDEX[x.level]??0)>=1)
    .sort((a,b)=>(LEVEL_INDEX[b.level]-LEVEL_INDEX[a.level])||((b.anomalyScore||0)-(a.anomalyScore||0)))
    .map(x=>({key:x.key,title:x.title,level:x.level,anomalyScore:x.anomalyScore,evidence:x.evidence?.slice(0,2)||[]}));

  const payload={
    generatedAt,
    model:{
      name:'KINGAI Global Anomaly Radar',
      version:'GAR-v1.0.0',
      interpretation:'Catastrophe Index and C-levels are operational escalation indicators, not probabilities of the end of the world.'
    },
    global:{
      level:globalLevel,
      catastropheIndex,
      knownExtinctionThreat:available.some(x=>x.level==='C5'),
      knownCatastrophicSignal:available.some(x=>['C4','C5'].includes(x.level)),
      activeWeakSignals:weakSignals.length,
      coverage,
      quality:coverage===1?'complete':coverage>=0.8?'partial':'degraded',
      unavailableModules:unavailable
    },
    modules,
    weakSignals,
    sources,
    realityFirewall:{
      accepted:['REAL official production observations','REAL official production alerts','REAL NASA/JPL Sentry production results'],
      rejectedFromRiskState:['SCENARIO','EXERCISE','SIMULATION','RESEARCH SCENARIO','UNVERIFIED SOCIAL CLAIM'],
      policy:'Scenario or exercise feeds must never change the production catastrophe state.'
    },
    guardrails:[
      'No single global doomsday probability is invented.',
      'Official probabilities are shown only when an authoritative source provides a meaningful probability.',
      'C0-C5 is an escalation class, not an occurrence probability.',
      'Regional catastrophes and civilization-level threats are kept semantically distinct.',
      'Missing data is UNKNOWN/DEGRADED, never silently SAFE.',
      'Earthquake and eruption dates are not deterministically predicted.'
    ],
    levelDefinitions:{
      C0:'Baseline — no material anomaly in available authoritative evidence',
      C1:'Anomaly — credible signal worth monitoring',
      C2:'Confirmed elevated — multiple or stronger official indicators',
      C3:'Severe — major event or extreme compound signal',
      C4:'Catastrophic — very high-consequence event underway or strongly evidenced',
      C5:'Extinction-class — reserved for extraordinary global-scale threat evidence'
    }
  };
  return new Response(JSON.stringify(payload),{headers:JSON_HEADERS});
}
