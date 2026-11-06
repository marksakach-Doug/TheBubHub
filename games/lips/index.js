// I'm Your Lips: a module game for Bub Hub.
//
// The page names a friend at the table and deals a word:
//     "Say what ______ would say about <word>."
// Everyone else writes the one line that friend would say about it. The friend
// reads the lines shuffled and ranks each one: never would say to / possible /
// wish i wouldve thought of that. Exactly one line takes the top rank, and its
// writer scores a point. The friend rotates round by round.
//
// Rules live only in reduce(). project() keeps authorship and the friend's
// shuffled texts out of every view until the reveal, and it never sends the
// word deck or the raw line map to anyone.

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
const MAX_LINE = 90;

const NEVER = 0;
const POSSIBLE = 1;
const WISH = 2;
const TIERS = [
  { key: NEVER, label: 'never would say', color: '#05d9e8' },
  { key: POSSIBLE, label: 'possibly would say', color: '#ffe14d' },
  { key: WISH, label: 'wish i wouldve thought of that', color: '#ff2a6d' },
];

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
// never tells the friend who wrote which line.
function scrambled(list, seed) {
  return list.slice().sort((x, y) => (hash(seed + x) - hash(seed + y)) || (x < y ? -1 : 1));
}

// ---------------------------------------------------------------- contract

export function init(ctx) {
  const order = [];
  const names = {};
  ((ctx && ctx.atTable) || []).forEach((p) => {
    if (!p || !p.id || order.indexOf(p.id) >= 0 || order.length >= MAX_SEATS) return;
    order.push(p.id);
    names[p.id] = clean(p.name) || 'someone';
  });
  return {
    epoch: 0,
    phase: 'lobby',          // lobby | write | rank | over
    roundNo: 0,
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
    result: null,            // { word, friend, winner } once the round is over
  };
}

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const id = from.id || '';
  const rng = (ctx && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
  if (!id) return { error: 'Lip down at the table first.' };
  const a = action && action.a;
  if (a === 'join') return join(state, id, from);
  if (a === 'start') return start(state, from, rng);
  if (a === 'toLobby') return toLobby(state, from);
  if (a === 'line') return line(state, id, from, action, rng);
  if (a === 'rank') return rank(state, id, action);
  return { error: 'That is not a move in this game.' };
}

function join(state, id, from) {
  if (state.order.indexOf(id) >= 0) return state;
  if (state.order.length >= MAX_SEATS) return { error: 'The table is full. Eight is the most.' };
  const s = clone(state);
  s.order.push(id);
  s.names[id] = clean(from.name) || 'someone';
  return s;
}

function start(state, from, rng) {
  if (!from.host) return { error: 'Only the host starts the next round.' };
  if (state.phase === 'write' || state.phase === 'rank') return { error: 'A round is already running.' };
  if (state.order.length < MIN_SEATS) return { error: 'Need three sets of lips at the table: an amigo and two people to lip.' };
  if (!WORDS.length) return { error: 'The word list is empty.' };
  const s = clone(state);
  s.roundNo = state.phase === 'lobby' ? 0 : state.roundNo + 1;
  s.friend = s.order[s.roundNo % s.order.length];
  s.writers = s.order.filter((x) => x !== s.friend);
  s.lines = {};
  s.shuffle = null;
  s.tiers = null;
  s.result = null;
  if (!s.deck.length) s.deck = shuffled(WORDS.map((_, i) => i), rng);
  s.word = WORDS[s.deck.pop()];
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
  s.friend = null;
  s.writers = [];
  s.lines = {};
  s.shuffle = null;
  s.tiers = null;
  s.result = null;
  s.word = null;
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
  }
  return s;
}

