/* ====================================================================== */

// Just the Facts: a module game for Bub Hub.
//
// The page deals a topic. One writer secretly holds Bare Reality; every other
// writer holds a Secret Pull (a craving, a vanity, a fear). Each writes one
// calm, straight-faced sentence about the topic against a clock. The Reader
// does not write and holds no slip. The Reader sees the sentences unsigned and
// picks the one they think is Bare Reality. One choice, no tiers.
//   Bare Reality picked: that writer scores a point.
//   A Pull picked: the slip flips, the writer points to the words where the
//   Pull hides, and the Reader says Yes or No: is that Pull genuinely in
//   there? Yes: the writer scores. No: that line was neutral, so it does not
//   count, and the Reader picks again.
// The Reader rotates, so everyone reads once. Most points wins.
//
// Rules live only in reduce(). reduce() never reads a clock, so a seeded replay
// stays identical: the write timer is run by the clients, and the host (or, as
// a fallback, the Reader) sends 'timeUp' when it runs out. project() keeps
// authorship, slips and the Reader's shuffled lines out of every view until a
// slip is flipped, and never sends the topic or pull lists to anyone.
//
// The topic and pull lists come in through ctx.lists. In the Bub Hub version,
// import them from a file instead and ignore ctx.lists.

import data from './facts.json' with { type: 'json' };

export const meta = {
  id: 'facts',
  title: 'Just the Facts',
  players: '4-6',
  color: '#16224d',
  icon: '📋',
  desc: 'One line is plain. The rest hide a want. Find the plain one.',
};

const MIN_SEATS = 4;        // a Reader and at least three writers
const MAX_SEATS = 6;
const MAX_LINE = 140;
const WRITE_SECONDS = 60;
const MAX_MARKS = 24;

// ---------------------------------------------------------------- helpers

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const clone = (s) => JSON.parse(JSON.stringify(s));
const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

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
// never tells the Reader who wrote which line.
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

function listsOf(state) {
  const s = state || {};
  return {
    topics: Array.isArray(s.topics) ? s.topics : [],
    pulls: Array.isArray(s.pulls) ? s.pulls : [],
  };
}

function dealTopic(s, rng, lists) {
  const t = lists.topics;
  let pick = t[Math.floor(rng() * t.length)];
  for (let i = 0; i < 6 && t.length > 1 && pick === s.topic; i++) pick = t[Math.floor(rng() * t.length)];
  s.topic = pick;
}

// One writer gets Bare Reality. Everyone else gets a different Pull.
function dealSlips(s, rng, lists) {
  const bare = s.writers[Math.floor(rng() * s.writers.length)];
  const pulls = shuffled(lists.pulls, rng);
  let k = 0;
  s.slips = {};
  s.writers.forEach((w) => { s.slips[w] = w === bare ? { bare: true } : { pull: pulls[k++] }; });
}

// If the round lost its Bare Reality writer, hand it to someone (deterministic).
function ensureBare(s) {
  if (!s.writers.length) return;
  if (s.writers.some((w) => s.slips[w] && s.slips[w].bare)) return;
  const w = scrambled(s.writers, s.epoch + ':' + s.roundNo + ':' + s.dealNo)[0];
  s.slips[w] = { bare: true };
}

const wordCount = (text) => (text ? text.split(' ').length : 0);

// ---------------------------------------------------------------- contract

export function init(ctx) {
  const order = [];
  const names = {};
  seatAll(order, names, ctx && ctx.atTable);
  return {
    epoch: 0,
    phase: 'lobby',          // lobby | write | pick | check | roundover | gameover
    roundNo: 0,
    matchRounds: 0,          // set at the start of a match: everyone reads once
    dealNo: 0,               // bumps whenever the clock restarts inside a round
    redeals: 0,              // times this round was re-dealt because too few wrote
    order,                   // seated players, in seat order
    names,                   // id -> display name, refreshed on each move
    scores: {},              // id -> points
    topic: null,
    reader: null,
    writers: [],             // ids who must write this round (snapshot at deal)
    slips: {},               // writer id -> { bare: true } | { pull: text }, hidden until flipped
    lines: {},               // writer id -> their line (hidden until picked)
    shuffle: null,           // writer ids in the order the Reader sees them
    struck: [],              // writer ids ruled out by a No
    pickWriter: null,        // the writer whose slip is flipped and being checked
    marks: [],               // word positions the writer pointed at
    history: [],             // { roundNo, topic, reader, winner, line, how, winnerName, readerName }
    result: null,            // { topic, reader, winner, line, how: 'bare' | 'spin' | 'none' }
    winnerIds: [],           // match winner id(s), set at game over
    topics: Array.isArray(data.topics) ? data.topics.slice() : [],
    pulls: Array.isArray(data.pulls) ? data.pulls.slice() : [],
  };
}

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const id = from.id || '';
  const rng = (ctx && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
  if (!id) return { error: 'Sit down at the table first.' };
  const a = action && action.a;
  if (a === 'join') return join(state, id, from);
  if (a === 'start') return start(state, from, rng, ctx);
  if (a === 'toLobby') return toLobby(state, from);
  if (a === 'line') return line(state, id, from, action, rng);
  if (a === 'swap') return swap(state, id, rng, ctx);
  if (a === 'timeUp') return timeUp(state, id, from, rng, ctx);
  if (a === 'pick') return pick(state, id, action);
  if (a === 'point') return point(state, id, action);
  if (a === 'judge') return judge(state, id, action);
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
  if (state.order.length >= MAX_SEATS) return { error: 'The table is full. Six is the most.' };
  const s = clone(state);
  s.order.push(id);
  s.names[id] = nm || 'someone';
  return s;
}

