// Rules suite for games/fugue/index.js — loads the shipped module and drives
// reduce()/project()/prune()/summarize() with a fake clock. Exit code is the verdict.
//   node tests/fugue_rules.mjs
import assert from 'node:assert/strict';
import * as G from '../games/fugue/index.js';

let clock = 1_000_000;
Date.now = () => clock;
let seed = 7;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + (e && e.message)); process.exitCode = 1; } }

const ids = ['a', 'b', 'c', 'd'];
const seats = (n) => ids.slice(0, n).map((id) => ({ id, name: id.toUpperCase() }));
const act = (st, who, action) => {
  const r = G.reduce(st, action, { from: { id: who, host: who === 'a' }, rng });
  return r;
};
const ok = (st, who, action) => { const r = act(st, who, action); assert.ok(!r.error, 'unexpected error: ' + (r.error || '')); return r; };
function started(n, m) {
  let st = G.init({ atTable: seats(n) });
  st = ok(st, 'a', { a: 'start', m: m || 'full' });
  return st;
}
function live(n, m) {
  let st = started(n, m);
  clock = st.round.introEndsAt + 10;
  return ok(st, 'a', { a: 'go' });
}
const streamerOf = (st, i) => st.round.streamers[i];

test('init seats the table, skips spectators, caps at 8', () => {
  const many = []; for (let i = 0; i < 12; i++) many.push({ id: 'p' + i });
  many[3].spectator = true;
  const st = G.init({ atTable: many });
  assert.equal(st.players.length, 8);
  assert.ok(st.players.indexOf('p3') < 0);
  assert.equal(st.hostId, 'p0');
});

test('start needs the host and three players', () => {
  const two = G.init({ atTable: seats(2) });
  assert.ok(act(two, 'a', { a: 'start' }).error);
  const three = G.init({ atTable: seats(3) });
  assert.ok(act(three, 'b', { a: 'start' }).error, 'a guest must not start');
  const st = ok(three, 'a', { a: 'start' });
  assert.equal(st.phase, 'intro');
  assert.equal(st.round.streamers.length, 2);
  assert.ok(st.round.streamers.indexOf(st.round.conn) < 0);
  const p = st.round.prompts;
  assert.notEqual(p[st.round.streamers[0]], p[st.round.streamers[1]], 'streamers get different prompts');
});

test('the clock gates intro -> live', () => {
  const st = started(3);
  clock = st.round.introEndsAt - 3000;
  assert.equal(ok(st, 'b', { a: 'go' }).phase, 'intro');
  clock = st.round.introEndsAt + 1;
  assert.equal(ok(st, 'b', { a: 'go' }).phase, 'live');
});

test('words: only streamers, cleaned, capped, ignored out of phase', () => {
  let st = live(3);
  const s = streamerOf(st, 0);
  assert.ok(act(st, st.round.conn, { a: 'word', w: 'hi' }).error, 'the connectionist cannot type');
  st = ok(st, s, { a: 'word', w: '  fire, ' });
  st = ok(st, s, { a: 'word', w: '' });
  st = ok(st, s, { a: 'word', w: 'x'.repeat(80) });
  const w = st.round.words[s];
  assert.deepEqual(w.slice(0, 2), ['fire', '']);
  assert.equal(w[2].length, 24);
  for (let i = 0; i < 60; i++) st = ok(st, s, { a: 'word', w: 'w' + i });
  assert.equal(st.round.words[s].length, 40);
  const early = started(3);
  assert.equal(ok(early, streamerOf(early, 0), { a: 'word', w: 'zzz' }).round.words[streamerOf(early, 0)].length, 0);
});

test('project hides other streams, prompts and votes from a streamer', () => {
  let st = live(4);
  const [s0, s1, s2] = st.round.streamers;
  st = ok(st, s0, { a: 'word', w: 'alpha' });
  st = ok(st, s1, { a: 'word', w: 'beta' });
  const v0 = G.project(st, s0, null);
  assert.deepEqual(Object.keys(v0.round.words), [s0]);
  assert.deepEqual(Object.keys(v0.round.prompts), [s0]);
  assert.equal(v0.round.rel, '');
  assert.equal(v0.round.links.length, 0);
  const vc = G.project(st, st.round.conn, null);
  assert.equal(Object.keys(vc.round.words).length, 3);
  assert.equal(Object.keys(vc.round.prompts).length, 0, 'connectionist reads the streams cold');
  assert.ok(vc.round.rel);
  assert.ok(!JSON.stringify(v0).includes('beta'), 'no leak of the other stream');
});

