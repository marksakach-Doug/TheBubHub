// Rules, privacy and robustness checks for games/blight/index.js — runs the SHIPPED module.
//   node tests/blight_rules.mjs        (exit 0 = green)
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const G = await import(pathToFileURL(path.resolve(here, '../games/blight/index.js')).href);

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + (e && e.stack || e)); process.exitCode = 1; } };

const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/* A tiny stand-in for the hub: one authoritative state, reduce() on every send. */
class Table {
  constructor(humans, seed = 1, hostIdx = 0) {
    this.rng = mulberry(seed);
    this.users = humans.map((n, i) => ({ id: 'u' + i, name: n, host: i === hostIdx }));
    this.s = G.init({ seats: this.users, atTable: this.users, options: {} });
  }
  host() { return this.users.find((u) => u.host); }
  send(id, action, o = {}) {
    const u = this.users.find((x) => x.id === id) || { id, name: id, host: false };
    const r = G.reduce(this.s, action, { from: { id: u.id, name: u.name, host: o.host != null ? o.host : u.host }, rng: this.rng });
    if (r && r.error) return r;
    this.s = r; return null;
  }
  ok(id, action, o) { const r = this.send(id, action, o); assert.equal(r, null, 'unexpected rejection of ' + JSON.stringify(action) + ' from ' + id + ': ' + (r && r.error)); }
  view(id) { return G.project(this.s, id); }
}

/* Cards in play for one player, from the authoritative state. */
const cardsOf = (p) => p.hand.concat(p.stack, p.rev);

/* A legal move for `pid`, chosen only from what that player's own projected view contains. */
function legalMove(view, rnd) {
  const me = view.you, pick = (a) => a[Math.floor(rnd() * a.length)];
  const meP = view.players.find((p) => p.id === me);
  const mine = view.turn === me;
  switch (view.phase) {
    case 'plant': return mine ? { a: 'place', k: pick(view.hand).k } : null;
    case 'grow': {
      if (!mine) return null;
      const tot = view.players.reduce((n, p) => n + p.stack.length, 0);
      if (!view.hand.length || rnd() < 0.35) return { a: 'bid', n: 1 + Math.floor(rnd() * tot) };
      return { a: 'add', k: pick(view.hand).k };
    }
    case 'bid': {
      if (!mine) return null;
      if (view.bid.cur < view.max && rnd() < 0.4) return { a: 'raise', n: view.bid.cur + 1 + Math.floor(rnd() * (view.max - view.bid.cur)) };
      return { a: 'fold' };
    }
    case 'challenge': return mine ? { a: 'flip', t: pick(view.flipOpts) } : null;
    case 'lose': return mine ? { a: 'lose', k: pick(view.loseOpts) } : null;
    case 'result': return meP && view.readyNeed.includes(me) && !view.ready.includes(me) ? { a: 'ready' } : null;
  }
  return null;
}

/* Everything a viewer must NOT be able to learn, checked against their serialised view. */
function assertNoLeak(t, label) {
  const S = t.s;
  if (S.phase === 'lobby') return;
  const ids = t.users.map((u) => u.id).concat(['spectator']);
  const publicIds = new Set();
  S.order.forEach((id) => { S.p[id].rev.forEach((c) => publicIds.add(c.id)); (S.shown[id] || []).forEach((c) => publicIds.add(c.id)); });
  for (const viewer of ids) {
    const json = JSON.stringify(t.view(viewer));
    for (const owner of S.order) {
      if (owner === viewer) continue;
      for (const c of S.p[owner].hand.concat(S.p[owner].stack)) {
        if (publicIds.has(c.id)) continue;
        assert.ok(!json.includes('"' + c.id + '"'), `${label}: ${viewer} can see the id of ${owner}'s hidden card ${c.id}`);
        assert.ok(!new RegExp('"s":' + c.s + '[,}]').test(json), `${label}: ${viewer} can see the art seed of ${owner}'s hidden card ${c.id}`);
      }
    }
    const v = JSON.parse(json);
    if (viewer === 'spectator') assert.deepEqual(v.hand, [], 'a spectator was given a hand');
    v.players.forEach((p) => { if (p.id !== viewer) p.stack.forEach((c) => assert.ok(c.h === 1 && c.k === undefined, `${label}: ${viewer} sees the kind of ${p.id}'s face-down card`)); });
  }
}

