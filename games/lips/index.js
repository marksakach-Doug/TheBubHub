// I'm Your Lips: a module game for Bub Hub.
//
// The page names a friend at the table and deals a word:
//     "Say what ______ would say about <word>."
// Everyone else writes the one line that friend would say about it, against a
// clock. The friend reads the lines shuffled and drags each one into a tier
// list: never would say / possibly would say / wish i wouldve thought of that.
// Exactly one line takes the top tier, and its writer scores a point. The
// friend rotates round by round.
//
// While the lines are being written, the friend plays with three mannequin
// heads: stick lips on them, drag them around, change the size, shape and
// colour. Everyone else sees the heads at the reveal.
//
// Rules live only in reduce(). reduce() never reads a clock, so a seeded replay
// stays identical: the write timer is run by the clients, and the host (or, as
// a fallback, the friend) sends 'timeUp' when it runs out. project() keeps
// authorship and the friend's shuffled texts out of every view until the
// reveal, and it never sends the word deck or the raw line map to anyone.

import { WORDS } from './words.js';

export const meta = {
  id: 'lips',
  title: "I'm Your Lips",
  players: '3-8',
  color: '#ff2a6d',
  icon: '👄',
  desc: 'Say what a friend would say. Make them wish they had those lips.',
};

const MIN_SEATS = 3;   // a friend and at least two people writing
const MAX_SEATS = 8;
const MATCH_ROUNDS = 6;     // rounds in a match; most points after this wins
const MAX_LINE = 90;
const WRITE_SECONDS = 60;   // how long everyone has to write
const HEADS = 3;            // mannequin heads on the shelf
const MAX_LIPS = 8;         // lips the friend may stick on in one round

const NEVER = 0;
const POSSIBLE = 1;
const WISH = 2;
const TIERS = [
  { key: NEVER, label: 'never would say', color: '#05d9e8' },
  { key: POSSIBLE, label: 'possibly would say', color: '#ffe14d' },
  { key: WISH, label: 'wish i wouldve thought of that', color: '#ff2a6d' },
];
const TIER_ORDER = [WISH, POSSIBLE, NEVER];   // the board reads top to bottom

// The lip. One path, one mouth line. Every button on the page is this shape.
const LIP_D = 'M10,50 C40,16 74,22 100,36 C126,22 160,16 190,50 C160,84 126,86 100,72 C74,86 40,84 10,50 Z';
const MOUTH_D = 'M10 50 Q100 62 190 50';

// Shapes the friend can pick for a mannequin lip. All drawn in a 200x100 box.
const SHAPES = {
  kiss: { d: LIP_D, line: MOUTH_D },
  pout: {
    d: 'M20,50 C40,10 80,14 100,30 C120,14 160,10 180,50 C165,95 125,98 100,90 C75,98 35,95 20,50 Z',
    line: 'M20 50 Q100 58 180 50',
  },
  smile: { d: 'M8,30 C50,70 150,70 192,30 C190,62 150,92 100,92 C50,92 10,62 8,30 Z', line: '' },
  grin: { d: 'M10,40 Q100,10 190,40 Q200,50 190,60 Q100,92 10,60 Q0,50 10,40 Z', line: 'M10 50 L190 50' },
  oh: {
    d: 'M100,8 C150,8 165,30 165,50 C165,72 150,92 100,92 C50,92 35,72 35,50 C35,30 50,8 100,8 Z',
    line: '',
    hole: 'M100,32 C122,32 130,42 130,50 C130,60 122,70 100,70 C78,70 70,60 70,50 C70,42 78,32 100,32 Z',
  },
  wavy: {
    d: 'M10,45 C30,15 55,15 75,35 C90,48 110,48 125,35 C145,15 170,15 190,45 C170,85 130,90 100,78 C70,90 30,85 10,45 Z',
    line: 'M10 48 Q35 38 60 50 T110 50 T160 50 T190 48',
  },
};
const SHAPE_KEYS = Object.keys(SHAPES);
const PALETTE = ['#ff2a6d', '#d6002f', '#ff9ec4', '#b967ff', '#05d9e8', '#ffe14d', '#39ff88', '#fff5fa'];

// Scene layout: three heads side by side in a 600 x 256 box.
const HEAD_X = [100, 300, 500];
const HEAD_Y = 118;

// ---------------------------------------------------------------- helpers

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const clone = (s) => JSON.parse(JSON.stringify(s));
const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Fisher-Yates with the hub's rng, so a seeded replay deals the same cards.
function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Used only by prune(), which has no rng. Keyed to the round so the seat order
// never tells the friend who wrote which line.
function scrambled(list, seed) {
  return list.slice().sort((x, y) => (hash(seed + x) - hash(seed + y)) || (x < y ? -1 : 1));
}

// Seat everyone in `list` who is not seated yet, and refresh names of those who are.
function seatAll(order, names, list) {
  (list || []).forEach((p) => {
    if (!p || !p.id) return;
    const nm = clean(p.name);
    if (order.indexOf(p.id) >= 0) {
      if (nm) names[p.id] = nm;
      return;
    }
    if (order.length >= MAX_SEATS) return;
    order.push(p.id);
    names[p.id] = nm || 'someone';
  });
}

function dealWord(s, rng) {
  if (!s.deck.length) s.deck = shuffled(WORDS.map((_, i) => i), rng);
  s.word = WORDS[s.deck.pop()];
}

// The friend's mannequin lips come from a client, so every field is checked.
function cleanLips(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, MAX_LIPS).map((raw) => {
    const l = raw && typeof raw === 'object' ? raw : {};
    const n = (v, lo, hi, d) => (isFinite(Number(v)) && v !== null && v !== '' ? clamp(Number(v), lo, hi) : d);
    const col = String(l.color);
    return {
      h: Math.round(n(l.h, 0, HEADS - 1, 0)),
      x: Math.round(n(l.x, -64, 64, 0)),
      y: Math.round(n(l.y, -84, 84, 0)),
      s: Math.round(n(l.s, 0.15, 1.2, 0.45) * 100) / 100,
      shape: (typeof l.shape === 'string' && has(SHAPES, l.shape)) ? l.shape : 'kiss',
      color: /^#[0-9a-f]{6}$/i.test(col) ? col.toLowerCase() : PALETTE[0],
    };
  });
}

// ---------------------------------------------------------------- contract

export function init(ctx) {
  const order = [];
  const names = {};
  seatAll(order, names, ctx && ctx.atTable);
  return {
    epoch: 0,
    phase: 'lobby',          // lobby | write | rank | roundover | gameover
    roundNo: 0,
    matchRounds: MATCH_ROUNDS,
    dealNo: 0,               // bumps whenever the clock restarts inside a round
    redeals: 0,              // times this round was re-dealt because nobody wrote
    order,                   // seated players, in seat order
    names,                   // id -> display name, refreshed on each move
    scores: {},              // id -> points
    deck: [],                // shuffled indices into WORDS, host-only
    word: null,
    friend: null,
    writers: [],             // ids who must write this round (snapshot at deal)
    lines: {},               // writer id -> their line (hidden until rank)
    shuffle: null,           // writer ids in the order the friend sees them
    tiers: null,             // tier per shuffle index, set at the reveal
    rankOrder: null,         // shuffle indices in the order the friend placed them
    doodle: [],              // the friend's mannequin lips (hidden until the reveal)
    history: [],             // { roundNo, word, friend, winner, line, winnerName, friendName } per completed round
    result: null,            // { word, friend, winner, line } once the round is over
    winnerIds: [],           // match winner id(s), set at game over
  };
}

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const id = from.id || '';
  const rng = (ctx && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
  if (!id) return { error: 'Lip down at the table first.' };
  const a = action && action.a;
  if (a === 'join') return join(state, id, from);
  if (a === 'start') return start(state, from, rng, ctx);
  if (a === 'toLobby') return toLobby(state, from);
  if (a === 'line') return line(state, id, from, action, rng);
  if (a === 'timeUp') return timeUp(state, id, from, rng);
  if (a === 'rank') return rank(state, id, action);
  if (a === 'sudden') return suddenWin(state, id, action);
  if (a === 'doodle') return doodle(state, id, action);
  return { error: 'That is not a move in this game.' };
}

function join(state, id, from) {
  const nm = clean(from.name);
  if (state.order.indexOf(id) >= 0) {
    if (!nm || state.names[id] === nm) return state;
    const s = clone(state);
    s.names[id] = nm;
    return s;
  }
  if (state.order.length >= MAX_SEATS) return { error: 'The table is full. Eight is the most.' };
  const s = clone(state);
  s.order.push(id);
  s.names[id] = nm || 'someone';
  return s;
}

