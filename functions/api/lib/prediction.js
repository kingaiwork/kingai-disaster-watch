const HOUR = 3600 * 1000;

const CONFIG = {
  earthquake: { halfLifeHours: 10, horizonConfidence: { 6: 0.66, 24: 0.38, 72: 0.16 }, mode: 'activity-persistence' },
  tsunami: { halfLifeHours: 4, horizonConfidence: { 6: 0.72, 24: 0.30, 72: 0.10 }, mode: 'official-message-persistence' },
  volcano: { halfLifeHours: 120, horizonConfidence: { 6: 0.82, 24: 0.74, 72: 0.58 }, mode: 'alert-state-persistence' },
  tornado: { halfLifeHours: 2.5, horizonConfidence: { 6: 0.78, 24: 0.52, 72: 0.18 }, mode: 'warning-plus-official-outlook' }
};

const HORIZONS = [6, 24, 72];

const clamp = (n, min=0, max=100) => Math.max(min, Math.min(max, n));
const round = (n, digits=0) => Number(Number(n).toFixed(digits));

export function parseSpcTimestamp(value) {
  if (value == null || value === '') return null;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 12) return null;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6)) - 1;
  const d = Number(digits.slice(6, 8));
  const hh = Number(digits.slice(8, 10));
  const mm = Number(digits.slice(10, 12));
  const ms = Date.UTC(y, m, d, hh, mm, 0);
  return Number.isFinite(ms) ? ms : null;
}

function attentionFromSpcProbability(probabilityPct) {
  const p = Number(probabilityPct);
  if (!Number.isFinite(p) || p <= 0) return 0;
  const levels = [
    [2, 24], [5, 38], [10, 54], [15, 65], [30, 80], [45, 90], [60, 96]
  ];
  for (const [threshold, score] of levels) if (p <= threshold) return score;
  return 98;
}

function freshnessQuality(ageSeconds, halfLifeHours) {
  if (!Number.isFinite(ageSeconds)) return 0.55;
  const ageHours = Math.max(0, ageSeconds / 3600);
  return clamp(Math.pow(2, -ageHours / Math.max(1, halfLifeHours)), 0.15, 1);
}

function label(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 85) return 'extreme';
  if (score >= 65) return 'high';
  if (score >= 40) return 'elevated';
  if (score >= 20) return 'guarded';
  return 'low';
}

function trend(projected, current) {
  if (!Number.isFinite(projected) || !Number.isFinite(current)) return 'unknown';
  const delta = projected - current;
  if (delta >= 8) return 'rising';
  if (delta <= -8) return 'easing';
  return 'steady';
}

function hazardProjection(name, hazard, data, hours, nowMs) {
  const config = CONFIG[name];
  const current = Number(hazard?.score);
  if (!Number.isFinite(current)) {
    return {
      score: null, interval: [null, null], confidence: 0, trend: 'unknown',
      mode: config.mode, support: 'source unavailable'
    };
  }

  const persistence = Math.pow(2, -hours / config.halfLifeHours);
  let projected = current * persistence;
  let support = 'current authoritative signal + time-decay model';
  let officialForecastPct = null;

  if (name === 'tornado') {
    const outlook = data.tornado?.outlook;
    const valid = parseSpcTimestamp(outlook?.valid);
    const expire = parseSpcTimestamp(outlook?.expire);
    const target = nowMs + hours * HOUR;
    if (outlook?.ok && Number.isFinite(valid) && Number.isFinite(expire) && target >= valid && target <= expire) {
      officialForecastPct = Number(outlook.maxTornadoProbabilityPct);
      projected = Math.max(projected, attentionFromSpcProbability(officialForecastPct));
      support = 'NWS active alerts + SPC official Day 1 probability + time-decay model';
    }
  }

  const sourceQuality = freshnessQuality(hazard?.evidenceAgeSeconds, config.halfLifeHours * 2);
  const horizonQuality = config.horizonConfidence[hours] ?? 0.2;
  const coverage = Number(data.index?.sourceConfidence);
  const coverageFactor = Number.isFinite(coverage) ? coverage : 0.5;
  const confidence = clamp(sourceQuality * horizonQuality * coverageFactor, 0, 1);
  const width = 7 + (1 - confidence) * 27 + (hours >= 72 ? 8 : hours >= 24 ? 4 : 0);
  const score = round(projected);
  const interval = [round(clamp(projected - width)), round(clamp(projected + width))];

  return {
    score,
    interval,
    confidence: round(confidence, 2),
    trend: trend(score, current),
    label: label(score),
    mode: config.mode,
    support,
    officialForecastPct: Number.isFinite(officialForecastPct) ? officialForecastPct : null
  };
}

export function buildPrediction(data, generatedAt=new Date().toISOString()) {
  const nowMs = Date.parse(generatedAt);
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const currentOverall = Number(data.index?.score);
  const hazards = ['earthquake', 'tsunami', 'volcano', 'tornado'];

  const horizons = HORIZONS.map(hours => {
    const projections = Object.fromEntries(
      hazards.map(name => [name, hazardProjection(name, data[name], data, hours, safeNow)])
    );
    const available = Object.entries(projections).filter(([,v]) => Number.isFinite(v.score));
    const ordered = available.sort((a,b) => b[1].score - a[1].score);
    const elevated = ordered.filter(([,v]) => v.score >= 50).length;
    const base = ordered[0]?.[1]?.score ?? null;
    const score = base == null ? null : round(clamp(base + Math.max(0, elevated - 1) * 4));
    const confidences = available.map(([,v]) => v.confidence);
    const confidence = confidences.length
      ? round(confidences.reduce((a,b) => a + b, 0) / confidences.length, 2)
      : 0;
    const uncertainty = 8 + (1 - confidence) * 25 + (hours >= 72 ? 8 : hours >= 24 ? 4 : 0);
    const interval = score == null ? [null, null] : [
      round(clamp(score - uncertainty)),
      round(clamp(score + uncertainty))
    ];

    return {
      hours,
      score,
      interval,
      confidence,
      label: label(score),
      trend: trend(score, currentOverall),
      hazards: projections,
      drivers: ordered.slice(0, 3).map(([name,v]) => ({
        hazard: name,
        score: v.score,
        confidence: v.confidence,
        support: v.support
      }))
    };
  });

  return {
    model: {
      name: 'KINGAI Hybrid Signal Ensemble',
      version: 'KHSE-v0.1',
      status: 'experimental-uncalibrated',
      architecture: 'hazard-specific state persistence + official forecast priors where available + source-freshness weighting'
    },
    generatedAt,
    horizons,
    safety: {
      isOccurrenceProbability: false,
      exactEventPrediction: false,
      officialAlertsTakePrecedence: true,
      statement: 'Projected scores estimate future operational attention, not the probability that a specific disaster will occur.'
    },
    limitations: [
      'Earthquake output is activity-persistence only; it does not predict exact time, place or magnitude.',
      'Tsunami output projects persistence of official message state and does not predict a new tsunami.',
      'Tornado projections may use the official SPC Day 1 tornado probability only while the selected horizon falls inside that outlook valid period.',
      'Longer horizons intentionally lose confidence because current public inputs are mostly real-time or Day 1 products.',
      'Experimental projection coefficients are not yet fed back into EMHSI scoring.'
    ]
  };
}
