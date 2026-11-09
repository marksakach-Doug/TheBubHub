/* Blight — a bluffing game of Living Plants and Dead Trees (module game for Bub Hub).
 *
 * Everyone starts with three Living Plants and one Dead Tree. Each round you plant a card face
 * down, may keep adding, then someone starts the bidding: how many Living Plants can you reveal?
 * The top bidder flips their own stack first, then other stacks, one card at a time. Reveal a
 * Dead Tree and you lose a card. Win two rounds, or be the last gardener standing.
 *
 * Authority: reduce() is the only thing that changes state and it runs on the host. Bots are
 * played inside reduce() too (there is no tick in the contract), so a table never stalls on a
 * timer and a bot's move is the same code path as a human's. project() is where the hidden
 * information lives: other players' hands and face-down stacks never leave the host.
 *
 * Screen: locked to the viewport (100dvh less whatever the hub puts above us) and cut into three
 * zones — opponents 28%, the table 44%, your hand + buttons 28% — so nothing scrolls on a phone.
 *
 * Layering rule for the UI (the "roots never cover text" guarantee): decorations sit at z-index
 * -1..4, every line of text sits at z-index 5, and no tile/panel is a stacking context, so nothing
 * a neighbour draws can land on top of a label. See the layering note above CSS.
 *
 * Drawing (trees, roots, borders) lives in trees.js; it is self-contained and deterministic.
 */

import { trees } from './trees.js';

export const meta = {
  id: 'blight',
  title: 'Blight',
  players: '3-6',
  color: '#5f7a3a',
  icon: '🌿',
  desc: 'Hide Living Plants and Dead Trees, then bid how many plants you can reveal. Win two rounds or outlast everyone. Bots fill empty seats.',
  soloable: true,
};

const MAXP = 6, MINP = 3, WINS = 2, LOGMAX = 16;
const hash = trees.hash;

/* ======================================================================================
 *  Small utilities (pure)
 * ==================================================================================== */
const clone = (o) => JSON.parse(JSON.stringify(o));
const isBotId = (id) => typeof id === 'string' && id.charAt(0) === '~';
const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
const pickOne = (a, rng) => a[Math.floor(rng() * a.length)];
const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+n) || 0));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ======================================================================================
 *  State
 *
 *  S = {
 *    v, epoch,               // epoch bumps every new game / back-to-lobby (the record's roundId)
 *    phase,                  // lobby | plant | grow | bid | challenge | lose | result | over
 *    hostId, names{}, lobby[], bots,            // table membership + host setting
 *    order[], p{ id: { name, bot, left?, alive, wins, hand[], stack[], rev[], tag } },
 *    round, starter, turn, placed[],
 *    bid{ cur, high, out[] } | null, max, challenger, need, count, fail,
 *    shown{ id: card[] },    // what was revealed this round, kept for the result screen
 *    flips[{ o, c }],        // every reveal this round in order: owner id + the card (public once flipped)
 *    ready[], winner, log[]
 *  }
 *  card = { id, k:'P'|'D', s }   id is "<owner>.<index>", assigned BEFORE the kinds are shuffled,
 *                                so an id never says what the card is.
 * ==================================================================================== */
export function init(ctx) {
  const at = ((ctx && ctx.atTable) || []).filter((m) => m && m.id && !m.spectator && !m.bot);
  const names = {}, lobby = [];
  at.forEach((m) => { if (lobby.indexOf(m.id) < 0) { lobby.push(m.id); names[m.id] = String(m.name || 'Player'); } });
  const host = at.find((m) => m.host);
  return {
    v: 1, epoch: 0, phase: 'lobby',
    hostId: host ? host.id : (lobby[0] || null),
    names, lobby, bots: 0,
    order: [], p: {}, round: 0, starter: null, turn: null, placed: [],
    bid: null, max: 0, challenger: null, need: 0, count: 0, fail: null,
    shown: {}, flips: [], ready: [], winner: null, log: [],
  };
}

/* ---------- helpers over state ---------- */
const say = (S, t) => { S.log.push(t); if (S.log.length > LOGMAX) S.log.splice(0, S.log.length - LOGMAX); };
const nm = (S, id) => (S.p[id] && S.p[id].name) || S.names[id] || 'Someone';
const live = (S) => S.order.filter((id) => S.p[id].alive);
const maxBid = (S) => S.order.reduce((s, id) => s + S.p[id].stack.length, 0);
function nextAlive(S, id) {
  const o = S.order, n = o.length; let i = o.indexOf(id);
  for (let k = 0; k < n; k++) { i = (i + 1) % n; if (S.p[o[i]].alive) return o[i]; }
  return id;
}
const ctrlId = (S) => (S.lobby.indexOf(S.hostId) >= 0 ? S.hostId : (S.lobby[0] || null));
const isCtrl = (S, from) => !!from.host || (!!from.id && from.id === ctrlId(S));
function botCount(S) {
  const h = Math.min(S.lobby.length, MAXP);
  return Math.max(0, Math.min(MAXP - h, Math.max(S.bots, MINP - h)));
}
/* Who must tap "Continue" before the next round: living humans, or every human once none live. */
function readyNeed(S) {
  const hum = S.order.filter((id) => !S.p[id].bot), al = hum.filter((id) => S.p[id].alive);
  return al.length ? al : hum;
}
const seatErr = (S, id) => {
  if (!S.p[id]) return 'You are watching — not seated.';
  if (!S.p[id].alive) return 'You are out of this game.';
  return null;
};

/* ======================================================================================
 *  Rules
 * ==================================================================================== */
function startGame(S, from, rng) {
  if (S.phase !== 'lobby' && S.phase !== 'over') return 'A game is already running.';
  if (!isCtrl(S, from)) return 'Only the host can start the game.';
  if (!S.lobby.length) return 'Nobody is seated.';
  const humans = S.lobby.slice(0, MAXP), nb = botCount(S);
  if (humans.length + nb < MINP) return 'Blight needs at least ' + MINP + ' players.';
  const ids = humans.slice();
  for (let i = 1; i <= nb; i++) ids.push('~bot' + i);
  shuffle(ids, rng);
  S.epoch++; S.order = ids; S.p = {}; S.round = 0; S.winner = null; S.log = []; S.shown = {}; S.flips = [];
  ids.forEach((id) => {
    const bot = isBotId(id), kinds = shuffle(['P', 'P', 'P', 'D'], rng);
    S.p[id] = {
      name: bot ? 'Bot ' + id.slice(4) : (S.names[id] || 'Player'), bot, alive: true, wins: 0, tag: '',
      hand: kinds.map((k, i) => ({ id: id + '.' + i, k, s: (rng() * 4294967296) >>> 0 })), stack: [], rev: [],
    };
  });
  S.starter = pickOne(ids, rng);
  say(S, 'The garden is planted: ' + ids.length + ' players, first to ' + WINS + ' rounds.');
  beginRound(S);
  return null;
}

function beginRound(S) {
  S.round++; S.phase = 'plant'; S.turn = S.starter; S.placed = [];
  S.bid = null; S.max = 0; S.challenger = null; S.need = 0; S.count = 0; S.fail = null; S.shown = {}; S.flips = []; S.ready = [];
  S.order.forEach((id) => { S.p[id].tag = ''; });
  say(S, 'Round ' + S.round + ' — ' + nm(S, S.starter) + ' starts.');
}

function putCard(S, id, k) {
  if (k !== 'P' && k !== 'D') return 'Choose a Living Plant or a Dead Tree.';
  const p = S.p[id], i = p.hand.findIndex((c) => c.k === k);
  if (i < 0) return 'You have no ' + (k === 'P' ? 'Living Plant' : 'Dead Tree') + ' in hand.';
  p.stack.push(p.hand.splice(i, 1)[0]);
  say(S, p.name + ' places a card face down.');
  return null;
}

function doPlace(S, id, k) {
  if (S.phase !== 'plant') return 'Everyone has already planted.';
  const e = seatErr(S, id); if (e) return e;
  if (S.turn !== id) return "It isn't your turn.";
  const m = putCard(S, id, k); if (m) return m;
  S.placed.push(id);
  if (live(S).every((x) => S.placed.indexOf(x) >= 0)) { S.phase = 'grow'; S.turn = S.starter; }
  else S.turn = nextAlive(S, id);
  return null;
}

function doAdd(S, id, k) {
  if (S.phase !== 'grow') return 'You can only add a card while the garden is growing.';
  const e = seatErr(S, id); if (e) return e;
  if (S.turn !== id) return "It isn't your turn.";
  if (!S.p[id].hand.length) return 'You have no cards in hand — you must bid.';
  const m = putCard(S, id, k); if (m) return m;
  S.turn = nextAlive(S, id);
  return null;
}

function doBid(S, id, n, rng) {
  if (S.phase !== 'grow') return 'You can only start bidding while the garden is growing.';
  const e = seatErr(S, id); if (e) return e;
  if (S.turn !== id) return "It isn't your turn.";
  const max = maxBid(S);
  if (!Number.isInteger(n) || n < 1 || n > max) return 'Bid between 1 and ' + max + '.';
  S.max = max; S.bid = { cur: n, high: id, out: [] }; S.phase = 'bid';
  S.order.forEach((x) => { S.p[x].tag = ''; });
  S.p[id].tag = 'Bid ' + n;
  say(S, S.p[id].name + ' starts the bidding at ' + n + '.');
  bidNext(S, rng);
  return null;
}

function doRaise(S, id, n, rng) {
  if (S.phase !== 'bid') return 'Nobody is bidding.';
  const e = seatErr(S, id); if (e) return e;
  if (S.turn !== id) return "It isn't your turn.";
  if (!Number.isInteger(n) || n <= S.bid.cur || n > S.max) return 'Raise to a number between ' + (S.bid.cur + 1) + ' and ' + S.max + ', or fold.';
  S.p[S.bid.high].tag = '';
  S.bid.cur = n; S.bid.high = id; S.p[id].tag = 'Bid ' + n;
  say(S, S.p[id].name + ' raises to ' + n + '.');
  bidNext(S, rng);
  return null;
}

