// Solo suites for games/fugue/index.js — the streamer and connectionist modes
// on a one-player table. Same harness style as fugue_rules.mjs: fake clock,
// seeded rng, exit code is the verdict.
//   node tests/fugue_solo.mjs
import assert from 'node:assert/strict';
import * as G from '../games/fugue/index.js';
import { BANK } from '../games/fugue/words.js';

let clock = 1_000_000;
Date.now = () => clock;
let seed = 11;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e && e.message)); process.exitCode = 1; } }

const fromMe = { id: 'p1', name: 'Alice', host: true };
const act = (st, action, as) => G.reduce(st, action, { from: as || fromMe, rng });
const ok = (st, action, as) => { const r = act(st, action, as); assert.ok(!r.error, 'unexpected error: ' + (r.error || '')); return r; };
const fresh = () => G.init({ atTable: [{ id: 'p1', name: 'Alice' }] });
// 4000ms beats a 2400–3600 bot interval from either side: one leg is always
// enough for every bot to owe exactly one more word, so drips never skip.
// legs 0 = table just opened, 1 = one word per stream live.
function started(wordsPerBot) {
  const legs = wordsPerBot === undefined ? 1 : wordsPerBot;
  let st = fresh();
  st = ok(st, { a: 'start', m: 'conn' });
  for (let i = 0; i < legs; i++) { clock += 4000; st = ok(st, { a: 'drip' }); }
  return st;
}
const maybeName = (id) => (id === 'p1' ? 'Alice' : 'Bo');

// ---------------------------------------------------------------- word bank --

test('the bank is intact: 78+ books, every one with a title and 52+ words', () => {
  assert.ok(BANK.length >= 78, 'bank has ' + BANK.length + ' books');
  BANK.forEach(function (b) {
    assert.ok(b.t && b.t.length > 1, 'book title missing');
    assert.ok(b.g > 0, 'gutenberg id missing for ' + b.t);
    const words = new Set(b.w.split(' '));
    assert.ok(words.size >= 52, b.t + ' has only ' + words.size + ' words');
    words.forEach((w) => assert.match(w, /^[a-z]+$/, 'unclean word ' + w));
  });
});

// ------------------------------------------------------------ solo streamer --

test('init on a one-player table is solo streamer mode', () => {
  const st = fresh();
  assert.equal(st.mode, 'solo-streamer');
  assert.deepEqual(st.players, ['p1']);
  assert.equal(st.hostId, 'p1');
  assert.equal(st.phase, 'lobby');
});

test('stream: start opens a live round with a prompt and a clock', () => {
  const st = ok(fresh(), { a: 'start', m: 'stream' });
  assert.equal(st.phase, 'live');
  assert.ok(st.soloRound.prompt.length > 0, 'a prompt arrived');
  assert.ok(st.soloRound.endsAt > clock);
  assert.equal(st.setNo, 1);
});

test('stream: words lock, get cleaned, and cap at 40', () => {
  let st = ok(fresh(), { a: 'start' });
  for (let i = 0; i < 45; i++) st = ok(st, { a: 'word', w: ' fire , ' + i });
  const w = st.soloRound.words;
  assert.equal(w.length, 40);
  assert.equal(w[0], 'fire0');
});

test('stream: finish records the count and the record sheet says so, null until over', () => {
  let st = ok(fresh(), { a: 'start' });
  assert.equal(G.summarize(st, (id) => id), null, 'nothing on the record mid-stream');
  st = ok(st, { a: 'word', w: 'alpha' });
  st = ok(st, { a: 'word', w: 'beta' });
  st = ok(st, { a: 'finish' });
  assert.equal(st.phase, 'over');
  assert.equal(st.over.count, 2);
  assert.match(G.summarize(st, maybeName), /Alice locked 2 words/);
});

test('stream: switching to connectionist from the streamer lobby works', () => {
  const st = ok(fresh(), { a: 'start', m: 'conn' });
  assert.equal(st.mode, 'solo-conn');
  assert.equal(st.phase, 'live');
  assert.equal(st.round.conn, 'p1');
});

// ------------------------------------------------------- solo connectionist --