function start(state, from, rng, ctx) {
  if (!from.host) return { error: 'Only the host can start the game.' };
  if (state.phase === 'write' || state.phase === 'pick' || state.phase === 'check') return { error: 'A round is already running.' };
  const lists = listsOf(state);
  if (!lists.topics.length) return { error: 'Add some topics first (host setup panel).' };
  const s = clone(state);
  // Anyone the hub says is at the table but who never pressed "Sit in" is
  // seated now, so the count here matches what the host can see.
  seatAll(s.order, s.names, ctx && ctx.atTable);
  if (s.order.length < MIN_SEATS) {
    const who = s.order.map((x) => s.names[x] || 'someone').join(', ') || 'nobody';
    return { error: 'Only ' + s.order.length + ' seated (' + who + '). Need ' + MIN_SEATS
      + ': a Reader and three writers. Anyone missing should press "Sit in".' };
  }
  if (lists.pulls.length < s.order.length - 2) {
    return { error: 'Need at least ' + (s.order.length - 2) + ' Secret Pulls for ' + s.order.length + ' players. You have ' + lists.pulls.length + '.' };
  }
  if (state.phase === 'lobby' || state.phase === 'gameover') {
    s.matchRounds = s.order.length;
    s.scores = {};
    s.winnerIds = [];
    s.history = [];
    s.roundNo = 0;
  } else {
    s.roundNo = state.roundNo + 1;
  }
  s.dealNo = 0;
  s.redeals = 0;
  s.reader = s.order[s.roundNo % s.order.length];
  s.writers = s.order.filter((x) => x !== s.reader);
  s.lines = {};
  s.shuffle = null;
  s.struck = [];
  s.pickWriter = null;
  s.marks = [];
  s.result = null;
  s.winnerIds = [];
  dealTopic(s, rng, lists);
  dealSlips(s, rng, lists);
  s.phase = 'write';
  return s;
}

function toLobby(state, from) {
  if (!from.host) return { error: 'Only the host can go back to the lobby.' };
  return resetToLobby(clone(state), false);
}

// A new epoch keeps round ids unique, so a rebuilt round never dedupes against
// an old one in the record.
function resetToLobby(s, keepScores) {
  s.epoch += 1;
  s.phase = 'lobby';
  s.roundNo = 0;
  s.matchRounds = 0;
  s.dealNo = 0;
  s.redeals = 0;
  s.reader = null;
  s.writers = [];
  s.slips = {};
  s.lines = {};
  s.shuffle = null;
  s.struck = [];
  s.pickWriter = null;
  s.marks = [];
  s.result = null;
  s.topic = null;
  s.winnerIds = [];
  if (!keepScores) s.scores = {};
  return s;
}

function line(state, id, from, action, rng) {
  if (state.phase !== 'write') {
    return { error: state.phase === 'pick' || state.phase === 'check' ? 'The lines are in. The Reader is reading.' : 'No round is running.' };
  }
  if (state.writers.indexOf(id) < 0) {
    return { error: id === state.reader
      ? "You're the Reader this round. The others write."
      : "You're sitting this round out. You're in from the next one." };
  }
  const text = clean(action && action.text);
  if (!text) return { error: 'Write something first.' };
  if (text.length > MAX_LINE) return { error: 'Keep it under ' + MAX_LINE + ' characters.' };
  const s = clone(state);
  s.lines[id] = text;
  s.names[id] = clean(from.name) || s.names[id];
  if (s.writers.every((w) => has(s.lines, w))) {
    s.phase = 'pick';
    s.shuffle = shuffled(s.writers, rng);
    s.struck = [];
  }
  return s;
}

// The Reader may swap the topic for another while nobody has written yet.
function swap(state, id, rng, ctx) {
  if (state.phase !== 'write') return { error: 'The topic is locked once lines are in.' };
  if (id !== state.reader) return { error: 'Only the Reader can swap the topic.' };
  if (Object.keys(state.lines).length) return { error: 'Someone has already written.' };
  const lists = listsOf(state);
  if (!lists.topics.length) return { error: 'There are no other topics.' };
  const s = clone(state);
  dealTopic(s, rng, lists);
  s.dealNo += 1;
  return s;
}

// The clock ran out. Whoever wrote, wrote; the rest sit this one out. If fewer
// than two wrote, the same Reader gets a fresh topic, fresh slips and a fresh
// clock. A late or repeated call changes nothing.
function timeUp(state, id, from, rng, ctx) {
  if (state.phase !== 'write') return state;
  if (!from.host && id !== state.reader && state.order.indexOf(id) < 0) return { error: 'Only the host, the Reader, or a player at the table can call time.' };
  const s = clone(state);
  const wrote = s.writers.filter((w) => has(s.lines, w));
  if (wrote.length < 2) {
    const lists = listsOf(s);
    if (!lists.topics.length || lists.pulls.length < s.writers.length - 1) return s;
    dealTopic(s, rng, lists);
    dealSlips(s, rng, lists);
    s.dealNo += 1;
    s.redeals += 1;
    s.lines = {};
    return s;
  }
  s.writers = wrote;
  const keep = {};
  wrote.forEach((w) => { keep[w] = s.slips[w]; });
  s.slips = keep;
  s.phase = 'pick';
  s.shuffle = shuffled(wrote, rng);
  s.struck = [];
  return s;
}