function doFold(S, id, rng) {
  if (S.phase !== 'bid') return 'Nobody is bidding.';
  const e = seatErr(S, id); if (e) return e;
  if (S.turn !== id) return "It isn't your turn.";
  S.bid.out.push(id); S.p[id].tag = 'Folded';
  say(S, S.p[id].name + ' folded.');
  bidNext(S, rng);
  return null;
}

/* After every bid action: either the bidding is over, or it is the next live bidder's turn. */
function bidNext(S, rng) {
  const b = S.bid, still = live(S).filter((x) => b.out.indexOf(x) < 0);
  if (still.length === 1 || b.cur >= S.max) return startChallenge(S, rng);
  let i = S.turn;
  do { i = nextAlive(S, i); } while (b.out.indexOf(i) >= 0 || i === b.high);
  S.turn = i;
}

function startChallenge(S, rng) {
  S.phase = 'challenge'; S.challenger = S.bid.high; S.need = S.bid.cur; S.count = 0; S.fail = null;
  const C = S.p[S.challenger];
  S.order.forEach((x) => { S.p[x].tag = ''; });
  C.tag = 'Challenge ' + S.need;
  say(S, C.name + ' must reveal ' + S.need + '.');
  while (C.stack.length && S.count < S.need && S.fail == null) revealTop(S, S.challenger);
  challengeStep(S, rng);
}

function revealTop(S, oid) {
  const o = S.p[oid], C = S.p[S.challenger], card = o.stack.pop();
  o.rev.push(card); S.flips.push({ o: oid, c: card });
  if (card.k === 'D') { S.fail = oid; say(S, o.name + '’s stack: ✖ Dead Tree!'); return; }
  S.count++; C.tag = 'Revealed ' + S.count + '/' + S.need;
  say(S, o.name + '’s stack: ✿ Living Plant. ' + S.count + '/' + S.need + '.');
}

function challengeStep(S, rng) {
  if (S.fail != null || S.count >= S.need) return resolve(S, rng);
  const cand = live(S).filter((x) => x !== S.challenger && S.p[x].stack.length);
  if (!cand.length) return resolve(S, rng);           // nothing left to flip: treated as a success, as in the playtest
  S.phase = 'challenge'; S.turn = S.challenger;
}

function doFlip(S, id, t, rng) {
  if (S.phase !== 'challenge') return 'Nobody is being challenged.';
  if (id !== S.challenger) return 'Only the challenger flips cards.';
  const o = S.p[t];
  if (!o || !o.alive || t === id) return 'Pick another player’s stack.';
  if (!o.stack.length) return 'That stack is empty.';
  revealTop(S, t);
  challengeStep(S, rng);
  return null;
}

function resolve(S, rng) {
  S.turn = null;
  const cid = S.challenger, C = S.p[cid];
  S.shown = {};
  S.order.forEach((id) => { if (S.p[id].rev.length) S.shown[id] = clone(S.p[id].rev); });
  if (S.fail == null) {
    C.wins++; C.tag = 'Won round';
    say(S, C.name + ' wins the round! (' + C.wins + '/' + WINS + ')');
    return finishRound(S);
  }
  C.tag = 'Failed';
  if (S.fail === cid) {
    const pool = C.hand.concat(C.stack, C.rev), np = pool.filter((c) => c.k === 'P').length, nd = pool.length - np;
    if (np && nd && !C.bot) { S.phase = 'lose'; S.turn = cid; return; }   // a human chooses
    applyLoss(S, rng, np && nd ? (rng() < 0.5 ? 'P' : 'D') : (np ? 'P' : 'D'));
  } else applyLoss(S, rng, null);
  finishRound(S);
}

/* Remove one card from the challenger's whole pool (hand + stack + revealed). kind=null → at random, unseen. */
function applyLoss(S, rng, kind) {
  const C = S.p[S.challenger], pool = C.hand.concat(C.stack, C.rev);
  if (kind) {
    pool.splice(pool.findIndex((c) => c.k === kind), 1);
    say(S, C.name + ' hit their own Dead Tree and loses a ' + (kind === 'P' ? 'Living Plant' : 'Dead Tree') + '.');
  } else {
    pool.splice(Math.floor(rng() * pool.length), 1);
    say(S, C.name + ' fails. ' + nm(S, S.fail) + ' draws one of ' + C.name + '’s cards at random and removes it unseen.');
  }
  C.hand = pool; C.stack = []; C.rev = [];
}

function doLose(S, id, k, rng) {
  if (S.phase !== 'lose') return 'There is nothing to lose right now.';
  if (id !== S.challenger) return 'That choice is not yours.';
  const C = S.p[id], pool = C.hand.concat(C.stack, C.rev);
  if (k !== 'P' && k !== 'D') return 'Choose a Living Plant or a Dead Tree.';
  if (!pool.some((c) => c.k === k)) return 'You have none of those left.';
  applyLoss(S, rng, k);
  finishRound(S);
  return null;
}

function finishRound(S) {
  const cid = S.challenger;
  S.order.forEach((id) => {
    const p = S.p[id];
    p.hand = p.hand.concat(p.stack, p.rev); p.stack = []; p.rev = [];
    if (!p.hand.length && p.alive) { p.alive = false; p.tag = 'Eliminated'; say(S, p.name + ' has no cards and is eliminated.'); }
  });
  const al = live(S);
  const w = S.order.find((id) => S.p[id].wins >= WINS) || (al.length === 1 ? al[0] : null);
  S.starter = S.p[cid].alive ? cid : (S.fail != null && S.fail !== cid ? S.fail : nextAlive(S, cid));
  S.turn = null; S.ready = [];
  if (w) { S.winner = w; S.phase = 'over'; say(S, S.p[w].name + ' wins the game after ' + S.round + ' round' + (S.round === 1 ? '' : 's') + '!'); }
  else S.phase = 'result';
}

/* ---------- bots (ported from the playtest; they only look at counts and their own stack) ---------- */
function botBid(S, id, cur, max, rng) {
  const me = S.p[id];
  if (me.stack.some((c) => c.k === 'D')) return cur ? 0 : 1;
  const own = me.stack.length; let oth = 0;
  S.order.forEach((o) => { if (o !== id && S.p[o].alive) oth += S.p[o].stack.length * 0.5; });
  if (!cur) return Math.max(1, Math.min(max, Math.round(own + oth * 0.3)));
  return cur + 1 <= max && cur + 1 <= own + oth + rng() * 0.8 - 0.2 ? cur + 1 : 0;
}
function botKind(p, rng) {
  const hasD = p.hand.some((c) => c.k === 'D'), hasP = p.hand.some((c) => c.k === 'P');
  return hasD && (!hasP || rng() < (p.stack.length ? 0.2 : 0.3)) ? 'D' : 'P';
}
/* One decision for whoever's turn it is. Returns an error string (never expected) or null. */
function botMove(S, id, rng) {
  const p = S.p[id];
  switch (S.phase) {
    case 'plant': return doPlace(S, id, botKind(p, rng));
    case 'grow': {
      if (!p.hand.length) return doBid(S, id, botBid(S, id, 0, maxBid(S), rng), rng);
      let add = true;
      if (!p.stack.some((c) => c.k === 'D')) {
        const down = S.order.reduce((s, x) => s + S.p[x].stack.length, 0);
        add = !(rng() < Math.min(0.9, 0.2 + 0.08 * (down - live(S).length)));
      }
      return add ? doAdd(S, id, botKind(p, rng)) : doBid(S, id, botBid(S, id, 0, maxBid(S), rng), rng);
    }
    case 'bid': { const b = botBid(S, id, S.bid.cur, S.max, rng); return b ? doRaise(S, id, b, rng) : doFold(S, id, rng); }
    case 'challenge': {
      const cand = live(S).filter((x) => x !== id && S.p[x].stack.length);
      return doFlip(S, id, pickOne(cand, rng), rng);
    }
    case 'lose': {
      const pool = p.hand.concat(p.stack, p.rev), np = pool.filter((c) => c.k === 'P').length, nd = pool.length - np;
      return doLose(S, id, np && nd ? (rng() < 0.5 ? 'P' : 'D') : (np ? 'P' : 'D'), rng);
    }
  }
  return 'No move.';
}

/* Play every bot whose turn it is, until a human has to decide. Frozen when no human is left. */
function runBots(S, rng) {
  for (let g = 0; g < 800; g++) {
    if (!S.order.length || S.order.every((id) => S.p[id].bot)) return;
    const id = S.turn;
    if (!id || !S.p[id] || !S.p[id].bot) return;
    if (botMove(S, id, rng)) return;
  }
}

function settle(S, rng) {
  if (S.phase === 'result' && S.order.some((id) => !S.p[id].bot)) {
    const need = readyNeed(S);
    if (need.length && need.every((x) => S.ready.indexOf(x) >= 0)) beginRound(S);
  }
  runBots(S, rng);
}

/* ======================================================================================
 *  reduce / prune / project / summarize
 * ==================================================================================== */
