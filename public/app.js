const byId = (id) => document.getElementById(id);
const safe = (fn) => { try { fn(); } catch (_) {} };
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

let lastData = null;
let selectedHorizon = 6;
let activeEventFilter = 'ALL';

const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

const layers = {
  earthquakes: L.layerGroup().addTo(map),
  volcanoes: L.layerGroup().addTo(map),
  categorical: L.layerGroup().addTo(map),
  tornadoProbability: L.layerGroup().addTo(map),
  tornadoAlerts: L.layerGroup().addTo(map)
};

L.control.layers({}, {
  'Earthquakes · USGS': layers.earthquakes,
  'Volcanoes · USGS': layers.volcanoes,
  'SPC categorical outlook': layers.categorical,
  'SPC tornado probability': layers.tornadoProbability,
  'NWS tornado alerts': layers.tornadoAlerts
}, { collapsed: true, position: 'topright' }).addTo(map);

function band(score) {
  if (!Number.isFinite(Number(score))) return 'Unknown';
  const s = Number(score);
  if (s >= 85) return 'Extreme';
  if (s >= 65) return 'High';
  if (s >= 40) return 'Elevated';
  if (s >= 20) return 'Guarded';
  return 'Low';
}

function scoreLabel(score) {
  const b = band(score);
  return b === 'Unknown' ? 'Insufficient authoritative coverage' : `${b} operational severity`;
}

function humanTrend(v='') {
  return ({ rising:'Rising ↑', easing:'Decreasing ↓', steady:'Steady →', unknown:'Unknown' })[String(v).toLowerCase()] || v || 'Unknown';
}

function humanAge(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return 'age unknown';
  if (n < 60) return `${Math.round(n)} sec ago`;
  if (n < 3600) return `${Math.round(n/60)} min ago`;
  if (n < 86400) return `${(n/3600).toFixed(n < 10800 ? 1 : 0)} hr ago`;
  return `${(n/86400).toFixed(1)} d ago`;
}

function parseCompactUtc(value) {
  const s = String(value || '').replace(/\D/g,'');
  if (s.length < 12) return null;
  const ms = Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), +s.slice(8,10), +s.slice(10,12));
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function formatSpcTime(value) {
  const d = parseCompactUtc(value);
  return d ? d.toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'}) : (value || '—');
}

function popup(title, lines) {
  return `<strong>${esc(title)}</strong><br>${lines.filter(Boolean).map(esc).join('<br>')}`;
}

function sparkline(values, stroke='#e85d8c', fill='rgba(232,93,140,.12)') {
  const xs = values.map(Number).filter(Number.isFinite);
  if (!xs.length) return '';
  const w=120,h=44,p=4,min=Math.min(...xs),max=Math.max(...xs),span=Math.max(1,max-min);
  const pts = xs.map((v,i) => [p + i*(w-2*p)/Math.max(1,xs.length-1), h-p-(v-min)*(h-2*p)/span]);
  const line = pts.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M ${pts[0][0]} ${h-p} L ${pts.map(([x,y])=>`${x} ${y}`).join(' L ')} L ${pts.at(-1)[0]} ${h-p} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" fill="${fill}"/><polyline points="${line}" fill="none" stroke="${stroke}" stroke-width="2"/>${pts.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="1.6" fill="${stroke}"/>`).join('')}</svg>`;
}

function renderBars(values) {
  const box = byId('currentBars');
  if (!box) return;
  const clean = values.map(v => Number.isFinite(Number(v)) ? Number(v) : 0);
  box.innerHTML = clean.map(v => `<i style="height:${Math.max(6,Math.min(34,6+v*.28))}px"></i>`).join('');
}

function projections(data) {
  return data.prediction?.horizons || [];
}

function hazardProjectedSeries(data, key) {
  const current = Number(data[key]?.score);
  const hs = projections(data);
  return [current, ...[6,24,72].map(h => Number(hs.find(x=>x.hours===h)?.hazards?.[key]?.score))].filter(Number.isFinite);
}

function setHazard(prefix, key, data, meta) {
  const hazard = data[key] || {};
  const score = Number(hazard.score);
  byId(prefix+'Score').textContent = Number.isFinite(score) ? Math.round(score) : '--';
  byId(prefix+'Band').textContent = band(score);
  byId(prefix+'Detail').textContent = hazard.detail || 'Authoritative source unavailable';
  byId(prefix+'Meta').textContent = meta(hazard);
  const colors = {eq:['#ef596d','rgba(239,89,109,.14)'],ts:['#4a9dc8','rgba(74,157,200,.14)'],vo:['#e88a35','rgba(232,138,53,.14)'],to:['#a851c5','rgba(168,81,197,.14)']};
  byId(prefix+'Spark').innerHTML = sparkline(hazardProjectedSeries(data,key), colors[prefix][0], colors[prefix][1]);
}

