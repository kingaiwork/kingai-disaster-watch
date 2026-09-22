import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/catastrophe.js';

const d=await (await onRequestGet()).json();
const solar=d?.modules?.solar;
assert.ok(solar);
assert.ok(solar.forecast72h);
assert.equal(solar.forecast72h.horizonHours,72);
assert.equal(typeof solar.forecast72h.maxPredictedKp,'number');
assert.ok(solar.forecast72h.maxPredictedKp>=0 && solar.forecast72h.maxPredictedKp<=9.5);
if (solar.forecast72h.maxEnlilSpeedKms != null) {
  assert.ok(solar.forecast72h.maxEnlilSpeedKms>0);
}
assert.equal(solar.officialProbability,null);
assert.equal(d?.probabilityIntegrity?.modules?.solar?.probability,null);
if (solar.forecast72h.maxPredictedGScale < 4 || (solar.forecast72h.maxEnlilSpeedKms ?? 0) < 900) {
  assert.equal(solar.forecast72h.extremeCompoundPreSignal,false);
}
console.log('solar ENLIL forecast tests passed');