export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const id = from.id || '';
  const rng = (ctx && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
  if (!action || typeof action.a !== 'string') return { error: 'Unknown action.' };
  const S = clone(state);
  if (id && from.name) {
    S.names[id] = String(from.name).slice(0, 40);
    if (S.p[id] && !S.p[id].bot) S.p[id].name = S.names[id];
  }
  if (id && from.host) S.hostId = id;
  let e = null;
  switch (action.a) {
    case 'join':
      if (!id) e = 'No identity.';
      else if (S.lobby.indexOf(id) < 0) S.lobby.push(id);
      break;
    case 'bots':
      if (S.phase !== 'lobby') e = 'Bots can only be changed in the lobby.';
      else if (!isCtrl(S, from)) e = 'Only the host can change the bots.';
      else S.bots = clampInt(action.n, 0, MAXP - 1);
      break;
    case 'start': e = startGame(S, from, rng); break;
    case 'toLobby':
      if (S.phase === 'lobby') e = 'Already in the lobby.';
      else if (!isCtrl(S, from)) e = 'Only the host can go back to the lobby.';
      else {
        S.epoch++; S.phase = 'lobby'; S.order = []; S.p = {}; S.round = 0; S.starter = null; S.turn = null; S.placed = [];
        S.bid = null; S.max = 0; S.challenger = null; S.need = 0; S.count = 0; S.fail = null; S.shown = {}; S.flips = []; S.ready = []; S.winner = null; S.log = [];
      }
      break;
    case 'place': e = doPlace(S, id, action.k); break;
    case 'add': e = doAdd(S, id, action.k); break;
    case 'bid': e = doBid(S, id, action.n, rng); break;
    case 'raise': e = doRaise(S, id, action.n, rng); break;
    case 'fold': e = doFold(S, id, rng); break;
    case 'flip': e = doFlip(S, id, action.t, rng); break;
    case 'lose': e = doLose(S, id, action.k, rng); break;
    case 'ready':
      if (S.phase !== 'result') e = 'No round has just ended.';
      else if (!S.p[id] || S.p[id].bot) e = 'You are watching — not seated.';
      else if (S.ready.indexOf(id) < 0) S.ready.push(id);
      break;
    case 'next':
      if (S.phase !== 'result') e = 'No round has just ended.';
      else if (!isCtrl(S, from)) e = 'Only the host can move things along.';
      else beginRound(S);
      break;
    case 'skip':     // host: let a bot make the move for someone who has gone quiet
      if (!isCtrl(S, from)) e = 'Only the host can do that.';
      else if (['plant', 'grow', 'bid', 'challenge', 'lose'].indexOf(S.phase) < 0 || !S.turn || !S.p[S.turn]) e = 'Nobody is being waited on.';
      else if (S.turn === id) e = 'That is your own move.';
      else e = botMove(S, S.turn, rng);
      break;
    default: e = 'Unknown action.';
  }
  if (e) return { error: e };
  settle(S, rng);
  return S;
}

/* A player left, timed out, was kicked or moved tables: their seat becomes a bot so no round ever
 * waits for someone who is gone. Same object back when there was nothing to remove. */
export function prune(state, goneId) {
  const p = state.p && state.p[goneId];
  const inLobby = state.lobby.indexOf(goneId) >= 0, inGame = !!p && !p.bot;
  if (!inLobby && !inGame && (state.ready || []).indexOf(goneId) < 0) return state;
  const S = clone(state);
  S.lobby = S.lobby.filter((x) => x !== goneId);
  S.ready = S.ready.filter((x) => x !== goneId);
  if (inGame) {
    const q = S.p[goneId]; q.bot = true; q.left = true;
    say(S, q.name + ' left — a bot takes their seat.');
  }
  settle(S, Math.random);
  return S;
}

/* What ONE player is allowed to see. Other players' hands and face-down stacks are reduced to
 * counts, and the placeholder ids/seeds for hidden cards are derived from (owner, epoch, round,
 * position) — never from the real card — so a card revealed in one round cannot be recognised
 * face-down in the next. */
export function project(state, pid) {
  const S = state, me = S.p[pid] || null;
  const over = S.phase === 'result' || S.phase === 'over';
  const players = S.order.map((id) => {
    const p = S.p[id], mine = id === pid;
    return {
      id, name: p.bot ? p.name : (S.names[id] || p.name), bot: !!p.bot, left: !!p.left,
      alive: p.alive, wins: p.wins, tag: p.tag, handN: p.hand.length,
      folded: !!(S.bid && S.bid.out.indexOf(id) >= 0),     // sat out the bidding: dimmed until the next round
      stack: mine ? clone(p.stack) : p.stack.map((c, i) => ({
        h: 1, id: 'h' + hash(id + '|' + S.epoch + '|' + S.round + '|' + i), s: hash('s' + id + '|' + S.epoch + '|' + S.round + '|' + i),
      })),
      rev: clone(over ? (S.shown[id] || []) : p.rev),
    };
  });
  let loseOpts = null;
  if (S.phase === 'lose' && me && S.turn === pid) {
    const pool = me.hand.concat(me.stack, me.rev);
    loseOpts = ['P', 'D'].filter((k) => pool.some((c) => c.k === k));
  }
  const need = S.phase === 'result' ? readyNeed(S) : [];
  const nb = botCount(S);
  return {
    v: 1, epoch: S.epoch, phase: S.phase, you: pid,
    seated: !!me, joined: S.lobby.indexOf(pid) >= 0, ctrl: pid === ctrlId(S),
    round: S.round, turn: S.turn, starter: S.starter, challenger: S.challenger, need: S.need, count: S.count,
    max: S.max, bid: S.bid ? { cur: S.bid.cur, high: S.bid.high, out: S.bid.out.slice() } : null,
    winner: S.winner, players, hand: me ? clone(me.hand) : [], loseOpts, flips: clone(S.flips),
    flipOpts: S.phase === 'challenge' && me && S.turn === pid ? live(S).filter((x) => x !== pid && S.p[x].stack.length) : [],
    ready: S.ready.slice(), readyNeed: need,
    lobby: S.lobby.map((id) => ({ id, name: S.names[id] || 'Player' })),
    bots: S.bots, botN: nb, humansIn: Math.min(S.lobby.length, MAXP), maxP: MAXP, minP: MINP,
    canStart: S.lobby.length > 0 && Math.min(S.lobby.length, MAXP) + nb >= MINP,
    log: S.log.slice(),
  };
}

export function roundId(state) { return 'b' + state.epoch; }

export function summarize(state, nameOf) {
  if (state.phase !== 'over' || !state.winner || !state.p[state.winner]) return null;
  const who = (id) => (nameOf && nameOf(id)) || state.names[id] || (state.p[id] && state.p[id].name) || 'Someone';
  const w = state.p[state.winner], others = state.order.filter((id) => id !== state.winner);
  const humans = others.filter((id) => !state.p[id].bot || state.p[id].left).map(who);
  const nb = others.filter((id) => state.p[id].bot && !state.p[id].left).length;
  const against = humans.concat(nb ? [nb + ' bot' + (nb > 1 ? 's' : '')] : []);
  const head = (w.bot && !w.left ? 'A bot' : who(state.winner)) + ' won Blight in ' + state.round + ' round' + (state.round === 1 ? '' : 's');
  if (!against.length) return head;
  return head + ' against ' + (against.length > 1 ? against.slice(0, -1).join(', ') + ' and ' + against[against.length - 1] : against[0]);
}

/* ======================================================================================
 *  Drawing glue. The generators live in trees.js (self-contained, tested on their own);
 *  this file only turns their output into markup.
 * ==================================================================================== */
const LEAF = 'M0 0C3.8-2.6 4-7.8 0-13.5C-4-7.8-3.8-2.6 0 0ZM0-1.8L.45-5.5L0-10.5L-.45-5.5Z';
const PET = (() => { let s = ''; for (let i = 0; i < 5; i++) { const a = i * 1.2566, cx = Math.cos(a) * 2.9, cy = Math.sin(a) * 2.9; s += `M${Math.round((cx - 2.45) * 10) / 10} ${Math.round(cy * 10) / 10}a2.45 2.45 0 1 0 4.9 0a2.45 2.45 0 1 0-4.9 0`; } return s; })();
const STEMS = ['#2d6a2e', '#387d35', '#46923c', '#58a644', '#6cb84d'];
const BC = new Map();                                                 // border cache: key -> svg text
const TAB = { P: '#3f7d34', D: '#2a2623' };                           // plant / dead-tree colour code for your private pips and edge tabs

function artHTML(c, st, now) {
  if (!st.art) st.art = trees.art(c);
  if (st.t0 == null) st.t0 = now;
  const el = (now - st.t0) / 1000, A = st.art, an = el < A.total, dl = (d) => (d - el).toFixed(2) + 's', tf = A.tf;
  let s = `<svg class="art${c.k === 'D' ? ' dd' : ''}" viewBox="0 0 100 140" preserveAspectRatio="xMidYMax meet"><g transform="translate(${tf.x} ${tf.y}) scale(${tf.s})">`;
  for (const b of A.br) s += `<path d="${b.d}"${an ? ` class="gr" style="transform-origin:${b.ox}px ${b.oy}px;animation-delay:${dl(b.dl)}"` : ''}/>`;
  for (const l of A.lv) s += `<g transform="translate(${l.x} ${l.y}) rotate(${l.a}) scale(${l.s})"><path d="${LEAF}" style="fill:${l.c}${an ? `;animation:gr .6s cubic-bezier(.2,.9,.3,1.15) ${dl(l.dl)} both;transform-origin:0 0` : ''}"/></g>`;
  for (const f of A.fl) s += `<g transform="translate(${f.x} ${f.y}) rotate(${f.a}) scale(${f.s})"><g${an ? ` class="gr" style="animation-delay:${dl(f.dl)}"` : ''}><path d="${PET}" style="fill:${f.c}"/><circle r="1.5" style="fill:${f.c2}"/></g></g>`;
  return s + '</g></svg>';
}
function backHTML(c, st, now) {
  if (!st.rt) st.rt = trees.roots(c);
  if (st.tb == null) st.tb = now;
  const el = (now - st.tb) / 1000, an = el < 1.4;
  return `<svg class="art rt" viewBox="0 0 100 140" preserveAspectRatio="xMidYMax meet">` + st.rt.map((b) => `<path d="${b.d}"${an ? ` class="gr" style="transform-origin:${b.ox}px ${b.oy}px;animation-delay:${(b.dl - el).toFixed(2)}s"` : ''}/>`).join('') + '</svg>';
}