function withWords(n) {
  let st = live(n);
  st.round.streamers.forEach((s) => { for (let i = 0; i < 6; i++) st = ok(st, s, { a: 'word', w: s + i }); });
  return st;
}

test('links: validation, once per word, vertical, weight, relation switches', () => {
  let st = withWords(4);
  const c = st.round.conn, [s0, s1, s2] = st.round.streamers;
  assert.ok(act(st, s0, { a: 'link', picks: [{ s: s0, i: 0 }, { s: s1, i: 0 }] }).error, 'streamers cannot link');
  assert.ok(act(st, c, { a: 'link', picks: [{ s: s0, i: 0 }] }).error, 'needs two streams');
  assert.ok(act(st, c, { a: 'link', picks: [{ s: s0, i: 0 }, { s: s0, i: 1 }] }).error, 'one word per stream');
  assert.ok(act(st, c, { a: 'link', picks: [{ s: s0, i: 9 }, { s: s1, i: 0 }] }).error, 'word must exist');
  const rel0 = st.round.rel;
  st = ok(st, c, { a: 'link', picks: [{ s: s0, i: 2 }, { s: s1, i: 2 }] });
  const l1 = st.round.links[0];
  assert.equal(l1.vertical, true); assert.equal(l1.weight, 1); assert.equal(l1.rel, rel0);
  assert.notEqual(st.round.rel, rel0, 'relation switches after a link');
  assert.ok(act(st, c, { a: 'link', picks: [{ s: s0, i: 2 }, { s: s1, i: 3 }] }).error, 'a word links once');
  st = ok(st, c, { a: 'link', picks: [{ s: s2, i: 1 }, { s: s0, i: 4 }, { s: s1, i: 5 }] });
  const l2 = st.round.links[1];
  assert.equal(l2.vertical, false); assert.equal(l2.weight, 2);
  assert.deepEqual(l2.picks.map((p) => p.s), [s0, s1, s2], 'picks ordered by stream');
});

test('the relation never repeats twice in a row', () => {
  let st = live(3);
  const [s0, s1] = st.round.streamers;
  for (let i = 0; i < 40; i++) { st = ok(st, s0, { a: 'word', w: 'q' + i }); st = ok(st, s1, { a: 'word', w: 'r' + i }); }
  let prev = st.round.rel;
  for (let i = 0; i < 30; i++) {
    st = ok(st, st.round.conn, { a: 'link', picks: [{ s: s0, i: i }, { s: s1, i: i }] });
    assert.notEqual(st.round.rel, prev); prev = st.round.rel;
  }
});

test('a streamer sees which of their words were used, not the link', () => {
  let st = withWords(3);
  const [s0, s1] = st.round.streamers;
  st = ok(st, st.round.conn, { a: 'link', picks: [{ s: s0, i: 1 }, { s: s1, i: 1 }] });
  const v = G.project(st, s0, null);
  assert.deepEqual(v.round.mineUsed, [1]);
  assert.equal(v.round.links.length, 0);
  assert.equal(v.round.linkCount, 1);
});

test('finish: no links skips the vote; links open it; the clock gates it', () => {
  let st = withWords(3);
  const [s0, s1] = st.round.streamers;
  assert.equal(ok(st, 'a', { a: 'finish' }).phase, 'live', 'too early');
  st = ok(st, st.round.conn, { a: 'link', picks: [{ s: s0, i: 0 }, { s: s1, i: 0 }] });
  clock = st.round.endsAt + 5;
  const v = ok(st, 'b', { a: 'finish' });
  assert.equal(v.phase, 'vote');
  assert.ok(v.round.voteEndsAt > clock);
  const none = live(3); clock = none.round.endsAt + 5;
  assert.equal(ok(none, 'a', { a: 'finish' }).phase, 'tally');
});