function renderTop(data) {
  const score = Number(data.index?.score);
  byId('overallScore').textContent = Number.isFinite(score) ? Math.round(score) : '--';
  byId('overallLabel').textContent = scoreLabel(score);

  const hs = projections(data);
  for (const h of [6,24,72]) {
    const p = hs.find(x=>x.hours===h);
    byId('score'+h).textContent = Number.isFinite(Number(p?.score)) ? Math.round(p.score) : '--';
    byId('trend'+h).textContent = p ? humanTrend(p.trend) : '--';
    byId('spark'+h).innerHTML = sparkline([score, Number(p?.score)].filter(Number.isFinite), h===6?'#e85d8c':h===24?'#d5933e':'#9a56c2', 'rgba(213,93,160,.1)');
  }

  const conf = Number(data.index?.sourceConfidence);
  const pct = Number.isFinite(conf) ? Math.round(conf*100) : 0;
  byId('confidenceValue').textContent = Number.isFinite(conf) ? pct+'%' : '--';
  byId('confidenceText').textContent = Number.isFinite(conf) ? pct+'%' : '--';
  byId('confidenceDonut').style.setProperty('--p',pct+'%');
  byId('qualityText').textContent = data.index?.quality || 'unknown';
  byId('modelValue').textContent = data.index?.model || '--';
  byId('modelChip').textContent = data.prediction?.model?.version || '--';
  byId('projectionModel').textContent = `${data.prediction?.model?.name || 'Projection model'} · ${data.prediction?.model?.status || ''}`;

  const unknown = data.index?.unknownHazards || [];
  byId('systemStatus').textContent = unknown.length ? `${unknown.length} source family degraded` : 'All Sources Operational';
  byId('trustCoverage').textContent = Number.isFinite(conf) ? pct+'%' : '--';

  const latencies = Object.values(data.sources||{}).map(x=>Number(x?.latencyMs)).filter(Number.isFinite);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : null;
  byId('trustLatency').textContent = avgLatency == null ? '--' : avgLatency < 1000 ? avgLatency+' ms' : (avgLatency/1000).toFixed(1)+' s';

  const evidenceCount = Number(data.earthquake?.count||0)
    + (data.tsunami?.messages||[]).length
    + (data.volcano?.volcanoes||[]).length
    + (data.tornado?.alerts||[]).length;
  byId('trustEvents').textContent = evidenceCount;
  byId('heroLiveSummary').textContent = `${evidenceCount} evidence items · ${pct}% source coverage`;
  byId('formulaMini').textContent = data.index?.formula || 'Transparent versioned aggregation';

  const generated = data.generatedAt ? new Date(data.generatedAt) : new Date();
  byId('freshness').textContent = `Updated ${generated.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;

  const bars = [
    data.earthquake?.score,data.tsunami?.score,data.volcano?.score,data.tornado?.score,
    hs.find(x=>x.hours===6)?.score,hs.find(x=>x.hours===24)?.score,hs.find(x=>x.hours===72)?.score
  ];
  renderBars(bars);

  setHazard('eq','earthquake',data,h=>`${h.count ?? 0} M2.5+ / 24h · largest M${Number(h.largest||0).toFixed(1)}`);
  setHazard('ts','tsunami',data,h=>`${(h.messages||[]).filter(x=>x.fresh24h).length} fresh message(s) / 24h`);
  setHazard('vo','volcano',data,h=>`${h.elevated ?? 0} elevated official status(es)`);
  setHazard('to','tornado',data,h=>`${h.warningCount ?? 0} warnings · ${h.watchCount ?? 0} watches`);
}

function clearMap() { Object.values(layers).forEach(x=>x.clearLayers()); }

function categoryStyle(value) {
  const v=Number(value);
  return { color: v>=6?'#d9556d':v>=4?'#e69743':'#bb79c9', weight:v>=6?2.5:1.8, fillOpacity:.08, dashArray:'5 5' };
}

function plot(data) {
  clearMap();
  for (const e of data.earthquake?.events||[]) {
    if (!Number.isFinite(e.lat)||!Number.isFinite(e.lng)) continue;
    const r=Math.max(4,Math.min(14,(Number(e.magnitude)||0)*1.5));
    L.circleMarker([e.lat,e.lng],{radius:r,color:'#ec5b67',fillColor:'#ff8070',fillOpacity:.55,weight:1.5})
      .addTo(layers.earthquakes).bindPopup(popup(`M${e.magnitude} earthquake`,[e.place,Number.isFinite(e.depth)?`Depth: ${e.depth} km`:'',e.time?new Date(e.time).toLocaleString():'']));
  }
  for (const v of data.volcano?.volcanoes||[]) {
    if (!Number.isFinite(v.lat)||!Number.isFinite(v.lng)) continue;
    L.circleMarker([v.lat,v.lng],{radius:7,color:'#e68b31',fillColor:'#f7ad44',fillOpacity:.72,weight:2})
      .addTo(layers.volcanoes).bindPopup(popup(v.name,[`Alert: ${v.alertLevel||'unknown'}`,`Aviation: ${v.colorCode||'unknown'}`,v.synopsis||'']));
  }
  for (const p of data.tornado?.outlook?.categoricalPolygons||[]) {
    if (!p.geometry) continue;
    safe(()=>L.geoJSON(p.geometry,{style:categoryStyle(p.categoryValue)}).addTo(layers.categorical).bindPopup(popup('SPC Day 1 categorical outlook',[p.categoryLabel||'',p.valid?`Valid: ${formatSpcTime(p.valid)}`:''])));
  }
  for (const p of data.tornado?.outlook?.tornadoPolygons||[]) {
    if (!p.geometry) continue;
    safe(()=>L.geoJSON(p.geometry,{style:{color:'#a95bc9',weight:2,fillColor:'#d081da',fillOpacity:.1,dashArray:'7 5'}}).addTo(layers.tornadoProbability).bindPopup(popup('SPC Day 1 tornado probability',[`${p.probabilityPct||0}% within 25 miles of a point`,p.valid?`Valid: ${formatSpcTime(p.valid)}`:''])));
  }
  for (const a of data.tornado?.alerts||[]) {
    if (!a.geometry) continue;
    safe(()=>L.geoJSON(a.geometry,{style:{color:'#d94a80',weight:3,fillColor:'#f16f86',fillOpacity:.15}}).addTo(layers.tornadoAlerts).bindPopup(popup(a.event,[a.areaDesc||'',a.headline||''])));
  }
}

function eventRows(data) {
  const rows=[];
  const spc=data.tornado?.outlook;
  if (spc?.ok) rows.push({rank:40+Number(spc.maxTornadoProbabilityPct||0),filter:'TO',type:'TORNADO OUTLOOK',severity:`${spc.maxTornadoProbabilityPct||0}%`,title:'SPC Day 1 tornado outlook',text:`${spc.categorical?.label||'Convective outlook'} · probability within 25 miles of a point`});
  for (const a of data.tornado?.alerts||[]) rows.push({rank:a.event==='Tornado Warning'?100:72,filter:'TO',type:'TORNADO',severity:a.severity||a.event,title:a.headline||a.event,text:a.areaDesc||'NWS active alert'});
  for (const t of (data.tsunami?.messages||[]).filter(x=>x.fresh24h)) rows.push({rank:t.level==='WARNING'?96:t.level==='ADVISORY'?72:t.level==='WATCH'?55:20,filter:'TS',type:'TSUNAMI',severity:t.level,title:t.title,text:t.updated?`Updated ${new Date(t.updated).toLocaleString()} · ${t.center}`:'NOAA message'});
  for (const v of data.volcano?.volcanoes||[]) if (['WARNING','WATCH','ADVISORY'].includes(String(v.alertLevel).toUpperCase())) rows.push({rank:v.alertLevel==='WARNING'?92:v.alertLevel==='WATCH'?62:35,filter:'VO',type:'VOLCANO',severity:v.alertLevel,title:v.name,text:v.synopsis||'USGS notice'});
  for (const e of (data.earthquake?.events||[]).filter(x=>Number(x.magnitude)>=4).slice(0,12)) rows.push({rank:Number(e.magnitude)*10,filter:'EQ',type:'EARTHQUAKE',severity:`M${e.magnitude}`,title:e.place,text:e.time?new Date(e.time).toLocaleString():'USGS event'});
  return rows.sort((a,b)=>b.rank-a.rank);
}

function renderEvents(data) {
  const rows=eventRows(data);
  const defs=[['ALL','All'],['EQ','Earthquake'],['TS','Tsunami'],['VO','Volcano'],['TO','Tornado']];
  byId('eventFilters').innerHTML=defs.map(([k,l])=>`<button class="filter-btn ${activeEventFilter===k?'active':''}" data-filter="${k}">${l}</button>`).join('');
  byId('eventFilters').querySelectorAll('button').forEach(b=>b.onclick=()=>{activeEventFilter=b.dataset.filter;renderEvents(lastData)});
  const visible=activeEventFilter==='ALL'?rows:rows.filter(r=>r.filter===activeEventFilter);
  byId('events').innerHTML=visible.length?visible.slice(0,18).map(r=>`<article class="event"><div class="event-top"><span class="event-type">${esc(r.type)}</span><span class="event-severity">${esc(r.severity)}</span></div><h3>${esc(r.title)}</h3><p>${esc(r.text)}</p></article>`).join(''):'<div class="loading">No current signals in this filter.</div>';
}

function renderForecast(data) {
  const hs=projections(data);
  if (!hs.length) return;
  if (!hs.some(x=>x.hours===selectedHorizon)) selectedHorizon=hs[0].hours;
  byId('horizonTabs').innerHTML=hs.map(h=>`<button class="${h.hours===selectedHorizon?'active':''}" data-hours="${h.hours}">${h.hours} Hours</button>`).join('');
  byId('horizonTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectedHorizon=+b.dataset.hours;renderForecast(lastData)});
  const h=hs.find(x=>x.hours===selectedHorizon)||hs[0];
  byId('forecastRange').textContent=Array.isArray(h.interval)?`${h.interval[0]} – ${h.interval[1]}`:'--';
  byId('forecastConfidence').textContent=Number.isFinite(Number(h.confidence))?`${Math.round(h.confidence*100)}%`:'--';
  byId('forecastTrend').textContent=humanTrend(h.trend);
  byId('forecastDrivers').innerHTML=(h.drivers||[]).map((d,i)=>`<span class="driver">#${i+1} ${esc(d.hazard)} <strong>${d.score}</strong></span>`).join('');

  const current=Number(data.index?.score)||0;
  const points=[{label:'Now',score:current,hours:0},...hs.map(x=>({label:`+${x.hours}h`,score:Number(x.score)||0,hours:x.hours}))];
  const w=560,hg=220,pad=38;
  const x=(i)=>pad+i*(w-pad*2)/(points.length-1);
  const y=(v)=>hg-pad-(Math.max(0,Math.min(100,v))/100)*(hg-pad*2);
  const line=points.map((p,i)=>`${x(i)},${y(p.score)}`).join(' ');
  const area=`M ${x(0)} ${hg-pad} L ${points.map((p,i)=>`${x(i)} ${y(p.score)}`).join(' L ')} L ${x(points.length-1)} ${hg-pad} Z`;
  const selectedIndex=points.findIndex(p=>p.hours===selectedHorizon);
  byId('forecastChart').innerHTML=`
    <defs><linearGradient id="warmFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#eb6394" stop-opacity=".34"/><stop offset="1" stop-color="#d767d4" stop-opacity=".03"/></linearGradient></defs>
    ${[0,25,50,75,100].map(v=>`<line x1="${pad}" x2="${w-pad}" y1="${y(v)}" y2="${y(v)}" stroke="#eadad8" stroke-width="1"/><text x="8" y="${y(v)+4}" font-size="10" fill="#8c7e86">${v}</text>`).join('')}
    <path d="${area}" fill="url(#warmFill)"/><polyline points="${line}" fill="none" stroke="#e65d8d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    ${points.map((pt,i)=>`<circle cx="${x(i)}" cy="${y(pt.score)}" r="${i===selectedIndex?6:4}" fill="#fff" stroke="${i===selectedIndex?'#c74fc8':'#e65d8d'}" stroke-width="3"/><text x="${x(i)}" y="${hg-12}" text-anchor="middle" font-size="10" fill="#786d77">${pt.label}</text>`).join('')}
    ${selectedIndex>=0?`<rect x="${x(selectedIndex)-28}" y="${Math.max(10,y(points[selectedIndex].score)-48)}" width="56" height="30" rx="8" fill="#fff" stroke="#e3d3d5"/><text x="${x(selectedIndex)}" y="${Math.max(28,y(points[selectedIndex].score)-29)}" text-anchor="middle" font-size="12" font-weight="800" fill="#3a3040">${points[selectedIndex].score}</text>`:''}
  `;
}