/* ======================================================================================
 *  Styles
 *
 *  The screen is locked to the viewport and cut into three strict vertical zones:
 *      top    28%   opponents, one compact row — their stacks, ×count badges, wins, folds
 *      centre 44%   the table: round/phase, current bid, the reveal strip, YOUR played stack
 *      bottom 28%   YOUR hand, the one-line instruction, and the buttons
 *  Height is 100dvh minus whatever sits above the game in the hub (measured, --chrome), so there
 *  is nothing left over to scroll. Every size below derives from --H, never from a fixed pixel.
 *
 *  Ink: the only near-black things on the board are the 2-3px card borders and the Dead Tree art.
 *  Frames, the table ring and the background roots are a muted warm parchment brown, so a Dead Tree
 *  turning up is a visual shock instead of one more dark scribble.
 *
 *  Layering (inside .bl, an isolated stacking context) — the "roots never cover text" guarantee:
 *     -1  #bgr  the faded background roots, under everything including panels
 *      1  #felt .bd   the table's ring
 *      2  panels (.opp::before, .lob::before)
 *      3  .bd outlines/twigs, .stk / .cards (the cards themselves)
 *      4  buttons (above every panel, or they would be visible but unclickable)
 *      5  .tx   TEXT. Always last. Nothing decorative may use z-index >= 5.
 *      6  .stk.spread   only while you hold your own stack: your cards fan over everything on purpose
 *  Tiles carry no transform / opacity / filter / z-index, so they are not stacking contexts and one
 *  tile's outline can never be painted over another tile's text. That is also why a folded tile is
 *  dimmed with colours (panel, text) and by fading its card layer, never with opacity on the tile.
 * ==================================================================================== */
const DARK = '--bg:#1a140e;--pa:#2a2118;--dim:#17120c;--hov:#38291b;--fg:#efe6d3;--mut:#b5a58c;--root:#7d6a4b;--chipbg:#6b5a40;--rtl:#2b2116;--cface:#efe6d0;--back:#5a4730;--rb:#7d6746;--stem:#6fbf5a;--dead:#131211;--dcard:#d9d3c6;--moss:#8fb35a;color-scheme:dark';
const CSS = `
.bl{--bg:#efe6d3;--pa:#f7f1e3;--dim:#ddd0b6;--hov:#e9dcc0;--fg:#3b2a1d;--mut:#6b5845;--root:#c8b690;--chipbg:#8a7352;--rtl:#e6d8bb;--cface:#f4ecd8;--back:#dac9a5;--rb:#bba37a;--stem:#3f8f3a;--dead:#171615;--dcard:#e8e4da;--moss:#5f7a3a;color-scheme:light;
  --chrome:0px;--H:max(320px,calc(100dvh - var(--chrome)));
  --oh:clamp(32px,calc(var(--H) * .088),76px);--mh:clamp(48px,calc(var(--H) * .138),112px);--hh:clamp(58px,calc(var(--H) * .165),128px);
  --step:7px;--dx:2px;--fs:clamp(11px,calc(var(--H) * .02),14px);
  position:relative;isolation:isolate;overflow:hidden;overflow:clip;box-sizing:border-box;width:100%;max-width:1000px;height:var(--H);margin:0 auto;
  display:grid;grid-template-rows:minmax(0,28fr) minmax(0,44fr) minmax(0,28fr);
  background:var(--bg);color:var(--fg);font:var(--fs)/1.3 Georgia,'Times New Roman',serif;-webkit-text-size-adjust:100%}
@media (prefers-color-scheme:dark){.bl:not([data-theme="light"]){${DARK}}}
.bl[data-theme="dark"]{${DARK}}
.bl button{font:inherit;font-size:clamp(12px,calc(var(--H) * .021),15px);color:var(--fg);background:var(--pa);border:none;border-radius:0;padding:6px 12px;cursor:pointer;position:relative;z-index:4;min-height:40px;white-space:nowrap;flex:0 1 auto;min-width:0;box-shadow:0 1px 2px rgba(80,55,30,.28)}
.bl button:hover:not(:disabled){background:var(--hov)}.bl button:active:not(:disabled){transform:scale(.94)}.bl button:disabled{opacity:.45;cursor:default}
.bl button.stp{min-width:38px;padding:6px 0;font-weight:700}
.bl button.go{font-weight:700}
.bd{position:absolute;left:-14px;top:-14px;pointer-events:none;overflow:visible;z-index:3;transition:transform .25s}
.bd path{fill:var(--root)}
.bl button:hover>.bd{transform:scale(1.05)}
.tx{position:relative;z-index:5}
.mut{color:var(--mut)}
.bl section{position:relative;min-width:0;min-height:0;padding:4px 8px}
#bgr{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:-1}
#bgr path{fill:var(--rtl)}

/* ----- cards: crisp black border, a little lift ----- */
.c{position:relative;z-index:0;isolation:isolate;box-sizing:border-box;width:var(--w);height:var(--h);display:inline-block;flex:none;cursor:pointer;overflow:hidden;
  background:var(--cface);color:var(--fg);border:var(--bw,2px) solid #111;box-shadow:0 2px 3px rgba(0,0,0,.35)}
.bl[data-theme="dark"] .c{box-shadow:0 0 0 1px rgba(255,255,255,.34),0 2px 4px rgba(0,0,0,.6)}
@media (prefers-color-scheme:dark){.bl:not([data-theme="light"]) .c{box-shadow:0 0 0 1px rgba(255,255,255,.34),0 2px 4px rgba(0,0,0,.6)}}
.c.b{background:var(--back)}.c.D{background:var(--dcard)}
.c.act{outline:2px solid var(--moss);outline-offset:2px}
.art{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.art path{fill:var(--stem)}.art.dd path{fill:var(--dead)}.art.rt path{fill:var(--rb)}
.c.P .art{animation:sway 6s ease-in-out infinite;animation-delay:var(--sw,0s);transform-origin:50% 100%}
.c .tab{position:absolute;left:0;right:0;bottom:0;height:var(--step);background:var(--tabc)}
.gr{animation:gr .65s cubic-bezier(.16,.84,.32,1) both;transform-origin:0 0}
.grf{animation:grf .6s cubic-bezier(.22,1.35,.36,1) both;transform-origin:0 0}
@keyframes gr{
  0%{transform:scale(0) rotate(-12deg);opacity:0}
  35%{opacity:1}
  70%{transform:scale(1.03) rotate(2deg)}
  100%{transform:scale(1) rotate(0deg);opacity:1}
}
@keyframes grl{
  0%{transform:scale(0,0) rotate(-28deg);opacity:0}
  65%{transform:scale(.9,1.12) rotate(5deg);opacity:1}
  100%{transform:scale(1,1) rotate(0deg);opacity:1}
}
@keyframes grf{
  0%{transform:scale(0) rotate(-65deg);opacity:0}
  70%{transform:scale(1.18) rotate(8deg);opacity:1}
  100%{transform:scale(1) rotate(0deg);opacity:1}
}
@keyframes sprout{0%{transform:translateY(14px) scale(.55);opacity:0}60%{transform:translateY(-3px) scale(1.06);opacity:1}100%{transform:none}}
@keyframes jolt{0%{transform:scale(.6) rotate(-6deg);opacity:0}25%{transform:scale(1.14) rotate(4deg);opacity:1}45%{transform:translateX(-4px) rotate(-3deg)}65%{transform:translateX(4px) rotate(2deg)}85%{transform:translateX(-2px)}100%{transform:none}}
@keyframes sway{0%,100%{transform:rotate(-1.4deg)}50%{transform:rotate(1.4deg)}}
@keyframes topglow{0%,100%{box-shadow:0 2px 3px rgba(0,0,0,.35),0 0 0 2px var(--moss),0 0 3px 1px rgba(95,122,58,0)}50%{box-shadow:0 2px 3px rgba(0,0,0,.35),0 0 0 3px var(--moss),0 0 10px 4px rgba(95,122,58,.8)}}
.c.top{animation:topglow 1.05s ease-in-out infinite}
@keyframes bud{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@keyframes bdin{from{opacity:0;transform:scale(.9)}to{opacity:1}}
#acts button{animation:bud .4s cubic-bezier(.2,.9,.3,1.3) backwards}#acts .bd{animation:bdin .7s ease-out .15s backwards}

/* ----- a stack: later cards sit higher and a hair to the right, so every card's edge shows ----- */
.stkw{position:relative;display:inline-block;margin-top:9px}
.stk{position:relative;z-index:3;--fan:calc(var(--h) * .6);
  width:calc(var(--w) + (var(--n) - 1) * var(--dx));height:calc(var(--h) + (var(--n) - 1) * var(--step))}
.stk .c{position:absolute;display:block;left:calc(var(--i) * var(--dx));bottom:calc(var(--i) * var(--step))}
.stk.empty::after{content:'';position:absolute;left:0;bottom:0;width:var(--w);height:var(--h);border:2px dashed var(--root);box-sizing:border-box;opacity:.8}
.stkw .badge{position:absolute;right:-7px;top:-7px;background:#111;color:#fff;border-radius:9px;padding:0 5px;font-size:.84em;font-weight:700;line-height:1.4;box-shadow:0 1px 2px rgba(0,0,0,.4)}
/* the TOP / FLIP ribbon lies along the lower edge of the uppermost card, clear of the badge */
.stkw .toplbl{position:absolute;left:calc((var(--n) - 1) * var(--dx));bottom:calc((var(--n) - 1) * var(--step));width:var(--w);box-sizing:border-box;text-align:center;background:var(--moss);color:#fff;border-radius:0;padding:1px 0;font-size:clamp(7px,calc(var(--w) * .27),11px);font-weight:700;letter-spacing:.05em;line-height:1.2;border-top:1px solid #111;margin:0 var(--bw,2px) var(--bw,2px)}
.stkw .pips{position:absolute;left:calc(100% + 7px);bottom:0;display:flex;flex-direction:column-reverse;gap:1px}
.stkw .pips.sp{gap:calc(var(--h) * .6 - 13px)}
.pip{background:#3f7d34;color:#fff;border-radius:7px;padding:0 5px;font-size:.78em;line-height:1.5;white-space:nowrap;opacity:.92}.pip.D{background:#2a2623}
.stk.spread{z-index:6}
.stk.spread .c{bottom:calc(var(--i) * var(--fan));z-index:calc(var(--n) - var(--i));transition:bottom .16s ease-out}
.stk.spread .tab{display:none}
.stk[data-hold]{cursor:grab;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}

/* ----- top zone: opponents ----- */
#top{display:grid;grid-template-columns:repeat(var(--oc,3),minmax(0,1fr));gap:6px;align-content:center;align-items:stretch}
.opp{--h:var(--oh);--w:calc(var(--oh) * .71);position:relative;display:flex;flex-direction:column;align-items:center;min-width:0;padding:3px 3px 2px;text-align:center;line-height:1.2}
.opp::before,.lob::before{content:'';position:absolute;inset:0;background:var(--pa);z-index:2;box-shadow:0 1px 2px rgba(80,55,30,.25)}
.opp.cur::before{box-shadow:0 0 0 3px var(--bg),0 0 0 5px var(--moss)}
.opp.folded::before,.opp.dead::before{background:var(--dim)}
.opp.folded .tx,.mine.folded .tx,.opp.dead .tx{color:var(--mut)}
/* folded = faded, but never while stacks are being flipped: the highlight must stay readable */
.opp.folded:not(.rv) .stk,.mine.folded:not(.rv) .stk{opacity:.42}
.opp.flip{cursor:pointer}
.opp.flip::before{box-shadow:0 0 0 2px var(--moss),0 0 0 5px var(--bg),0 0 0 7px var(--moss);animation:pulse 1.1s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 2px var(--moss),0 0 0 4px var(--bg),0 0 0 5px var(--moss)}}
.opp .nm{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.opp .st{min-height:1.5em}
.chip{display:inline-block;background:var(--chipbg);color:#fff;border-radius:9px;padding:0 6px;font-size:.84em;line-height:1.45;white-space:nowrap}
.chip.f{background:var(--mut)}
.opp .ct{font-size:.86em;color:var(--mut);margin-top:auto}

/* ----- centre zone: the table ----- */
#mid{display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:2px}
#felt{position:absolute;inset:2% 3%;pointer-events:none}
#felt .bd{z-index:1}
#hero{text-align:center;width:min(92%,540px);margin-top:4px}
#hero .kick{font-size:clamp(13px,calc(var(--H) * .022),16px);color:var(--mut);letter-spacing:.03em;font-weight:600}
#hero .big{font-weight:700;font-size:clamp(18px,calc(var(--H) * .036),28px);line-height:1.15;margin:2px 0}
#flips{--h:var(--mh);--w:calc(var(--mh) * .71);--bw:3px;display:flex;justify-content:center;align-items:flex-end;gap:5px;max-width:96%;min-height:0}
#flips:empty{display:none}
.fp{display:flex;flex-direction:column;align-items:center;min-width:0}
.fp .own{font-size:.76em;color:var(--mut);max-width:calc(var(--w) + 14px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2}
.fp .no{font-size:.76em;font-weight:700;line-height:1.2}
.fp .c.D{border-color:#111;box-shadow:0 0 0 3px #c0392b,0 4px 10px rgba(192,57,43,.55)}
.mine{--h:var(--mh);--w:calc(var(--mh) * .71);--bw:3px;position:relative;display:flex;flex-direction:column;align-items:center;margin-bottom:2px}
.mine .lbl{font-size:.84em;color:var(--mut)}

/* ----- bottom zone: your hand + what to do ----- */
#bot{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;padding-bottom:6px}
#hand{--h:var(--hh);--w:calc(var(--hh) * .71);--bw:3px}
#hand .cards{position:relative;z-index:3;display:flex;justify-content:center;align-items:center;min-height:var(--hh)}
#hand .cards .c+.c{margin-left:8px}
#hand .c:hover{transform:translateY(-3px);transition:transform .2s}
#prompt{font-weight:600;text-align:center;font-size:clamp(12px,calc(var(--H) * .0215),15px);line-height:1.22;min-height:1.25em;max-width:96%}
#prompt.err{text-decoration:underline wavy var(--moss) 1px;text-underline-offset:3px}
#acts{display:flex;gap:6px;justify-content:center;align-items:center;min-height:40px;max-width:100%}
#acts .num{min-width:2ch;text-align:center;font-weight:700;font-size:1.25em}

/* ----- lobby ----- */
#lobby{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.lob{pointer-events:auto;position:relative;flex:none;width:min(94%,430px);padding:14px 18px;text-align:center}
.lob p{margin:6px 0}.lob .who{margin:7px 0}
.lob .big{font-weight:700;font-size:clamp(16px,calc(var(--H) * .03),22px)}
.lob .row{display:flex;gap:12px;justify-content:center;margin-top:10px}
.lob .step{display:inline-flex;align-items:center;gap:10px}
.lob .step button{min-width:40px;padding:4px 12px}

/* while a move is in flight: no second tap */
.bl.busy #acts{pointer-events:none;opacity:.6}.bl.busy .opp.flip,.bl.busy .c.act{pointer-events:none}
@media (prefers-reduced-motion:reduce){.c.P .art,.c,#acts button,#acts .bd,.opp.flip::before,.c.top{animation:none!important}}
/* short screens (a phone on its side): the hand moves beside the prompt and buttons instead of above them */
@media (max-height:480px){
  #hero .tick,#hero .sub{display:none}.lob p{display:none}.bl{--step:6px;--hh:clamp(40px,calc(var(--H) * .22),64px)}
  #bot{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:'hand prompt' 'hand acts';align-content:center;align-items:center;column-gap:14px;row-gap:2px;padding:2px 10px}
  #hand{grid-area:hand}#prompt{grid-area:prompt}#acts{grid-area:acts}
}
@media (max-height:620px){.lob p{display:none}}
@media (min-width:700px){#top{gap:10px}.opp{padding:5px 6px 3px}}
.bl[data-phase="bid"] #felt .bd path{fill:#b8862d;transition:fill .3s}
.bl[data-phase="bid"] #hero .big{color:var(--moss);transform:scale(1.06);transition:transform .2s}
.bl[data-phase="bid"] .chip:not(.f){background:#b8862d;box-shadow:0 0 8px rgba(184,134,45,.45)}

#vic{position:fixed;inset:0;width:100vw;height:100dvh;z-index:9999;pointer-events:none;display:flex; flex-direction:column;align-items:center;justify-content:center;background:rgba(26,20,14,.38);backdrop-filter:blur(2px)}
#vic:empty{display:none}
#vic .vic-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
#vic .stem-p{fill:var(--stem)}
#vic .vic-ban{pointer-events:auto;position:relative;z-index:5;background:var(--pa);padding:18px 28px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.45);animation:bud .5s cubic-bezier(.2,.9,.3,1.2) both}
#vic .vic-ban .big{font-size:clamp(22px,calc(var(--H) * .042),34px);font-weight:700;margin-bottom:10px}
#vic .vic-ban .row{display:flex;gap:10px;justify-content:center;margin-top:12px}
`;
/* ======================================================================================
 *  mount
 *
 *  DOM-only render: nothing here touches innerHTML or insertAdjacentHTML, so the
 *  whole gate (and the fake DOM it runs under) can build and repaint the screen.
 * ==================================================================================== */
