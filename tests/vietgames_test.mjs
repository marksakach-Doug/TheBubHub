// Chém Từ — rules tests for the standalone VietGames port.
//
// The game used to be a Bub Hub module. It now lives at
// public/vietgames/chem-tu/game.js and is driven by a local harness, so its
// resolver can be imported directly here with no DOM and no hub. That is the
// point: the move must not change the rules.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GAME = path.join(ROOT, 'public', 'vietgames', 'chem-tu', 'game.js');
const PAGE = path.join(ROOT, 'public', 'vietgames', 'chem-tu', 'index.html');
const LANDING = path.join(ROOT, 'public', 'vietgames', 'index.html');

const mod = await import(pathToFileURL(GAME).href);
const { init, reduce, project, mount, meta, WORD_LIST } = mod;

const ID = 'local';

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

function start(state, rng) {
  const next = reduce(state, { a: 'start' }, ctx(rng));
  assert.equal(next.error, undefined, 'start must be accepted');
  assert.equal(next.phase, 'play');
  return next;
}

function wrongSide(prompt) {
  return prompt.correctSide === 'left' ? 'right' : 'left';
}

let passed = 0;
function ok(name, fn) {
  fn();
  console.log(`  ok   ${name}`);
  passed++;
}

console.log('=== VietGames — Chém Từ rules ===');

ok('meta is the standalone Vietnamese game', () => {
  assert.equal(meta.id, 'chem-tu');
  assert.equal(meta.title, 'Chém Từ');
  assert.equal(meta.players.min, 1);
  assert.equal(meta.players.max, 1);
});

ok('the word list is present and well formed', () => {
  assert.ok(WORD_LIST.length >= 70, `only ${WORD_LIST.length} cards`);
  for (const item of WORD_LIST) {
    assert.ok(item.pic, 'card has no picture');
    assert.ok(item.match, `card ${item.pic} has no match word`);
    assert.ok(Array.isArray(item.decoy) && item.decoy.length > 0,
      `card ${item.match} has no decoy`);
    assert.notEqual(item.match, item.decoy[0], `card ${item.match} repeats its match`);
    assert.ok(!item.decoy.includes('ngu'), 'a demeaning decoy survived the child-content pass');
    assert.ok(!item.decoy.includes('tuộc'), 'a non-word decoy survived the content pass');
  }
});

ok('init seats the local player', () => {
  const s = fresh();
  assert.deepEqual(s.players, [ID]);
  assert.equal(s.hostId, ID);
  assert.equal(s.phase, 'ready');
  assert.equal(s.lives, 3);
});

ok('start deals a prompt with one matching side', () => {
  const s = start(fresh());
  assert.ok(s.prompt);
  assert.ok(s.prompt.pic);
  assert.ok(s.prompt.durationMs >= 1100);
  assert.ok(s.prompt.endsAt > Date.now());
  assert.ok([s.prompt.left, s.prompt.right].includes(s.prompt.matchWord));
  assert.equal(s.prompt.correctSide,
    s.prompt.left === s.prompt.matchWord ? 'left' : 'right');
});

ok('a correct slash scores and keeps all lives', () => {
  const s = start(fresh());
  const next = reduce(s, { a: 'slash', side: s.prompt.correctSide }, ctx());
  assert.equal(next.error, undefined);
  assert.equal(next.score, 1);
  assert.equal(next.lives, 3);
  assert.equal(next.streak, 1);
  assert.equal(next.phase, 'play');
  assert.ok(next.prompt);
  assert.notEqual(next.prompt.cardIndex, s.prompt.cardIndex,
    'the next prompt should not repeat the previous card');
});

ok('a wrong slash costs a life and records the miss', () => {
  const s = start(fresh());
  const next = reduce(s, { a: 'slash', side: wrongSide(s.prompt) }, ctx());
  assert.equal(next.error, undefined);
  assert.equal(next.score, 0);
  assert.equal(next.lives, 2);
  assert.equal(next.missed.length, 1);
  assert.equal(next.missed[0].match, s.prompt.matchWord);
});

ok('a timeout costs a life', () => {
  const s = start(fresh());
  s.prompt.endsAt = Date.now() - 1000;
  const next = reduce(s, { a: 'timeout' }, ctx());
  assert.equal(next.error, undefined);
  assert.equal(next.lives, 2);
  assert.equal(next.missed[0].reason, 'timeout');
});

ok('three misses end the round with a score summary', () => {
  let s = start(fresh());
  for (let i = 0; i < 3; i++) {
    const out = reduce(s, { a: 'slash', side: wrongSide(s.prompt) }, ctx());
    assert.equal(out.error, undefined);
    s = out;
  }
  assert.equal(s.phase, 'over');
  assert.equal(s.lives, 0);
  assert.equal(s.over.score, 0);
  assert.equal(s.over.reason, 'clang');
  assert.ok(s.over.missed.length >= 1);
});

ok('project sends the local id and a prompt the client can draw', () => {
  const s = start(fresh());
  const view = project(s, ID);
  assert.equal(view.you, ID);
  assert.equal(view.prompt.pic, s.prompt.pic);
  assert.equal(view.prompt.left, s.prompt.left);
  assert.equal(view.prompt.right, s.prompt.right);
});

ok('mount is exported for the standalone harness', () => {
  assert.equal(typeof mount, 'function');
});

ok('the UI is Vietnamese, not the old hub copy', () => {
  const src = fs.readFileSync(GAME, 'utf8');
  for (const text of ['Chém Từ', 'Bắt đầu', 'Chơi lại', 'Thẻ từ vựng', 'Đã hiểu', 'Còn khó']) {
    assert.ok(src.includes(text), `missing Vietnamese UI text: ${text}`);
  }
  for (const old of ['Draw Sword', 'Target Dojo', 'Blade &amp; Word', 'Practice Missed']) {
    assert.ok(!src.includes(old), `old hub copy survived: ${old}`);
  }
});

ok('the standalone pages exist and are linked', () => {
  const landing = fs.readFileSync(LANDING, 'utf8');
  const page = fs.readFileSync(PAGE, 'utf8');
  assert.ok(landing.includes('href="./chem-tu/"'));
  assert.ok(landing.includes('Trò chơi tiếng Việt'));
  assert.ok(page.includes('src="./harness.js"'));
  assert.ok(page.includes('href="../"'));
});

console.log(`\n${passed} passed`);