function invariants(t, label) {
  const S = t.s;
  S.order.forEach((id) => {
    const cs = cardsOf(S.p[id]);
    assert.ok(cs.length <= 4, label + ': ' + id + ' holds more than 4 cards');
    assert.ok(cs.filter((c) => c.k === 'D').length <= 1, label + ': ' + id + ' holds two Dead Trees');
    assert.ok(cs.filter((c) => c.k === 'P').length <= 3, label + ': ' + id + ' holds more than 3 plants');
    assert.equal(new Set(cs.map((c) => c.id)).size, cs.length, label + ': duplicate card ids for ' + id);
    if (S.p[id].alive) assert.ok(cs.length > 0, label + ': ' + id + ' alive with no cards');
    else assert.equal(cs.length, 0, label + ': eliminated ' + id + ' still holds cards');
  });
  assert.ok(S.log.length <= 16, 'log grew unbounded');
}

/* ---------------------------------------------------------------------------------- */
console.log('lobby and seating');

test('init seats the table, skipping spectators and bots', () => {
  const s = G.init({ seats: [], atTable: [{ id: 'a', name: 'Ann', host: true }, { id: 'b', name: 'Bo', spectator: true }, { id: 'c', name: 'Cy', bot: true }, { id: 'd', name: 'Di' }], options: {} });
  assert.deepEqual(s.lobby, ['a', 'd']);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.hostId, 'a');
  JSON.stringify(s);
});

test('late joiners are added once; start is host-only; a lone player may start', () => {
  const t = new Table(['Ann']);
  t.ok('u9', { a: 'join' }, { host: false });
  t.ok('u9', { a: 'join' }, { host: false });
  assert.deepEqual(t.s.lobby, ['u0', 'u9']);
  assert.match(t.send('u9', { a: 'start' }).error, /host/i);
  t.ok('u0', { a: 'start' });
  assert.equal(t.s.phase, 'plant');
  assert.equal(t.s.order.length, 3, '2 humans + 1 bot to reach the minimum of 3');
  const solo = new Table(['Ann']);
  solo.ok('u0', { a: 'start' });
  assert.equal(solo.s.order.length, 3, 'solo = 1 human + 2 bots');
});

test('a table of one (host elsewhere) can still be started by whoever holds it', () => {
  const t = new Table(['Ann']);
  t.s.hostId = 'someone-else';
  t.ok('u0', { a: 'start' }, { host: false });
});

test('bot count is the host’s call, clamped, and cannot pad past six seats', () => {
  const t = new Table(['A', 'B', 'C', 'D']);
  assert.match(t.send('u1', { a: 'bots', n: 2 }).error, /host/i);
  t.ok('u0', { a: 'bots', n: 99 });
  assert.equal(t.s.bots, 5);
  t.ok('u0', { a: 'start' });
  assert.equal(t.s.order.length, 6, '4 humans + 2 bots, capped at 6');
});

test('more than six people: six play, the rest watch', () => {
  const t = new Table(['1', '2', '3', '4', '5', '6', '7', '8']);
  t.ok('u0', { a: 'start' });
  assert.equal(t.s.order.length, 6);
  const v = t.view('u7');
  assert.equal(v.seated, false);
  assert.equal(v.joined, true);
  assert.deepEqual(v.hand, []);
  assert.match(t.send('u7', { a: 'place', k: 'P' }).error, /not seated|watching/i);
});