test('conn: start seats three book-jammed bots and deals a relation', () => {
  const st = started(0);
  assert.equal(st.mode, 'solo-conn');
  assert.equal(st.round.streamers.length, 3);
  assert.deepEqual(st.round.streamers, ['b1', 'b2', 'b3']);
  assert.equal(st.round.conn, 'p1');
  assert.ok(st.round.rel, 'a relation is up');
  assert.ok(st.round.bot.b1.book && st.round.bot.b1.book.length > 1);
  assert.equal(st.round.bot.b1.nextAt, clock + 2000);
  assert.ok(st.round.bot.b1.queue.length <= 40, 'drip queue capped');
  st.round.streamers.forEach(function (s) {
    const book = BANK.filter((b) => b.t === st.round.bot[s].book)[0];
    assert.ok(book, 'bot ' + s + ' has a real book: ' + st.round.bot[s].book);
    const words = new Set(book.w.split(' '));
    st.round.bot[s].queue.forEach((w) => assert.ok(words.has(w), 'queue word not from book'));
  });
  assert.deepEqual(st.order, ['p1', 'p1', 'p1'], 'three rounds, all connecting');
});

test('conn: words drip on the clock, and a second drip finds nothing due', () => {
  let st = started(0);
  clock += 3000;
  st = ok(st, { a: 'drip' });
  st.round.streamers.forEach((s) => assert.equal(st.round.words[s].length, 1, s + ' typed its first word'));
  const snap = JSON.stringify(st.round.words);
  st = ok(st, { a: 'drip' });
  assert.equal(JSON.stringify(st.round.words), snap, 'no word due yet, no change');
});

test('conn: linking needs what is on the table, one word per stream, once per word', () => {
  let st = started(1);                                                    // exactly one word per stream
  assert.ok(act(st, { a: 'link', picks: [{ s: 'b1', i: 1 }, { s: 'b2', i: 0 }] }).error, 'not-yet-dripped index refused');
  assert.ok(act(st, { a: 'link', picks: [{ s: 'b1', i: 0 }, { s: 'b1', i: 0 }] }).error, 'same stream twice refused');
  st = ok(st, { a: 'link', picks: [{ s: 'b1', i: 0 }, { s: 'b2', i: 0 }] });
  assert.equal(st.round.links.length, 1);
  assert.equal(st.round.links[0].vertical, true);
  assert.equal(st.round.links[0].weight, 1);
  assert.ok(act(st, { a: 'link', picks: [{ s: 'b1', i: 0 }, { s: 'b3', i: 0 }] }).error, 'a linked word links once');
  assert.notEqual(st.round.rel, st.round.links[0].rel, 'relation snaps after every link');
});

test('conn: the human cannot type, and no stranger sits down mid-game', () => {
  let st = started(1);
  assert.ok(act(st, { a: 'word', w: 'nope' }).error || st.round.words.p1 === undefined, 'the connectionist does not stream');
  assert.ok(act(st, { a: 'join' }, { id: 'p2', name: 'Bo', host: false }).error, 'a second human refused');
  assert.equal(ok(st, { a: 'join' }).late.length, 0, 're-joining by the solo player is a noop');
});

test('conn: finish tallies straight to standing links, no vote phase', () => {
  let st = started(3);                                                    // idx 0,1,2 live on every stream
  st = ok(st, { a: 'link', picks: [{ s: 'b1', i: 0 }, { s: 'b2', i: 0 }] });          // vertical, 2 pts
  st = ok(st, { a: 'link', picks: [{ s: 'b1', i: 1 }, { s: 'b2', i: 2 }, { s: 'b3', i: 0 }] }); // 3 streams, 2 pts
  assert.equal(ok(st, { a: 'vote', n: 1, yes: true }).phase, 'live', 'nobody votes here');
  clock += 121000;
  st = ok(st, { a: 'finish' });
  assert.equal(st.phase, 'tally');
  assert.equal(st.round.result.points, 4);
  st.round.result.rows.forEach((row) => assert.equal(row.stands, true, 'links stand unjudged'));
  assert.equal(st.scores.p1, 4);
  assert.equal(G.project(st, 'p1', null).round.result.points, 4, 'the tally is public');
});