function pick(state, id, action) {
  if (state.phase !== 'pick') return { error: 'There is nothing to pick yet.' };
  if (id !== state.reader) return { error: 'Only the Reader picks.' };
  const key = action && action.key;
  if (!Number.isInteger(key) || key < 0 || key >= state.shuffle.length) return { error: 'Pick one of the lines.' };
  const w = state.shuffle[key];
  if (state.struck.indexOf(w) >= 0) return { error: 'That line is already ruled out.' };
  const s = clone(state);
  if (s.slips[w] && s.slips[w].bare) {
    finishRound(s, w, 'bare');
    return s;
  }
  s.phase = 'check';
  s.pickWriter = w;
  s.marks = [];
  return s;
}

// The flipped writer points at the words where the Pull hides.
function point(state, id, action) {
  if (state.phase !== 'check') return { error: 'There is nothing to point at.' };
  if (id !== state.pickWriter) return { error: 'Only the writer of that line points.' };
  const n = wordCount(state.lines[id]);
  const raw = action && action.marks;
  if (!Array.isArray(raw)) return { error: 'Those words do not point.' };
  const marks = [];
  raw.forEach((m) => {
    if (Number.isInteger(m) && m >= 0 && m < n && marks.indexOf(m) < 0) marks.push(m);
  });
  const s = clone(state);
  s.marks = marks.sort((x, y) => x - y).slice(0, MAX_MARKS);
  return s;
}

function judge(state, id, action) {
  if (state.phase !== 'check') return { error: 'There is nothing to judge.' };
  if (id !== state.reader) return { error: 'Only the Reader says Yes or No.' };
  const yes = !!(action && action.yes);
  if (yes && !state.marks.length) return { error: 'Wait for them to point at the words.' };
  const s = clone(state);
  if (yes) {
    finishRound(s, s.pickWriter, 'spin');
    return s;
  }
  // No: that line was neutral, so it does not count. The Reader picks again.
  s.struck.push(s.pickWriter);
  s.pickWriter = null;
  s.marks = [];
  const left = s.shuffle.filter((w) => s.struck.indexOf(w) < 0);
  if (!left.length) finishRound(s, null, 'none');
  else s.phase = 'pick';
  return s;
}

function finishRound(s, winner, how) {
  const wline = winner ? (s.lines[winner] || '') : '';
  if (winner) s.scores[winner] = (s.scores[winner] || 0) + 1;
  s.result = { topic: s.topic, reader: s.reader, winner, line: wline, how };
  s.history = (s.history || []).slice();
  s.history.push({
    roundNo: s.roundNo,
    topic: s.topic,
    reader: s.reader,
    winner,
    line: wline,
    how,
    winnerName: winner ? (s.names[winner] || '…') : '',
    readerName: s.names[s.reader] || '…',
  });
  if (how !== 'spin') s.marks = [];
  s.pickWriter = null;
  if (s.roundNo + 1 >= s.matchRounds) {
    const best = Math.max(0, ...s.order.map((x) => s.scores[x] || 0));
    // Ties share the win. Nobody scoring means nobody wins.
    s.winnerIds = best > 0 ? s.order.filter((x) => (s.scores[x] || 0) === best) : [];
    s.phase = 'gameover';
  } else {
    s.winnerIds = [];
    s.phase = 'roundover';
  }
}