function rank(state, id, action) {
  if (state.phase !== 'rank') return { error: 'There are no lips to rank yet.' };
  if (id !== state.friend) return { error: 'Only the friend ranks the lips.' };
  const tiers = action && action.tiers;
  if (!Array.isArray(tiers) || tiers.length !== state.shuffle.length) return { error: 'Rank every lip first.' };
  if (!tiers.every((t) => t === NEVER || t === POSSIBLE || t === WISH)) return { error: 'Each lip gets one of the three tiers.' };
  if (tiers.filter((t) => t === WISH).length !== 1) return { error: 'Exactly one lip gets "wish i wouldve thought of that".' };
  const s = clone(state);
  s.tiers = tiers.slice();
  s.phase = 'over';
  const winner = state.shuffle[tiers.indexOf(WISH)];
  s.scores[winner] = (s.scores[winner] || 0) + 1;
  s.result = { word: state.word, friend: state.friend, winner };
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
  const reveal = (state.phase === 'over' && state.shuffle && state.tiers)
    ? state.shuffle.map((wid, i) => ({
      key: i,
      text: state.lines[wid],
      tier: state.tiers[i],
      authorName: names[wid] || '…',
    }))
    : null;

  return {
    you: playerId,
    phase: state.phase,
    epoch: state.epoch,
    roundNo: state.roundNo,
    word: state.word,
    friend: state.friend,
    friendName: state.friend ? (names[state.friend] || '…') : '',
    isFriend,
    isWriter: state.writers.indexOf(playerId) >= 0,
    isSeated: seated.indexOf(playerId) >= 0,
    canJoin: seated.indexOf(playerId) < 0 && seated.length < MAX_SEATS,
    seatCount: seated.length,
    writersTotal: state.writers.length,
    writtenCount: state.writers.filter((w) => has(state.lines, w)).length,
    myLine: has(state.lines, playerId) ? state.lines[playerId] : null,
    board,
    rankLines,
    reveal,
    shuffleKey: state.epoch + ':' + state.roundNo + ':' + (state.shuffle ? state.shuffle.length : 0),
  };
}

export function prune(state, goneId) {
  const inOrder = state.order.indexOf(goneId) >= 0;
  const inRound = state.writers.indexOf(goneId) >= 0 || has(state.lines, goneId) || state.friend === goneId;
  if (!inOrder && !inRound) return state;

  const s = clone(state);
  s.order = s.order.filter((x) => x !== goneId);
  if (s.phase !== 'write' && s.phase !== 'rank') return s;   // lobby and results keep their shape
  if (s.order.length < MIN_SEATS) return resetToLobby(s, true);

  if (s.friend === goneId) {
    // The friend left: same word, new friend, lines start again.
    s.friend = s.order[s.roundNo % s.order.length];
    s.writers = s.order.filter((x) => x !== s.friend);
    s.lines = {};
    s.shuffle = null;
    s.tiers = null;
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
  }
  return s;
}

export function roundId(state) {
  return 'e' + state.epoch + 'r' + state.roundNo;
}

export function summarize(state, nameOf) {
  if (state.phase !== 'over' || !state.result) return null;
  const r = state.result;
  return nameOf(r.winner) + "'s line about \"" + r.word + '\" was the one ' + nameOf(r.friend) + ' wished they had thought of.';
}

// ---------------------------------------------------------------- view

// The lip. One path, one mouth line. Every button on the page is this shape.
const LIP_D = 'M10,50 C40,16 74,22 100,36 C126,22 160,16 190,50 C160,84 126,86 100,72 C74,86 40,84 10,50 Z';
const MOUTH_D = 'M10 50 Q100 62 190 50';

function lipSvg(cls) {
  return '<svg class="' + cls + '" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
    + '<path class="lf" d="' + LIP_D + '"/><path class="ll" d="' + MOUTH_D + '"/></svg>';
}