test('deal: 3 plants + 1 dead tree each, and a card id never reveals its kind', () => {
  const kindsByIndex = [0, 0, 0, 0];
  for (let seed = 1; seed <= 200; seed++) {
    const t = new Table(['A', 'B', 'C'], seed); t.ok('u0', { a: 'start' });
    t.s.order.forEach((id) => {
      const h = t.s.p[id].hand.concat(t.s.p[id].stack);
      assert.equal(h.filter((c) => c.k === 'P').length + h.filter((c) => c.k === 'D').length, 4);
      h.forEach((c) => { if (c.k === 'D') kindsByIndex[+c.id.split('.')[1]]++; });
    });
  }
  // The dead tree must land on every index (0..3) a healthy share of the time — never always index 3.
  kindsByIndex.forEach((n, i) => assert.ok(n > 100, 'dead tree is biased towards card index ' + i + ': ' + kindsByIndex));
});

/* ---------------------------------------------------------------------------------- */
console.log('turn rules');

function fixedTable(hands, opts = {}) {
  // three humans, seat order fixed, every stack empty, hands as given: {u0:'PPPD', ...}
  const t = new Table(['A', 'B', 'C'], 7);
  t.ok('u0', { a: 'start' });
  assert.equal(t.s.order.length, 3);
  t.s.order = ['u0', 'u1', 'u2'];
  const next = {};
  Object.keys(t.s.p).forEach((id) => { if (!['u0', 'u1', 'u2'].includes(id)) delete t.s.p[id]; });
  ['u0', 'u1', 'u2'].forEach((id, n) => {
    t.s.p[id] = { name: id, bot: false, alive: true, wins: 0, tag: '', stack: [], rev: [], hand: hands[id].split('').map((k, i) => ({ id: id + '.' + i, k, s: 1000 * n + i })) };
  });
  t.s.starter = 'u0'; t.s.turn = 'u0'; t.s.phase = 'plant'; t.s.placed = []; t.s.round = 1; t.s.log = [];
  return t;
}

test('planting goes round the table in order and only on your own turn', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  assert.match(t.send('u1', { a: 'place', k: 'P' }).error, /turn/i);
  t.ok('u0', { a: 'place', k: 'P' });
  assert.match(t.send('u0', { a: 'place', k: 'P' }).error, /turn/i);
  t.ok('u1', { a: 'place', k: 'D' });
  assert.equal(t.s.phase, 'plant');
  t.ok('u2', { a: 'place', k: 'P' });
  assert.equal(t.s.phase, 'grow');
  assert.equal(t.s.turn, 'u0');
});

test('you cannot place a kind you do not hold, or a nonsense kind', () => {
  const t = fixedTable({ u0: 'PPP', u1: 'PPPD', u2: 'PPPD' });
  assert.match(t.send('u0', { a: 'place', k: 'D' }).error, /no Dead Tree/i);
  assert.ok(t.send('u0', { a: 'place', k: 'X' }).error);
});

function toGrow(t, plants = { u0: 'P', u1: 'P', u2: 'P' }) {
  ['u0', 'u1', 'u2'].forEach((id) => t.ok(id, { a: 'place', k: plants[id] }));
  assert.equal(t.s.phase, 'grow');
}

test('a player with an empty hand must bid; others may add or bid', () => {
  const t = fixedTable({ u0: 'P', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t);
  assert.match(t.send('u0', { a: 'add', k: 'P' }).error, /no cards|must bid/i);
  assert.match(t.send('u0', { a: 'bid', n: 4 }).error, /between 1 and 3/);
  t.ok('u0', { a: 'bid', n: 2 });
  assert.equal(t.s.phase, 'bid');
});

test('bidding: raise must beat the bid, folders stay out, high bidder is not asked again', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t);
  t.ok('u0', { a: 'bid', n: 1 });
  assert.equal(t.s.turn, 'u1');
  assert.match(t.send('u1', { a: 'raise', n: 1 }).error, /between 2 and 3/);
  t.ok('u1', { a: 'raise', n: 2 });
  assert.equal(t.s.turn, 'u2');
  t.ok('u2', { a: 'fold' });
  assert.equal(t.s.turn, 'u0', 'u0 may still raise over u1');
  t.ok('u0', { a: 'fold' });
  assert.equal(t.s.phase, 'challenge', 'only u1 is left in: it becomes the challenge');
  assert.equal(t.s.challenger, 'u1');
  assert.equal(t.s.need, 2);
});