export function project(state, playerId) {
  const names = state.names;
  const scores = state.scores;
  const seated = state.order;
  const ids = seated.concat(Object.keys(scores).filter((x) => seated.indexOf(x) < 0));
  // Seat order, not points order: the board is a tally, not a ranking.
  const board = ids.map((x) => ({
    id: x,
    name: names[x] || '…',
    points: scores[x] || 0,
    seated: seated.indexOf(x) >= 0,
    reader: x === state.reader,
    wrote: has(state.lines, x),
  }));

  const ph = state.phase;
  const isReader = playerId === state.reader;
  const isWriter = state.writers.indexOf(playerId) >= 0;
  const live = ph === 'write' || ph === 'pick' || ph === 'check';
  const shuffle = state.shuffle || [];
  const struck = state.struck || [];

  const readLines = (ph === 'pick' && isReader)
    ? shuffle.map((w, i) => ({ key: i, text: state.lines[w] })).filter((l) => struck.indexOf(shuffle[l.key]) < 0)
    : null;

  // A struck line was flipped in front of everyone, so its slip is public.
  const struckList = ((ph === 'pick' || ph === 'check') ? struck : []).map((w) => ({
    text: state.lines[w],
    authorName: names[w] || '…',
    pull: state.slips[w] && state.slips[w].pull ? state.slips[w].pull : '',
  }));

  const pw = state.pickWriter;
  const check = (ph === 'check' && pw)
    ? {
      text: state.lines[pw],
      authorName: names[pw] || '…',
      pull: state.slips[pw].pull || '',
      marks: state.marks.slice(),
    }
    : null;

  const showReveal = ph === 'roundover' || ph === 'gameover';
  const res = state.result;
  const reveal = (showReveal && res && state.shuffle)
    ? state.shuffle.map((w, i) => ({
      key: i,
      text: state.lines[w],
      authorName: names[w] || '…',
      bare: !!(state.slips[w] && state.slips[w].bare),
      pull: (state.slips[w] && state.slips[w].pull) || '',
      status: w === res.winner ? (res.how === 'bare' ? 'bare' : 'spin') : (struck.indexOf(w) >= 0 ? 'struck' : 'unpicked'),
      marks: (w === res.winner && res.how === 'spin') ? state.marks.slice() : [],
    }))
    : null;

  return {
    you: playerId,
    phase: ph,
    epoch: state.epoch,
    roundNo: state.roundNo,
    matchRounds: state.matchRounds,
    dealNo: state.dealNo,
    redeals: state.redeals,
    writeSec: WRITE_SECONDS,
    topic: state.topic,
    reader: state.reader,
    readerName: state.reader ? (names[state.reader] || '…') : '',
    isReader,
    isWriter,
    isSpinner: ph === 'check' && pw === playerId,
    isSeated: seated.indexOf(playerId) >= 0,
    canJoin: seated.indexOf(playerId) < 0 && seated.length < MAX_SEATS,
    seatCount: seated.length,
    seated: seated.map((x) => ({ id: x, name: names[x] || '…', you: x === playerId })),
    writersTotal: state.writers.length,
    writtenCount: state.writers.filter((w) => has(state.lines, w)).length,
    myLine: has(state.lines, playerId) ? state.lines[playerId] : null,
    // A writer always sees their own slip. Nobody else's is sent until it is flipped.
    mySlip: (live && isWriter && state.slips[playerId]) ? state.slips[playerId] : null,
    board,
    readLines,
    struckList,
    linesLeft: ph === 'pick' ? shuffle.filter((w) => struck.indexOf(w) < 0).length : 0,
    check,
    reveal,
    result: res ? {
      topic: res.topic,
      how: res.how,
      readerName: names[res.reader] || '…',
      winnerName: res.winner ? (names[res.winner] || '…') : '',
      line: res.line,
    } : null,
    winnerIds: state.winnerIds || [],
    winnerNames: (state.winnerIds || []).map((x) => names[x] || '…'),
    shuffleKey: state.epoch + ':' + state.roundNo + ':' + state.dealNo + ':' + (state.shuffle ? state.shuffle.length : 0) + ':' + struck.length,
    history: state.history || [],
  };
}

export function prune(state, goneId) {
  const inOrder = state.order.indexOf(goneId) >= 0;
  const inRound = state.writers.indexOf(goneId) >= 0 || has(state.lines, goneId) || state.reader === goneId;
  if (!inOrder && !inRound) return state;

  const s = clone(state);
  s.order = s.order.filter((x) => x !== goneId);
  if (s.phase === 'lobby' || s.phase === 'roundover' || s.phase === 'gameover') return s;   // results keep their shape
  if (s.order.length < MIN_SEATS) return resetToLobby(s, true);

  // The Reader left: same topic, new Reader, lines start again, clock restarts.
  if (s.reader === goneId) return restartRound(s);

  s.writers = s.writers.filter((x) => x !== goneId);
  delete s.lines[goneId];
  delete s.slips[goneId];
  if (s.phase === 'write') {
    if (s.writers.every((w) => has(s.lines, w))) {
      s.phase = 'pick';
      s.shuffle = scrambled(s.writers, s.epoch + ':' + s.roundNo + ':' + s.dealNo);
      s.struck = [];
    }
    return s;
  }
  // pick or check
  s.shuffle = s.shuffle.filter((x) => x !== goneId);
  s.struck = s.struck.filter((x) => x !== goneId);
  if (s.pickWriter === goneId) {
    s.pickWriter = null;
    s.marks = [];
    s.phase = 'pick';
  }
  if (!s.shuffle.filter((w) => s.struck.indexOf(w) < 0).length) return restartRound(s);
  return s;
}

function restartRound(s) {
  s.reader = s.order[s.roundNo % s.order.length];
  // Only players who were dealt a slip this round write; late joiners wait.
  s.writers = s.order.filter((x) => x !== s.reader && s.slips[x]);
  if (s.writers.length < 2) return resetToLobby(s, true);
  const keep = {};
  s.writers.forEach((w) => { keep[w] = s.slips[w]; });
  s.slips = keep;
  s.dealNo += 1;
  ensureBare(s);
  s.lines = {};
  s.shuffle = null;
  s.struck = [];
  s.pickWriter = null;
  s.marks = [];
  s.result = null;
  s.phase = 'write';
  return s;
}

export function roundId(state) {
  return 'e' + state.epoch + 'r' + state.roundNo;
}