function renderSourceHealth(data) {
  const names={earthquake:'USGS EQ',tsunami:'NOAA',volcano:'USGS VHP',tornado:'NWS / SPC'};
  byId('sourceHealth').innerHTML=Object.entries(names).map(([k,n])=>{
    const s=data.sources?.[k];const ok=Boolean(s?.ok);
    return `<div class="source-row"><div><i class="health-dot ${ok?'ok':'bad'}"></i><strong>${n}</strong></div><span class="source-meta">${ok?humanAge(s.evidenceAgeSeconds):'unavailable'} · ${Number.isFinite(Number(s?.latencyMs))?s.latencyMs+'ms':'—'}</span></div>`;
  }).join('');
}

function renderMethodology(data) {
  const formulas=data.methodology?.formulas||{};
  const titles={emhsi:'EMHSI current index',earthquake:'Earthquake score',tsunami:'Tsunami score',volcano:'Volcano score',tornado:'Tornado score'};
  const order=['emhsi','earthquake','tsunami','volcano','tornado'];
  const khse=data.prediction?.model?.formulas||{};
  let cards=order.filter(k=>formulas[k]).map(k=>`<article class="formula-card"><h3>${titles[k]}</h3><code>${esc(formulas[k])}</code></article>`);
  cards.push(`<article class="formula-card"><h3>KHSE persistence</h3><code>${esc(khse.persistence||'projected = current × 2^(-horizon/halfLife)')}</code></article>`);
  cards.push(`<article class="formula-card"><h3>KHSE confidence</h3><code>${esc(khse.confidence||'confidence = freshness × horizonQuality × sourceCoverage')}</code></article>`);
  byId('formulaGrid').innerHTML=cards.join('');

  const facts=data.methodology?.officialFacts||{};
  const links=data.methodology?.sourceLinks||{};
  const labels={earthquake:'Earthquake science',tsunami:'Tsunami alert semantics',volcano:'Volcano alert levels',tornado:'SPC tornado probability'};
  byId('officialFacts').innerHTML=Object.keys(labels).map(k=>`<article class="fact"><h3>${labels[k]}</h3><p>${esc(facts[k]||'Official source documentation.')}</p>${links[k]?`<a href="${esc(links[k])}" target="_blank" rel="noopener">Official source ↗</a>`:''}</article>`).join('');
}