test('fold: you are out of the bidding until the next round, and the table can see it', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t);
  t.ok('u0', { a: 'bid', n: 1 });
  assert.equal(t.view('u2').players.find((p) => p.id === 'u1').folded, false);
  t.ok('u1', { a: 'raise', n: 2 });
  t.ok('u2', { a: 'fold' });
  assert.equal(t.s.log[t.s.log.length - 1], 'C folded.', 'the log says "folded", not "passes"');
  assert.ok(!t.s.log.some((l) => /pass/i.test(l)), 'no log line still talks about passing');
  for (const viewer of ['u0', 'u1', 'u2', 'stranger']) assert.equal(t.view(viewer).players.find((p) => p.id === 'u2').folded, true, viewer + ' sees u2 folded');
  assert.equal(t.view('u0').players.find((p) => p.id === 'u0').folded, false);
  assert.equal(t.s.p.u2.tag, 'Folded');
  t.ok('u0', { a: 'raise', n: 3 });                  // u0 re-raises; u1 and u0 keep going, u2 is never asked again
  assert.ok(t.s.phase !== 'bid' || t.s.turn !== 'u2', 'a folded player is never asked to bid again');
  assert.match(t.send('u2', { a: 'raise', n: 3 }).error, /turn|nobody/i);
  assert.match(t.send('u2', { a: 'fold' }).error, /turn|nobody/i);
  // folded stays visible through the challenge and the result, and clears when the next round starts
  t.s = JSON.parse(JSON.stringify(t.s));
  assert.equal(t.view('u1').players.find((p) => p.id === 'u2').folded, true);
  while (t.s.phase === 'challenge') { const c = t.s.challenger, opts = t.view(c).flipOpts; if (!opts.length) break; t.ok(c, { a: 'flip', t: opts[0] }); }
  if (t.s.phase === 'result') {
    assert.equal(t.view('u0').players.find((p) => p.id === 'u2').folded, true, 'still dimmed on the result screen');
    t.ok('u0', { a: 'next' });
  }
  if (t.s.phase === 'plant') assert.ok(t.users.every((u) => t.view(u.id).players.every((p) => p.folded === false)), 'nobody is folded in the new round');
});

test('"pass" no longer exists as an action', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t); t.ok('u0', { a: 'bid', n: 1 });
  assert.match(t.send('u1', { a: 'pass' }).error, /unknown/i);
});

test('bidding the maximum ends the bidding at once', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t);
  t.ok('u0', { a: 'bid', n: 3 });
  assert.notEqual(t.s.phase, 'bid');
});

test('the challenger flips their own stack top-first, then picks other stacks', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t, { u0: 'P', u1: 'P', u2: 'P' });
  t.ok('u0', { a: 'add', k: 'P' });     // u0 stack: P P  (top = second P)
  t.ok('u1', { a: 'add', k: 'P' });
  t.ok('u2', { a: 'add', k: 'P' });
  assert.equal(t.s.turn, 'u0');
  t.ok('u0', { a: 'bid', n: 3 });
  t.ok('u1', { a: 'fold' });
  t.ok('u2', { a: 'fold' });
  // u0 must reveal 3: both its own plants first, then one more from somebody else
  assert.equal(t.s.phase, 'challenge');
  assert.equal(t.s.count, 2);
  assert.equal(t.s.p.u0.stack.length, 0);
  assert.deepEqual(t.view('u0').flipOpts.sort(), ['u1', 'u2']);
  assert.deepEqual(t.view('u1').flipOpts, [], 'only the challenger is offered flips');
  assert.match(t.send('u1', { a: 'flip', t: 'u2' }).error, /challenger/i);
  assert.match(t.send('u0', { a: 'flip', t: 'u0' }).error, /another/i);
  t.ok('u0', { a: 'flip', t: 'u1' });
  assert.equal(t.s.phase, 'result');
  assert.equal(t.s.p.u0.wins, 1);
});

