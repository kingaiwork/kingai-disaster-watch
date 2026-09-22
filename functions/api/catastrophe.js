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
  const [payload, scoutResult] = await Promise.all([
    fetchJson('https://ssd-api.jpl.nasa.gov/sentry.api', { cacheTtl: 300 }),
    fetchJson('https://ssd-api.jpl.nasa.gov/scout.api', { cacheTtl: 60 })
      .then(data => ({ ok:true, data }))
      .catch(error => ({ ok:false, error:String(error?.message || error) }))
  ]);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const scoutRows = Array.isArray(scoutResult?.data?.data) ? scoutResult.data.data : [];
  const scoutCandidates = scoutRows.map(row => ({
    objectName: row.objectName || '',
    impactRating: n(row.rating),
    neoScore: n(row.neoScore),
    phaScore: n(row.phaScore),
    geocentricScore: n(row.geocentricScore),
    absoluteMagnitudeH: n(row.H),
    observationArcHours: n(row.arc),
    observationCount: n(row.nObs),
    lastRun: row.lastRun || ''
  })).sort((a,b)=>(b.impactRating ?? -1)-(a.impactRating ?? -1));
  const scoutTop = scoutCandidates[0] || null;
  const scoutRating = scoutTop?.impactRating ?? 0;
  const parsed = rows.map(row => ({
    id: row.id || row.des || '',
    name: row.fullname || row.des || row.id || 'Unknown object',
    diameterKm: n(row.diameter),
    impactProbability: n(row.ip),
    palermoCumulative: n(row.ps_cum),
    palermoMax: n(row.ps_max),
    torinoMax: n(row.ts_max),
    encounterRange: row.range || '',
    earliestEncounterYear: Number((String(row.range || '').match(/[0-9]{4}/) || [])[0]) || null,
    lastObservation: row.last_obs || ''
  })).filter(x => x.impactProbability != null);

  const material = parsed.filter(x => (x.diameterKm ?? 0) >= 0.14);
  const civilization = parsed.filter(x => (x.diameterKm ?? 0) >= 1);
  const currentYear = new Date().getUTCFullYear();
  const within100Years = material.filter(x =>
    x.earliestEncounterYear != null &&
    x.earliestEncounterYear >= currentYear &&
    x.earliestEncounterYear <= currentYear + 100
  );
  const civilizationWithin100Years = civilization.filter(x =>
    x.earliestEncounterYear != null &&
    x.earliestEncounterYear >= currentYear &&
    x.earliestEncounterYear <= currentYear + 100
  );
  const highestProbabilityWithin100Years = [...within100Years]
    .filter(x => x.impactProbability != null)
    .sort((a,b) => (b.impactProbability ?? 0) - (a.impactProbability ?? 0))[0] || null;
  material.sort((a,b) => (b.palermoCumulative ?? -99) - (a.palermoCumulative ?? -99));
  const top = material[0] || null;
  let level = 'C0';
  const yearsAway = top?.earliestEncounterYear ? Math.max(0, top.earliestEncounterYear - currentYear) : null;
  if (top) {
    const ps = top.palermoCumulative ?? -99;
    const nearCentury = yearsAway != null && yearsAway <= 100;
    if ((top.diameterKm ?? 0) >= 10 && nearCentury && (top.impactProbability ?? 0) > 0 && ps >= 0) level = 'C5';
    else if (nearCentury && ps >= 1) level = 'C4';
    else if (nearCentury && ps >= 0) level = 'C3';
    else if (nearCentury && ps >= -1) level = 'C2';
    else if (nearCentury && ps >= -2) level = 'C1';
    else if (ps >= 0) level = 'C1';
  }
  const sentryLevel = level;
  if (sentryLevel === 'C0' && scoutRating >= 4) level = 'C1';
  const urgency = yearsAway == null ? 0 : yearsAway <= 25 ? 20 : yearsAway <= 100 ? 10 : 0;
  const sentryScore = top
    ? clamp((yearsAway != null && yearsAway > 100)
        ? Math.max(0, ((top.palermoCumulative ?? -5) + 2) * 8)
        : 8 + Math.max(0,((top.palermoCumulative ?? -5)+3))*10 + urgency)
    : 0;
  const scoutScore = scoutRating >= 4 ? 30 : scoutRating >= 3 ? 18 : scoutRating >= 2 ? 8 : 0;
  const anomalyScore = Math.max(sentryScore, scoutScore);
  const scoutDriven = sentryLevel === 'C0' && level === 'C1';
  return {
    key: 'asteroid',
    title: 'Asteroid impact',
    level,
    anomalyScore,
    confidence: scoutDriven ? 65 : 98,
    reality: scoutDriven ? 'REAL_UNCONFIRMED' : 'REAL',
    scope: 'Global',
    semantics: 'NASA/JPL Sentry provides rigorous long-term impact monitoring. Scout adds near-real-time screening of unconfirmed NEOCP objects; Scout ratings are not probabilities and can only create a C1 watch.',
    trackedObjects: parsed.length,
    materialObjects: material.length,
    civilizationScaleObjects: civilization.length,
    knownMaterialCandidatesWithin100Years: within100Years.length,
    knownCivilizationScaleCandidatesWithin100Years: civilizationWithin100Years.length,
    maxOfficialImpactProbabilityWithin100Years: highestProbabilityWithin100Years?.impactProbability ?? null,
    maxOfficialImpactProbabilityObjectWithin100Years: highestProbabilityWithin100Years,
    officialProbability: top?.impactProbability ?? null,
    probabilityUnit: top ? 'fraction for highest-ranked material Sentry object; object-specific, not a global impact probability' : null,
    topCandidate: top,
    scout: {
      ok: Boolean(scoutResult?.ok),
      count: scoutResult?.ok ? Number(scoutResult?.data?.count || scoutCandidates.length || 0) : null,
      signatureVersion: scoutResult?.data?.signature?.version || null,
      highestImpactRating: scoutTop?.impactRating ?? null,
      highestCandidate: scoutTop,
      watch: scoutRating >= 3,
      c1Triggered: scoutDriven,
      probability: null,
      caveat: 'Scout analyzes unconfirmed NEOCP objects with short observational arcs. Impact Rating is a screening score, not a rigorous impact probability.'
    },
    evidence: [
      ...(top ? [
        `Top material Sentry object: ${top.name}`,
        `Diameter estimate: ${top.diameterKm ?? 'unknown'} km`,
        `Impact probability: ${top.impactProbability}`,
        `Palermo cumulative: ${top.palermoCumulative ?? 'unknown'}`,
        `Potential encounter range: ${top.encounterRange || 'unknown'}`
      ] : ['No >=140 m object was returned by the current Sentry result set.']),
      ...(scoutResult?.ok
        ? [`Scout highest impact rating: ${scoutRating} (${scoutTop?.objectName || 'none'}) — screening only, not probability`]
        : [`Scout unavailable: ${scoutResult?.error || 'unknown error'}`])
    ]
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
  const highImpactPattern=/yellowstone|long valley|valles caldera|newberry/i;
  const highImpact=volcanoes.filter(v=>highImpactPattern.test(v.name));
  const highImpactElevated=highImpact.filter(v=>volcanoRank(v.alertLevel)>=1);
  const highTop=highImpactElevated.sort((a,b)=>volcanoRank(b.alertLevel)-volcanoRank(a.alertLevel))[0]||null;
  const r=volcanoRank(highTop?.alertLevel);
  const level=r>=3?'C3':r>=2?'C2':r>=1?'C1':'C0';
  const yellowstone=volcanoes.find(v=>/yellowstone/i.test(v.name));
  return {
    key:'volcano', title:'Supervolcano / caldera escalation', level,
    anomalyScore:r>=3?78:r>=2?52:r>=1?28:0,
    confidence:92,reality:'REAL',scope:'USGS-monitored U.S. high-impact caldera systems',
    semantics:'Latest USGS HANS notices are filtered for high-impact caldera escalation. Ordinary active volcanoes do not raise the catastrophe class.',
    elevatedCount:elevated.length,
    highImpactEscalations:highImpactElevated.length,
    highest:highTop ? {name:highTop.name,alertLevel:highTop.alertLevel,colorCode:highTop.colorCode,sentUtc:highTop.sentUtc,url:highTop.url}:null,
    operationalHighest:highest ? {name:highest.name,alertLevel:highest.alertLevel,colorCode:highest.colorCode,sentUtc:highest.sentUtc,url:highest.url}:null,
    yellowstoneNotice:yellowstone ? {alertLevel:yellowstone.alertLevel,colorCode:yellowstone.colorCode,sentUtc:yellowstone.sentUtc}:null,
    officialProbability:null,
    evidence:highImpactElevated.length
      ? highImpactElevated.slice(0,4).map(v=>`${v.name}: ${v.alertLevel}/${v.colorCode}`)
      : [`No elevated high-impact caldera notice in current USGS HANS results. Operational elevated volcanoes: ${elevated.length}.`]
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

function buildProbabilityIntegrity(modules) {
  const asteroid = modules?.asteroid || {};
  const p100 = n(asteroid.maxOfficialImpactProbabilityWithin100Years);
  return {
    singleGlobalDoomsdayProbability: null,
    globalStatus: 'NOT_SCIENTIFICALLY_DEFINED',
    explanation: 'A single global doomsday percentage is not scientifically defensible across unrelated hazards and time horizons.',
    rules: [
      'Only authoritative numeric probabilities are exposed as probabilities.',
      'Operational C0-C5 classes and Catastrophe Index are not probabilities.',
      'Long-term background rates are not converted into short-term event forecasts.',
      'Regional catastrophe probability is never relabeled as human-extinction probability.'
    ],
    modules: {
      asteroid: {
        status: p100 == null ? 'NO_MATERIAL_100Y_OBJECT_PROBABILITY' : 'OFFICIAL_OBJECT_SPECIFIC_PROBABILITY',
        horizon: '100 years',
        threshold: '>=140 m estimated diameter',
        probabilityFraction: p100,
        probabilityPercent: p100 == null ? null : Number((p100 * 100).toPrecision(8)),
        candidateCount: Number(asteroid.knownMaterialCandidatesWithin100Years || 0),
        civilizationScaleCandidateCount: Number(asteroid.knownCivilizationScaleCandidatesWithin100Years || 0),
        object: asteroid.maxOfficialImpactProbabilityObjectWithin100Years || null,
        source: 'NASA/JPL Sentry',
        caveat: 'This is the highest object-specific Sentry impact probability among returned >=140 m candidates with an encounter inside 100 years. It is not the total probability that any asteroid will hit Earth. Scout screening ratings are intentionally excluded from probability values.',
        scoutScreening: {
          status: asteroid?.scout?.ok ? 'AVAILABLE_UNCONFIRMED_SCREENING' : 'UNAVAILABLE',
          highestImpactRating: asteroid?.scout?.highestImpactRating ?? null,
          watch: Boolean(asteroid?.scout?.watch),
          probability: null,
          caveat: asteroid?.scout?.caveat || 'Scout is screening evidence, not probability.'
        }
      },
      megaquake: {
        status: 'NO_RELIABLE_SHORT_TERM_PROBABILITY',
        probability: null,
        source: 'USGS',
        caveat: 'Observed seismicity and long-term tectonic hazard do not provide a scientifically reliable exact short-term earthquake probability for a specific megaquake.'
      },
      tsunami: {
        status: 'EVENT_DRIVEN',
        probability: null,
        source: 'NOAA / U.S. Tsunami Warning System',
        caveat: 'Tsunami threat is evaluated after a source event using official warnings, observations and models; no generic doomsday probability is invented.'
      },
      volcano: {
        status: 'NO_RELIABLE_EXACT_ERUPTION_DATE_PROBABILITY',
        probability: null,
        source: 'USGS HANS',
        caveat: 'Alert levels and monitoring anomalies are operational evidence, not an exact eruption-date probability.'
      },
      solar: {
        status: 'OPERATIONAL_FORECAST_NOT_CIVILIZATION_PROBABILITY',
        probability: null,
        source: 'NOAA SWPC',
        caveat: 'Kp, G-scale, CME and solar-wind forecasts are not converted into an unsupported civilization-collapse probability.'
      }
    }
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

  const probabilityIntegrity = buildProbabilityIntegrity(modules);

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
    probabilityIntegrity,
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
      'Earthquake and eruption dates are not deterministically predicted.',
      'No cross-hazard single doomsday probability is fabricated.',
      'NASA Scout impact ratings are treated as unconfirmed screening evidence, never as impact probability.'
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