export function summarize(state, nameOf) {
  if ((state.phase !== 'roundover' && state.phase !== 'gameover') || !state.result) return null;
  const r = state.result;
  if (!r.winner) return 'Every line about "' + r.topic + '" was ruled out. Nobody scored.';
  return r.how === 'bare'
    ? nameOf(r.reader) + ' found the plain line about "' + r.topic + '": ' + nameOf(r.winner) + "'s."
    : nameOf(r.winner) + "'s line about \"" + r.topic + '" carried a Pull and got past ' + nameOf(r.reader) + '.';
}

// ---------------------------------------------------------------- view

const CSS = `
.jtf{--ground:#111827;--slip:#1f2937;--ink:#f3f4f6;--soft:#9ca3af;--flag:#ff8d84;--on:#4a4220;color:var(--ink);font:18px/1.5 "Century Schoolbook","New Century Schoolbook","Century Schoolbook L",Cambria,Georgia,serif}
.jtf *{box-sizing:border-box;border-radius:0}
.jtf h1{font-size:34px;line-height:1.1;margin:0 0 6px}
.jtf h2{font-size:18px;margin:22px 0 8px}
.jtf p{margin:8px 0}
.jtf .soft{color:var(--soft)}
.jtf button,.jtf textarea{font:inherit;color:var(--ink);background:var(--slip);border:2px solid var(--ink)}
.jtf button{padding:11px 16px;cursor:pointer;margin:4px 8px 4px 0}
.jtf button.primary{background:var(--ink);color:var(--slip)}
.jtf button:disabled{opacity:.4;cursor:default}
.jtf textarea{display:block;width:100%;padding:10px 12px;min-height:96px;resize:vertical;margin:8px 0 2px}
.jtf :focus-visible{outline:3px solid var(--flag);outline-offset:2px}
.jtf .slip{border:2px dashed var(--ink);background:var(--slip);padding:10px 12px;margin:8px 0}
.jtf .topic{font-size:44px;line-height:1.1;text-align:center;border-top:2px solid var(--ink);border-bottom:2px solid var(--ink);padding:16px 0;margin:10px 0;overflow-wrap:anywhere}
.jtf .clock{font-size:44px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.jtf .clock.hot{color:var(--flag)}
.jtf .track{height:6px;background:var(--slip);border:1px solid var(--ink);margin-bottom:6px}
.jtf .track i{display:block;height:100%;width:100%;background:var(--ink)}
.jtf .count{text-align:right;color:var(--soft);font-size:14px;margin:0 0 8px}
.jtf .count.at{color:var(--flag)}
.jtf .line{display:block;width:100%;text-align:left;border:2px solid var(--ink);background:var(--slip);padding:12px 14px;margin:8px 0}
.jtf button.line.sel{background:var(--ink);color:var(--slip)}
.jtf .quote{font-size:24px;line-height:1.4;border-left:5px solid var(--ink);padding:2px 0 2px 14px;margin:12px 0}
.jtf .word{font:inherit;display:inline-block;margin:2px 0;padding:0 2px;background:transparent;border:0;border-bottom:2px solid transparent;cursor:default}
.jtf button.word{padding:2px 4px;margin:2px 1px;border:2px solid transparent;cursor:pointer}
.jtf .word.on{background:var(--on);border-bottom-color:var(--ink)}
.jtf .card{border:2px solid var(--ink);background:var(--slip);padding:10px 14px;margin:10px 0}
.jtf .card.win{border-width:4px}
.jtf .card.struck{opacity:.6}
.jtf .card .au{display:block;color:var(--soft);font-size:15px;margin-top:4px}
.jtf .scores{margin-top:20px;border-top:2px solid var(--ink);padding-top:10px}
.jtf .chip{display:inline-block;border:2px solid var(--ink);background:var(--slip);padding:3px 10px;margin:4px 6px 4px 0;font-size:16px}
.jtf .chip.out{border-style:dashed;opacity:.6}
.jtf .chip.win{border-width:4px}
.jtf .status{margin-top:12px;color:var(--soft);font-size:15px;min-height:1.4em}
.jtf .status.warn{color:var(--flag)}
.jtf .banner{font-size:26px;line-height:1.25;margin:6px 0 10px}
`;