test('hitting someone else’s Dead Tree: their owner removes a random card, unseen; owner starts next', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t, { u0: 'P', u1: 'D', u2: 'P' });
  t.ok('u0', { a: 'bid', n: 2 });
  t.ok('u1', { a: 'fold' }); t.ok('u2', { a: 'fold' });
  assert.equal(t.s.phase, 'challenge');
  t.ok('u0', { a: 'flip', t: 'u1' });
  assert.equal(t.s.phase, 'result');
  assert.equal(t.s.p.u0.hand.length, 3, 'u0 lost exactly one card');
  assert.equal(t.s.p.u0.wins, 0);
  assert.equal(t.s.starter, 'u0', 'the challenger survived, so they start');
});

test('hitting your own Dead Tree: a human with both kinds chooses; with one kind it is automatic', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t, { u0: 'D', u1: 'P', u2: 'P' });
  t.ok('u0', { a: 'bid', n: 1 });
  t.ok('u1', { a: 'fold' }); t.ok('u2', { a: 'fold' });
  assert.equal(t.s.phase, 'lose');
  assert.deepEqual(t.view('u0').loseOpts, ['P', 'D']);
  assert.equal(t.view('u1').loseOpts, null);
  assert.match(t.send('u1', { a: 'lose', k: 'P' }).error, /not yours/i);
  t.ok('u0', { a: 'lose', k: 'D' });
  assert.equal(t.s.phase, 'result');
  assert.equal(t.s.p.u0.hand.filter((c) => c.k === 'D').length, 0, 'the chosen Dead Tree is gone');
  assert.equal(t.s.p.u0.hand.length, 3);

  const t2 = fixedTable({ u0: 'D', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t2, { u0: 'D', u1: 'P', u2: 'P' });
  t2.ok('u0', { a: 'bid', n: 1 });
  t2.ok('u1', { a: 'fold' }); t2.ok('u2', { a: 'fold' });
  assert.equal(t2.s.p.u0.alive, false, 'down to nothing: eliminated, and no choice was needed');
});

test('two successful challenges win the game; the record sentence names winner and table', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  t.s.p.u0.wins = 1;
  toGrow(t, { u0: 'P', u1: 'P', u2: 'P' });
  t.ok('u0', { a: 'bid', n: 1 });
  t.ok('u1', { a: 'fold' }); t.ok('u2', { a: 'fold' });
  assert.equal(t.s.phase, 'over');
  assert.equal(t.s.winner, 'u0');
  const s = G.summarize(t.s, (id) => ({ u0: 'Ann', u1: 'Bo', u2: 'Cy' }[id]));
  assert.equal(s, 'Ann won Blight in 1 round against Bo and Cy');
  assert.equal(G.roundId(t.s), 'b' + t.s.epoch);
});

test('summarize is silent until the game is decided, and describes bots and bot wins', () => {
  const t = new Table(['Ann'], 3); t.ok('u0', { a: 'start' });
  assert.equal(G.summarize(t.s, () => 'x'), null);
  t.s.phase = 'over'; t.s.winner = 'u0';
  assert.match(G.summarize(t.s, (id) => id === 'u0' ? 'Ann' : null), /^Ann won Blight in \d+ rounds? against 2 bots$/);
  const bot = t.s.order.find((id) => id[0] === '~'); t.s.winner = bot;
  assert.match(G.summarize(t.s, (id) => id === 'u0' ? 'Ann' : null), /^A bot won Blight .* against Ann and 1 bot$/);
});

test('between rounds everyone must continue; the host can push things along', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t, { u0: 'P', u1: 'P', u2: 'P' });
  t.ok('u0', { a: 'bid', n: 1 }); t.ok('u1', { a: 'fold' }); t.ok('u2', { a: 'fold' });
  assert.equal(t.s.phase, 'result');
  assert.deepEqual(t.view('u1').readyNeed.sort(), ['u0', 'u1', 'u2']);
  t.ok('u0', { a: 'ready' }); t.ok('u1', { a: 'ready' });
  assert.equal(t.s.phase, 'result');
  assert.match(t.send('u1', { a: 'next' }).error, /host/i);
  t.ok('u2', { a: 'ready' });
  assert.equal(t.s.phase, 'plant');
  assert.equal(t.s.round, 2);
  assert.equal(t.s.p.u0.stack.length, 0);
  assert.equal(t.s.p.u0.hand.length, 4, 'cards come back to hand');
  // and the host can skip the wait
  const t2 = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t2); t2.ok('u0', { a: 'bid', n: 1 }); t2.ok('u1', { a: 'fold' }); t2.ok('u2', { a: 'fold' });
  t2.ok('u0', { a: 'next' });
  assert.equal(t2.s.phase, 'plant');
});

