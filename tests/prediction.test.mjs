import assert from 'node:assert/strict';
import { buildPrediction, parseSpcTimestamp } from '../functions/api/lib/prediction.js';

assert.equal(parseSpcTimestamp('202609172000'), Date.UTC(2026, 8, 17, 20, 0, 0));
assert.equal(parseSpcTimestamp('bad'), null);

const now = '2026-09-17T21:00:00.000Z';
const data = {
  index: { score: 70, sourceConfidence: 1 },
  earthquake: { score: 65, evidenceAgeSeconds: 600 },
  tsunami: { score: 0, evidenceAgeSeconds: 1200 },
  volcano: { score: 62, evidenceAgeSeconds: 1800 },
  tornado: {
    score: 0,
    evidenceAgeSeconds: 300,
    outlook: {
      ok: true,
      maxTornadoProbabilityPct: 10,
      valid: '202609172000',
      expire: '202609181200'
    }
  }
};

const result = buildPrediction(data, now);
assert.equal(result.model.version, 'KHSE-v0.2');
assert.equal(result.safety.isOccurrenceProbability, false);
assert.equal(result.horizons.length, 3);

const h6 = result.horizons.find(x => x.hours === 6);
assert.ok(h6);
assert.equal(h6.hazards.tornado.officialForecastPct, 10);
assert.ok(h6.hazards.tornado.score >= 50);

const h24 = result.horizons.find(x => x.hours === 24);
assert.ok(h24);
assert.equal(h24.hazards.tornado.officialForecastPct, null);
assert.ok(h24.confidence < h6.confidence);

const h72 = result.horizons.find(x => x.hours === 72);
assert.ok(h72.confidence < h24.confidence);
assert.equal(result.limitations.length >= 4, true);

console.log('prediction tests passed');
