import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const middleware = fs.readFileSync(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const rootFunction = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

assert.match(html, /id="catastrophe-radar"/);
assert.match(html, /href="#catastrophe-radar">Global Radar<\/a>/);
assert.equal((html.match(/data-radar="/g) || []).length, 5);
assert.ok(!html.includes('Home</a>\\n'), 'literal \\n must not appear in navigation markup');
assert.match(app, /fetch\('\/api\/catastrophe'/);
assert.match(app, /KINGAI Global Anomaly Radar UI/);
assert.match(css, /Global Anomaly Radar v1/);
assert.match(css, /\.catastrophe-radar/);

console.log('static contract tests passed');

assert.match(rootFunction, /export function onRequestGet/);
assert.match(rootFunction, /x-kingai-root/);
assert.match(rootFunction, /id=\\\"catastrophe-radar\\\"/);