export function mount(root, api) {
  const doc = root.ownerDocument || document;
  const win = typeof window !== 'undefined' ? window : globalThis;
  const $el = (tag) => doc.createElement(tag);
  const SVG_NS = 'http:' + '//www.w3.org/2000/svg';
  const $svg = (tag) => doc.createElementNS(SVG_NS, tag);
  const $ = (s) => root.querySelector(s);

  const style = $el('style'); style.textContent = CSS; root.appendChild(style);

  const bl = $el('div'); bl.id = 'bl'; bl.className = 'bl';
  const top = $el('section'); top.id = 'top';
  const mid = $el('section'); mid.id = 'mid';
  const felt = $el('div'); felt.id = 'felt'; felt.dataset.bd = 'felt'; felt.dataset.sh = 'e'; felt.dataset.tw = '0.3';
  const hero = $el('div'); hero.id = 'hero';
  const flips = $el('div'); flips.id = 'flips';
  const mine = $el('div'); mine.id = 'mine';
  const bot = $el('section'); bot.id = 'bot';
  const handCont = $el('div'); handCont.id = 'hand';
  const prompt = $el('div'); prompt.id = 'prompt'; prompt.className = 'tx'; prompt.setAttribute('role', 'status');
  const acts = $el('div'); acts.id = 'acts';
  const lobby = $el('div'); lobby.id = 'lobby';
  const vic = $el('div'); vic.id = 'vic';

  mid.appendChild(felt); mid.appendChild(hero); mid.appendChild(flips); mid.appendChild(mine);
  bot.appendChild(handCont); bot.appendChild(prompt); bot.appendChild(acts);
  bl.appendChild(top); bl.appendChild(mid); bl.appendChild(bot); bl.appendChild(lobby);
  bl.appendChild(vic);
  root.appendChild(bl);

  let view = null, joinTries = 0, BGK = '', toastTok = 0, busyTok = 0, holdTok = 0, toastMsg = '', destroyed = false, heldAt = 0;
  let vicKey = '';
  const ui = { mode: null, key: '', n: null, lo: 1, hi: 1, spread: false };
  const CST = new Map();
  const cst = (key) => { let s = CST.get(key); if (!s) { if (CST.size > 700) CST.clear(); s = { t0: null, tb: null, art: null, rt: null }; CST.set(key, s); } return s; };
  const bdEl = new WeakMap();

  const applyTheme = () => {
    const d = doc.documentElement;
    if (!d) return;
    const t = d.getAttribute('data-theme') || (d.classList.contains('dark') ? 'dark' : d.classList.contains('light') ? 'light' : '');
    bl.setAttribute('data-theme', t === 'dark' || t === 'light' ? t : '');
  };
  applyTheme();
  let mo = null;
  try { mo = new MutationObserver(applyTheme); mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] }); } catch (e) { mo = null; }

  function fit() {
    const rect = bl.getBoundingClientRect();
    const topY = rect.top + (typeof window !== 'undefined' && window.scrollY ? window.scrollY : 0);
    const chrome = Math.max(0, Math.round(topY));
    if (bl.dataset.chrome !== String(chrome)) { bl.dataset.chrome = String(chrome); bl.style.setProperty('--chrome', chrome + 'px'); }
    bl.style.setProperty('--oc', String(view ? Math.max(1, opponents().length) : 3));
  }

  function decorate() {
    root.querySelectorAll('[data-bd]').forEach((el) => {
      const w = el.offsetWidth, h = el.offsetHeight; if (!w || !h) return;
      const tw = +(el.dataset.tw || 0), key = el.dataset.bd + '|' + w + '|' + h + '|' + tw;
      const cur = bdEl.get(el);
      if (cur && cur.dataset.k === key) return;
      if (cur) cur.remove();
      const b = trees.borderDOM(trees.hash(el.dataset.bd), w, h, el.dataset.sh === 'e', key, tw);
      b.dataset.k = key;
      bdEl.set(el, b);
      el.appendChild(b);
    });
  }

  function bgRoots() {
    const w = bl.offsetWidth, h = bl.offsetHeight, k = w + '|' + h; if (!w || k === BGK) return;
    const first = !BGK; BGK = k;
    const old = $('#bgr'); if (old) old.remove();
    const bgr = trees.bgrootsDOM(w, h, first); bgr.id = 'bgr';
    bl.insertBefore(bgr, bl.firstChild);
  }
  const relayout = () => { if (destroyed) return; fit(); decorate(); bgRoots(); };

  const opponents = () => view.players.filter((p) => p.id !== view.you);
  const meP = () => view.players.find((p) => p.id === view.you) || null;
  const lab = (id) => { const p = view.players.find((x) => x.id === id); return id === view.you ? 'You' : (p ? p.name : 'Someone'); };
  const stackTotal = () => view.players.reduce((n, p) => n + p.stack.length, 0);
  const ctrlUI = () => view.ctrl || api.isHost;

  const artEl = (c, st, now) => {
    if (!st.art) st.art = trees.art(c);
    if (st.t0 == null) st.t0 = now;
    const el = (now - st.t0) / 1000, A = st.art, an = el < A.total, dl = (d) => (d - el).toFixed(2) + 's', tf = A.tf;
    const svg = $svg('svg'); svg.setAttribute('class', 'art' + (c.k === 'D' ? ' dd' : ''));
    svg.setAttribute('viewBox', '0 0 100 140'); svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    const g = $svg('g'); g.setAttribute('transform', 'translate(' + tf.x + ' ' + tf.y + ') scale(' + tf.s + ')');
    for (const b of A.br) {
      const p = $svg('path'); p.setAttribute('d', b.d);
      const col = c.k === 'P' ? 'fill:' + STEMS[Math.min(b.dp || 0, 4)] + ';' : '';
      if (an) { p.setAttribute('class', 'gr'); p.style.cssText = col + 'transform-origin:' + b.ox + 'px ' + b.oy + 'px;animation-delay:' + dl(b.dl); }
      else if (col) p.style.cssText = col;
      g.appendChild(p);
    }
    for (const l of A.lv) {
      const gg = $svg('g'); gg.setAttribute('transform', 'translate(' + l.x + ' ' + l.y + ') rotate(' + l.a + ') scale(' + l.s + ')');
      const p = $svg('path'); p.setAttribute('d', LEAF); p.setAttribute('fill-rule', 'evenodd');
      p.style.cssText = 'fill:' + l.c + (an ? ';animation:grl .55s cubic-bezier(.2,.9,.3,1.2) ' + dl(l.dl) + ' both;transform-origin:0 0' : '');
      gg.appendChild(p); g.appendChild(gg);
    }
    for (const f of A.fl) {
      const gg = $svg('g'); gg.setAttribute('transform', 'translate(' + f.x + ' ' + f.y + ') rotate(' + f.a + ') scale(' + f.s + ')');
      const inner = $svg('g');
      if (an) { inner.setAttribute('class', 'grf'); inner.style.cssText = 'animation-delay:' + dl(f.dl); }
      const p = $svg('path'); p.setAttribute('d', PET); p.style.cssText = 'fill:' + f.c;
      const halo = $svg('circle'); halo.setAttribute('r', '2.3'); halo.style.cssText = 'fill:' + f.c2 + ';opacity:.45';
      const ci = $svg('circle'); ci.setAttribute('r', '1.4'); ci.style.cssText = 'fill:' + f.c2;
      inner.appendChild(p); inner.appendChild(halo); inner.appendChild(ci); gg.appendChild(inner); g.appendChild(gg);
    }
    svg.appendChild(g);
    return svg;
  };

  const backEl = (c, st, now) => {
    if (!st.rt) st.rt = trees.roots(c);
    if (st.tb == null) st.tb = now;
    const el = (now - st.tb) / 1000, an = el < 1.4;
    const svg = $svg('svg'); svg.setAttribute('class', 'art rt');
    svg.setAttribute('viewBox', '0 0 100 140'); svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    for (const b of st.rt) {
      const p = $svg('path'); p.setAttribute('d', b.d);
      if (an) { p.setAttribute('class', 'gr'); p.style.cssText = 'transform-origin:' + b.ox + 'px ' + b.oy + 'px;animation-delay:' + (b.dl - el).toFixed(2) + 's'; }
      svg.appendChild(p);
    }
    return svg;
  };

  function card(c, face, o, now) {
    o = o || {};
    const st = cst(c.id + '|' + c.k + '|' + c.s), a = face ? artEl(c, st, now) : backEl(c, st, now), t = (now - (face ? st.t0 : st.tb)) / 1000;
    const s = $el('span'); s.className = 'c ' + (face ? c.k : 'b') + (o.act ? ' act' : '') + (o.top ? ' top' : '');
    s.setAttribute('data-id', esc(c.id));
    if (o.act) { s.setAttribute('data-act', o.act); s.setAttribute('data-k', o.k); }
    const intro = o.jolt && c.k === 'D' && t < .6 ? 'jolt .55s cubic-bezier(.36,.07,.19,.97) ' + (-t).toFixed(2) + 's both'
      : (t < .7 ? 'sprout .7s cubic-bezier(.2,.9,.3,1.2) ' + (-t).toFixed(2) + 's backwards' : '');
    const anim = intro || o.top ? 'animation:' + [intro, o.top ? 'topglow 1.05s ease-in-out infinite' : ''].filter(Boolean).join(',') + ';' : '';
    const sw = face && c.k === 'P' ? '--sw:' + (-(((now / 1000) + c.s % 50 / 10) % 6)).toFixed(2) + 's;' : '';
    const idx = o.i != null ? '--i:' + o.i + ';' : '';
    s.style.cssText = anim + sw + idx;
    s.appendChild(a);
    if (o.tab) { const tb = $el('i'); tb.className = 'tab'; tb.style.cssText = '--tabc:' + o.tab; s.appendChild(tb); }
    return s;
  }

  function stackBlock(cards, face, o, now) {
    const n = cards.length;
    const stkw = $el('div'); stkw.className = 'stkw'; stkw.style.cssText = '--n:' + Math.max(1, n);
    const stk = $el('div'); stk.className = 'stk' + (n ? '' : ' empty') + (o.spread ? ' spread' : '');
    stk.style.cssText = '--n:' + Math.max(1, n);
    if (o.hold) { stk.setAttribute('data-hold', '1'); stk.setAttribute('tabindex', '0'); stk.setAttribute('role', 'group'); stk.setAttribute('aria-label', 'Your stack, bottom to top. Press and hold to spread it out.'); }
    for (let i = 0; i < n; i++) stk.appendChild(card(cards[i], face, { i, top: o.top && i === n - 1, tab: o.tabs && i < n - 1 ? TAB[cards[i].k] : null }, now));
    stkw.appendChild(stk);
    if (n) {
      const badge = $el('span'); badge.className = 'tx badge'; badge.setAttribute('title', n + ' card' + (n === 1 ? '' : 's')); badge.textContent = '×' + n; stkw.appendChild(badge);
    }
    if (o.top && n) {
      const lbl = $el('span'); lbl.className = 'tx toplbl'; lbl.textContent = o.flipNext ? 'FLIP' : 'TOP'; stkw.appendChild(lbl);
    }
    if (o.pips && n) {
      const pips = $el('div'); pips.className = 'tx pips' + (o.spread ? ' sp' : '');
      for (let i = 0; i < n; i++) {
        const c = cards[i]; const pip = $el('span'); pip.className = 'pip ' + c.k; pip.textContent = (i + 1) + ' ' + (c.k === 'P' ? '✿' : '✖'); pips.appendChild(pip);
      }
      stkw.appendChild(pips);
    }
    return stkw;
  }

  const btn = (label, act, data, extra) => {
    const b = $el('button'); b.className = extra || ''; b.setAttribute('data-act', act);
    if (data) for (const k in data) b.setAttribute('data-' + k, esc(data[k]));
    b.setAttribute('data-bd', 'btn' + esc(label));
    const s = $el('span'); s.className = 'tx'; s.textContent = label; b.appendChild(s);
    return b;
  };
  const chip = (t, cls) => { const s = $el('span'); s.className = 'chip ' + (cls || ''); s.textContent = t; return s; };

  function oppTile(p, now) {
    const v = view, revealing = v.phase === 'challenge' && p.alive && p.stack.length > 0;
    const flip = v.phase === 'challenge' && v.turn === v.you && v.flipOpts.indexOf(p.id) >= 0;
    const tag = !p.alive ? 'out' : (p.folded ? 'Folded' : p.tag);
    const div = $el('div'); div.className = 'opp ' + (p.id === v.turn ? 'cur' : '') + (p.folded ? 'folded' : '') + (p.alive ? '' : 'dead') + (flip ? ' flip' : '') + (revealing ? ' rv' : '');
    div.setAttribute('data-bd', 'seat' + esc(p.id));
    if (flip) { div.setAttribute('data-act', 'flip'); div.setAttribute('data-t', esc(p.id)); div.setAttribute('role', 'button'); div.setAttribute('tabindex', '0'); div.setAttribute('aria-label', 'Flip the top card of ' + esc(p.name) + "'s stack"); }
    const nm = $el('div'); nm.className = 'tx nm';
    const b = $el('b'); b.textContent = esc(p.name); nm.appendChild(b);
    if (p.left) { const t = $el('span'); t.textContent = ' (left)'; nm.appendChild(t); }
    const mut = $el('span'); mut.className = 'mut'; mut.textContent = '●'.repeat(p.wins) + '○'.repeat(Math.max(0, WINS - p.wins)); nm.appendChild(mut);
    div.appendChild(nm);
    const stDiv = $el('div'); stDiv.className = 'tx st'; if (tag) stDiv.appendChild(chip(tag, p.folded || !p.alive ? 'f' : '')); div.appendChild(stDiv);
    div.appendChild(stackBlock(p.stack, false, { top: revealing, flipNext: flip }, now));
    const ct = $el('div'); ct.className = 'tx ct'; ct.textContent = p.alive ? p.handN + ' in hand' : ''; div.appendChild(ct);
    return div;
  }

  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function renderTop(now) { clearNode(top); view.players.filter((p) => p.id !== view.you).forEach((p) => top.appendChild(oppTile(p, now))); }

  function renderMid(now) {
    const v = view, ch = v.challenger ? lab(v.challenger) : '';
    const me = v.you, turnMe = v.turn === me;
    let kick = '', big = '';
    switch (v.phase) {
      case 'plant': kick = 'Round ' + v.round + ' · Planting'; big = turnMe ? 'Your turn to plant' : lab(v.turn) + ' is planting'; break;
      case 'grow': kick = 'Round ' + v.round + ' · Growing'; big = turnMe ? 'Add a card or bid' : lab(v.turn) + ' is deciding…'; break;
      case 'bid': kick = 'Round ' + v.round + ' · Bidding (up to ' + v.max + ')'; big = 'Bid: ' + v.bid.cur + ' by ' + lab(v.bid.high); break;
      case 'challenge': kick = 'Round ' + v.round + ' · Revealing'; big = ch + ': ' + v.count + ' / ' + v.need + ' Living Plants'; break;
      case 'lose': kick = 'Round ' + v.round + ' · Dead Tree!'; big = ch + ' loses a card'; break;
      case 'result': {
        const c = v.players.find((x) => x.id === v.challenger), won = !!c && c.tag === 'Won round';
        kick = 'Round ' + v.round + ' · Complete'; big = won ? ch + ' won the round (' + c.wins + '/' + WINS + ')' : ch + ' failed the challenge'; break;
      }
      case 'over': kick = 'Game over'; big = lab(v.winner) + ' win' + (v.winner === me ? '' : 's') + ' the game!'; break;
    }
    bl.setAttribute('data-phase', v.phase);
    clearNode(hero);
    const kickEl = $el('div'); kickEl.className = 'tx kick'; kickEl.textContent = kick; hero.appendChild(kickEl);
    const bigEl = $el('div'); bigEl.className = 'tx big'; bigEl.textContent = big; hero.appendChild(bigEl);
    clearNode(flips);
    v.flips.forEach((f, i) => {
      const fp = $el('div'); fp.className = 'fp';
      const no = $el('span'); no.className = 'tx no'; no.textContent = i + 1; fp.appendChild(no);
      fp.appendChild(card(f.c, true, { jolt: true }, now));
      const own = $el('span'); own.className = 'tx own'; own.textContent = esc(lab(f.o)); fp.appendChild(own);
      flips.appendChild(fp);
    });
    const p = meP();
    if (!p) { clearNode(mine); return; }
    const tag = !p.alive ? 'You are out' : (p.folded ? 'You folded' : p.tag), n = p.stack.length;
    const revealing = v.phase === 'challenge' && p.alive && n > 0 && v.challenger !== me;
    clearNode(mine);
    const mineDiv = $el('div'); mineDiv.className = 'mine ' + (p.folded ? 'folded' : '') + (revealing ? ' rv' : '') + (p.id === v.turn ? ' cur' : '');
    const lbl = $el('div'); lbl.className = 'tx lbl';
    lbl.textContent = (p.alive ? 'Your stack · bottom → top ' + '●'.repeat(p.wins) + '○'.repeat(Math.max(0, WINS - p.wins)) : '') + (tag ? ' ' : '');
    if (tag) lbl.appendChild(chip(tag, p.folded || !p.alive ? 'f' : ''));
    mineDiv.appendChild(lbl);
    mineDiv.appendChild(stackBlock(p.stack, true, { top: revealing, tabs: true, pips: true, hold: true, spread: ui.spread }, now));
    mine.appendChild(mineDiv);
  }

  function stepper(lo, hi, label, confirmAct, def) {
    if (ui.n == null) ui.n = def; ui.lo = lo; ui.hi = hi; ui.n = Math.max(lo, Math.min(hi, ui.n));
    const dn = btn('−', 'stepdn', null, 'stp'); if (ui.n <= lo) dn.disabled = true;
    const up = btn('+', 'stepup', null, 'stp'); if (ui.n >= hi) up.disabled = true;
    const num = $el('span'); num.className = 'tx num'; num.setAttribute('aria-live', 'polite'); num.textContent = ui.n;
    return [dn, num, up, btn(label + ' ' + ui.n, confirmAct, null, 'go')];
  }

  function botHTML() {
    const v = view, me = v.you, p = meP(), mine = v.turn === me && !!p && p.alive;
    const waitFor = () => {
      const tp = v.players.find((x) => x.id === v.turn);
      const out = { t: 'Waiting for ' + (v.turn ? lab(v.turn) : 'the next step') + '…', a: [] };
      if (ctrlUI() && tp && !tp.bot && v.turn !== me) out.a = [btn('Let a bot move for ' + tp.name, 'skip')];
      return out;
    };
    if (v.phase === 'lobby') return { t: '', a: [] };
    if (!p) return { t: v.joined ? '👁 A game is in progress — you’ll be seated in the next one.' : '👁 Watching — you’re not seated at this table.', a: [] };
    const np = v.hand.filter((c) => c.k === 'P').length, nd = v.hand.length - np;
    const kinds = (act) => {
      const out = [];
      if (np) out.push(btn('✿ Living Plant (' + np + ')', act, { k: 'P' }));
      if (nd) out.push(btn('✖ Dead Tree' + (nd > 1 ? ' (' + nd + ')' : ''), act, { k: 'D' }));
      return out;
    };
    const own = p.stack.length;
    let res;
    switch (v.phase) {
      case 'plant': res = mine ? { t: 'Your turn — tap a card in your hand to plant.', a: [], tap: 'place' } : waitFor(); break;
      case 'grow':
        if (!mine) res = waitFor();
        else if (!v.hand.length) res = { t: 'No cards left in hand — you must bid.', a: stepper(1, stackTotal(), 'Bid', 'bid', Math.max(1, own)) };
        else if (ui.mode === 'addkind') res = { t: 'Tap a card in your hand to add to your stack.', a: [btn('Back', 'back')], tap: 'add' };
        else if (ui.mode === 'open') res = { t: 'Start the bid: how many Living Plants?', a: stepper(1, stackTotal(), 'Bid', 'bid', Math.max(1, own)).concat([btn('Back', 'back')]) };
        else res = { t: 'Your turn — add a card, or start the bid.', a: [btn('Add another card', 'addmode'), btn('Start the bid', 'openmode')] };
        break;
      case 'bid':
        if (!mine) res = waitFor();
        else res = { t: 'Bid is ' + v.bid.cur + '. Raise it — or Fold to sit out the rest of this round.', a: v.bid.cur < v.max ? stepper(v.bid.cur + 1, v.max, 'Raise to', 'raise', v.bid.cur + 1).concat([btn('Fold', 'fold')]) : [btn('Fold', 'fold')] };
        break;
      case 'challenge':
        if (v.turn !== me) res = waitFor();
        else res = { t: 'Tap a highlighted stack to flip its top card — ' + (v.need - v.count) + ' more Living Plant' + (v.need - v.count === 1 ? '' : 's') + ' to find.', a: [] };
        break;
      case 'lose':
        if (v.turn !== me) res = waitFor();
        else res = { t: 'You hit your own Dead Tree — choose a card to lose.', a: (v.loseOpts || []).map((k) => btn(k === 'P' ? '✿ Living Plant' : '✖ Dead Tree', 'lose', { k })) };
        break;
      case 'result': {
        const needIt = v.readyNeed.indexOf(me) >= 0, done = v.ready.filter((x) => v.readyNeed.indexOf(x) >= 0).length, mineReady = v.ready.indexOf(me) >= 0;
        let t;
        let a = [];
        if (needIt && !mineReady) { t = 'Round over. Tap Continue when you are ready.'; a = [btn('Continue', 'ready', null, 'go')]; }
        else t = 'Waiting for the others to continue (' + done + '/' + v.readyNeed.length + ')…';
        if (ctrlUI() && (mineReady || !needIt) && done < v.readyNeed.length) a = a.concat([btn('Continue now', 'next')]);
        res = { t, a };
        break;
      }
      case 'over': res = { t: v.winner === me ? 'You win the game!' : lab(v.winner) + ' wins the game.', a: ctrlUI() ? [btn('Play again', 'start', null, 'go'), btn('Back to lobby', 'toLobby')] : [], tail: ctrlUI() ? '' : 'Waiting for the host to start another game…' };
        break;
      default: res = { t: '', a: [] };
    }
    return res;
  }

  function renderBot(now) {
    const v = view, b = botHTML(), p = meP();
    const hand = p ? v.hand.slice().sort((x, y) => (x.k === y.k ? 0 : x.k === 'P' ? -1 : 1)) : [];
    clearNode(handCont);
    if (p && v.phase !== 'lobby') {
      const cards = $el('div'); cards.className = 'cards';
      hand.forEach((c) => cards.appendChild(card(c, true, b.tap ? { act: b.tap, k: c.k } : {}, now)));
      handCont.appendChild(cards);
    }
    prompt.textContent = toastMsg || b.t || b.tail || '';
    prompt.className = 'tx' + (toastMsg ? ' err' : '');
    clearNode(acts);
    (b.a || []).forEach((n) => acts.appendChild(n));
  }

  function renderLobby() {
    const v = view, ctrl = ctrlUI();
    const names = v.lobby.map((m) => esc(m.name) + (m.id === v.you ? ' (you)' : '')).join(', ') || '—';
    const stepWrap = $el('span'); stepWrap.className = 'step';
    if (ctrl) {
      stepWrap.appendChild(btn('−', 'bots', { n: Math.max(0, v.bots - 1) }, 'stp'));
      const bn = $el('b'); bn.className = 'tx'; bn.textContent = v.botN; stepWrap.appendChild(bn);
      stepWrap.appendChild(btn('+', 'bots', { n: Math.min(v.maxP - 1, v.bots + 1) }, 'stp'));
    } else {
      const bn = $el('b'); bn.className = 'tx'; bn.textContent = v.botN; stepWrap.appendChild(bn);
    }
    let status;
    if (!v.joined && !v.seated) status = api.isSpectator ? '👁 Watching — you are not at this table.' : 'Taking your seat…';
    else if (v.lobby.length > v.maxP) status = 'Only ' + v.maxP + ' can play — the rest will watch.';
    else status = v.humansIn + ' at the table' + (v.botN ? ' + ' + v.botN + ' bot' + (v.botN > 1 ? 's' : '') : '') + ' — ' + (v.humansIn + v.botN < v.minP ? 'needs ' + v.minP : (ctrl ? 'invite someone, or start' : 'waiting for the host to start'));
    clearNode(lobby);
    const lob = $el('div'); lob.className = 'lob'; lob.dataset.bd = 'lobbypanel'; lob.dataset.tw = '0.3';
    const big = $el('div'); big.className = 'tx big'; big.textContent = 'Blight'; lob.appendChild(big);
    const p = $el('p'); p.className = 'tx'; p.textContent = 'Everyone has three ✿ Living Plants and one ✖ Dead Tree. Plant a card face down, add more or start bidding: how many plants can you reveal? Bid, or fold to sit the round out. Hit a Dead Tree and you lose a card. Win ' + WINS + ' rounds or outlast everyone.'; lob.appendChild(p);
    const who = $el('div'); who.className = 'tx who'; const mut = $el('span'); mut.className = 'mut'; mut.textContent = 'At the table:'; who.appendChild(mut); const namesT = document.createTextNode(' ' + names); who.appendChild(namesT); lob.appendChild(who);
    const who2 = $el('div'); who2.className = 'tx who'; const mut2 = $el('span'); mut2.className = 'mut'; mut2.textContent = 'Bots:'; who2.appendChild(mut2); who2.appendChild(stepWrap); lob.appendChild(who2);
    const st = $el('div'); st.className = 'tx mut'; st.textContent = esc(status); lob.appendChild(st);
    if (ctrl) {
      const row = $el('div'); row.className = 'row';
      if (v.canStart) row.appendChild(btn('Start', 'start', null, 'go'));
      lob.appendChild(row);
    }
    lobby.appendChild(lob);
  }

  function render() {
    if (!view || destroyed) return;
    const v = view, now = typeof performance !== 'undefined' ? performance.now() : 0;
    const key = [v.phase, v.turn, v.round, v.hand.length, stackTotal(), v.bid && v.bid.cur].join('|');
    if (key !== ui.key) { ui.key = key; ui.mode = null; ui.n = null; }
    fit();
    if (v.phase === 'lobby') {
      [top, hero, flips, mine, handCont, acts].forEach(clearNode);
      prompt.textContent = ''; felt.style.visibility = 'hidden';
      renderLobby();
    } else {
      clearNode(lobby); felt.style.visibility = '';
      renderTop(now); renderMid(now); renderBot(now);
    }
    if (v.phase === 'over' && v.winner) {
      const vk = v.epoch + '|' + v.winner;
      if (vicKey !== vk) {
        vicKey = vk; clearNode(vic);
        const w = win.innerWidth || bl.offsetWidth || 400, h = win.innerHeight || bl.offsetHeight || 700;
        vic.appendChild(trees.victoryDOM(hash('win|' + vk), w, h, LEAF, PET));
        const ban = $el('div'); ban.className = 'vic-ban'; ban.setAttribute('data-bd', 'vicban');
        const title = $el('div'); title.className = 'tx big';
        title.textContent = v.winner === v.you ? 'You win the game!' : lab(v.winner) + ' wins the game!';
        ban.appendChild(title);
        if (ctrlUI()) {
          const row = $el('div'); row.className = 'row';
          row.appendChild(btn('Play again', 'start', null, 'go'));
          row.appendChild(btn('Back to lobby', 'toLobby'));
          ban.appendChild(row);
        }
        vic.appendChild(ban);
      }
    } else if (vicKey) {
      vicKey = ''; clearNode(vic);
    }
    decorate(); bgRoots();
  }

  function clearBusy() { busyTok++; bl.classList.remove('busy'); }
  function toast(text) {
    const tok = ++toastTok; toastMsg = String(text);
    api.setTimeout(() => { if (tok === toastTok) { toastMsg = ''; if (view && !destroyed) renderBot(typeof performance !== 'undefined' ? performance.now() : 0); } }, 4500);
    clearBusy(); if (view) renderBot(typeof performance !== 'undefined' ? performance.now() : 0);
  }
  function send(a) {
    const tok = ++busyTok; bl.classList.add('busy');
    api.setTimeout(() => { if (tok === busyTok) bl.classList.remove('busy'); }, 1200);
    api.send(a);
  }
  const redoActs = () => { renderBot(typeof performance !== 'undefined' ? performance.now() : 0); decorate(); };
  const ACTS = {
    place: (d) => send({ a: 'place', k: d.k }),
    add: (d) => send({ a: 'add', k: d.k }),
    addmode: () => {
      const np = view.hand.filter((c) => c.k === 'P').length, nd = view.hand.length - np;
      if (np && nd) { ui.mode = 'addkind'; render(); } else send({ a: 'add', k: np ? 'P' : 'D' });
    },
    openmode: () => { ui.mode = 'open'; ui.n = null; render(); },
    back: () => { ui.mode = null; render(); },
    stepdn: () => { ui.n = Math.max(ui.lo, ui.n - 1); redoActs(); },
    stepup: () => { ui.n = Math.min(ui.hi, ui.n + 1); redoActs(); },
    bid: () => send({ a: 'bid', n: ui.n }),
    raise: () => send({ a: 'raise', n: ui.n }),
    fold: () => send({ a: 'fold' }),
    flip: (d) => send({ a: 'flip', t: d.t }),
    lose: (d) => send({ a: 'lose', k: d.k }),
    ready: () => send({ a: 'ready' }),
    next: () => send({ a: 'next' }),
    skip: () => send({ a: 'skip' }),
    start: () => send({ a: 'start' }),
    toLobby: () => send({ a: 'toLobby' }),
    bots: (d) => send({ a: 'bots', n: +d.n }),
  };
  const onClick = (e) => {
    if (!view || destroyed) return;
    if (Date.now() - heldAt < 450) return;
    const t = e.target.closest && e.target.closest('[data-act]');
    if (t && ACTS[t.dataset.act]) { ACTS[t.dataset.act](t.dataset); return; }
    const el = e.target.closest && e.target.closest('.c[data-id]');
    if (el) { const s = CST.get(el.dataset.id); if (s) { if (el.classList.contains('b')) s.tb = typeof performance !== 'undefined' ? performance.now() : 0; else s.t0 = typeof performance !== 'undefined' ? performance.now() : 0; render(); } }
  };
  const onDown = (e) => {
    if (!view || destroyed || !(e.target.closest && e.target.closest('[data-hold]'))) return;
    const tok = ++holdTok;
    api.setTimeout(() => { if (tok === holdTok && !destroyed) { ui.spread = true; heldAt = Date.now(); render(); } }, 220);
  };
  const endHold = () => {
    holdTok++;
    if (ui.spread) { ui.spread = false; heldAt = Date.now(); if (view && !destroyed) render(); }
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const m = e.target.matches;
    if (m && m.call(e.target, '[role="button"][data-act]')) { e.preventDefault(); onClick(e); }
    else if (m && m.call(e.target, '[data-hold]')) { e.preventDefault(); ui.spread = !ui.spread; render(); }
  };
  const onCtx = (e) => { if (e.target.closest && e.target.closest('[data-hold]')) e.preventDefault(); };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointerup', endHold);
  root.addEventListener('pointercancel', endHold);
  root.addEventListener('contextmenu', onCtx);
  if (win.addEventListener) { win.addEventListener('pointerup', endHold); win.addEventListener('resize', relayout); }
  let ro = null;
  try { ro = new ResizeObserver(relayout); ro.observe(bl); } catch (e) { ro = null; }

  function autoJoin() {
    if (!view || api.isSpectator) return;
    if (view.joined || view.seated) { joinTries = 0; return; }
    if (joinTries < 3) { joinTries++; api.send({ a: 'join' }); }
  }

  return {
    update(v) {
      if (destroyed) return;
      view = v; clearBusy(); autoJoin(); render();
    },
    denied(text) { if (!destroyed) toast(text || 'Not allowed.'); },
    destroy() {
      destroyed = true;
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointerup', endHold);
      root.removeEventListener('pointercancel', endHold);
      root.removeEventListener('contextmenu', onCtx);
      if (win.removeEventListener) { win.removeEventListener('pointerup', endHold); win.removeEventListener('resize', relayout); }
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
    },
  };
}