function start(state, from, rng, ctx) {
  if (!from.host) return { error: 'Only the host can start the game.' };
  if (state.phase === 'write' || state.phase === 'rank') return { error: 'A round is already running.' };
  if (!WORDS.length) return { error: 'The word list is empty.' };
  const s = clone(state);
  // Double check: anyone the hub says is at the table but who never pressed
  // "Sit in" is seated now, so the count here matches what the host can see.
  seatAll(s.order, s.names, ctx && ctx.atTable);
  if (s.order.length < MIN_SEATS) {
    const who = s.order.map((x) => s.names[x] || 'someone').join(', ') || 'nobody';
    return { error: 'Only ' + s.order.length + ' seated (' + who + '). Need ' + MIN_SEATS
      + ': an amigo and two people to lip. Anyone missing should press "Sit in".' };
  }
  if (state.phase === 'lobby' || state.phase === 'gameover') {
    s.matchRounds = MATCH_ROUNDS;
    s.scores = {};
    s.winnerIds = [];
    s.history = [];
    s.roundNo = 0;
  } else {
    s.roundNo = state.roundNo + 1;
  }
  s.dealNo = 0;
  s.redeals = 0;
  s.friend = s.order[s.roundNo % s.order.length];
  s.writers = s.order.filter((x) => x !== s.friend);
  s.lines = {};
  s.shuffle = null;
  s.tiers = null;
  s.rankOrder = null;
  s.doodle = [];
  s.result = null;
  s.winnerIds = [];
  dealWord(s, rng);
  s.phase = 'write';
  return s;
}

function toLobby(state, from) {
  if (!from.host) return { error: 'Only the host licks the table back to the libby.' };
  return resetToLobby(clone(state), false);
}

// A new epoch keeps round ids unique, so a rebuilt round never dedupes against
// an old one in the record.
function resetToLobby(s, keepScores) {
  s.epoch += 1;
  s.phase = 'lobby';
  s.roundNo = 0;
  s.matchRounds = MATCH_ROUNDS;
  s.dealNo = 0;
  s.redeals = 0;
  s.friend = null;
  s.writers = [];
  s.lines = {};
  s.shuffle = null;
  s.tiers = null;
  s.rankOrder = null;
  s.doodle = [];
  s.result = null;
  s.word = null;
  s.winnerIds = [];
  if (!keepScores) s.scores = {};
  return s;
}

function line(state, id, from, action, rng) {
  if (state.phase !== 'write') {
    return { error: state.phase === 'rank' ? 'The lips are locked. The friend is licking those lips.' : 'No round is running.' };
  }
  if (state.writers.indexOf(id) < 0) {
    return { error: id === state.friend
      ? "You're the friend this round. The others lick the lips."
      : "You're sitting this round out. You're in from the next one." };
  }
  const text = clean(action && action.text);
  if (!text) return { error: 'Lip something first.' };
  if (text.length > MAX_LINE) return { error: 'Lip it under ' + MAX_LINE + ' characters.' };
  const s = clone(state);
  s.lines[id] = text;
  s.names[id] = clean(from.name) || s.names[id];
  if (s.writers.every((w) => has(s.lines, w))) {
    s.phase = 'rank';
    s.shuffle = shuffled(s.writers, rng);
    s.tiers = null;
    s.rankOrder = null;
  }
  return s;
}

// The clock ran out. Whoever wrote, wrote; the rest sit this one out. If
// nobody wrote, the same friend gets a fresh word and a fresh clock.
// Only the host (or the friend, if the host's message went missing) may call
// time. A late or repeated call changes nothing.
function timeUp(state, id, from, rng) {
  if (state.phase !== 'write') return state;
  if (!from.host && id !== state.friend && state.order.indexOf(id) < 0) return { error: 'Only the host, the friend, or a player at the table can call time.' };
  const s = clone(state);
  const wrote = s.writers.filter((w) => has(s.lines, w));
  if (!wrote.length) {
    dealWord(s, rng);
    s.dealNo += 1;
    s.redeals += 1;
    s.lines = {};
    return s;
  }
  s.writers = wrote;
  s.phase = 'rank';
  s.shuffle = shuffled(wrote, rng);
  s.tiers = null;
  s.rankOrder = null;
  return s;
}

function rank(state, id, action) {
  if (state.phase !== 'rank') return { error: 'There are no lips to rank yet.' };
  if (id !== state.friend) return { error: 'Only the friend ranks the lips.' };
  const n = state.shuffle.length;
  const tiers = action && action.tiers;
  if (!Array.isArray(tiers) || tiers.length !== n) return { error: 'Rank every lip first.' };
  if (!tiers.every((t) => t === NEVER || t === POSSIBLE || t === WISH)) return { error: 'Each lip gets one of the three tiers.' };
  if (tiers.filter((t) => t === WISH).length !== 1) return { error: 'Exactly one lip gets "wish i wouldve thought of that".' };

  // Where each lip sits inside its tier. Optional: it only changes how the reveal reads.
  let order = action && action.order;
  if (order == null) {
    order = [];
    for (let i = 0; i < n; i++) order.push(i);
  } else {
    const seen = {};
    const okOrder = Array.isArray(order) && order.length === n && order.every((v) => {
      if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
      seen[v] = true;
      return true;
    });
    if (!okOrder) return { error: 'That ranking order is scrambled.' };
  }

  const s = clone(state);
  s.tiers = tiers.slice();
  s.rankOrder = order.slice();
  const winner = state.shuffle[tiers.indexOf(WISH)];
  const wline = state.lines[winner] || '';
  s.scores[winner] = (s.scores[winner] || 0) + 1;
  s.result = { word: state.word, friend: state.friend, winner, line: wline };
  s.history = (state.history || []).slice();
  s.history.push({
    roundNo: state.roundNo,
    word: state.word,
    friend: state.friend,
    winner,
    line: wline,
    winnerName: state.names[winner] || '…',
    friendName: state.names[state.friend] || '…',
  });
  if (s.roundNo + 1 >= s.matchRounds) {
    const best = Math.max(0, ...s.order.map((x) => s.scores[x] || 0));
    const tied = s.order.filter((x) => (s.scores[x] || 0) === best);
    if (tied.length > 1) {
      // Sudden death: the friend re-ranks the tied players' winning lines.
      s.winnerIds = [];
      s.phase = 'sudden';
      s.sudden = { candidates: tied.slice(), lines: {} };
      tied.forEach((wid) => { s.sudden.lines[wid] = lastWin(s.history, wid) || state.lines[wid] || ''; });
    } else {
      s.winnerIds = tied;
      s.phase = 'gameover';
    }
  } else {
    s.winnerIds = [];
    s.phase = 'roundover';
  }
  return s;
}

// Most recent line a player won a point with (for sudden-death tiebreak).
function lastWin(history, id) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    if ((history[i] || {}).winner === id) return history[i].line;
  }
  return null;
}

// The friend's mannequin lips. Saved as one whole list every time.
function suddenWin(state, id, action) {
  if (state.phase !== 'sudden') return { error: 'There is no tie to break.' };
  if (id !== state.friend) return { error: 'Only the friend breaks the tie.' };
  const winner = action && action.winner;
  if (!state.sudden.candidates.includes(winner)) return { error: 'Pick one of the tied players.' };
  const s = clone(state);
  s.winnerIds = [winner];
  s.phase = 'gameover';
  return s;
}

function doodle(state, id, action) {
  if (state.phase === 'lobby' || id !== state.friend) return { error: 'Only the friend plays with the mannequins.' };
  const lips = cleanLips(action && action.lips);
  if (!lips) return { error: 'Those lips do not stick.' };
  const s = clone(state);
  s.doodle = lips;
  return s;
}

export function project(state, playerId) {
  const names = state.names;
  const scores = state.scores;
  const seated = state.order;
  const ids = seated.concat(Object.keys(scores).filter((x) => seated.indexOf(x) < 0));
  const board = ids.map((x) => ({
    id: x,
    name: names[x] || '…',
    points: scores[x] || 0,
    seated: seated.indexOf(x) >= 0,
    friend: x === state.friend,
    wrote: has(state.lines, x),
  })).sort((p, q) => q.points - p.points);

  const isFriend = playerId === state.friend;
  const rankLines = (state.phase === 'rank' && isFriend)
    ? state.shuffle.map((wid, i) => ({ key: i, text: state.lines[wid] }))
    : null;

  const posOf = {};
  (state.rankOrder || []).forEach((idx, p) => { posOf[idx] = p; });
  const showReveal = state.phase === 'roundover' || state.phase === 'gameover';
  const reveal = (showReveal && state.shuffle && state.tiers)
    ? state.shuffle.map((wid, i) => ({
      key: i,
      text: state.lines[wid],
      tier: state.tiers[i],
      pos: has(posOf, i) ? posOf[i] : i,
      authorName: names[wid] || '…',
    }))
    : null;

  return {
    you: playerId,
    phase: state.phase,
    epoch: state.epoch,
    roundNo: state.roundNo,
    matchRounds: state.matchRounds,
    dealNo: state.dealNo,
    redeals: state.redeals,
    writeSec: WRITE_SECONDS,
    word: state.word,
    friend: state.friend,
    friendName: state.friend ? (names[state.friend] || '…') : '',
    isFriend,
    isWriter: state.writers.indexOf(playerId) >= 0,
    isSeated: seated.indexOf(playerId) >= 0,
    canJoin: seated.indexOf(playerId) < 0 && seated.length < MAX_SEATS,
    seatCount: seated.length,
    seated: seated.map((x) => ({ id: x, name: names[x] || '…', you: x === playerId })),
    writersTotal: state.writers.length,
    writtenCount: state.writers.filter((w) => has(state.lines, w)).length,
    myLine: has(state.lines, playerId) ? state.lines[playerId] : null,
    board,
    rankLines,
    reveal,
    // The friend always sees their own heads; everyone else waits for the reveal.
    doodle: (isFriend || showReveal) ? state.doodle : [],
    winnerIds: state.winnerIds || [],
    winnerNames: (state.winnerIds || []).map((x) => names[x] || '…'),
    shuffleKey: state.epoch + ':' + state.roundNo + ':' + state.dealNo + ':' + (state.shuffle ? state.shuffle.length : 0),
    history: state.history || [],
    sudden: (state.phase === 'sudden' && isFriend)
      ? state.sudden.candidates.map((wid) => ({ key: wid, text: state.sudden.lines[wid] || '', authorName: names[wid] || '…' }))
      : null,
  };
}