const DRIFT_SPOTS = [
  [4, 8, '#ff2a6d', 0], [78, 12, '#05d9e8', -4], [18, 60, '#ffe14d', -8], [72, 66, '#b967ff', -2],
  [44, 36, '#ff2a6d', -6], [88, 42, '#05d9e8', -10], [2, 40, '#b967ff', -3], [54, 86, '#ffe14d', -7],
];
const DRIFT = DRIFT_SPOTS.map(([x, y, c, d]) =>
  '<svg style="left:' + x + '%;top:' + y + '%;--c:' + c + ';animation-delay:' + d + 's" viewBox="0 0 200 100" preserveAspectRatio="none">'
  + '<path class="lf" d="' + LIP_D + '"/></svg>'
).join('');

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
.line-card{border:3px solid #b967ff;box-shadow:0 0 10px #b967ff,inset 0 0 12px rgba(185,103,255,.2);background:rgba(185,103,255,.06);padding:12px 14px;margin:10px 0}
.line-card.top{border-color:#ffe14d;box-shadow:0 0 14px #ffe14d,inset 0 0 18px rgba(255,225,77,.25)}
.line-text{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:19px;font-weight:700;line-height:1.3;color:#fff;text-shadow:0 0 6px rgba(255,255,255,.6);overflow-wrap:anywhere}
.how{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.45;color:#fff5fa}
.tag{margin:8px 0 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c9b7d6}
textarea{display:block;width:100%;margin:10px 0 4px;min-height:84px;padding:12px;border-radius:0;font:700 18px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff5fa;background:#000;border:3px solid #ffe14d;box-shadow:0 0 10px #ffe14d;outline:none;resize:vertical}
textarea:focus{box-shadow:0 0 20px #ffe14d,0 0 4px #fff}
textarea::placeholder{color:#8f7aa0;font-weight:400}
.acts{display:flex;flex-wrap:wrap;gap:0 10px;align-items:center;margin-top:6px}
.tiers{display:flex;flex-wrap:wrap;gap:0 6px;margin-top:2px}
.lip{position:relative;display:inline-block;min-width:150px;min-height:64px;margin:4px 0;padding:0;border:0;background:transparent;color:#fff5fa;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;--neon:#ff2a6d}
.lip.small{min-width:124px;min-height:56px}
.lip.big{min-height:84px}
.lip.big .lt{font-size:20px;padding:20px 32px}
.lipbg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 3px var(--neon)) drop-shadow(0 0 9px var(--neon))}
.lf{fill:rgba(20,2,12,.85);stroke:var(--neon);stroke-width:3;vector-effect:non-scaling-stroke;transition:fill .15s}
.ll{fill:none;stroke:var(--neon);stroke-width:2;vector-effect:non-scaling-stroke;opacity:.85}
.lt{position:relative;display:block;padding:16px 22px;font-size:15px;font-weight:900;line-height:1.15;letter-spacing:.06em;text-transform:uppercase;text-align:center;text-shadow:0 0 6px var(--neon)}
.lip:hover .lf{fill:rgba(60,4,26,.9)}
.lip:active{transform:scale(.93) translateY(2px)}
.lip.on .lf{fill:var(--neon)}
.lip.on .lt{color:#07030d;text-shadow:none}
.lip:focus-visible{outline:2px dashed #fff;outline-offset:4px}
.lip[disabled]{opacity:.35;cursor:not-allowed;filter:grayscale(.7)}
.lip[disabled]:active{transform:none}
.rv{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-top:8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.who{color:#fff;text-shadow:0 0 6px #fff}
.tierlab{color:var(--neon);text-shadow:0 0 6px var(--neon)}
.plus{color:#ffe14d;font-size:20px;text-shadow:0 0 8px #ffe14d,0 0 22px #ffe14d;animation:flicker 1.6s infinite}
.kiss{display:inline-block;width:26px;height:13px;margin-right:8px;vertical-align:middle;filter:drop-shadow(0 0 3px #ff2a6d)}
.kiss .lf{fill:rgba(255,42,109,.35)}
.scores{margin-top:14px}
.chip{display:inline-flex;align-items:center;gap:6px;margin:4px 6px 4px 0;padding:4px 9px;border:2px solid #b967ff;box-shadow:0 0 6px #b967ff;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#fff5fa;--neon:#ff2a6d}
.chip.out{opacity:.45;border-style:dashed}
.chip em{font-style:normal;color:#05d9e8;text-shadow:0 0 6px #05d9e8}
.chip b{color:#ffe14d;text-shadow:0 0 6px #ffe14d}
.mini{display:inline-block;width:24px;height:12px}
.status{margin-top:12px;min-height:1.3em;font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:#05d9e8;text-shadow:0 0 6px #05d9e8}
.status.warn{color:#ff2a6d;text-shadow:0 0 8px #ff2a6d}
@media (prefers-reduced-motion:reduce){.title,.plus,.drift svg{animation:none}}
`;

export function mount(root, api) {
  root.innerHTML = '<style>' + CSS + '</style>'
    + '<div class="sign"><div class="drift" aria-hidden="true">' + DRIFT + '</div><div class="board"></div></div>';
  const boardEl = root.querySelector('.board');

  let view = null;
  let draft = null;        // the line box as typed; null means untouched, show my line
  let roundKey = null;     // resets local drafts when the round changes
  let shuffleKey = null;   // resets the friend's ranking when the lines change
  let tierDraft = [];      // the friend's ranking, held here until crowned
  let note = '';           // a local message for a click refused before sending

  function lip(label, act, o) {
    o = o || {};
    let attrs = ' data-act="' + act + '"';
    if (o.i !== undefined) attrs += ' data-i="' + o.i + '"';
    if (o.t !== undefined) attrs += ' data-t="' + o.t + '"';
    if (o.disabled) attrs += ' disabled';
    const cls = 'lip' + (o.on ? ' on' : '') + (o.big ? ' big' : '') + (o.small ? ' small' : '');
    const style = o.color ? ' style="--neon:' + o.color + '"' : '';
    return '<button class="' + cls + '"' + style + attrs + '>' + lipSvg('lipbg')
      + '<span class="lt">' + label + '</span></button>';
  }

  function rankCounts() {
    const n = (view.rankLines || []).length;
    let set = 0;
    let wishes = 0;
    for (let i = 0; i < n; i++) {
      if (tierDraft[i] !== undefined) set += 1;
      if (tierDraft[i] === WISH) wishes += 1;
    }
    return { n, set, wishes };
  }

  function statusText() {
    const v = view;
    if (v.phase === 'lobby') {
      return v.seatCount + ' at the table' + (v.seatCount < MIN_SEATS ? ' · need ' + MIN_SEATS + ' to start' : ' · ready');
    }
    if (v.phase === 'write') {
      return v.writtenCount + ' of ' + v.writersTotal + ' lines in' + (v.isWriter && v.myLine ? ' · yours is in' : '');
    }
    if (v.phase === 'rank') return v.isFriend ? 'Rank every line, then lick the top one.' : v.friendName + ' is ranking.';
    return 'Round over.';
  }

  function lobbyBody() {
    const v = view;
    const ready = v.seatCount >= MIN_SEATS;
    let b = '<div class="tube"><p class="how">Everyone else writes the one thing that friend '
      + 'would say about it. The friend ranks the lips, and the one they wish they had thought of scores a point. '
      + 'The friend rotates every lipround.</p></div>';
    b += '<div class="acts">';
    if (v.canJoin) b += lip('Sit in', 'join');
    if (api.isHost) b += lip(ready ? 'Start the lips' : 'Need three to start', 'start', { big: true, disabled: !ready });
    else b += '<p class="tag">The host is licking the lips.</p>';
    return b + '</div>';
  }

  function writeBody() {
    const v = view;
    if (v.isFriend) {
      return '<div class="tube"><p class="how">Everyone is thinking about your lips. You just sit here and wait.</p>'
        + '<p class="tag">' + v.writtenCount + ' of ' + v.writersTotal + ' lips in</p></div>';
    }
    if (v.isWriter) {
      return '<div class="tube"><p class="how">What would ' + esc(v.friendName) + ' say about '
        + esc(v.word) + '? </p>'
        + '<textarea id="draft" maxlength="' + MAX_LINE + '" rows="2" placeholder="what they would say"></textarea>'
        + '<div class="acts">' + lip(v.myLine ? 'Change my lips' : 'Lip It', 'say', { big: true }) + '</div></div>';
    }
    if (v.isSeated) {
      return '<div class="tube"><p class="how">You are lipping this round out. You are in from the next one.</p>'
        + '<p class="tag">' + v.writtenCount + ' of ' + v.writersTotal + ' lines in</p></div>';
    }
    return '<div class="tube"><p class="how">Watching. Lip in to write from the next round.</p>'
      + (v.canJoin ? '<div class="acts">' + lip('Put your lips in', 'join') + '</div>' : '') + '</div>';
  }

  function rankBody() {
    const v = view;
    if (!v.isFriend) {
      return '<div class="tube"><p class="how">' + esc(v.friendName)
        + ' is ranking the lines. They stay hidden until the reveal.</p></div>';
    }
    const rows = (v.rankLines || []).map((l) => {
      const btns = TIERS.map((t) => lip(t.label, 'tier', {
        i: l.key, t: t.key, on: tierDraft[l.key] === t.key, color: t.color, small: true,
      })).join('');
      return '<div class="line-card"><div class="line-text">' + lipSvg('kiss') + esc(l.text) + '</div>'
        + '<div class="tiers">' + btns + '</div></div>';
    }).join('');
    const c = rankCounts();
    const ok = c.set === c.n && c.wishes === 1;
    const hint = c.wishes === 0 ? 'Pick the one you wish you had thought of.'
      : c.wishes > 1 ? 'Only one line can be the wish.'
      : c.set === c.n ? 'Ready.' : 'Ranked ' + c.set + ' of ' + c.n + '.';
    return '<div class="tube"><p class="how">Rank each lip. Only one lip gets "wish i wouldve thought of that".</p></div>'
      + rows
      + '<div class="acts">' + lip('Lick the top lip', 'crown', { big: true, disabled: !ok }) + '</div>'
      + '<p class="tag">' + hint + '</p>';
  }

  function overBody() {
    const v = view;
    const list = (v.reveal || []).slice().sort((a, b) => (b.tier - a.tier) || (a.key - b.key));
    const rows = list.map((l) => {
      const t = TIERS[l.tier];
      const top = l.tier === WISH;
      return '<div class="line-card' + (top ? ' top' : '') + '">'
        + '<div class="line-text">' + lipSvg('kiss') + esc(l.text) + '</div>'
        + '<div class="rv"><span class="who">' + esc(l.authorName) + '</span>'
        + '<span class="tierlab" style="--neon:' + t.color + '">' + t.label + '</span>'
        + (top ? '<span class="plus">+1 point</span>' : '') + '</div></div>';
    }).join('');
    const acts = api.isHost
      ? '<div class="acts">' + lip('Next friend', 'start', { big: true, disabled: v.seatCount < MIN_SEATS })
        + lip('Back to lobby', 'toLobby') + '</div>'
      : '<p class="tag">The host lips the next friend.</p>';
    return '<div class="tube"><p class="how">The lips.</p></div>' + rows + acts;
  }

  function scoreBody() {
    const v = view;
    if (!v.board.length) return '';
    const chips = v.board.map((p) => '<span class="chip' + (p.seated ? '' : ' out') + '">'
      + lipSvg('mini') + esc(p.name)
      + (p.friend && v.phase !== 'lobby' ? ' <em>friend</em>' : '')
      + ' <b>' + p.points + '</b></span>').join('');
    return '<div class="tube scores"><div class="tag">Table · points</div>' + chips + '</div>';
  }

  function page() {
    const v = view;
    const phrase = v.word
      ? 'Say what <b>' + esc(v.friendName || '…') + '</b> would say about <span class="w">' + esc(v.word) + '</span>.'
      : 'Say what <b>______</b> would say about <span class="w">______</span>.';
    let body = '';
    if (v.phase === 'lobby') body = lobbyBody();
    else if (v.phase === 'write') body = writeBody();
    else if (v.phase === 'rank') body = rankBody();
    else if (v.phase === 'over') body = overBody();
    const status = note ? '<div class="status warn">' + esc(note) + '</div>'
      : '<div class="status">' + esc(statusText()) + '</div>';
    return '<h1 class="title"><span>I\'m your</span> <span class="lipsw">lips</span></h1>'
      + '<div class="phrase">' + phrase + '</div>'
      + body + scoreBody() + status;
  }

  function render() {
    if (!view) {
      boardEl.innerHTML = '<div class="status">Warming up the lips…</div>';
      return;
    }
    const rk = view.epoch + ':' + view.roundNo;
    if (rk !== roundKey) { roundKey = rk; draft = null; tierDraft = []; }
    if (view.shuffleKey !== shuffleKey) { shuffleKey = view.shuffleKey; tierDraft = []; }

    // Re-rendering must not eat a line someone is typing.
    const hadFocus = root.activeElement && root.activeElement.id === 'draft';
    const old = boardEl.querySelector('#draft');
    const sel = (hadFocus && old) ? [old.selectionStart, old.selectionEnd] : null;

    boardEl.innerHTML = page();
    const ta = boardEl.querySelector('#draft');
    if (ta) {
      ta.value = draft == null ? (view.myLine || '') : draft;
      if (hadFocus) {
        ta.focus();
        if (sel) ta.setSelectionRange(sel[0], sel[1]);
      }
    }
  }

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

  function onClick(e) {
    const btn = e.target && e.target.closest && e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.getAttribute('data-act');
    if (act === 'join') api.send({ a: 'join' });
    else if (act === 'start') api.send({ a: 'start' });
    else if (act === 'toLobby') api.send({ a: 'toLobby' });
    else if (act === 'say') submitLine();
    else if (act === 'tier') {
      tierDraft[Number(btn.getAttribute('data-i'))] = Number(btn.getAttribute('data-t'));
      note = '';
      render();
    } else if (act === 'crown') {
      api.send({ a: 'rank', tiers: tierDraft.slice() });
    }
  }

  function onInput(e) {
    if (e.target && e.target.id === 'draft') draft = e.target.value;
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

  return {
    update(v) {
      view = v;
      note = '';
      render();
    },
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKey);
    },
  };
}