function renderSpc(data) {
  const o=data.tornado?.outlook;
  if (!o?.ok) { byId('spcPanel').innerHTML='<div class="spc-note">SPC outlook unavailable. The system treats this as unknown, not safe.</div>'; return; }
  byId('spcPanel').innerHTML=`
    <div class="spc-metric"><span>MAX TORNADO PROBABILITY</span><strong>${esc(o.maxTornadoProbabilityPct??0)}%</strong></div>
    <div class="spc-metric"><span>DAY 1 CATEGORY</span><strong>${esc(o.categorical?.label||'—')}</strong></div>
    <div class="spc-metric"><span>VALID</span><strong>${esc(formatSpcTime(o.valid))}</strong></div>
    <div class="spc-metric"><span>EXPIRES</span><strong>${esc(formatSpcTime(o.expire))}</strong></div>
    <div class="spc-metric"><span>SPATIAL FEATURES</span><strong>${(o.categoricalPolygons||[]).length + (o.tornadoPolygons||[]).length}</strong></div>
    <div class="spc-note">${esc(o.semantics||'Official NOAA/NWS SPC forecast evidence.')} This official probability is displayed separately from the current EMHSI tornado score and is used by KHSE only while the selected horizon falls inside the product valid period.</div>`;
}

async function load() {
  try {
    const r=await fetch('/api/status',{cache:'no-store'});
    if (!r.ok) throw new Error(`API ${r.status}`);
    const data=await r.json();
    lastData=data;
    renderTop(data);
    plot(data);
    renderEvents(data);
    renderForecast(data);
    renderSourceHealth(data);
    renderMethodology(data);
    renderSpc(data);
  } catch (err) {
    byId('freshness').textContent='Live aggregation unavailable';
    byId('systemStatus').textContent='Source aggregation error';
    byId('heroLiveSummary').textContent='Missing data is unknown, never safe.';
  }
}

load();
setInterval(load,5*60*1000);