export function prune(state, goneId) {
  const inOrder = state.order.indexOf(goneId) >= 0;
  const inRound = state.writers.indexOf(goneId) >= 0 || has(state.lines, goneId) || state.friend === goneId;
  if (!inOrder && !inRound) return state;

  const s = clone(state);
  s.order = s.order.filter((x) => x !== goneId);
  if (s.phase === 'sudden') {
    s.sudden.candidates = s.sudden.candidates.filter((x) => x !== goneId);
    if (state.friend === goneId || s.sudden.candidates.length < 1 || s.order.length < MIN_SEATS) {
      return resetToLobby(s, true);
    }
    return s;
  }
  if (s.phase !== 'write' && s.phase !== 'rank') return s;   // lobby and results keep their shape
  if (s.order.length < MIN_SEATS) return resetToLobby(s, true);

  if (s.friend === goneId) {
    // The friend left: same word, new friend, lines start again, clock restarts.
    s.friend = s.order[s.roundNo % s.order.length];
    s.writers = s.order.filter((x) => x !== s.friend);
    s.lines = {};
    s.shuffle = null;
    s.tiers = null;
    s.rankOrder = null;
    s.doodle = [];
    s.dealNo += 1;
    s.phase = 'write';
    return s;
  }

  s.writers = s.writers.filter((x) => x !== goneId);
  delete s.lines[goneId];
  if (s.phase === 'rank') {
    s.shuffle = s.shuffle.filter((x) => x !== goneId);
  } else if (s.writers.every((w) => has(s.lines, w))) {
    s.phase = 'rank';
    s.shuffle = scrambled(s.writers, s.epoch + ':' + s.roundNo);
    s.tiers = null;
    s.rankOrder = null;
  }
  return s;
}

export function roundId(state) {
  return 'e' + state.epoch + 'r' + state.roundNo;
}

export function summarize(state, nameOf) {
  if ((state.phase !== 'roundover' && state.phase !== 'gameover') || !state.result) return null;
  const r = state.result;
  return nameOf(r.winner) + "'s line about \"" + r.word + '\" was the one ' + nameOf(r.friend) + ' wished they had thought of.';
}

// ---------------------------------------------------------------- view

function lipSvg(cls) {
  return '<svg class="' + cls + '" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
    + '<path class="lf" d="' + LIP_D + '"/><path class="ll" d="' + MOUTH_D + '"/></svg>';
}

// A shape button's little preview.
function shapeSvg(key, color) {
  const sh = SHAPES[key];
  return '<svg viewBox="0 0 200 100" aria-hidden="true" focusable="false"><path d="' + sh.d + '" fill="' + color
    + '" stroke="rgba(0,0,0,.5)" stroke-width="4"/>'
    + (sh.hole ? '<path d="' + sh.hole + '" fill="#2a0614"/>' : '')
    + (sh.line ? '<path d="' + sh.line + '" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="4"/>' : '')
    + '</svg>';
}

function lipTransform(l) {
  return 'translate(' + (HEAD_X[l.h] + l.x) + ',' + (HEAD_Y + l.y) + ') scale(' + l.s + ')';
}

function lipGroup(l, k, selected) {
  const sh = SHAPES[l.shape] || SHAPES.kiss;
  return '<g class="lipg' + (selected ? ' sel' : '') + '" data-k="' + k + '" transform="' + lipTransform(l) + '">'
    + '<rect class="hit" x="-110" y="-60" width="220" height="120"/>'
    + '<g transform="translate(-100,-50)">'
    + '<path class="lipfill" d="' + sh.d + '" fill="' + esc(l.color) + '"/>'
    + (sh.hole ? '<path class="liphole" d="' + sh.hole + '"/>' : '')
    + (sh.line ? '<path class="lipline" d="' + sh.line + '"/>' : '')
    + '</g></g>';
}

function eyeSvg(cx, cy, r, pr) {
  return '<g class="eye" data-m="' + (r - pr - 2) + '" transform="translate(' + cx + ',' + cy + ')">'
    + '<circle class="sclera" r="' + r + '"/><circle class="pupil" cx="0" cy="3" r="' + pr + '"/></g>';
}

function headSvg(h) {
  return '<g class="head" transform="translate(' + HEAD_X[h] + ',' + HEAD_Y + ')">'
    + '<path class="mq" d="M-24,66 L-30,128 L30,128 L24,66 Z"/>'
    + '<rect class="mq" x="-46" y="124" width="92" height="9" rx="4"/>'
    + '<ellipse class="mq" rx="62" ry="82"/>'
    + '<path class="seam" d="M0,-82 C-9,-30 -9,30 0,82"/>'
    + '<path class="mq" d="M0,-4 L-8,24 Q0,30 8,24 Z"/>'
    + eyeSvg(-25, -32, 18, 7) + eyeSvg(26, -34, 14, 6)
    + '</g>';
}

function sceneHtml(list, sel, scale) {
  scale = scale == null ? 1 : scale;
  let s = '<svg class="scene" viewBox="0 0 600 256" width="' + (600 * scale) + '" height="' + (256 * scale) + '" role="img" aria-label="Three mannequin heads with googly eyes">';
  for (let h = 0; h < HEADS; h++) s += headSvg(h);
  list.forEach((l, k) => { s += lipGroup(l, k, k === sel); });
  return s + '</svg>';
}

function scenePoint(svg, cx, cy) {
  const m = svg.getScreenCTM && svg.getScreenCTM();
  if (!m || !svg.createSVGPoint) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = cx;
  pt.y = cy;
  return pt.matrixTransform(m.inverse());
}

const DRIFT_SPOTS = [
  [4, 8, '#ff2a6d', 0], [78, 12, '#05d9e8', -4], [18, 60, '#ffe14d', -8], [72, 66, '#b967ff', -2],
  [44, 36, '#ff2a6d', -6], [88, 42, '#05d9e8', -10], [2, 40, '#b967ff', -3], [54, 86, '#ffe14d', -7],
];
const DRIFT = DRIFT_SPOTS.map(([x, y, c, d]) =>
  '<svg style="left:' + x + '%;top:' + y + '%;--c:' + c + ';animation-delay:' + d + 's" viewBox="0 0 200 100" preserveAspectRatio="none">'
  + '<path class="lf" d="' + LIP_D + '"/></svg>'
).join('');

const CONFETTI_SPOTS = [
  [2, 2.8, 28, '#ff2a6d', 0], [8, 3.4, 22, '#05d9e8', .3], [14, 2.6, 32, '#ffe14d', .8], [20, 3.8, 24, '#b967ff', .1],
  [26, 3.1, 30, '#ff9ec4', 1.1], [32, 2.9, 20, '#39ff88', .5], [38, 3.6, 34, '#ff2a6d', 1.5], [44, 2.7, 26, '#05d9e8', .2],
  [50, 3.3, 22, '#ffe14d', .9], [56, 2.5, 30, '#b967ff', 1.3], [62, 3.7, 24, '#ff9ec4', .4], [68, 2.8, 28, '#39ff88', 1.7],
  [74, 3.2, 20, '#ff2a6d', .6], [80, 2.6, 32, '#05d9e8', 1.0], [86, 3.5, 26, '#ffe14d', .15], [92, 2.9, 22, '#b967ff', 1.4],
  [5, 3.0, 18, '#39ff88', 1.9], [17, 3.9, 36, '#ff2a6d', .7], [29, 2.4, 24, '#05d9e8', 1.6], [41, 3.4, 28, '#ffe14d', 1.2],
  [53, 2.7, 20, '#b967ff', 2.0], [65, 3.6, 34, '#ff9ec4', .45], [77, 2.8, 22, '#ff2a6d', 1.8], [89, 3.1, 30, '#39ff88', .85], [97, 3.3, 26, '#05d9e8', 2.2],
];
const CONFETTI = '<div class="confetti" aria-hidden="true">' + CONFETTI_SPOTS.map(([x, dur, w, c, d]) =>
  '<svg style="left:' + x + '%;--dur:' + dur + 's;--w:' + w + 'px;--c:' + c + ';animation-delay:' + d + 's" viewBox="0 0 200 100" preserveAspectRatio="none">'
  + '<path class="lf" d="' + LIP_D + '"/><path class="ll" d="' + MOUTH_D + '"/></svg>'
).join('') + '</div>';

