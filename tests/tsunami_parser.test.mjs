import assert from 'node:assert/strict';
import { categoryFromSummary, parseAtom, tsunamiLevel } from '../functions/api/lib/tsunami.js';

const atom = (category, updated='2026-09-17T14:23:45Z') => `<?xml version="1.0"?>
<feed>
  <entry>
    <title>45 miles NE of Amukta Pass, Alaska</title>
    <updated>${updated}</updated>
    <summary><strong>Category:</strong> ${category}<br/><strong>Bulletin Issue Time:</strong> now</summary>
    <link href="https://www.tsunami.gov/example/CAP.xml"/>
  </entry>
</feed>`;

assert.equal(categoryFromSummary('Category: Information Bulletin Issue Time: now'), 'Information');
assert.deepEqual(tsunamiLevel('Warning'), ['WARNING', 96]);
assert.deepEqual(tsunamiLevel('Advisory'), ['ADVISORY', 72]);
assert.deepEqual(tsunamiLevel('Watch'), ['WATCH', 55]);
assert.deepEqual(tsunamiLevel('Cancellation'), ['CANCELLATION', 0]);
assert.deepEqual(tsunamiLevel('Information'), ['INFORMATION', 12]);

const info = parseAtom(atom('Information'), 'NTWC', Date.parse('2026-09-17T15:00:00Z'))[0];
assert.equal(info.title, '45 miles NE of Amukta Pass, Alaska');
assert.equal(info.category, 'Information');
assert.equal(info.level, 'INFORMATION');
assert.equal(info.score, 12);
assert.equal(info.fresh24h, true);

const warning = parseAtom(atom('Warning'), 'NTWC', Date.parse('2026-09-17T15:00:00Z'))[0];
assert.equal(warning.level, 'WARNING');
assert.equal(warning.score, 96);

const oldWarning = parseAtom(atom('Warning', '2026-09-15T00:00:00Z'), 'NTWC', Date.parse('2026-09-17T15:00:00Z'))[0];
assert.equal(oldWarning.level, 'WARNING');
assert.equal(oldWarning.fresh24h, false);

const cancellation = parseAtom(atom('Cancellation'), 'PTWC', Date.parse('2026-09-17T15:00:00Z'))[0];
assert.equal(cancellation.level, 'CANCELLATION');
assert.equal(cancellation.score, 0);

console.log('TSUNAMI_PARSER_TEST_PASS');