function voting() {
  let st = withWords(4);
  const c = st.round.conn, [s0, s1, s2] = st.round.streamers;
  st = ok(st, c, { a: 'link', picks: [{ s: s0, i: 0 }, { s: s1, i: 0 }] });          // vertical x2 -> 2 pts
  st = ok(st, c, { a: 'link', picks: [{ s: s0, i: 1 }, { s: s1, i: 2 }, { s: s2, i: 3 }] }); // 3 streams, not vertical -> 2 pts
  st = ok(st, c, { a: 'link', picks: [{ s: s0, i: 3 }, { s: s2, i: 5 }] });           // 1 pt
  clock = st.round.endsAt + 5;
  st = ok(st, 'a', { a: 'finish' });
  return { st, c, s: [s0, s1, s2] };
}

test('votes: private until tally, yes must beat no, scoring', () => {
  let { st, c, s } = voting();
  assert.ok(act(st, c, { a: 'vote', n: 1, yes: true }).error, 'connectionist cannot vote');
  st = ok(st, s[0], { a: 'vote', n: 1, yes: true });
  assert.deepEqual(G.project(st, s[1], null).round.votes, {}, 'others votes are hidden');
  assert.deepEqual(G.project(st, s[0], null).round.votes, { 1: { [s[0]]: true } });
  assert.equal(G.project(st, c, null).round.cast, 1);
  st = ok(st, s[1], { a: 'vote', n: 1, yes: true });
  st = ok(st, s[2], { a: 'vote', n: 1, yes: false });     // 2-1 stands (+2)
  st = ok(st, s[0], { a: 'vote', n: 2, yes: true });
  st = ok(st, s[1], { a: 'vote', n: 2, yes: false });
  st = ok(st, s[2], { a: 'vote', n: 2, yes: false });     // 1-2 falls
  st = ok(st, s[0], { a: 'vote', n: 3, yes: true });
  st = ok(st, s[1], { a: 'vote', n: 3, yes: false });
  assert.equal(st.phase, 'vote');
  st = ok(st, s[2], { a: 'vote', n: 3, yes: true });      // 2-1 stands (+1); everyone voted -> tally
  assert.equal(st.phase, 'tally');
  assert.equal(st.round.result.points, 3);
  assert.equal(st.scores[c], 3);
  assert.equal(G.project(st, s[1], null).round.votes[2][s[0]], true, 'votes revealed at tally');
});

test('a tie, and silence, do not stand; close needs the deadline', () => {
  let { st, c, s } = voting();
  st = ok(st, s[0], { a: 'vote', n: 1, yes: true });
  st = ok(st, s[1], { a: 'vote', n: 1, yes: false });     // 1-1 tie, s2 silent
  assert.equal(ok(st, 'a', { a: 'close' }).phase, 'vote', 'too early to close');
  clock = st.round.voteEndsAt + 5;
  const t = ok(st, 'a', { a: 'close' });
  assert.equal(t.phase, 'tally');
  assert.equal(t.scores[c], 0);
});

test('a full set: everyone connects once, then it ends and records', () => {
  let st = G.init({ atTable: seats(3) });
  st = ok(st, 'a', { a: 'start' });
  const seen = [];
  for (let r = 0; r < 3; r++) {
    seen.push(st.round.conn);
    clock = st.round.introEndsAt + 5; st = ok(st, 'a', { a: 'go' });
    clock = st.round.endsAt + 5; st = ok(st, 'a', { a: 'finish' });
    assert.equal(st.phase, 'tally');
    clock = st.round.tallyEndsAt + 5;
    st = ok(st, 'b', { a: 'next' });
  }
  assert.equal(new Set(seen).size, 3, 'each player connected once');
  assert.equal(st.phase, 'over');
  assert.equal(G.roundId(st), 's1');
  const line = G.summarize(st, (id) => id.toUpperCase());
  assert.match(line, /tied Fugue on 0 points/);
  const again = ok(st, 'a', { a: 'start' });
  assert.equal(again.setNo, 2); assert.equal(again.phase, 'intro');
  assert.equal(G.summarize(again, (id) => id), null);
});