const CSS = `
*{box-sizing:border-box}
.sign{position:relative;overflow:hidden;min-height:520px;padding:22px 16px 26px;background:#07030d;color:#fff5fa;font-family:"Arial Black",Impact,"Helvetica Neue",Arial,sans-serif;border:4px solid #ff2a6d;box-shadow:0 0 18px #ff2a6d,inset 0 0 40px rgba(255,42,109,.25)}
.sign::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;background:repeating-linear-gradient(to bottom,rgba(255,255,255,.035) 0 1px,transparent 1px 3px)}
.drift{position:absolute;inset:0;pointer-events:none;z-index:0}
.drift svg{position:absolute;width:64px;height:32px;opacity:.28;filter:drop-shadow(0 0 6px var(--c));animation:drift 14s ease-in-out infinite alternate}
.drift .lf{fill:none;stroke:var(--c);stroke-width:2;vector-effect:non-scaling-stroke}
@keyframes drift{from{transform:translate(0,0) rotate(-6deg)}to{transform:translate(16px,-20px) rotate(8deg)}}
.board{position:relative;z-index:1}
.title{margin:0 0 4px;font-size:clamp(30px,9vw,50px);line-height:1;text-transform:uppercase;letter-spacing:.04em;color:#fff;text-shadow:0 0 4px #fff,0 0 12px #ff2a6d,0 0 26px #ff2a6d,0 0 46px #ff2a6d;animation:flicker 5s infinite}
.title .lipsw{color:#05d9e8;text-shadow:0 0 4px #fff,0 0 12px #05d9e8,0 0 28px #05d9e8}
@keyframes flicker{0%,19%,21%,23%,25%,54%,56%,100%{opacity:1}20%,24%,55%{opacity:.55}}
.phrase{margin:6px 0 14px;font-size:clamp(17px,4.8vw,24px);line-height:1.25;text-transform:uppercase;text-shadow:0 0 6px #fff5fa}
.phrase b{color:#ffe14d;text-shadow:0 0 8px #ffe14d}
.phrase .w{color:#05d9e8;text-shadow:0 0 8px #05d9e8}
.tube{border:3px solid #05d9e8;box-shadow:0 0 10px #05d9e8,inset 0 0 14px rgba(5,217,232,.2);background:rgba(5,217,232,.04);padding:12px 14px;margin:10px 0}
.how{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.45;color:#fff5fa}
.tag{margin:8px 0 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c9b7d6}
textarea{display:block;width:100%;margin:10px 0 4px;min-height:84px;padding:12px;border-radius:0;font:700 18px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff5fa;background:#000;border:3px solid #ffe14d;box-shadow:0 0 10px #ffe14d;outline:none;resize:vertical;touch-action:manipulation}
textarea:focus{box-shadow:0 0 20px #ffe14d,0 0 4px #fff}
textarea::placeholder{color:#8f7aa0;font-weight:400}
.count{font:700 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#c9b7d6;margin:0 0 8px 0;text-align:right}
.count.at{color:#ffe14d;text-shadow:0 0 6px #ffe14d}
@media (max-width:600px){textarea{min-height:150px}.sign{padding-bottom:34px}}
.acts{display:flex;flex-wrap:wrap;gap:0 10px;align-items:center;margin-top:6px}
.lip{position:relative;display:inline-block;min-width:150px;min-height:64px;margin:4px 0;padding:0;border:0;background:transparent;color:#fff5fa;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;--neon:#ff2a6d}
.lip.big{min-height:84px}
.lip.big .lt{font-size:20px;padding:20px 32px}
.lipbg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 3px var(--neon)) drop-shadow(0 0 9px var(--neon))}
.lf{fill:rgba(20,2,12,.85);stroke:var(--neon);stroke-width:3;vector-effect:non-scaling-stroke;transition:fill .15s}
.ll{fill:none;stroke:var(--neon);stroke-width:2;vector-effect:non-scaling-stroke;opacity:.85}
.lt{position:relative;display:block;padding:16px 22px;font-size:15px;font-weight:900;line-height:1.15;letter-spacing:.06em;text-transform:uppercase;text-align:center;text-shadow:0 0 6px var(--neon)}
.lip:hover .lf{fill:rgba(60,4,26,.9)}
.lip:active{transform:scale(.93) translateY(2px)}
.lip:focus-visible{outline:2px dashed #fff;outline-offset:4px}
.lip[disabled]{opacity:.35;cursor:not-allowed;filter:grayscale(.7)}
.lip[disabled]:active{transform:none}
.plus{color:#ffe14d;font-size:20px;text-shadow:0 0 8px #ffe14d,0 0 22px #ffe14d;animation:flicker 1.6s infinite}
.kiss{display:inline-block;width:26px;height:13px;margin-right:8px;vertical-align:middle;filter:drop-shadow(0 0 3px #ff2a6d)}
.kiss .lf{fill:rgba(255,42,109,.35)}
.scores{margin-top:14px}
.chip{display:inline-flex;align-items:center;gap:6px;margin:4px 6px 4px 0;padding:4px 9px;border:2px solid #b967ff;box-shadow:0 0 6px #b967ff;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#fff5fa;--neon:#ff2a6d}
.chip.out{opacity:.45;border-style:dashed}
.chip.you{border-color:#ffe14d;box-shadow:0 0 6px #ffe14d}
.chip em{font-style:normal;color:#05d9e8;text-shadow:0 0 6px #05d9e8}
.chip b{color:#ffe14d;text-shadow:0 0 6px #ffe14d}
.mini{display:inline-block;width:24px;height:12px}
.status{margin-top:12px;min-height:1.3em;font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:#05d9e8;text-shadow:0 0 6px #05d9e8}
.status.warn{color:#ff2a6d;text-shadow:0 0 8px #ff2a6d}

/* the write clock */
.timer{display:flex;align-items:center;gap:12px;margin:10px 0}
.tbar{flex:1;height:16px;border:2px solid #ffe14d;box-shadow:0 0 8px #ffe14d;background:#000;overflow:hidden}
.tfill{display:block;height:100%;width:100%;background:#ffe14d;box-shadow:0 0 10px #ffe14d;transition:width .25s linear}
.tnum{min-width:2.2ch;text-align:right;font-size:30px;line-height:1;color:#ffe14d;text-shadow:0 0 10px #ffe14d}
.timer.hot .tbar{border-color:#ff2a6d;box-shadow:0 0 10px #ff2a6d}
.timer.hot .tfill{background:#ff2a6d;box-shadow:0 0 12px #ff2a6d}
.timer.hot .tnum{color:#ff2a6d;text-shadow:0 0 10px #ff2a6d;animation:flicker 1s infinite}

/* the tier list */
.tierlist{margin:10px 0;border:3px solid #b967ff;box-shadow:0 0 10px #b967ff;background:#120818}
.trow{display:flex;border-bottom:3px solid #07030d}
.trow:last-child{border-bottom:0}
.tlabel{flex:0 0 96px;display:flex;align-items:center;justify-content:center;padding:8px 6px;background:var(--neon);color:#07030d;font-size:12px;line-height:1.15;letter-spacing:.04em;text-transform:uppercase;text-align:center}
.oneslot{display:block;font-size:10px;line-height:1;text-transform:none;letter-spacing:0;opacity:.85;margin-top:2px}
.zone{flex:1;min-width:0;min-height:76px;display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start;padding:8px;transition:background .12s,box-shadow .12s}
.zone.hot{background:rgba(255,255,255,.1);box-shadow:inset 0 0 16px var(--neon,#fff)}
.zone.pool{min-height:64px;padding:8px 0 0}
.zone.top{max-height:128px;overflow:hidden}
.zone.top.full{border-color:#fff;box-shadow:0 0 14px #fff;background:rgba(255,255,255,.1)}
.zone.top.empty{border:2px dashed #ffe14d;box-shadow:0 0 14px #ffe14d;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.tchip{position:relative;max-width:100%;padding:8px 10px;border:2px solid var(--neon,#b967ff);background:rgba(20,2,12,.94);box-shadow:0 0 6px var(--neon,#b967ff);font:700 15px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;overflow-wrap:anywhere;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}
.tchip.dragging{opacity:.3}
.tchip.picked{outline:2px dashed #fff;outline-offset:2px}
.tchip.before::before{content:"";position:absolute;left:-7px;top:-2px;bottom:-2px;width:4px;background:#fff;box-shadow:0 0 8px #fff}
.tchip.ghost{position:absolute;z-index:20;pointer-events:none;opacity:.94;transform:rotate(-2deg) scale(1.04);box-shadow:0 0 18px #fff,0 12px 22px rgba(0,0,0,.6)}
.tchip.rv{cursor:default;touch-action:auto}
.tchip.top{border-color:#ffe14d;box-shadow:0 0 14px #ffe14d}
.tchip .au{display:block;margin-top:4px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#ffe14d}

/* the mannequins */
.scene{display:block;width:100%;height:auto;margin:8px 0;background:radial-gradient(ellipse at 50% 100%,rgba(185,103,255,.28),transparent 70%)}
.mq{fill:#e8dfd6;stroke:#6d5a66;stroke-width:2}
.seam{fill:none;stroke:#b8aaa5;stroke-width:1.5;stroke-dasharray:4 5}
.sclera{fill:#fff;stroke:#222;stroke-width:2}
.pupil{fill:#111}
.lipg{cursor:grab;touch-action:none}
.lipg .hit{fill:transparent;stroke:none}
.lipg.sel .hit{stroke:#fff;stroke-width:2;stroke-dasharray:6 5;vector-effect:non-scaling-stroke;fill:rgba(255,255,255,.07)}
.lipfill{stroke:rgba(0,0,0,.45);stroke-width:3;vector-effect:non-scaling-stroke}
.lipline{fill:none;stroke:rgba(0,0,0,.55);stroke-width:2;vector-effect:non-scaling-stroke}
.liphole{fill:#2a0614}
.fctl{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-top:6px}
.fgroup{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.fbtn,.sbtn,.swatch{font:inherit;cursor:pointer;color:#fff5fa;background:#000;border:2px solid #05d9e8;box-shadow:0 0 6px #05d9e8;touch-action:manipulation}
.fbtn{padding:8px 12px;font-size:12px;letter-spacing:.05em;text-transform:uppercase}
.sbtn{width:48px;height:32px;padding:3px}
.sbtn svg{display:block;width:100%;height:100%}
.swatch{width:26px;height:26px;padding:0;border-radius:50%}
.sbtn.on,.swatch.on{border-color:#ffe14d;box-shadow:0 0 10px #ffe14d}
.fctl [disabled]{opacity:.35;cursor:not-allowed}
.fctl input[type=range]{flex:1;min-width:130px;accent-color:#ff2a6d}
.fctl input[type=color]{width:36px;height:30px;padding:0;border:2px solid #05d9e8;background:#000}
.confetti{position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden}
.confetti svg{position:absolute;top:-12%;width:var(--w);height:auto;opacity:.95;filter:drop-shadow(0 0 6px var(--c));animation:lipfall var(--dur) linear infinite}
.confetti .lf{fill:var(--c);stroke:rgba(255,255,255,.35);stroke-width:3;vector-effect:non-scaling-stroke}
.confetti .ll{fill:none;stroke:rgba(0,0,0,.28);stroke-width:2;vector-effect:non-scaling-stroke}
@keyframes lipfall{0%{transform:translateY(-10vh) rotate(0deg)}25%{transform:translateY(28vh) translateX(10px) rotate(90deg)}50%{transform:translateY(62vh) translateX(-10px) rotate(180deg)}75%{transform:translateY(96vh) translateX(8px) rotate(270deg)}100%{transform:translateY(125vh) translateX(-6px) rotate(360deg)}}
.matchwin{border-color:#ffe14d;box-shadow:0 0 16px #ffe14d,inset 0 0 18px rgba(255,225,77,.14);text-align:center}
.winnername{margin:2px 0 6px;font-size:clamp(26px,7vw,40px);line-height:1.1;color:#ffe14d;text-shadow:0 0 10px #ffe14d,0 0 24px #ff2a6d}
.goal{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c9b7d6}
@media (prefers-reduced-motion:reduce){.title,.plus,.drift svg,.timer.hot .tnum,.confetti svg{animation:none}.tfill{transition:none}.confetti svg{top:auto;bottom:8%;opacity:.5}}
`;