export function mount(root, api) {
  root.innerHTML = '<style>' + CSS + '</style><div class="jtf"><div class="board"></div></div>';
  const boardEl = root.querySelector('.board');
  const doc = root.ownerDocument || document;


  let view = null;
  let draft = null;        // the line box as typed; null means untouched, show my line
  let roundKey = null;     // resets local drafts when the round changes
  let note = '';           // a local message for a click refused before sending
  let hide = false;        // my slip hidden from the screen
  let sel = -1;            // the line the Reader has tapped, before confirming
  let selKey = null;
  let marksLocal = [];     // the words the pointing writer has tapped
  let dealKey = null;      // the clock restarts when this changes
  let writeStart = 0;
  let autoSent = false;
  let joinTries = 0;
  let joinTimer = null;
  let ticker = null;

  // ------------------------------------------------------------ pieces

  const btn = (label, act, o) => {
    o = o || {};
    return '<button class="' + (o.primary ? 'primary' : '') + '" data-act="' + act + '"'
      + (o.data ? ' ' + o.data : '') + (o.disabled ? ' disabled' : '') + '>' + label + '</button>';
  };

  function timerHtml() {
    return '<div class="clock" id="tnum">' + view.writeSec + '</div><div class="track"><i id="tfill"></i></div>';
  }

  function wordsHtml(text, marks, canMark) {
    return text.split(' ').map((w, i) => {
      const on = marks.indexOf(i) >= 0;
      return canMark
        ? '<button class="word' + (on ? ' on' : '') + '" data-act="word" data-i="' + i + '">' + esc(w) + '</button>'
        : '<span class="word' + (on ? ' on' : '') + '">' + esc(w) + '</span>';
    }).join(' ');
  }

  function slipHtml() {
    const s = view.mySlip;
    if (!s) return '';
    const body = hide ? 'Hidden.'
      : s.bare ? '<b>Bare Reality.</b> Nothing to hide and nothing to push. Write the plainest sentence you can.'
      : '<b>Secret Pull:</b> ' + esc(s.pull) + '. Hide it in a calm sentence. If the Reader picks you, you will have to point to it.';
    return '<h2>Your slip</h2><div class="slip">' + body + '</div>'
      + '<button data-act="hide">' + (hide ? 'Show slip' : 'Hide slip') + '</button>';
  }

  // ------------------------------------------------------------ bodies

  function statusText() {
    const v = view;
    const r = 'Round ' + (v.roundNo + 1) + ' of ' + v.matchRounds;
    if (v.phase === 'lobby') {
      return v.seatCount + ' seated' + (v.seatCount < MIN_SEATS ? ', need ' + MIN_SEATS + ' to start' : ', ready');
    }
    if (v.phase === 'write') return r + '. ' + v.writtenCount + ' of ' + v.writersTotal + ' lines in' + (v.myLine ? ', yours is in' : '') + '.';
    if (v.phase === 'pick') return r + '. ' + (v.isReader ? 'Pick the line you think is Bare Reality.' : v.readerName + ' is reading.');
    if (v.phase === 'check') return r + '. A slip is flipped.';
    if (v.phase === 'roundover') return r + ' complete.';
    if (v.phase === 'gameover') return 'Match complete after ' + v.matchRounds + ' rounds.';
    return '';
  }

  function lobbyBody() {
    const v = view;
    const ready = v.seatCount >= MIN_SEATS;
    const who = v.seated.map((p) => '<span class="chip">' + esc(p.name) + (p.you ? ' (you)' : '') + '</span>').join('');
    let b = '<p>Each round one player is the Reader. The Reader finds the one plain line among lines that are hiding a want. '
      + 'A line that carries a hidden want and gets past the Reader scores too. Everyone reads once: <b>'
      + (v.seatCount >= MIN_SEATS ? v.seatCount : 'as many as there are players') + ' rounds</b>. Most points wins.</p>';
    b += '<h2>Seated (' + v.seatCount + ' of ' + MIN_SEATS + ' needed)</h2>' + (who || '<p class="soft">Nobody yet.</p>');
    if (!ready) b += '<p class="soft">Anyone not listed should press “Sit in”.</p>';
    b += '<div>';
    if (v.canJoin) b += btn('Sit in', 'join');
    if (api.isHost) b += btn(ready ? 'Start' : 'Need ' + (MIN_SEATS - v.seatCount) + ' more', 'start', { primary: true, disabled: !ready });
    else b += '<p class="soft">The host will start the game.</p>';
    return b + '</div>';
  }

  function writeBody() {
    const v = view;
    const again = v.redeals > 0 && v.dealNo > 0 ? '<p class="soft">Too few wrote in time. Fresh topic, fresh slips, fresh clock.</p>' : '';
    const topic = '<div class="topic">' + esc(v.topic) + '</div>';
    if (v.isReader) {
      return timerHtml() + again + topic
        + '<p>You are the Reader. You write nothing and hold no slip. Wait for the lines.</p>'
        + '<p class="soft">' + v.writtenCount + ' of ' + v.writersTotal + ' lines in.</p>'
        + '<div>' + btn('Swap the topic', 'swap', { disabled: v.writtenCount > 0 }) + btn('Call time', 'calltime') + '</div>';
    }
    if (v.isWriter) {
      return timerHtml() + again + topic + slipHtml()
        + '<h2>Your line</h2><p class="soft">One calm, straight-faced sentence about the topic.</p>'
        + '<textarea id="draft" maxlength="' + MAX_LINE + '" rows="3" placeholder="One calm sentence"></textarea>'
        + '<div id="linecount" class="count">0/' + MAX_LINE + '</div>'
        + '<div>' + btn(v.myLine ? 'Change my line' : 'Hand it in', 'say', { primary: true }) + '</div>';
    }
    return timerHtml() + topic
      + (v.isSeated
        ? '<p>You are sitting this round out. You are in from the next one.</p>'
        : '<p>Watching. Sit in to play from the next round.</p>' + (v.canJoin ? btn('Sit in', 'join') : ''))
      + '<p class="soft">' + v.writtenCount + ' of ' + v.writersTotal + ' lines in.</p>';
  }

  function struckHtml() {
    const v = view;
    if (!v.struckList.length) return '';
    return '<h2>Ruled out</h2>' + v.struckList.map((l) =>
      '<div class="card struck">“' + esc(l.text) + '”<span class="au">' + esc(l.authorName) + (l.pull ? ', Pull: ' + esc(l.pull) : '')
      + '. That line was neutral, so it doesn’t count.</span></div>').join('');
  }

  function pickBody() {
    const v = view;
    const topic = '<div class="topic">' + esc(v.topic) + '</div>';
    if (!v.isReader) {
      return topic + '<p>' + esc(v.readerName) + ' is reading the lines. They stay hidden until a slip is flipped.</p>' + struckHtml();
    }
    const lines = (v.readLines || []).map((l) =>
      '<button class="line' + (l.key === sel ? ' sel' : '') + '" data-act="choose" data-k="' + l.key + '">' + esc(l.text) + '</button>').join('');
    return topic + '<p>' + (v.struckList.length ? 'Pick again. ' : '') + 'Which line is Bare Reality? Tap one, then confirm. One choice.</p>'
      + lines
      + '<div>' + btn('That one', 'confirm', { primary: true, disabled: sel < 0 }) + '</div>'
      + struckHtml();
  }

  function checkBody() {
    const v = view;
    const c = v.check;
    const topic = '<div class="topic small">' + esc(v.topic) + '</div>';
    const marks = v.isSpinner ? marksLocal : c.marks;
    const head = '<p><b>' + esc(c.authorName) + '</b> wrote this line. The slip flips: <b>Secret Pull: ' + esc(c.pull) + '.</b></p>';
    const quote = '<div class="quote">' + wordsHtml(c.text, marks, v.isSpinner) + '</div>';
    let ask = '';
    if (v.isSpinner) ask = '<p>Tap the exact words where you hid it.</p>';
    else if (v.isReader) {
      ask = '<p>Is that Pull genuinely in there?</p><div>'
        + btn('Yes, it’s in there', 'yes', { primary: true, disabled: !c.marks.length })
        + btn('No, that line was neutral', 'no') + '</div>'
        + (c.marks.length ? '' : '<p class="soft">Yes unlocks once they point at words.</p>');
    } else ask = '<p class="soft">' + esc(v.readerName) + ' decides whether the Pull is really in there.</p>';
    return topic + head + quote + ask + struckHtml();
  }

  function revealHtml() {
    const v = view;
    return (v.reveal || []).map((l) => {
      const role = l.bare ? 'Bare Reality' : 'Pull: ' + esc(l.pull);
      const tag = l.status === 'bare' ? ' Picked. +1 point.'
        : l.status === 'spin' ? ' Picked, and the Pull was in there. +1 point.'
        : l.status === 'struck' ? ' Ruled out.' : '';
      return '<div class="card' + (l.status === 'bare' || l.status === 'spin' ? ' win' : '') + (l.status === 'struck' ? ' struck' : '') + '">'
        + '<div class="word-line">' + (l.marks.length ? wordsHtml(l.text, l.marks, false) : '“' + esc(l.text) + '”') + '</div>'
        + '<span class="au">' + esc(l.authorName) + ', ' + role + '.' + esc(tag) + '</span></div>';
    }).join('');
  }

  function resultBanner() {
    const r = view.result;
    if (!r) return '';
    if (!r.winnerName) return '<div class="banner">Every line was ruled out. Nobody scores.</div>';
    if (r.how === 'bare') return '<div class="banner">' + esc(r.readerName) + ' found it. ' + esc(r.winnerName) + ' wrote the plain line. +1 for ' + esc(r.winnerName) + '.</div>';
    return '<div class="banner">' + esc(r.winnerName) + '’s line carried a Pull and got past ' + esc(r.readerName) + '. +1 for ' + esc(r.winnerName) + '.</div>';
  }

  function roundOverBody() {
    const v = view;
    const left = v.matchRounds - (v.roundNo + 1);
    const acts = api.isHost
      ? '<div>' + btn(left === 1 ? 'Final round' : 'Next round', 'start', { primary: true, disabled: v.seatCount < MIN_SEATS })
        + btn('Back to lobby', 'toLobby') + '</div>'
      : '<p class="soft">The host will start the next round.</p>';
    return resultBanner() + '<p class="soft">Topic: ' + esc(v.result ? v.result.topic : '') + '. ' + left + (left === 1 ? ' round' : ' rounds') + ' left.</p>'
      + revealHtml() + acts;
  }

  function gameOverBody() {
    const v = view;
    const names = v.winnerNames || [];
    const win = names.length === 1 ? esc(names[0]) + ' wins the match.'
      : names.length > 1 ? esc(names.join(' and ')) + ' share the win.' : 'Nobody scored.';
    const acts = api.isHost
      ? '<div>' + btn('Play again', 'start', { primary: true, disabled: v.seatCount < MIN_SEATS }) + btn('Back to lobby', 'toLobby') + '</div>'
      : '<p class="soft">The host can play again or go back to the lobby.</p>';
    return '<div class="banner">' + win + '</div>' + resultBanner() + revealHtml() + acts;
  }

  function scoreBody() {
    const v = view;
    if (!v.board.length) return '';
    const win = {};
    if (v.phase === 'gameover') (v.winnerIds || []).forEach((id) => { win[id] = true; });
    const running = v.phase === 'write' || v.phase === 'pick' || v.phase === 'check';
    const chips = v.board.map((p) => '<span class="chip' + (p.seated ? '' : ' out') + (win[p.id] ? ' win' : '') + '">'
      + esc(p.name) + (p.reader && running ? ' (Reader)' : '') + ' ' + p.points + '</span>').join('');
    return '<div class="scores"><div class="soft">Points' + (v.matchRounds ? ' after ' + v.matchRounds + ' rounds' : '') + '</div>' + chips + '</div>';
  }

  function page() {
    const v = view;
    let body = '';
    if (v.phase === 'lobby') body = lobbyBody();
    else if (v.phase === 'write') body = writeBody();
    else if (v.phase === 'pick') body = pickBody();
    else if (v.phase === 'check') body = checkBody();
    else if (v.phase === 'roundover') body = roundOverBody();
    else if (v.phase === 'gameover') body = gameOverBody();
    const status = note ? '<div class="status warn">' + esc(note) + '</div>' : '<div class="status">' + esc(statusText()) + '</div>';
    return '<h1>Just the Facts</h1>' + body + scoreBody() + status;
  }

  // ------------------------------------------------------------ render

  function render() {
    if (!view) {
      boardEl.innerHTML = '<div class="status">Setting the table…</div>';
      return;
    }
    const rk = view.epoch + ':' + view.roundNo + ':' + view.dealNo + ':' + view.phase;
    if (rk !== roundKey) {
      roundKey = rk;
      draft = null;
      hide = false;
    }
    if (view.shuffleKey !== selKey) { selKey = view.shuffleKey; sel = -1; }

    // Re-rendering must not eat a line someone is typing.
    const hadFocus = doc.activeElement && doc.activeElement.id === 'draft';
    const old = boardEl.querySelector('#draft');
    const caret = (hadFocus && old) ? [old.selectionStart, old.selectionEnd] : null;

    boardEl.innerHTML = page();
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
        if (caret) ta.setSelectionRange(caret[0], caret[1]);
      }
    }
    tick();
  }

  // ------------------------------------------------------------ the clock

  function tick() {
    if (!view || view.phase !== 'write') return;
    const total = view.writeSec * 1000;
    const spent = Date.now() - writeStart;
    const left = Math.max(0, total - spent);
    const num = boardEl.querySelector('#tnum');
    const fill = boardEl.querySelector('#tfill');
    if (num) {
      num.textContent = String(Math.ceil(left / 1000));
      num.classList.toggle('hot', left <= 10000);
    }
    if (fill) fill.style.width = (left / total * 100) + '%';
    if (left > 0) return;

    // Out of time: whatever is typed but unsent goes in.
    if (view.isWriter && !autoSent) {
      autoSent = true;
      const t = clean(draft == null ? '' : draft).slice(0, MAX_LINE);
      if (t && t !== view.myLine) { try { api.send({ a: 'line', text: t }); } catch (e) {} }
    }
    // The host (or the Reader) calls time once the clock has run out; retry until the phase changes.
    if ((api.isHost || view.isReader) && spent - total >= (api.isHost ? 1500 : 2500)) {
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

  // ------------------------------------------------------------ actions

  function submitLine() {
    const text = clean(draft == null ? (view && view.myLine) || '' : draft);
    if (!text) {
      note = 'Write something first.';
      render();
      return;
    }
    api.send({ a: 'line', text });
  }

  function toggleWord(i) {
    const at = marksLocal.indexOf(i);
    if (at >= 0) marksLocal.splice(at, 1); else marksLocal.push(i);
    marksLocal.sort((x, y) => x - y);
    api.send({ a: 'point', marks: marksLocal.slice() });
    render();
  }

  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const b = t.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.getAttribute('data-act');
    if (act === 'join') api.send({ a: 'join' });
    else if (act === 'start') api.send({ a: 'start' });
    else if (act === 'toLobby') api.send({ a: 'toLobby' });
    else if (act === 'say') submitLine();
    else if (act === 'swap') api.send({ a: 'swap' });
    else if (act === 'calltime') api.send({ a: 'timeUp' });
    else if (act === 'hide') { hide = !hide; render(); }
    else if (act === 'choose') { sel = Number(b.getAttribute('data-k')); render(); }
    else if (act === 'confirm') { if (sel >= 0) api.send({ a: 'pick', key: sel }); }
    else if (act === 'word') toggleWord(Number(b.getAttribute('data-i')));
    else if (act === 'yes') api.send({ a: 'judge', yes: true });
    else if (act === 'no') api.send({ a: 'judge', yes: false });
  }

  function onInput(e) {
    const el = e.target;
    if (!el || el.id !== 'draft') return;
    draft = el.value;
    const ce = boardEl.querySelector('#linecount');
    if (ce) {
      ce.textContent = el.value.length + '/' + MAX_LINE;
      ce.classList.toggle('at', el.value.length >= MAX_LINE);
    }
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
  ticker = setInterval(tick, 250);
  render();

  return {
    update(v) {
      view = v;
      note = '';
      const dk = v.epoch + ':' + v.roundNo + ':' + v.dealNo;
      if (v.phase === 'write' && dk !== dealKey) {
        dealKey = dk;
        writeStart = Date.now();
        autoSent = false;
      }
      marksLocal = v.check && v.isSpinner ? v.check.marks.slice() : [];
      if (!v.canJoin && v.isSeated) joinTries = 0;
      ensureSeat();
      render();
    },
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKey);
      clearInterval(ticker);
      clearTimeout(joinTimer);
    },
  };
}