test('summarize names a winner and the rest', () => {
  let st = G.init({ atTable: seats(3) });
  st = Object.assign({}, st, { phase: 'over', setNo: 1, order: ['a', 'b', 'c'], scores: { a: 5, b: 2, c: 2 } });
  st.over = { rows: [{ id: 'a', pts: 5 }, { id: 'b', pts: 2 }, { id: 'c', pts: 2 }], top: 5, winners: ['a'] };
  assert.equal(G.summarize(st, (id) => id.toUpperCase()), 'A won Fugue with 5 points (B 2, C 2)');
});

test('late joiners wait for the next set', () => {
  let st = started(3);
  st = ok(st, 'd', { a: 'join' }).round ? ok(st, 'd', { a: 'join' }) : st;
  assert.deepEqual(st.late, ['d']);
  assert.ok(act(st, 'd', { a: 'word', w: 'x' }).error, 'late player is not seated yet');
});

test('prune: connectionist leaves -> round called off; streamer leaves in vote -> carries on', () => {
  let st = withWords(4);
  const gone = G.prune(st, st.round.conn);
  assert.equal(gone.phase, 'tally'); assert.equal(gone.round.aborted, true);
  assert.equal(gone.players.length, 3);
  assert.equal(G.prune(st, 'zzz'), st, 'unknown id returns the same object');

  let { st: v, s } = voting();
  [s[0], s[1]].forEach((id) => { [1, 2, 3].forEach((n) => { v = ok(v, id, { a: 'vote', n, yes: true }); }); });
  assert.equal(v.phase, 'vote');
  const after = G.prune(v, s[2]);                       // the one holding the vote up leaves
  assert.equal(after.phase, 'tally');

  const small = withWords(3);
  const killed = G.prune(small, small.round.streamers[0]);   // only one streamer left
  assert.equal(killed.round.aborted, true);
  clock = killed.round.tallyEndsAt + 5;
  assert.equal(ok(killed, killed.players[0], { a: 'next' }).phase, 'over', 'under 3 players ends the set');
});

test('streamers score a point per locked word', () => {
  let st = live(3);
  const s = streamerOf(st, 0);
  st = ok(st, s, { a: 'word', w: 'one' });
  st = ok(st, s, { a: 'word', w: 'two' });
  assert.equal(st.scores[s], 2);
  assert.equal(st.scores[st.round.conn], 0);
});

test('a blessed word is worth four in total; a falling link pays nothing', () => {
  let st = live(3);
  const c = st.round.conn, [s0, s1] = st.round.streamers;
  st = ok(st, s0, { a: 'word', w: 'alpha' });
  st = ok(st, s1, { a: 'word', w: 'beta' });
  st = ok(st, c, { a: 'link', picks: [{ s: s0, i: 0 }, { s: s1, i: 0 }] });
  clock = st.round.endsAt + 5;
  st = ok(st, 'a', { a: 'finish' });
  st = ok(st, s0, { a: 'vote', n: 1, yes: true });
  st = ok(st, s1, { a: 'vote', n: 1, yes: true });
  assert.equal(st.phase, 'tally');
  assert.equal(st.scores[s0], 4, '1 for the lock, 3 for the bless');
  assert.equal(st.scores[s1], 4);
  assert.equal(st.scores[c], 2, 'vertical link, double');

  let st2 = live(3);
  const c2 = st2.round.conn, [t0, t1] = st2.round.streamers;
  st2 = ok(st2, t0, { a: 'word', w: 'alpha' });
  st2 = ok(st2, t1, { a: 'word', w: 'beta' });
  st2 = ok(st2, c2, { a: 'link', picks: [{ s: t0, i: 0 }, { s: t1, i: 0 }] });
  clock = st2.round.endsAt + 5;
  st2 = ok(st2, 'a', { a: 'finish' });
  st2 = ok(st2, t0, { a: 'vote', n: 1, yes: false });
  st2 = ok(st2, t1, { a: 'vote', n: 1, yes: false });
  assert.equal(st2.phase, 'tally');
  assert.equal(st2.scores[t0], 1);
  assert.equal(st2.scores[t1], 1);
  assert.equal(st2.scores[c2], 0);
});