export function mount(root, api) {
  root.innerHTML = '<style>' + CSS + '</style>'
    + '<div class="sign"><div class="drift" aria-hidden="true">' + DRIFT + '</div><div id="lips-confetti"></div><div class="board"></div></div>';
  const boardEl = root.querySelector('.board');
  const confettiEl = root.querySelector('#lips-confetti');
  const signEl = root.querySelector('.sign');
  const doc = root.ownerDocument || document;
  const win = doc.defaultView || window;

  let view = null;
  let draft = null;        // the line box as typed; null means untouched, show my line
  let roundKey = null;     // resets local drafts when the round changes
  let shuffleKey = null;   // resets the friend's ranking when the lines change
  let note = '';           // a local message for a click refused before sending

  let tl = null;           // the friend's tier list draft: { pool: [i], rows: { 0: [i], 1: [i], 2: [i] } }
  let picked = -1;         // a line tapped (not dragged), waiting for a tier to be tapped

  let lips = null;        // the friend's mannequin lips, held here and saved to the table
  let selLip = -1;
  let fidgetEl = null;     // lives across re-renders so the sliders never get yanked mid-drag
  let saveT = null;

  let dealKey = null;      // the clock restarts when this changes
  let writeStart = 0;
  let autoSent = false;
  let timeUpSent = false;

  let drag = null;         // a line or a lip being dragged
  let busy = false;        // true while a finger is down on something draggable
  let busySince = 0;
  let dirty = false;       // a view arrived while busy
  let joinTries = 0;
  let joinTimer = null;
  let eyeFrame = 0;
  let lastPtr = null;
  let ticker = null;
  let scroller = null;
  let renderedPhase = null;

  // ------------------------------------------------------------ pieces

  function lip(label, act, o) {
    o = o || {};
    let attrs = ' data-act="' + act + '"';
    if (o.disabled) attrs += ' disabled';
    const cls = 'lip' + (o.big ? ' big' : '');
    return '<button class="' + cls + '"' + attrs + '>' + lipSvg('lipbg')
      + '<span class="lt">' + label + '</span></button>';
  }

  function timerHtml() {
    return '<div class="timer"><div class="tbar"><i class="tfill" id="tfill"></i></div>'
      + '<span class="tnum" id="tnum">' + view.writeSec + '</span></div>';
  }

  // ------------------------------------------------------------ tier list

  function freshTL(n) {
    const pool = [];
    for (let i = 0; i < n; i++) pool.push(i);
    return { pool, rows: { 0: [], 1: [], 2: [] } };
  }

  function listFor(z) { return z === 'pool' ? tl.pool : tl.rows[z]; }

  function whereIs(i) {
    if (tl.pool.indexOf(i) >= 0) return 'pool';
    for (let k = 0; k < TIER_ORDER.length; k++) {
      if (tl.rows[TIER_ORDER[k]].indexOf(i) >= 0) return String(TIER_ORDER[k]);
    }
    return 'pool';
  }

  // Move line i into zone z at position idx. The top tier holds one line: if it
  // is taken, the old one goes back to where the new one came from.
  function placeChip(i, z, idx) {
    const from = whereIs(i);
    const src = listFor(from);
    src.splice(src.indexOf(i), 1);
    const dst = listFor(z);
    if (z === String(WISH) && dst.length >= 1) {
      dst.splice(0, dst.length).forEach((o) => src.push(o));
    }
    const at = clamp(idx == null ? dst.length : idx, 0, dst.length);
    dst.splice(at, 0, i);
  }

  function rankCounts() {
    const n = (view.rankLines || []).length;
    return { n, set: tl ? n - tl.pool.length : 0, wishes: tl ? tl.rows[WISH].length : 0 };
  }

  function chipHtml(i, text) {
    return '<div class="tchip' + (picked === i ? ' picked' : '') + '" data-i="' + i + '">' + lipSvg('kiss') + esc(text) + '</div>';
  }

  function tierRows(chipsFor, editable, full, empty) {
    full = full || new Set();
    return '<div class="tierlist">' + TIER_ORDER.map((t) => {
      const T = TIERS[t];
      const label = editable && t === WISH ? esc(T.label) + ' <span class="oneslot">one slot only</span>' : esc(T.label);
      const wishFull = t === WISH && full.has(t);
      const wishEmpty = t === WISH && empty;
      return '<div class="trow" style="--neon:' + T.color + '"><div class="tlabel">' + label + '</div>'
        + '<div class="zone top' + (wishFull ? ' full' : '') + (wishEmpty ? ' empty' : '') + '"' + (editable ? ' data-zone="' + t + '"' : '') + '>' + chipsFor(t) + '</div></div>';
    }).join('') + '</div>';
  }

  // ------------------------------------------------------------ mannequins

  function controlsHtml() {
    const l = selLip >= 0 ? lips[selLip] : null;
    const off = l ? '' : ' disabled';
    const shapes = SHAPE_KEYS.map((k) => '<button type="button" class="sbtn' + (l && l.shape === k ? ' on' : '')
      + '" data-f="shape" data-v="' + k + '" title="' + k + '"' + off + '>' + shapeSvg(k, l ? l.color : '#ff2a6d') + '</button>').join('');
    const swatches = PALETTE.map((c) => '<button type="button" class="swatch' + (l && l.color === c ? ' on' : '')
      + '" data-f="color" data-v="' + c + '" style="background:' + c + '" aria-label="colour ' + c + '"' + off + '></button>').join('');
    return '<div class="fctl">'
      + '<div class="fgroup"><button type="button" class="fbtn" data-f="add"' + (lips.length >= MAX_LIPS ? ' disabled' : '') + '>+ Add lips</button>'
      + '<button type="button" class="fbtn" data-f="del"' + off + '>Remove</button></div>'
      + '<div class="fgroup">' + shapes + '</div>'
      + '<div class="fgroup">' + swatches + '<input type="color" data-f="pick" value="' + (l ? l.color : '#ff2a6d') + '"' + off + '></div>'
      + '<div class="fgroup" style="flex:1 1 100%"><span class="tag" style="margin:0">size</span>'
      + '<input type="range" data-f="size" min="15" max="120" value="' + (l ? Math.round(l.s * 100) : 45) + '"' + off + '></div>'
      + '</div>';
  }

  function fidgetRender() {
    fidgetEl.innerHTML = '<div class="tube"><p class="how">While you wait: stick lips on the mannequins. '
      + 'Drag them anywhere, even the forehead. Everyone sees them at the reveal.</p>'
      + sceneHtml(lips, selLip, 0.5) + controlsHtml() + '</div>';
  }

  function ensureFidget() {
    if (fidgetEl) return;
    fidgetEl = doc.createElement('div');
    if (lips === null) lips = clone(view.doodle || []);
    fidgetRender();
  }

  function queueSave() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { if (lips) api.send({ a: 'doodle', lips: lips.slice() }); }, 400);
  }

  function fidgetClick(btn) {
    const f = btn.getAttribute('data-f');
    const v = btn.getAttribute('data-v');
    if (f === 'add') {
      if (lips.length >= MAX_LIPS) return;
      lips.push({ h: lips.length % HEADS, x: 0, y: 38, s: 0.45, shape: 'kiss', color: PALETTE[lips.length % PALETTE.length] });
      selLip = lips.length - 1;
    } else if (selLip >= 0) {
      if (f === 'del') { lips.splice(selLip, 1); selLip = -1; }
      else if (f === 'shape') lips[selLip].shape = v;
      else if (f === 'color') lips[selLip].color = v;
    }
    fidgetRender();
    queueSave();
  }

  function fidgetInput(el) {
    if (selLip < 0 || !lips[selLip]) return;
    const f = el.getAttribute('data-f');
    const l = lips[selLip];
    const g = fidgetEl.querySelector('.lipg.sel');
    if (f === 'size') {
      l.s = clamp(Number(el.value) / 100, 0.15, 1.2);
      if (g) g.setAttribute('transform', lipTransform(l));
    } else if (f === 'pick') {
      l.color = String(el.value).toLowerCase();
      if (g) g.querySelector('.lipfill').setAttribute('fill', l.color);
      fidgetEl.querySelectorAll('.swatch').forEach((sw) => sw.classList.toggle('on', sw.getAttribute('data-v') === l.color));
    } else return;
    queueSave();
  }

  // The googly eyes follow whatever you are pointing with.
  function lookAll() {
    eyeFrame = 0;
    if (!lastPtr) return;
    root.querySelectorAll('.eye').forEach((eye) => {
      const sc = eye.querySelector('.sclera');
      const pu = eye.querySelector('.pupil');
      if (!sc || !pu) return;
      const r = sc.getBoundingClientRect();
      const dx = lastPtr.x - (r.left + r.width / 2);
      const dy = lastPtr.y - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const m = Number(eye.getAttribute('data-m')) || 6;
      const k = (Math.min(1, dist / 60) * m) / dist;
      pu.setAttribute('transform', 'translate(' + (dx * k).toFixed(1) + ',' + (dy * k).toFixed(1) + ')');
    });
  }

  // ------------------------------------------------------------ bodies

  function roundLabel() {
    return 'Round ' + (view.roundNo + 1) + ' of ' + view.matchRounds;
  }

  function statusText() {
    const v = view;
    if (v.phase === 'lobby') {
      return v.seatCount + ' seated' + (v.seatCount < MIN_SEATS ? ' · need ' + MIN_SEATS + ' to start' : ' · ready for ' + v.matchRounds + ' liprounds');
    }
    if (v.phase === 'write') {
      return 'LipRound ' + (view.roundNo + 1) + ' of ' + view.matchRounds + ' · ' + v.writtenCount + ' of ' + v.writersTotal + ' lips in [· yours is in]';
    }
    if (v.phase === 'rank') return 'LipRound ' + (view.roundNo + 1) + ' of ' + view.matchRounds + ' · ' + (v.isFriend ? 'Drag every lip into a tier, then lick the top one.' : view.friendName + ' is ranking.');
    if (v.phase === 'roundover') return 'LipRound ' + (v.roundNo + 1) + ' of ' + view.matchRounds + ' complete.';
    if (v.phase === 'gameover') return 'Flapping complete · ' + view.matchRounds + ' liprounds played.';
    return '';
  }

