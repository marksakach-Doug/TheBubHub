// Không Mặc Gì (Stripped Sentences) — rules tests for the standalone VietGames port.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GAME = path.join(ROOT, 'public', 'vietgames', 'khongmacgi', 'game.js');
const PAGE = path.join(ROOT, 'public', 'vietgames', 'khongmacgi', 'index.html');
const HARNESS = path.join(ROOT, 'public', 'vietgames', 'khongmacgi', 'harness.js');
const LANDING = path.join(ROOT, 'public', 'vietgames', 'index.html');
const JSON_FILE = path.join(ROOT, 'public', 'vietgames', 'khongmacgi', 'stripped.json');

const mod = await import(pathToFileURL(GAME).href);
const { init, reduce, project, summarize, roundId, prune, mount, meta } = mod;

const ID = 'local';
const NAMES = { [ID]: 'Bạn' };
const nameOf = (id) => NAMES[id] || id;

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ctx(rng) {
  return { from: { id: ID, name: 'Bạn', host: true }, rng: rng || seededRng(1) };
}

function fresh() {
  return init({ atTable: [{ id: ID, name: 'Bạn' }] });
}

let passed = 0;
function ok(name, fn) {
  fn();
  console.log(`  ok   ${name}`);
  passed++;
}

console.log('=== VietGames — Không Mặc Gì rules ===');

ok('meta is the standalone Vietnamese game', () => {
  assert.equal(meta.id, 'stripped-vi');
  assert.equal(meta.title, 'Hum Tones');
  assert.equal(meta.soloable, true);
});

ok('stripped.json pairs exist and are valid', () => {
  const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  assert.ok(Array.isArray(data.pairs) && data.pairs.length > 0);
  for (const pair of data.pairs) {
    assert.equal(pair.length, 2);
    assert.ok(typeof pair[0] === 'string' && pair[0].length > 0);
    assert.ok(typeof pair[1] === 'string' && pair[1].length > 0);
  }
});

ok('init seats the local player in lobby phase', () => {
  const s = fresh();
  assert.deepEqual(s.order, [ID]);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.scores[ID], 0);
});

ok('start deals a speak phase round', () => {
  const s = reduce(fresh(), { a: 'start' }, ctx());
  assert.equal(s.error, undefined);
  assert.equal(s.phase, 'speak');
  assert.equal(s.ear, ID);
  assert.ok(Array.isArray(s.pair) && s.pair.length === 2);
});

ok('mount is exported for the standalone harness', () => {
  assert.equal(typeof mount, 'function');
});

ok('the standalone pages exist and are linked', () => {
  const landing = fs.readFileSync(LANDING, 'utf8');
  const page = fs.readFileSync(PAGE, 'utf8');
  const harness = fs.readFileSync(HARNESS, 'utf8');
  assert.ok(landing.includes('href="./khongmacgi/"'), 'landing page links khongmacgi');
  assert.ok(page.includes('src="./harness.js"'), 'page includes harness.js');
  assert.ok(harness.includes('import { init, reduce, project, mount } from \'./game.js\';'), 'harness imports game.js');
});

console.log(`\n${passed} passed`);