test('classic holds one relation; full snaps; free has none', () => {
  let classic = live(3, 'classic');
  const rel = classic.round.rel;
  const [a0, a1] = classic.round.streamers;
  classic = ok(classic, a0, { a: 'word', w: 'quiet' });
  classic = ok(classic, a1, { a: 'word', w: 'loud' });
  classic = ok(classic, classic.round.conn, { a: 'link', picks: [{ s: a0, i: 0 }, { s: a1, i: 0 }] });
  assert.equal(classic.round.rel, rel, 'classic holds the relation all round');

  let full = live(3, 'full');
  const r0 = full.round.rel;
  const [f0, f1] = full.round.streamers;
  full = ok(full, f0, { a: 'word', w: 'quiet' });
  full = ok(full, f1, { a: 'word', w: 'loud' });
  full = ok(full, full.round.conn, { a: 'link', picks: [{ s: f0, i: 0 }, { s: f1, i: 0 }] });
  assert.notEqual(full.round.rel, r0, 'full snaps to a new relation');

  let free = live(3, 'free');
  assert.equal(free.round.rel, 'free');
  const [e0, e1] = free.round.streamers;
  free = ok(free, e0, { a: 'word', w: 'quiet' });
  free = ok(free, e1, { a: 'word', w: 'loud' });
  free = ok(free, free.round.conn, { a: 'link', picks: [{ s: e0, i: 0 }, { s: e1, i: 0 }] });
  assert.equal(free.round.links[0].rel, 'free');
  assert.equal(free.round.rel, 'free', 'free never deals a relation');
  clock = free.round.endsAt + 5;
  free = ok(free, 'a', { a: 'finish' });
  free = ok(free, e0, { a: 'vote', n: 1, yes: true });
  free = ok(free, e1, { a: 'vote', n: 1, yes: true });
  assert.equal(free.phase, 'tally');
  assert.equal(free.round.result.points, 2, 'vertical free link, double');
});

test('prompt: swap keeps words, once per round, costs three', () => {
  let st = live(3);
  const s = streamerOf(st, 0);
  st = ok(st, s, { a: 'word', w: 'kept' });
  const before = st.round.prompts[s];
  st = ok(st, s, { a: 'prompt' });
  assert.notEqual(st.round.prompts[s], before, 'a fresh prompt arrives');
  assert.deepEqual(st.round.words[s], ['kept'], 'locked words carry over');
  assert.equal(st.scores[s], 1 - 3, 'lock scores, swap costs three');
  assert.ok(st.round.swaps[s]);
  assert.ok(act(st, s, { a: 'prompt' }).error, 'once per round');
  assert.ok(act(st, st.round.conn, { a: 'prompt' }).error, 'the connectionist cannot swap');
  assert.equal(G.project(st, s, null).round.promptUsed, true);
});

test('toLobby: over returns to the lobby, seats kept, host-only', () => {
  let st = G.init({ atTable: seats(3) });
  st = ok(st, 'a', { a: 'start' });
  for (let r = 0; r < 3; r++) {
    clock = st.round.introEndsAt + 5; st = ok(st, 'a', { a: 'go' });
    clock = st.round.endsAt + 5; st = ok(st, 'a', { a: 'finish' });
    clock = st.round.tallyEndsAt + 5;
    st = ok(st, 'b', { a: 'next' });
  }
  assert.equal(st.phase, 'over');
  assert.ok(act(st, 'b', { a: 'toLobby' }).error, 'a guest cannot reset the table');
  const lobby = ok(st, 'a', { a: 'toLobby' });
  assert.equal(lobby.phase, 'lobby');
  assert.deepEqual(lobby.players.slice().sort(), ['a', 'b', 'c']);
  assert.equal(lobby.over, null);
  assert.equal(lobby.round, null);
  assert.ok(lobby.epoch > st.epoch, 'epoch bump re-anchors clients');
  const again = ok(lobby, 'a', { a: 'start' });
  assert.equal(again.phase, 'intro', 'can start again from the lobby');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
