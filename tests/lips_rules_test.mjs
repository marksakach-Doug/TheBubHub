// Offline rules suite for I'm Your Lips. No browser needed.
// Run: node tests/lips_rules_test.mjs
import assert from 'node:assert/strict';
import * as lips from '../games/lips/index.js';
import { WORDS } from '../games/lips/words.js';

const { init, reduce, project, prune, roundId, summarize } = lips;
let passed = 0;

function test(name, fn) {
  try { fn(); passed += 1; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// Deterministic rng so shuffles are reproducible.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const PEOPLE = [
  { id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }, { id: 'd', name: 'Di' },
];

function table(people = PEOPLE) {
  return init({ atTable: people.map((p) => ({ ...p, host: p.id === 'a', game: 'lips' })), seats: [], options: {} });
}

function send(state, id, action, opts = {}) {
  const ctx = { from: { id, name: opts.name || (PEOPLE.find((p) => p.id === id) || {}).name || id, host: !!opts.host }, rng: opts.rng || seeded(7) };
  return reduce(state, action, ctx);
}

function started(people = PEOPLE, rng) {
  let s = table(people);
  s = send(s, 'a', { a: 'start' }, { host: true, rng });
  return s;
}

function writeAll(s, texts) {
  s.writers.forEach((w, i) => { s = send(s, w, { a: 'line', text: texts[i] || ('line from ' + w) }); });
  return s;
}

function rankAsFriend(s, tiers) {
  return send(s, s.friend, { a: 'rank', tiers }, { rng: seeded(3) });
}

console.log("I'm Your Lips: rules");

test('init seats the table in order, lobby, no round', () => {
  const s = table();
  assert.equal(s.phase, 'lobby');
  assert.deepEqual(s.order, ['a', 'b', 'c', 'd']);
  assert.equal(s.friend, null);
});

test('only the host starts; needs three seated', () => {
  const s = table();
  assert.ok(reduce(s, { a: 'start' }, { from: { id: 'b', host: false }, rng: seeded(1) }).error);
  const two = table([PEOPLE[0], PEOPLE[1]]);
  assert.ok(send(two, 'a', { a: 'start' }, { host: true }).error);
});

test('start deals a friend, a word and writers; the friend does not write', () => {
  const s = started();
  assert.equal(s.phase, 'write');
  assert.equal(s.friend, 'a');
  assert.deepEqual(s.writers, ['b', 'c', 'd']);
  assert.ok(WORDS.includes(s.word));
  assert.ok(send(s, 'a', { a: 'line', text: 'hi' }).error, 'friend cannot write');
});

test('a spectator or a sitting-out player cannot write', () => {
  const s = started();
  assert.ok(send(s, 'zed', { a: 'line', text: 'hi' }).error);
});

test('empty and overlong lines are refused', () => {
  const s = started();
  assert.ok(send(s, 'b', { a: 'line', text: '   ' }).error);
  assert.ok(send(s, 'b', { a: 'line', text: 'x'.repeat(91) }).error);
});

test('projection in write hides other lines and keeps the friend without a ranking', () => {
  let s = started();
  s = send(s, 'b', { a: 'line', text: 'secret bobbity line' });
  const vb = project(s, 'b');
  assert.equal(vb.myLine, 'secret bobbity line');
  const vc = project(s, 'c');
  assert.equal(vc.myLine, null);
  assert.ok(!JSON.stringify(vc).includes('secret bobbity line'), 'another writer must not see the line');
  const vf = project(s, 'a');
  assert.equal(vf.rankLines, null);
  assert.ok(!JSON.stringify(vf).includes('secret bobbity line'), 'friend must not see lines before the rank');
  assert.ok(!('deck' in vf) && !('lines' in vf) && !('shuffle' in vf), 'raw state is not projected');
});

test('all lines in moves to rank; friend sees shuffled texts with no authors', () => {
  let s = writeAll(started(), ['b-line', 'c-line', 'd-line']);
  assert.equal(s.phase, 'rank');
  const vf = project(s, 'a');
  assert.equal(vf.rankLines.length, 3);
  assert.deepEqual(vf.rankLines.map((l) => l.text).sort(), ['b-line', 'c-line', 'd-line']);
  const json = JSON.stringify(vf.rankLines);
  assert.ok(!json.includes('"b"') && !json.includes('"c"') && !json.includes('"d"'), 'no author ids in the friend view');
  assert.equal(project(s, 'b').rankLines, null, 'writers do not get the ranking');
});

test('ranking must place exactly one wish, one line per tier entry', () => {
  const s = writeAll(started(), ['x1', 'x2', 'x3']);
  assert.ok(rankAsFriend(s, [2, 2, 0]).error, 'two wishes refused');
  assert.ok(rankAsFriend(s, [0, 1, 1]).error, 'no wish refused');
  assert.ok(rankAsFriend(s, [2, 1]).error, 'short list refused');
  assert.ok(rankAsFriend(s, ['2', 0, 1]).error, 'non-numeric tier refused');
  assert.ok(send(s, 'b', { a: 'rank', tiers: [2, 0, 1] }).error, 'only the friend ranks');
});

test('a valid ranking gives the wish-line author one point and reveals the round', () => {
  const s0 = writeAll(started(), ['b-line', 'c-line', 'd-line']);
  // shuffle index 1 is the wish
  const wishWriter = s0.shuffle[1];
  const tiers = [0, 0, 0];
  tiers[1] = 2;
  const s = rankAsFriend(s0, tiers);
  assert.equal(s.phase, 'roundover');
  assert.equal(s.scores[wishWriter], 1);
  assert.equal(Object.values(s.scores).reduce((x, y) => x + y, 0), 1);
  assert.equal(project(s0, 'b').reveal, null, 'no reveal while ranking');
  const rv = project(s, 'c').reveal;
  assert.equal(rv.length, 3);
  assert.ok(rv.some((l) => l.tier === 2 && l.authorName === PEOPLE.find((p) => p.id === wishWriter).name));
  assert.ok(project(s, 'c').matchRounds >= 1);
});

test('rounds rotate the friend and keep the word deck moving', () => {
  const tiers = [1, 2, 0];   // exactly one wish, at shuffle index 1
  let s = rankAsFriend(writeAll(started(), ['1', '2', '3']), tiers);
  assert.equal(s.phase, 'roundover');
  const next = send(s, 'a', { a: 'start' }, { host: true, rng: seeded(9) });
  assert.equal(next.phase, 'write');
  assert.equal(next.roundNo, 1);
  assert.equal(next.friend, 'b');
});

test('the deck does not repeat a word until it runs out', () => {
  let s = started(PEOPLE, seeded(11));
  const seen = [];
  for (let round = 0; round < WORDS.length; round++) {
    seen.push(s.word);
    s = writeAll(s, Array(s.writers.length).fill('x'));
    s = rankAsFriend(s, s.shuffle.map((_, i) => (i === 0 ? 2 : 0)));
    s = send(s, 'a', { a: 'start' }, { host: true, rng: seeded(round + 20) });
  }
  assert.equal(new Set(seen).size, WORDS.length, 'every word dealt once in a full deck');
});

test('only the host can take the table back to the lobby; it clears the round and scores', () => {
  let s = writeAll(started(), ['1', '2', '3']);
  s = rankAsFriend(s, [2, 0, 1]);
  assert.ok(send(s, 'b', { a: 'toLobby' }).error);
  const lobby = send(s, 'a', { a: 'toLobby' }, { host: true });
  assert.equal(lobby.phase, 'lobby');
  assert.deepEqual(lobby.scores, {});
  assert.equal(lobby.epoch, s.epoch + 1);
  assert.deepEqual(lobby.winnerIds, []);
});

test('a late joiner sits out the current round and writes from the next', () => {
  let s = started();
  s = send(s, 'e', { a: 'join' }, { name: 'Ed' });
  assert.ok(s.order.includes('e'));
  assert.ok(!s.writers.includes('e'));
  assert.ok(send(s, 'e', { a: 'line', text: 'hi' }).error);
});

test('join is idempotent and refuses a ninth seat', () => {
  const s = started();
  assert.equal(send(s, 'b', { a: 'join' }), s);
  let t = s;
  for (let i = 0; i < 10; i++) {
    const r = send(t, 'x' + i, { a: 'join' }, { name: 'x' + i });
    if (r.error) { assert.equal(t.order.length, 8); return; }
    t = r;
  }
  assert.fail('table should cap at eight');
});

test('prune: a writer who leaves is removed, and the round moves on when the rest have written', () => {
  let s = started();
  s = send(s, 'b', { a: 'line', text: 'b-line' });
  s = send(s, 'c', { a: 'line', text: 'c-line' });
  const after = prune(s, 'd');
  assert.ok(!after.order.includes('d'));
  assert.equal(after.phase, 'rank', 'the two who are left have both written');
  assert.equal(after.shuffle.length, 2);
  assert.ok(!after.shuffle.includes('d'));
});

test('prune: the friend leaving restarts the lines with a new friend and the same word', () => {
  let s = started();
  s = send(s, 'b', { a: 'line', text: 'b-line' });
  const word = s.word;
  const after = prune(s, 'a');
  assert.equal(after.phase, 'write');
  assert.notEqual(after.friend, 'a');
  assert.equal(after.word, word);
  assert.deepEqual(after.lines, {});
});

test('prune: dropping below three seats returns to the lobby with a new epoch', () => {
  let s = started();
  const after = prune(prune(s, 'c'), 'd');
  assert.equal(after.phase, 'lobby');
  assert.equal(after.epoch, s.epoch + 1, 'new epoch so round ids never collide');
});

test('prune returns the same object when the leaver held no seat or part in the round', () => {
  const s = started();
  assert.equal(prune(s, 'nobody'), s);
});

test('round id changes each round; summary is null until the round is over and then stable', () => {
  let s = writeAll(started(), ['1', '2', '3']);
  assert.equal(summarize(s, (x) => x), null);
  s = rankAsFriend(s, [2, 0, 1]);
  const first = roundId(s);
  const line1 = summarize(s, (x) => x);
  assert.ok(line1 && line1.includes(s.word));
  assert.equal(summarize(s, (x) => x), line1, 'stable across calls within a round');
  const next = send(s, 'a', { a: 'start' }, { host: true, rng: seeded(4) });
  assert.notEqual(roundId(next), first);
});

test('a finished game with no winner text never leaks a raw line into the record', () => {
  let s = writeAll(started(), ['SECRET-TEXT-DO-NOT-RECORD', 'two', 'three']);
  s = rankAsFriend(s, [2, 0, 1]);
  const sentence = summarize(s, (x) => x);
  assert.ok(!sentence.includes('SECRET'), 'record shows the word, not the line');
});

test('match ends after the set number of rounds with a winner and lip confetti state', () => {
  let s = started();
  s.matchRounds = 2;
  s = rankAsFriend(writeAll(s, ['1', '2', '3']), [1, 2, 0]); // round 1, wish -> shuffle[1]
  assert.equal(s.phase, 'roundover');
  const firstWinner = s.shuffle[1];
  s = send(s, 'a', { a: 'start' }, { host: true, rng: seeded(12) });
  assert.equal(s.phase, 'write');
  s = rankAsFriend(writeAll(s, ['4', '5', '6']), [1, 2, 0]); // round 2, wish -> shuffle[1]
  assert.equal(s.phase, 'gameover');
  assert.ok(Array.isArray(s.winnerIds) && s.winnerIds.length >= 1);
  assert.ok(s.winnerIds.includes(s.shuffle[1]));
  const v = project(s, 'b');
  assert.equal(v.phase, 'gameover');
  assert.deepEqual(v.winnerIds, s.winnerIds);
  assert.ok(Array.isArray(v.winnerNames));
  assert.equal(v.reveal.length, 3);
  assert.ok(v.doodle !== undefined);
  assert.ok(summarize(s, (x) => x), 'final round summary remains available');
});

test('a tie at match end enters sudden death; the friend picks one winner', () => {
  let s = started();
  s.matchRounds = 2;
  s = rankAsFriend(writeAll(s, ['1', '2', '3']), [2, 0, 1]); // wish -> shuffle[0]
  const w1 = s.shuffle[0];
  s = send(s, 'a', { a: 'start' }, { host: true, rng: seeded(13) });
  s = rankAsFriend(writeAll(s, ['4', '5', '6']), [0, 2, 1]); // wish -> shuffle[1]
  const w2 = s.shuffle[1];
  assert.equal(s.phase, 'sudden', 'a tie goes to sudden death');
  assert.equal(s.scores[w1], 1);
  assert.equal(s.scores[w2], 1);
  assert.deepEqual((s.sudden || {}).candidates.slice().sort(), [w1, w2].sort());
  assert.equal(s.winnerIds.length, 0, 'no match winner yet');
  const resolved = send(s, s.friend, { a: 'sudden', winner: w1 }, { rng: seeded(3) });
  assert.equal(resolved.phase, 'gameover');
  assert.deepEqual(resolved.winnerIds, [w1], 'sudden death names a single winner');
});

test('timeUp moves to rank with only the writers who wrote, when not everyone wrote', () => {
  let s = started();
  s = send(s, 'b', { a: 'line', text: 'b-line' });
  s = send(s, 'c', { a: 'line', text: 'c-line' });
  // d has not written; friend 'a' calls time
  const after = send(s, 'a', { a: 'timeUp' }, { rng: seeded(5) });
  assert.equal(after.phase, 'rank');
  assert.deepEqual(after.writers, ['b', 'c']);
  assert.equal(after.shuffle.length, 2);
  assert.ok(!after.shuffle.includes('d'));
});

test('timeUp can be called by any seated player, not just host or friend', () => {
  let s = started();
  s = send(s, 'b', { a: 'line', text: 'b-line' });
  // writer 'c' (not host, not friend) calls time
  const after = send(s, 'c', { a: 'timeUp' }, { rng: seeded(5) });
  assert.equal(after.phase, 'rank');
  assert.deepEqual(after.writers, ['b']);
});

test('timeUp with nobody written deals a fresh word and stays in write', () => {
  const s = started();
  const after = send(s, 'a', { a: 'timeUp' }, { rng: seeded(5) });
  assert.equal(after.phase, 'write');
  assert.equal(after.redeals, 1);
  assert.deepEqual(after.lines, {});
});

test('sudden death can only be triggered by the friend on a tied candidate', () => {
  let s = started();
  s.matchRounds = 2;
  s = rankAsFriend(writeAll(s, ['1', '2', '3']), [2, 0, 1]);
  const w1 = s.shuffle[0];
  s = send(s, 'a', { a: 'start' }, { host: true, rng: seeded(13) });
  s = rankAsFriend(writeAll(s, ['4', '5', '6']), [0, 2, 1]);
  const w2 = s.shuffle[1];
  assert.ok(send(s, 'a', { a: 'sudden', winner: w1 }).error, 'only the friend breaks the tie');
  assert.ok(send(s, s.friend, { a: 'sudden', winner: 'nobody' }).error, 'must pick a tied candidate');
});

test('host can play again after game over; it starts a fresh match with cleared scores', () => {
  let s = started();
  s.matchRounds = 1;
  s = rankAsFriend(writeAll(s, ['1', '2', '3']), [2, 0, 1]);
  assert.equal(s.phase, 'gameover');
  assert.ok(send(s, 'b', { a: 'start' }).error);
  const next = send(s, 'a', { a: 'start' }, { host: true, rng: seeded(14) });
  assert.equal(next.phase, 'write');
  assert.equal(next.roundNo, 0);
  assert.deepEqual(next.winnerIds, []);
  assert.equal(Object.values(next.scores).reduce((x, y) => x + y, 0), 0);
  assert.equal(next.matchRounds, 6);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ' (failures above)' : ''));
