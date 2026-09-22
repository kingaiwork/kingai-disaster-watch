import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/catastrophe.js';

const response = await onRequestGet();
assert.equal(response.status, 200);
const data = await response.json();

assert.equal(data?.model?.version, 'GAR-v1.0.0');
assert.equal(data?.probabilityIntegrity?.singleGlobalDoomsdayProbability, null);
assert.equal(data?.probabilityIntegrity?.globalStatus, 'NOT_SCIENTIFICALLY_DEFINED');
assert.equal(data?.probabilityIntegrity?.modules?.megaquake?.probability, null);
assert.equal(data?.probabilityIntegrity?.modules?.tsunami?.probability, null);
assert.equal(data?.probabilityIntegrity?.modules?.volcano?.probability, null);
assert.equal(data?.probabilityIntegrity?.modules?.solar?.probability, null);

const asteroid = data?.probabilityIntegrity?.modules?.asteroid;
assert.ok(asteroid);
assert.equal(asteroid.horizon, '100 years');
assert.equal(asteroid.threshold, '>=140 m estimated diameter');
assert.ok(Number.isInteger(asteroid.candidateCount));
if (asteroid.probabilityFraction != null) {
  assert.ok(asteroid.probabilityFraction >= 0 && asteroid.probabilityFraction <= 1);
  assert.equal(asteroid.probabilityPercent, Number((asteroid.probabilityFraction * 100).toPrecision(8)));
}
console.log('probability integrity tests passed');