test('the host can have a bot move for someone who has gone quiet — and only the host', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  assert.match(t.send('u1', { a: 'skip' }).error, /host/i);
  t.ok('u0', { a: 'place', k: 'P' });
  assert.equal(t.s.turn, 'u1');
  t.ok('u0', { a: 'skip' });
  assert.equal(t.s.turn, 'u2', 'u1’s move was made for them');
  assert.equal(t.s.p.u1.stack.length, 1);
  assert.equal(t.s.p.u1.bot, false, 'and u1 is still a human');
});

test('toLobby is host-only, keeps seats, bumps the epoch, and play again deals a fresh game', () => {
  const t = new Table(['Ann', 'Bo', 'Cy'], 5); t.ok('u0', { a: 'start' });
  const e = t.s.epoch;
  assert.match(t.send('u1', { a: 'toLobby' }).error, /host/i);
  t.ok('u0', { a: 'toLobby' });
  assert.equal(t.s.phase, 'lobby');
  assert.deepEqual(t.s.lobby, ['u0', 'u1', 'u2']);
  assert.ok(t.s.epoch > e);
  t.ok('u0', { a: 'start' });
  assert.equal(t.s.round, 1);
});

/* ---------------------------------------------------------------------------------- */
console.log('leaving');

test('prune: nothing to remove returns the very same object', () => {
  const t = new Table(['Ann', 'Bo']);
  assert.equal(G.prune(t.s, 'stranger'), t.s);
});

test('prune in the lobby just removes the seat', () => {
  const t = new Table(['Ann', 'Bo']);
  const s = G.prune(t.s, 'u1');
  assert.deepEqual(s.lobby, ['u0']);
});

test('a player who leaves mid-round becomes a bot, so no round ever waits on them', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  t.ok('u0', { a: 'place', k: 'P' });
  assert.equal(t.s.turn, 'u1');
  t.s = G.prune(t.s, 'u1');                          // it was u1's turn
  assert.equal(t.s.p.u1.bot, true);
  assert.equal(t.s.p.u1.left, true);
  assert.equal(t.s.p.u1.stack.length, 1, 'the bot moved straight away');
  assert.equal(t.s.turn, 'u2');
  assert.ok(!t.s.lobby.includes('u1'));
  invariants(t, 'after leave');
});

test('leaving during the "continue" screen does not strand the others', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  toGrow(t); t.ok('u0', { a: 'bid', n: 1 }); t.ok('u1', { a: 'fold' }); t.ok('u2', { a: 'fold' });
  t.ok('u0', { a: 'ready' }); t.ok('u1', { a: 'ready' });
  t.s = G.prune(t.s, 'u2');                          // the only one left to tap
  assert.equal(t.s.phase, 'plant', 'everyone present had already continued');
});

test('with every human gone the table freezes instead of grinding bots forever', () => {
  const t = fixedTable({ u0: 'PPPD', u1: 'PPPD', u2: 'PPPD' });
  ['u0', 'u1', 'u2'].forEach((id) => { t.s = G.prune(t.s, id); });
  assert.ok(['plant', 'grow'].includes(t.s.phase));
  assert.equal(G.summarize(t.s, () => 'x'), null);
});