test('conn: three rounds make a set, then the record sheet fills', () => {
  let st = started(0);
  assert.equal(G.summarize(st, (id) => id), null);
  for (let round = 0; round < 3; round++) {
    clock += 4000; st = ok(st, { a: 'drip' });
    st = ok(st, { a: 'link', picks: [{ s: 'b1', i: 0 }, { s: 'b2', i: 0 }] });
    clock += 121000; st = ok(st, { a: 'finish' });
    assert.equal(st.phase, 'tally');
    clock += 15000; st = ok(st, { a: 'next' });
  }
  assert.equal(st.phase, 'over', 'the set ended after round three');
  assert.equal(st.setNo, 1);
  assert.equal(G.roundId(st), 's1');
  assert.match(G.summarize(st, maybeName), /Alice won Fugue with 6 points/);
  const again = ok(st, { a: 'start', m: 'stream' });
  assert.equal(again.mode, 'solo-streamer', 'over screen can switch straight back to streaming');
  assert.equal(G.summarize(again, (id) => id), null);
});

test('conn: project never leaks the other ends of the run, roster carries book names', () => {
  let st = started();
  clock += 3000;
  st = ok(st, { a: 'drip' });
  const v = G.project(st, 'p1', null);
  assert.equal(v.role, 'conn');
  assert.equal(v.round.linkCount, 0);
  assert.deepEqual(v.round.conn, 'p1');
  const names = {};
  (v.roster || []).forEach((p) => { names[p.id] = p.name; });
  st.round.streamers.forEach((s) => assert.equal(names[s], st.round.bot[s].book, s + ' is labeled by its book'));
});

test('conn: prune removes the player and leaves no half-live bots', () => {
  let st = started();
  clock += 3000; st = ok(st, { a: 'drip' });
  st = G.prune(st, 'p1');
  assert.equal(st.players.length, 0);
  assert.equal(st.phase, 'over');
  assert.equal(G.summarize(st, (id) => id), null, 'an empty table records nothing');
  const same = G.prune(started(), 'zzz');
  assert.deepEqual(same.mode, 'solo-conn', 'an unknown leaver changes nothing');
});

// ---------------------------------------------------------------- verdict ---

test('solo: words score no points and the prompt swap is a no-op', () => {
  let st = ok(fresh(), { a: 'start', m: 'stream' });
  st = ok(st, { a: 'word', w: 'alpha' });
  assert.deepEqual(st.scores, {}, 'solo keeps the count-based record');
  const before = st.soloRound.prompt;
  const sw = act(st, { a: 'prompt' });
  assert.ok(!sw.error, 'the swap is silently ignored, not refused');
  assert.equal(sw.soloRound.prompt, before);
  assert.deepEqual(sw.soloRound.words, st.soloRound.words);
});

test('solo: Free Association is refused, not quietly started', () => {
  const r = act(fresh(), { a: 'start', m: 'free' });
  assert.ok(r.error, 'free needs a table of three');
});

// ---------------------------------------------------------- solo <-> multi ----
// init() seats who opened first; later arrivals come through `join`. A second
// human must promote the table out of solo, or multiplayer is unreachable.

test('solo -> multi: a second join promotes the table, three can start', () => {
  let st = fresh();
  assert.equal(st.mode, 'solo-streamer');
  st = ok(st, { a: 'join' }, { id: 'p2', name: 'Bo', host: false });
  assert.equal(st.mode, null, 'second player leaves solo');
  assert.deepEqual(st.players, ['p1', 'p2']);
  assert.equal(st.soloRound, null);
  assert.equal(act(st, { a: 'start' }).error, 'Fugue needs 3 players.', 'two players is the multiplayer lobby, not solo');
  st = ok(st, { a: 'join' }, { id: 'p3', name: 'Cy', host: false });
  st = ok(st, { a: 'start', m: 'classic' });
  assert.equal(st.phase, 'intro');
  assert.equal(st.round.streamers.length, 2);
  clock = st.round.introEndsAt + 10;
  st = ok(st, { a: 'go' });
  assert.equal(st.phase, 'live');
  const s0 = st.round.streamers[0];
  st = ok(st, { a: 'word', w: 'alpha' }, { id: s0, name: s0, host: false });
  assert.equal(st.round.words[s0].length, 1);
});

test('multi -> solo: prune back to one player in lobby restores solo', () => {
  let st = fresh();
  st = ok(st, { a: 'join' }, { id: 'p2', name: 'Bo', host: false });
  assert.equal(st.mode, null);
  st = G.prune(st, 'p2');
  assert.equal(st.mode, 'solo-streamer');
  assert.deepEqual(st.players, ['p1']);
  assert.equal(st.hostId, 'p1');
  assert.equal(st.phase, 'lobby');
  st = ok(st, { a: 'start', m: 'stream' });
  assert.equal(st.phase, 'live');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
