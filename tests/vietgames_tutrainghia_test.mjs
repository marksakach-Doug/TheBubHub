// Từ Trái Nghĩa — rules tests for the standalone VietGames port.
//
// The game module keeps the Bub Hub contract (init/reduce/project/mount) and
// is driven by a local harness at public/vietgames/tutrainghia/, so it can be
// imported directly here with no DOM and no hub. Mirrors tests/vietgames_test.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GAME = path.join(ROOT, 'public', 'vietgames', 'tutrainghia', 'game.js');
const PAGE = path.join(ROOT, 'public', 'vietgames', 'tutrainghia', 'index.html');
const HARNESS = path.join(ROOT, 'public', 'vietgames', 'tutrainghia', 'harness.js');
const LANDING = path.join(ROOT, 'public', 'vietgames', 'index.html');
const WATER = path.join(ROOT, 'public', 'vietgames', 'assets', 'tutrainghia', 'music', 'water.mp3');

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

function started(seed) {
  const next = reduce(fresh(), { a: 'start' }, ctx(seededRng(seed ?? 1)));
  assert.equal(next.error, undefined, 'start must be accepted');
  return next;
}

function clear(state) {
  const next = reduce(state, { a: 'clear', seq: state.runs[ID].seq }, ctx());
  assert.equal(next.error, undefined, 'clear must be accepted');
  return next;
}

let passed = 0;
function ok(name, fn) {
  fn();
  console.log(`  ok   ${name}`);
  passed++;
}

console.log('=== VietGames — Từ Trái Nghĩa rules ===');

ok('meta is the standalone Vietnamese game', () => {
  assert.equal(meta.id, 'tutrainghia');
  assert.equal(meta.title, 'Từ Trái Nghĩa');
  assert.equal(meta.players, 'solo');
});

ok('init seats the local player at an idle run', () => {
  const s = fresh();
  assert.equal(s.runs[ID].phase, 'idle');
  assert.equal(s.runs[ID].lives, meta.LIVES_START ?? 9);
  assert.equal(s.done, null);
});

ok('start deals a seeded, playing run', () => {
  const s = started(7);
  const r = s.runs[ID];
  assert.equal(r.phase, 'play');
  assert.equal(r.seq, 1);
  assert.equal(r.lives, 9);
  assert.ok(Number.isInteger(r.seed) && r.seed > 0, 'start must roll a seed');
  const other = started(1234);
  assert.notEqual(other.runs[ID].seed, r.seed, 'different rng gives a different seed');
});

ok('a stale or repeated report is ignored quietly', () => {
  const s = started();
  const again = reduce(s, { a: 'die', seq: 999 }, ctx());
  assert.equal(again, s, 'unchanged state object, not an error');
});

ok('an unseated sender is rejected', () => {
  const s = fresh();
  const out = reduce(s, { a: 'start' }, { from: { id: 'nobody', name: 'X', host: false }, rng: Math.random });
  assert.ok(out.error);
});

ok('die costs a life', () => {
  const s = started();
  const next = reduce(s, { a: 'die', seq: 1 }, ctx());
  assert.equal(next.error, undefined);
  const r = next.runs[ID];
  assert.equal(r.lives, 8);
  assert.equal(r.seq, 2);
  assert.equal(r.deaths, 1);
  assert.equal(r.phase, 'play');
});

ok('out of lives resets to the start of the set, not the game', () => {
  let s = started();
  for (let i = 0; i < 8; i++) s = reduce(s, { a: 'die', seq: s.runs[ID].seq }, ctx());
  const r = s.runs[ID];
  assert.equal(r.deaths, 8);
  assert.equal(r.lives, 1);
  const ninth = reduce(s, { a: 'die', seq: r.seq }, ctx());
  const r9 = ninth.runs[ID];
  assert.equal(r9.lives, 9);
  assert.equal(r9.resets, 1);
  assert.equal(r9.level, 0);
  assert.equal(r9.phase, 'play');
});