test('a bad action never throws and never changes state', () => {
  const t = new Table(['Ann', 'Bo']); t.ok('u0', { a: 'start' });
  const before = JSON.stringify(t.s);
  for (const a of [null, {}, { a: 5 }, { a: 'nope' }, { a: 'place' }, { a: 'bid', n: 'x' }, { a: 'raise', n: -1 }, { a: 'flip' }, { a: 'lose', k: 'Z' }, { a: 'ready' }]) {
    const r = G.reduce(t.s, a, { from: { id: 'u1', name: 'Bo' }, rng: Math.random });
    assert.ok(r && r.error, JSON.stringify(a) + ' should be rejected');
  }
  assert.equal(JSON.stringify(t.s), before);
});

/* ---------------------------------------------------------------------------------- */
console.log('whole games (random legal players, every move checked)');

function playGame({ humans, seed, check }) {
  const t = new Table(humans.map((_, i) => 'P' + i), seed);
  const rnd = mulberry(seed * 7919 + 13);
  t.ok('u0', { a: 'start' });
  let moves = 0;
  while (t.s.phase !== 'over') {
    assert.ok(++moves < 4000, `game ${seed} did not finish`);
    const candidates = t.users.map((u) => ({ u, m: legalMove(t.view(u.id), rnd) })).filter((x) => x.m);
    assert.ok(candidates.length, `game ${seed}: phase ${t.s.phase} but nobody can act (turn=${t.s.turn})`);
    const { u, m } = candidates[Math.floor(rnd() * candidates.length)];
    const r = t.send(u.id, m);
    assert.equal(r, null, `game ${seed}: ${u.id} sent a move its own view offered and it was rejected: ${JSON.stringify(m)} → ${r && r.error}`);
    invariants(t, `game ${seed} move ${moves}`);
    if (check) check(t, moves);
  }
  assert.ok(G.summarize(t.s, (id) => t.users.find((u) => u.id === id)?.name || null), 'finished game has a record sentence');
  return moves;
}

test('300 complete games, 1–6 humans plus bots, all moves legal and all games finish', () => {
  let total = 0;
  for (let seed = 1; seed <= 300; seed++) total += playGame({ humans: Array(1 + (seed % 6)).fill(0), seed });
  console.log('       (' + total + ' moves)');
});

test('no hidden card, seed or kind ever reaches another player or a spectator (every move of 40 games)', () => {
  for (let seed = 1000; seed < 1040; seed++) playGame({ humans: Array(1 + (seed % 5)).fill(0), seed, check: (t, n) => assertNoLeak(t, `game ${seed} move ${n}`) });
});

test('the view is JSON-safe and small, and the host view carries no authoritative state', () => {
  const t = new Table(['Ann', 'Bo', 'Cy'], 9); t.ok('u0', { a: 'start' });
  const v = t.view('u0'), json = JSON.stringify(v);
  assert.ok(json.length < 6000, 'view is ' + json.length + ' bytes');
  assert.equal(v.p, undefined);
  assert.equal(v.names, undefined);
});

test('a player leaving at a random moment in 100 games never deadlocks the table', () => {
  for (let seed = 5000; seed < 5100; seed++) {
    const t = new Table(['a', 'b', 'c', 'd'], seed), rnd = mulberry(seed);
    t.ok('u0', { a: 'start' });
    const leaveAt = 3 + Math.floor(rnd() * 40), who = 'u' + (1 + Math.floor(rnd() * 3));
    let moves = 0;
    while (t.s.phase !== 'over') {
      assert.ok(++moves < 4000, 'seed ' + seed + ' stalled after a leave');
      if (moves === leaveAt) t.s = G.prune(t.s, who);
      const cand = t.users.filter((u) => t.s.p[u.id] && !t.s.p[u.id].bot).map((u) => ({ u, m: legalMove(t.view(u.id), rnd) })).filter((x) => x.m);
      assert.ok(cand.length, 'seed ' + seed + ': nobody can act in ' + t.s.phase);
      const { u, m } = cand[Math.floor(rnd() * cand.length)];
      assert.equal(t.send(u.id, m), null);
      invariants(t, 'leave seed ' + seed);
    }
  }
});

console.log(process.exitCode ? '\nFAILED' : `\nall ${passed} blight rule checks passed`);