function lobbyBody() {
    const v = view;
    const ready = v.seatCount >= MIN_SEATS;
    let b = '<div class="tube"><p class="how">The table plays <b>' + v.matchRounds + ' liprounds</b>. Each lipround, everyone lips the one lip one friend would lip about a word. The friend ranks the lips. The lip they wish they had thought of gets <b>1 point</b>. After ' + v.matchRounds + ' liprounds, the most lips wins.</p></div>';
    const who = v.seated.map((p) => '<span class="chip' + (p.you ? ' you' : '') + '">' + lipSvg('mini') + esc(p.name)
      + (p.you ? ' <em>you</em>' : '') + '</span>').join('');
    b += '<div class="tube"><div class="tag" style="margin:0 0 6px">Seated · ' + v.seatCount + ' of ' + MIN_SEATS + ' needed · Goal: most lips after ' + v.matchRounds + ' liprounds</div>'
      + (who || '<span class="tag">nobody yet</span>')
      + (ready ? '' : '<p class="tag">Anyone at the table who is not listed here should press "Sit in".</p>') + '</div>';
    b += '<div class="acts">';
    if (v.canJoin) b += lip('Sit in', 'join');
    if (api.isHost) {
      b += lip(ready ? 'Start flapping the lips (' + v.matchRounds + ' liprounds)' : 'Need ' + (MIN_SEATS - v.seatCount) + ' more', 'start', { big: true, disabled: !ready });
    } else b += '<p class="tag">The host will start the lipflaps.</p>';
    return b + '</div>';
  }

  function writeBody() {
    const v = view;
    const again = v.redeals > 0 ? '<p class="tag" style="margin:0 0 6px">Nobody wrote in time. Fresh word, fresh clock.</p>' : '';
    if (v.isFriend) {
      return timerHtml() + again
        + '<div class="tube"><p class="how">Everyone is thinking about your lips. You just sit here and wait.</p>'
        + '<p class="tag">' + v.writtenCount + ' of ' + v.writersTotal + ' lips in</p></div>'
        + '<div class="acts">' + lip('Call time', 'calltime', { big: true }) + '</div>'
        + '<div id="fidget-slot"></div>';
    }
    if (v.isWriter) {
      return timerHtml() + again
        + '<div class="tube"><p class="how">What would ' + esc(v.friendName) + ' say about '
        + esc(v.word) + '? </p>'
        + '<textarea id="draft" maxlength="' + MAX_LINE + '" rows="2" placeholder="what they would say"></textarea>'
        + '<div id="linecount" class="count">0/' + MAX_LINE + '</div>'
        + '<div class="acts">' + lip(v.myLine ? 'Change my lips' : 'Lip It', 'say', { big: true }) + '</div></div>';
    }
    if (v.isSeated) {
      return timerHtml()
        + '<div class="tube"><p class="how">You are lipping this round out. You are in from the next one.</p>'
        + '<p class="tag">' + v.writtenCount + ' of ' + v.writersTotal + ' lines in</p></div>';
    }
    return timerHtml()
      + '<div class="tube"><p class="how">Watching. Lip in to write from the next round.</p>'
      + (v.canJoin ? '<div class="acts">' + lip('Put your lips in', 'join') + '</div>' : '') + '</div>';
  }

  function rankBody() {
    const v = view;
    if (v.phase === 'sudden') {
      if (!v.isFriend) {
        return '<div class="tube"><p class="how">LipRound complete with a tie at the top. '
          + esc(v.friendName) + ' is breaking it.</p></div>';
      }
      const list = (v.sudden || []).map((c) =>
        '<button class="lip big" data-act="suddenwin" data-v="' + c.key + '">'
        + esc(c.text) + ' <span class="au">— ' + esc(c.authorName) + '</span></button>').join('');
      const names = (v.sudden || []).map((c) => esc(c.authorName)).join(' and ');
      return '<div class="tube"><p class="how">Sudden death: tied between ' + names
        + '. Pick the line you wish you had thought of.</p></div>' + list;
    }
    if (!v.isFriend) {
      return '<div class="tube"><p class="how">' + esc(v.friendName)
        + ' is ranking the lines. They stay hidden until the reveal.</p></div>';
    }
    if (!tl) tl = freshTL((v.rankLines || []).length);
    const text = {};
    (v.rankLines || []).forEach((l) => { text[l.key] = l.text; });
    const full = new Set();
    const empty = c.wishes === 0;
    if (tl.rows[WISH].length) full.add(WISH);
    const board = tierRows((t) => tl.rows[t].map((i) => chipHtml(i, text[i])).join(''), true, full, empty);
    const pool = '<div class="tube"><div class="tag" style="margin:0">Unranked · drag each line up into a tier</div>'
      + '<div class="zone pool" data-zone="pool">' + tl.pool.map((i) => chipHtml(i, text[i])).join('') + '</div></div>';
    const c = rankCounts();
    const ok = c.set === c.n && c.wishes === 1;
    const hint = c.wishes === 0 ? 'The top lip hasn\'t been licked. Flip a lip up there. You can’t lip-tinue until there is a lip up there that you wish you licked.'
      : c.set === c.n ? 'Ready.' : 'Ranked ' + c.set + ' of ' + c.n + '.';
    return '<div class="tube"><p class="how">Drag each line into a tier. The top tier holds just one. '
      + 'You can also tap a line, then tap a tier.</p></div>'
      + board + pool
      + '<div class="acts">' + lip('Lick the top lip', 'crown', { big: true, disabled: !ok }) + '</div>'
      + '<p class="tag">' + hint + '</p>';
  }

  function revealBoard() {
    const v = view;
    const by = { 0: [], 1: [], 2: [] };
    (v.reveal || []).slice().sort((a, b) => a.pos - b.pos).forEach((l) => by[l.tier].push(l));
    return tierRows((t) => by[t].map((l) => '<div class="tchip rv' + (t === WISH ? ' top' : '') + '">'
      + lipSvg('kiss') + esc(l.text) + '<span class="au">' + esc(l.authorName)
      + (t === WISH ? ' · +1 point' : '') + '</span></div>').join(''), false);
  }

  function revealHeads() {
    const v = view;
    return (v.doodle && v.doodle.length)
      ? '<div class="tube"><p class="how">' + esc(v.friendName) + ' lipped the mannequins while they waited.</p>'
        + sceneHtml(v.doodle, -1, 1) + '</div>'
      : '';
  }

  function roundOverBody() {
    const v = view;
    const left = v.matchRounds - (v.roundNo + 1);
    const acts = api.isHost
      ? '<div class="acts">' + lip(left === 1 ? 'Final lipround' : 'Next lipround', 'start', { big: true, disabled: v.seatCount < MIN_SEATS })
        + lip('Back to lobby', 'toLobby') + '</div>'
      : '<p class="tag">The host will start the next lipround.</p>';
    return '<div class="tube"><p class="how"><b>LipRound ' + (v.roundNo + 1) + ' of ' + v.matchRounds + ' complete.</b> '
      + left + (left === 1 ? ' lipround' : ' liprounds') + ' left. Most points after ' + v.matchRounds + ' liprounds wins.</p></div>'
      + revealBoard() + revealHeads() + acts;
  }

  function winnerText() {
    const names = view.winnerNames || [];
    if (names.length === 1) return esc(names[0]) + ' wins the match!';
    if (names.length > 1) return 'Lip tie! ' + esc(names.join(' and ')) + ' win!';
    return 'Match complete!';
  }

  function gameOverBody() {
    const v = view;
    const acts = api.isHost
      ? '<div class="acts">' + lip('Play again (' + v.matchRounds + ' liprounds)', 'start', { big: true, disabled: v.seatCount < MIN_SEATS })
        + lip('Back to lippy', 'toLobby') + '</div>'
      : '<p class="tag">The host can play again or go back to the lippy.</p>';
    const dl = '<div class="acts"><button class="lip big" data-act="savelines">Save winning lines as .txt</button></div>';
    return '<div class="tube matchwin"><p class="goal">After ' + v.matchRounds + ' liprounds</p>'
      + '<div class="winnername">' + winnerText() + '</div>'
      + '<p class="how" style="margin:0">Final lips are on the lip table below.</p></div>'
      + dl + revealBoard() + revealHeads() + acts;
  }

  function saveWinningLines() {
    const hs = view.history || [];
    if (!hs.length) { note = 'No winning lines to save.'; render(); return; }
    const para = hs.map((h) => esc(h.winnerName) + ' got ' + esc(h.friendName)
      + ' to wish they said "' + esc(h.line) + '".').join(' ');
    const blob = new Blob([para], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url; a.download = 'lips-winning-lines.txt';
    boardEl.appendChild(a); a.click(); a.remove();
    win.setTimeout(() => URL.revokeObjectURL(url), 5000);
    note = 'Saved winning lines to lips-winning-lines.txt.';
    render();
  }

  function scoreBody() {
    const v = view;
    if (!v.board.length) return '';
    const winSet = {};
    if (v.phase === 'gameover') (v.winnerIds || []).forEach((id) => { winSet[id] = true; });
    const chips = v.board.map((p) => '<span class="chip' + (p.seated ? '' : ' out') + (winSet[p.id] ? ' you' : '') + '">'
      + lipSvg('mini') + esc(p.name)
      + (p.friend && v.phase !== 'lobby' && v.phase !== 'gameover' ? ' <em>friend</em>' : '')
      + (winSet[p.id] ? ' <em>flap winner</em>' : '')
      + ' <b>' + p.points + '</b></span>').join('');
    const goal = v.phase === 'lobby' ? 'Goal: most lips after ' + v.matchRounds + ' liprounds'
      : v.phase === 'gameover' ? 'Final score after ' + v.matchRounds + ' liprounds'
      : 'LipRound ' + (v.roundNo + 1) + ' of ' + v.matchRounds + ' · Goal: most lips wins';
    return '<div class="tube scores"><div class="tag">' + esc(goal) + '</div>' + chips + '</div>';
  }

  function page() {
    const v = view;
    const phrase = v.phase === 'gameover'
      ? 'Match complete after <b>' + v.matchRounds + '</b> liprounds.'
      : v.word
      ? 'Say what <b>' + esc(v.friendName || '…') + '</b> would say about <span class="w">' + esc(v.word) + '</span>.'
      : 'Say what <b>______</b> would say about <span class="w">______</span>.';
    let body = '';
    if (v.phase === 'lobby') body = lobbyBody();
    else if (v.phase === 'write') body = writeBody();
    else if (v.phase === 'rank') body = rankBody();
    else if (v.phase === 'roundover') body = roundOverBody();
    else if (v.phase === 'gameover') body = gameOverBody();
    const status = note ? '<div class="status warn">' + esc(note) + '</div>'
      : '<div class="status">' + esc(statusText()) + '</div>';
    return '<h1 class="title"><span>I\'m your</span> <span class="lipsw">lips</span></h1>'
      + '<div class="phrase">' + phrase + '</div>'
      + body + scoreBody() + status;
  }

  // ------------------------------------------------------------ render

  function render() {
    if (!view) {
      boardEl.innerHTML = '<div class="status">Warming up the lips…</div>';
      if (confettiEl) confettiEl.innerHTML = '';
      return;
    }
    renderedPhase = view.phase;
    const rk = view.epoch + ':' + view.roundNo + ':' + view.phase;
    if (rk !== roundKey) {
      roundKey = rk;
      draft = null;
      tl = null;
      picked = -1;
      lips = null;
      selLip = -1;
      fidgetEl = null;
      clearTimeout(saveT);
    }
    if (view.shuffleKey !== shuffleKey) { shuffleKey = view.shuffleKey; tl = null; picked = -1; }

    // Re-rendering must not eat a line someone is typing.
    const hadFocus = root.activeElement && root.activeElement.id === 'draft';
    const old = boardEl.querySelector('#draft');
    const sel = (hadFocus && old) ? [old.selectionStart, old.selectionEnd] : null;

    boardEl.innerHTML = page();
    if (confettiEl) confettiEl.innerHTML = view.phase === 'gameover' ? CONFETTI : '';
    const ta = boardEl.querySelector('#draft');
    if (ta) {
      ta.value = draft == null ? (view.myLine || '') : draft;
      const ce = boardEl.querySelector('#linecount');
      if (ce) {
        ce.textContent = ta.value.length + '/' + MAX_LINE;
        ce.classList.toggle('at', ta.value.length >= MAX_LINE);
      }
      if (hadFocus) {
        ta.focus();
        if (sel) ta.setSelectionRange(sel[0], sel[1]);
      }
    }
    // The mannequin panel is a living node: move it back in rather than rebuild it.
    const slot = boardEl.querySelector('#fidget-slot');
    if (slot) {
      ensureFidget();
      slot.replaceWith(fidgetEl);
    }
    tick();
    if (eyeFrame === 0 && lastPtr) eyeFrame = win.requestAnimationFrame(lookAll);
  }

  // ------------------------------------------------------------ the clock

  function tick() {
    if (!view || view.phase !== 'write') return;
    const total = view.writeSec * 1000;
    const spent = Date.now() - writeStart;
    const left = Math.max(0, total - spent);
    const num = boardEl.querySelector('#tnum');
    const fill = boardEl.querySelector('#tfill');
    const box = boardEl.querySelector('.timer');
    if (num) num.textContent = String(Math.ceil(left / 1000));
    if (fill) fill.style.width = (left / total * 100) + '%';
    if (box) box.classList.toggle('hot', left <= 10000);
    if (left > 0) return;

    // Out of time: whatever is typed but unsent goes in.
    if (view.isWriter && !autoSent) {
      autoSent = true;
      const t = clean(draft == null ? '' : draft).slice(0, MAX_LINE);
      if (t && t !== view.myLine) { try { api.send({ a: 'line', text: t }); } catch (e) {} }
    }
    // Anyone at the table can call time once the clock has run out; retry until the phase changes.
    if ((api.isHost || view.isFriend) && spent - total >= (api.isHost ? 1500 : 1000)) {
      note = 'Calling time…';
      try { api.send({ a: 'timeUp' }); } catch (e) {}
    }
  }

  // ------------------------------------------------------------ seating

  // Everyone at the table gets seated automatically. If the first try does not
  // land, one more goes out a moment later.
  function ensureSeat() {
    if (!view || !view.canJoin || joinTries >= 2) return;
    joinTries += 1;
    api.send({ a: 'join' });
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => { if (view && view.canJoin) ensureSeat(); }, 2500);
  }

  // ------------------------------------------------------------ drag

  function holdBusy() { busy = true; busySince = Date.now(); }

  // Let go of the hold. A view that arrived meanwhile, or a finished drag, rebuilds the page.
  function releaseBusy(force) {
    busy = false;
    if (dirty || force) {
      dirty = false;
      renderedPhase = view ? view.phase : null;
      render();
    }
  }

  function hitRoot() { return typeof root.elementsFromPoint === 'function' ? root : doc; }

  function zoneAt(x, y) {
    const els = hitRoot().elementsFromPoint(x, y);
    for (let k = 0; k < els.length; k++) {
      const z = els[k].closest ? els[k].closest('[data-zone]') : null;
      if (z && boardEl.contains(z)) return z;
    }
    return null;
  }

  function insertAt(zone, x, y, skip) {
    const chips = Array.prototype.filter.call(zone.querySelectorAll('.tchip'),
      (c) => Number(c.getAttribute('data-i')) !== skip);
    for (let k = 0; k < chips.length; k++) {
      const r = chips[k].getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return { index: k, before: chips[k] };
    }
    return { index: chips.length, before: null };
  }

  function clearHot() {
    boardEl.querySelectorAll('.hot,.before').forEach((el) => { el.classList.remove('hot'); el.classList.remove('before'); });
  }

  function startChipDrag(e, el) {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.remove('picked');
    ghost.classList.add('ghost');
    ghost.style.width = r.width + 'px';
    signEl.appendChild(ghost);
    el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: window listeners still work */ }
    drag = {
      kind: 'chip', pid: e.pointerId, i: Number(el.getAttribute('data-i')), el, ghost,
      dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      moved: false, z: null, idx: null,
    };
    holdBusy();
    moveChip();
    scroller = setInterval(() => {
      if (!drag || drag.kind !== 'chip') return;
      const dy = drag.y < 70 ? -14 : (drag.y > win.innerHeight - 70 ? 14 : 0);
      if (dy) { win.scrollBy(0, dy); moveChip(); }
    }, 30);
  }

  function moveChip() {
    const d = drag;
    const sr = signEl.getBoundingClientRect();
    d.ghost.style.left = (d.x - d.dx - sr.left - signEl.clientLeft) + 'px';
    d.ghost.style.top = (d.y - d.dy - sr.top - signEl.clientTop) + 'px';
    clearHot();
    const z = d.moved ? zoneAt(d.x, d.y) : null;
    if (z) {
      z.classList.add('hot');
      const at = insertAt(z, d.x, d.y, d.i);
      d.z = z.getAttribute('data-zone');
      d.idx = at.index;
      if (at.before) at.before.classList.add('before');
    } else { d.z = null; d.idx = null; }
  }

  function endChip(cancel) {
    const d = drag;
    drag = null;
    clearInterval(scroller);
    d.ghost.remove();
    d.el.classList.remove('dragging');
    clearHot();
    if (!cancel) {
      if (!d.moved) picked = picked === d.i ? -1 : d.i;        // a tap picks the line up
      else if (d.z !== null) { placeChip(d.i, d.z, d.idx); picked = -1; note = ''; }
    }
    releaseBusy(true);
  }

  function startLipDrag(e, g) {
    e.preventDefault();
    const k = Number(g.getAttribute('data-k'));
    if (!lips[k]) return;
    // Bring it to the front. The DOM stays put until the drop so the pointer capture holds.
    lips.push(lips.splice(k, 1)[0]);
    selLip = lips.length - 1;
    fidgetEl.querySelectorAll('.lipg.sel').forEach((x) => x.classList.remove('sel'));
    g.classList.add('sel');
    try { g.setPointerCapture(e.pointerId); } catch (err) { /* see above */ }
    drag = { kind: 'lip', pid: e.pointerId, g, svg: g.ownerSVGElement, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    holdBusy();
  }

  function moveLip() {
    const d = drag;
    const p = scenePoint(d.svg, d.x, d.y);
    const h = clamp(Math.floor(p.x / 200), 0, HEADS - 1);
    const l = lips[selLip];
    l.h = h;
    l.x = Math.round(clamp(p.x - HEAD_X[h], -64, 64));
    l.y = Math.round(clamp(p.y - HEAD_Y, -84, 84));
    d.g.setAttribute('transform', lipTransform(l));
  }

  function endLip(cancel) {
    const d = drag;
    drag = null;
    busy = false;
    dirty = false;
    if (!cancel) queueSave();
    // Rebuild the panel so the controls follow the selected lip.
    if (fidgetEl) fidgetRender();
    render();
    return d;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const chip = t.closest('.tchip[data-i]');
    if (chip && view && view.phase === 'rank' && view.isFriend && tl && !drag) { startChipDrag(e, chip); return; }
    const lg = t.closest('.lipg[data-k]');
    if (lg && fidgetEl && fidgetEl.contains(lg) && !drag) { startLipDrag(e, lg); return; }
  }

  function onPointerMove(e) {
    lastPtr = { x: e.clientX, y: e.clientY };
    if (!eyeFrame) eyeFrame = win.requestAnimationFrame(lookAll);
    if (!drag || e.pointerId !== drag.pid) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.moved && Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > 6) drag.moved = true;
    if (drag.kind === 'chip') moveChip();
    else if (drag.moved) moveLip();
  }

  function onPointerUp(e) {
    if (drag && e.pointerId === drag.pid) {
      if (drag.kind === 'chip') endChip(e.type === 'pointercancel');
      else endLip(e.type === 'pointercancel');
      return;
    }
    if (busy) releaseBusy();
  }

  function onTouchMove(e) {
    if (drag && e.cancelable) e.preventDefault();   // keep the page still while something is being dragged
  }

  // ------------------------------------------------------------ actions

  function submitLine() {
    const raw = draft == null ? (view && view.myLine) || '' : draft;
    const text = clean(raw);
    if (!text) {
      note = 'Write something first.';
      render();
      return;
    }
    api.send({ a: 'line', text: text });
  }

  function crown() {
    if (!tl || tl.pool.length || tl.rows[WISH].length !== 1) return;
    const tiers = [];
    const order = [];
    TIER_ORDER.forEach((t) => tl.rows[t].forEach((i) => { tiers[i] = t; order.push(i); }));
    api.send({ a: 'rank', tiers, order });
  }

  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const fb = t.closest('button[data-f]');
    if (fb) {
      if (!fb.disabled && fidgetEl && fidgetEl.contains(fb)) fidgetClick(fb);
      return;
    }
    const btn = t.closest('button[data-act]');
    if (btn) {
      if (btn.disabled) return;
      const act = btn.getAttribute('data-act');
      if (act === 'join') api.send({ a: 'join' });
      else if (act === 'start') api.send({ a: 'start' });
      else if (act === 'toLobby') api.send({ a: 'toLobby' });
      else if (act === 'say') submitLine();
      else if (act === 'crown') crown();
      else if (act === 'savelines') saveWinningLines();
      else if (act === 'suddenwin') api.send({ a: 'sudden', winner: btn.getAttribute('data-v') });
      else if (act === 'calltime') api.send({ a: 'timeUp' });
      return;
    }
    // Tap fallback: a picked-up line goes wherever the next tier is tapped.
    if (picked >= 0 && tl && !t.closest('.tchip')) {
      const z = t.closest('[data-zone]');
      if (z && boardEl.contains(z)) {
        placeChip(picked, z.getAttribute('data-zone'), null);
        picked = -1;
        render();
      }
    }
  }

  function onInput(e) {
    const el = e.target;
    if (!el) return;
    if (el.id === 'draft') { draft = el.value; return; }
    if (el.getAttribute && el.getAttribute('data-f') && fidgetEl && fidgetEl.contains(el)) fidgetInput(el);
  }

  function onKey(e) {
    if (e.target && e.target.id === 'draft' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitLine();
    }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  win.addEventListener('pointermove', onPointerMove);
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('pointercancel', onPointerUp);
  ticker = setInterval(tick, 250);

  return {
    update(v) {
      view = v;
      note = '';
      const dk = v.epoch + ':' + v.roundNo + ':' + v.dealNo;
      if (v.phase === 'write' && dk !== dealKey) {
        dealKey = dk;
        writeStart = Date.now();
        autoSent = false;
        timeUpSent = false;
      }
      if (!v.canJoin && v.isSeated) joinTries = 0;
      ensureSeat();
      // Never rebuild the page under someone's finger. If the hold gets stuck, let go after a moment.
      if (busy) {
        dirty = true;
        const phaseChanged = v.phase !== renderedPhase;
        if (Date.now() - busySince < 1000 && !phaseChanged) return;
        busy = false;
        if (phaseChanged) renderedPhase = v.phase;
      }
      renderedPhase = v.phase;
      render();
    },
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('touchmove', onTouchMove);
      win.removeEventListener('pointermove', onPointerMove);
      win.removeEventListener('pointerup', onPointerUp);
      win.removeEventListener('pointercancel', onPointerUp);
      clearInterval(ticker);
      clearInterval(scroller);
      clearTimeout(saveT);
      clearTimeout(joinTimer);
      if (eyeFrame) win.cancelAnimationFrame(eyeFrame);
      if (drag && drag.ghost) drag.ghost.remove();
    },
  };
}