ok('clear advances the level and earns a life', () => {
  const s = started();
  const next = clear(s);
  const r = next.runs[ID];
  assert.equal(r.level, 1);
  assert.equal(r.lives, 10);
  assert.equal(r.cleared, 1);
  assert.equal(next.done, null, 'no record inside a set');
});

ok('clearing level 8 closes the set and records it', () => {
  let s = started();
  for (let i = 0; i < 8; i++) s = clear(s);
  const r = s.runs[ID];
  assert.equal(r.set, 1);
  assert.equal(r.level, 0);
  assert.equal(r.lives, 15, 'earned lives are kept, never below the opening count');
  assert.deepEqual(s.done, { n: 1, id: ID, set: 0, won: false, lives: 15 });
});

ok('clearing all four sets wins the run', () => {
  let s = started();
  for (let i = 0; i < 32; i++) s = clear(s);
  assert.equal(s.runs[ID].phase, 'won');
  assert.equal(s.done.won, true);
  assert.equal(s.done.set, 3);
});

ok('summarize speaks through the hub roster, with the game title', () => {
  let s = started();
  for (let i = 0; i < 8; i++) s = clear(s);
  assert.equal(summarize(s, nameOf), 'Bạn cleared set 1 (Thành Phố) of Từ Trái Nghĩa');
  let w = started();
  for (let i = 0; i < 32; i++) w = clear(w);
  assert.equal(summarize(w, nameOf), 'Bạn cleared all 4 sets of Từ Trái Nghĩa');
  const idle = fresh();
  assert.equal(summarize(idle, nameOf), null, 'nothing to report before a set ends');
});

ok('roundId changes per recorded set and dedupes otherwise', () => {
  assert.equal(roundId(fresh()), 'd0');
  let s = started();
  for (let i = 0; i < 8; i++) s = clear(s);
  assert.equal(roundId(s), 'd1');
  const again = clear(s);
  assert.equal(roundId(again), 'd1', 'the same set reported twice shares one id');
});

ok('prune removes a departed player, keeps the object when nothing to do', () => {
  const s = started();
  const next = prune(s, ID);
  assert.deepEqual(next.runs, {});
  assert.equal(prune(next, ID), next, 'same object when there was nothing to remove');
});

ok('project sends the local run and other seated runs anonymised', () => {
  const s = started();
  const view = project(s, ID);
  assert.equal(view.you, ID);
  assert.equal(view.run.seq, 1);
  assert.deepEqual(view.others, []);
  assert.equal(view.run.seed, s.runs[ID].seed, 'the client needs the host seed');
});

ok('mount is exported for the standalone harness', () => {
  assert.equal(typeof mount, 'function');
});

ok('the standalone pages exist and are linked', () => {
  const landing = fs.readFileSync(LANDING, 'utf8');
  const page = fs.readFileSync(PAGE, 'utf8');
  assert.ok(landing.includes('href="./tutrainghia/"'), 'the landing page links the game');
  assert.ok(landing.includes('Từ Trái Nghĩa'), 'the landing card is titled in Vietnamese');
  assert.ok(page.includes('src="./harness.js"'), 'the page drives the harness');
  assert.ok(page.includes('href="../"'), 'the page offers the way back');
  assert.ok(fs.readFileSync(HARNESS, 'utf8').includes("from './game.js'"),
    'the harness drives the game module');
});

ok('the underwater loop ships next to the game, at the path the module plays', () => {
  assert.ok(fs.existsSync(WATER), `missing ${WATER}`);
  const src = fs.readFileSync(GAME, 'utf8');
  assert.ok(src.includes("const AS='../assets/tutrainghia/'"),
    'the audio base must resolve to /vietgames/assets/tutrainghia/');
});

ok('the second vocab game is not registered in the hub', () => {
  const games = fs.readFileSync(path.join(ROOT, 'public', 'games.js'), 'utf8');
  assert.ok(!games.includes('tutrainghia'), 'vietgames games never go in public/games.js');
});

console.log(`\n${passed} passed`);
