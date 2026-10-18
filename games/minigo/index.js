// MiniGo — 7x7 Go against a Monte Carlo bot, or against another player at the table.
//
// A module game: rules in reduce(), pixels in mount(). The bot is not a player the hub
// knows about. Its seat holds the id 'bot', and the human sitting opposite runs the search
// (in a Web Worker) and sends the result back as an ordinary {a:'bot'} intent, which
// reduce() validates like any other move. See engine.js for the rules and the search.

import { engine, makeEngine } from './engine.js';

const PASS = engine.PASS, AREA = engine.AREA, N = engine.N;
// 9 is the komi at which perfect play on 7x7 is believed to draw (KataGo's 7x7 book). The
// half point removes draws and, in theory, favours White. Change it here and nowhere else.
const KOMI = 9.5;
const SZ = 640, M = 50, CELL = 90;
// Bot strength: a time budget, plus an iteration cap that keeps "easy" weak on any machine.
const LEVELS = {
  easy:   { ms: 200,  iters: 120 },
  medium: { ms: 1200, iters: 1e9 },
  hard:   { ms: 3500, iters: 1e9 }
};

export const meta = {
  id: 'minigo', title: 'MiniGo', players: { min: 1, max: 2 },
  color: '#d9a05b', icon: '⚫', soloable: true,
  desc: 'Go on a 7x7 board against a Monte Carlo bot or a friend. Area scoring, komi 9.5.'
};

// ---------------------------------------------------------------- rules (host side)

function colorOf(state, id) {
  if (!id) return 0;
  return state.players[0] === id ? 1 : state.players[1] === id ? 2 : 0;
}

function zeros() { return new Array(AREA).fill(0); }

function fresh(o) {
  return {
    v: 1, gameNo: o.gameNo, komi: KOMI,
    b: zeros(), ko: -1, turn: 1, passes: 0, caps: [0, 0, 0],
    last: -1, lastPass: false, moves: 0, hist: [zeros().join('')],
    phase: 'play', dead: zeros(), acc: [0, 0, 0],
    players: o.players, vsBot: o.vsBot, names: o.names,
    winner: 0, margin: 0, how: '', black: 0, white: 0
  };
}

export function init(ctx) {
  let people = (ctx && ctx.atTable && ctx.atTable.length) ? ctx.atTable : ((ctx && Array.isArray(ctx.seats)) ? ctx.seats : []);
  people = people.filter(function (m) { return m && m.id && !m.spectator && !m.bot; });
  people = people.slice().sort(function (a, b) { return (b.host ? 1 : 0) - (a.host ? 1 : 0); });
  const humans = people.slice(0, 2), names = {};
  humans.forEach(function (p) { names[p.id] = p.name || 'Player'; });
  return fresh({
    gameNo: 1, names: names, vsBot: humans.length < 2,
    players: [humans[0] ? humans[0].id : null, humans[1] ? humans[1].id : 'bot']
  });
}

function playMove(state, i, c, r) {
  const caps = state.caps.slice();
  caps[c] += r.caps;
  return Object.assign({}, state, {
    b: r.b, ko: r.ko, caps: caps, hist: state.hist.concat(r.key),
    passes: 0, lastPass: false, last: i, turn: 3 - c, moves: state.moves + 1
  });
}

function passMove(state, c) {
  const s = Object.assign({}, state, {
    passes: state.passes + 1, lastPass: true, last: -1, ko: -1, turn: 3 - c, moves: state.moves + 1
  });
  if (s.passes >= 2) { s.phase = 'score'; s.dead = zeros(); s.acc = [0, 0, 0]; }
  return s;
}

function finishScore(state) {
  const sc = engine.score(state.b, state.dead, state.komi);
  return Object.assign({}, state, {
    phase: 'over', how: 'score', winner: sc.diff > 0 ? 1 : 2,
    margin: Math.abs(sc.diff), black: sc.black, white: sc.white
  });
}

function resignMove(state, loser) {
  return Object.assign({}, state, { phase: 'over', how: 'resign', winner: 3 - loser, margin: 0 });
}

// Taking a seat. This used to answer with the state either way, so a joiner who
// could not be seated was re-sent the identical state, their client computed an
// unchanged key and never asked again — a permanent spectator with no way to
// find out why. Every refusal is an error now, and the client shows it and
// retries.
function joinSeat(state, id, name) {
  if (!id) return { error: 'No player id.' };
  if (colorOf(state, id)) return state;                       // already seated
  const players = state.players.slice();
  let vsBot = state.vsBot;
  const open = players.indexOf(null);
  if (open >= 0) {
    players[open] = id;
  } else if (state.vsBot && state.moves === 0 && state.phase === 'play') {
    // Nobody has moved yet, so a newcomer can take the bot's seat and make it a human game.
    const bi = players.indexOf('bot');
    if (bi < 0) return { error: 'This table has no open seat.' };
    players[bi] = id;
    vsBot = false;
  } else if (!vsBot) {
    return { error: 'This table is full — MiniGo is two players.' };
  } else {
    return { error: 'The bot is mid-game. Finish this game, or press New game, and take the seat.' };
  }
  // Both seats human: the flag has to clear here too. Filling both via join
  // never touched it, so a genuine human game still ran with the Bot level
  // buttons and Swap sides on screen.
  if (players.indexOf('bot') < 0) vsBot = false;
  const names = Object.assign({}, state.names);
  names[id] = name || names[id] || 'Player';
  return Object.assign({}, state, { players: players, vsBot: vsBot, names: names });
}

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const id = from.id || '';
  const a = action && action.a;
  if (!a) return { error: 'Unknown action.' };
  if (a === 'join') return joinSeat(state, id, from.name);

  const seat = colorOf(state, id);
  if (!seat) return { error: 'You are watching, not seated.' };
  const waiting = state.players[0] === null || state.players[1] === null;

  if (a === 'play' || a === 'pass') {
    if (state.phase !== 'play') return { error: 'The game is not in play.' };
    if (waiting) return { error: 'Waiting for an opponent.' };
    if (seat !== state.turn) return { error: "It isn't your turn." };
    if (a === 'pass') return passMove(state, seat);
    const r = engine.applyMove(state, action.i, seat);
    return r.err ? { error: r.err } : playMove(state, action.i, seat, r);
  }

  if (a === 'bot') {
    const bc = state.players.indexOf('bot') + 1;
    if (!state.vsBot || !bc || state.phase !== 'play' || waiting) return { error: 'No bot move is due.' };
    if (state.turn !== bc) return { error: "It isn't the bot's turn." };
    if (action.g !== state.gameNo || action.n !== state.moves) return { error: 'That bot move is out of date.' };
    if (action.i === PASS) return passMove(state, bc);
    const r = engine.applyMove(state, action.i, bc);
    // The bot's move is only advice. If it were ever illegal, passing beats a frozen table.
    return r.err ? passMove(state, bc) : playMove(state, action.i, bc, r);
  }

  if (a === 'resign') {
    if (state.phase === 'over') return { error: 'The game is already over.' };
    return resignMove(state, seat);
  }

  if (a === 'mark') {
    if (state.phase !== 'score') return { error: 'Nothing to mark right now.' };
    const i = action.i;
    if (typeof i !== 'number' || i !== (i | 0) || i < 0 || i >= AREA || !state.b[i]) return { error: 'Pick a stone.' };
    const v = state.dead[i] ? 0 : 1, dead = state.dead.slice();
    engine.groupOf(state.b, i).forEach(function (k) { dead[k] = v; });
    return Object.assign({}, state, { dead: dead, acc: [0, 0, 0] });
  }

  if (a === 'accept') {
    if (state.phase !== 'score') return { error: 'Nothing to accept right now.' };
    const acc = state.acc.slice();
    acc[seat] = 1;
    // The bot accepts whatever you mark, so one accept settles a bot game.
    // Guarded on the index: when both seats are human, indexOf('bot') is -1 and
    // this used to write acc[0], an unused slot.
    const bi = state.players.indexOf('bot');
    if (state.vsBot && bi >= 0) acc[bi + 1] = 1;
    const s = Object.assign({}, state, { acc: acc });
    return (acc[1] && acc[2]) ? finishScore(s) : s;
  }

  if (a === 'resume') {
    if (state.phase !== 'score') return { error: 'The game is not being scored.' };
    return Object.assign({}, state, { phase: 'play', passes: 0, lastPass: false, ko: -1, dead: zeros(), acc: [0, 0, 0] });
  }

  if (a === 'new') {
    if (state.phase !== 'over') return { error: 'Finish this game first.' };
    const swap = action.swap === undefined ? !state.vsBot : !!action.swap;
    const p = state.players;
    return fresh({
      gameNo: state.gameNo + 1, names: state.names, vsBot: state.vsBot,
      players: swap ? [p[1], p[0]] : p.slice()
    });
  }

  return { error: 'Unknown action.' };
}

export function project(state, playerId) {
  return Object.assign({}, state, { you: playerId, seat: colorOf(state, playerId) });
}

export function prune(state, goneId) {
  const i = state.players.indexOf(goneId);
  if (i < 0) return state;
  const players = state.players.slice();
  players[i] = null;
  return Object.assign({}, state, { players: players });
}

export function roundId(state) { return 'g' + state.gameNo; }

export function summarize(state, nameOf) {
  if (!state || state.phase !== 'over' || !state.winner) return null;
  const w = state.players[state.winner - 1], l = state.players[2 - state.winner];
  const nm = function (id) { return id === 'bot' ? 'the bot' : id ? nameOf(id) : 'a player'; };
  const by = state.how === 'resign' ? ' by resignation' : ' by ' + state.margin + ' points';
  if (w === 'bot') return nm(l) + ' lost to the bot at ' + meta.title + by;
  return nm(w) + ' beat ' + nm(l) + ' at ' + meta.title + by;
}

// ---------------------------------------------------------------- the bot's worker

// The worker's source is the engine itself: makeEngine() is self-contained, so its text
// plus a few lines of glue is a complete program. No separate worker file, no build step.
function workerSource() {
  return '(function(){var E=(' + makeEngine.toString() + ')();var s=new E.Searcher();' +
    'self.onmessage=function(e){var m=e.data;' +
    'if(m.cmd==="reset"){s.reset();return;}' +
    's.start(m.pos,m.cfg);while(!s.step(50)){}' +
    'var r=s.result();r.id=m.id;self.postMessage(r);};})();';
}

// ---------------------------------------------------------------- the screen

const CSS = [
  ':host{display:block}',
  '*{box-sizing:border-box}',
  '.wrap{max-width:560px;margin:0 auto;padding:8px;display:flex;flex-direction:column;gap:8px;color:#e2e8f0;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}',
  '.top{display:flex;gap:8px}',
  '.chip{flex:1;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:#1e293b;border:2px solid transparent;min-width:0}',
  '.chip.on{border-color:#d9a05b}',
  '.chip b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.chip small{margin-left:auto;color:#94a3b8;white-space:nowrap}',
  '.dot{flex:0 0 18px;height:18px;border-radius:50%}',
  '.dot.b{background:radial-gradient(circle at 35% 30%,#666,#000)}',
  '.dot.w{background:radial-gradient(circle at 35% 30%,#fff,#c9c9c9);box-shadow:0 0 0 1px #888}',
  '#st{min-height:40px;text-align:center;font-weight:700;display:flex;align-items:center;justify-content:center}',
  '#err{min-height:18px;text-align:center;font-size:13px;color:#e5484d}',
  'canvas{width:min(100%,72vh);aspect-ratio:1;margin:0 auto;display:block;touch-action:manipulation}',
  '.row{display:flex;gap:8px}',
  'button{flex:1;font:inherit;border:0;border-radius:10px;padding:10px;min-height:44px;background:#334155;color:#fff;cursor:pointer}',
  'button:hover{background:#475569}',
  'button.dim{opacity:.45}',
  'button.sel{background:#d9a05b;color:#1a1208}',
  '[hidden]{display:none!important}',
  '.lvl{font-size:13px;align-items:center}.lvl span{color:#94a3b8;flex:0 0 auto}.lvl button{min-height:36px;padding:6px}'
].join('');

const HTML =
  '<div class="wrap">' +
  '<div class="top"><div class="chip" id="c1"><span class="dot b"></span><b id="n1">Black</b><small id="p1"></small></div>' +
  '<div class="chip" id="c2"><span class="dot w"></span><b id="n2">White</b><small id="p2"></small></div></div>' +
  '<div id="st"></div>' +
  '<canvas id="cv" width="1280" height="1280" aria-label="7 by 7 Go board"></canvas>' +
  '<div id="err"></div>' +
  '<div class="row"><button id="b1">Pass</button><button id="b2">Resign</button></div>' +
  '<div class="row lvl" id="lvl" hidden><span>Bot level</span>' +
  '<button data-l="easy">Easy</button><button data-l="medium">Medium</button><button data-l="hard">Hard</button></div>' +
  '</div>';

export function mount(root, api) {
  root.innerHTML = '<style>' + CSS + '</style>' + HTML;
  const q = function (s) { return root.querySelector(s); };
  const cv = q('#cv'), ctx = cv.getContext('2d');
  if (ctx) ctx.setTransform(2, 0, 0, 2, 0, 0);

  let view = null, hov = -1, resArm = false;
  let level = 'medium', thinkKey = null, thinking = false;
  let worker = null, workerUrl = null, workerBad = false, inline = null;
  let joinKey = '', destroyed = false, flashTimer = null;
  let retryTimer = null, joinFail = '';

  // ---- who is who
  function nameOf(id) {
    if (id === 'bot') return 'Bot';
    if (!id) return 'waiting…';
    if (id === api.me.id) return api.me.name;
    return (view && view.names && view.names[id]) || 'Player';
  }
  function chipName(c) {
    const id = view.players[c - 1];
    return (c === 1 ? 'Black' : 'White') + ' · ' + nameOf(id) + (id && id === api.me.id ? ' (you)' : '');
  }
  function botColor() { return view ? view.players.indexOf('bot') + 1 : 0; }
  function canAct() {
    return !!view && view.phase === 'play' && view.seat === view.turn &&
      view.players[0] !== null && view.players[1] !== null;
  }
  // Ask for a seat. The key used to be (gameNo, moves, phase) with no retry, so
  // a rejected join — the table full, the bot mid-game, a seat that only opened
  // after somebody left — was never asked about again for the life of the mount.
  // The message is kept on screen until we get a seat or a new reason.
  function maybeJoin() {
    if (destroyed || !view || view.seat || api.isSpectator) return;
    if (view.players.indexOf('bot') < 0 && view.players.every(function (p) { return p; })) {
      // Both seats are real players: there is genuinely nothing for us here.
      if (joinFail !== 'full') { joinFail = 'full'; flash('This table is full — MiniGo is two players.'); }
      return;
    }
    const k = view.gameNo + ':' + view.moves + ':' + view.phase;
    if (k === joinKey) return;
    joinKey = k; joinFail = '';
    api.send({ a: 'join' });
  }
  function flash(t) {
    q('#err').textContent = t || '';
    clearTimeout(flashTimer);
    if (t) flashTimer = api.setTimeout(function () { q('#err').textContent = ''; }, 2600);
  }

  // ---- drawing
  const px = function (i) { return M + (i % N) * CELL; };
  const py = function (i) { return M + ((i / N) | 0) * CELL; };
  function stone(x, y, c, al) {
    ctx.globalAlpha = al;
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.arc(x + 3, y + 4, 38, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(x - 12, y - 14, 4, x, y, 40);
    if (c === 1) { g.addColorStop(0, '#6a6a6a'); g.addColorStop(1, '#000'); }
    else { g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfcfcf'); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 38, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, SZ, SZ);
    const g = ctx.createLinearGradient(0, 0, SZ, SZ);
    g.addColorStop(0, '#c98f55'); g.addColorStop(1, '#a56a35');
    ctx.fillStyle = g; ctx.fillRect(0, 0, SZ, SZ);
    ctx.strokeStyle = '#432610'; ctx.lineWidth = 2.5;
    for (let k = 0; k < N; k++) {
      ctx.beginPath(); ctx.moveTo(M, M + k * CELL); ctx.lineTo(M + (N - 1) * CELL, M + k * CELL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(M + k * CELL, M); ctx.lineTo(M + k * CELL, M + (N - 1) * CELL); ctx.stroke();
    }
    ctx.fillStyle = '#432610';
    [[2, 2], [2, 4], [4, 2], [4, 4], [3, 3]].forEach(function (p) {
      ctx.beginPath(); ctx.arc(M + p[0] * CELL, M + p[1] * CELL, 6, 0, Math.PI * 2); ctx.fill();
    });
    if (!view) return;
    const sc = view.phase === 'play' ? null : engine.score(view.b, view.dead, view.komi);
    for (let i = 0; i < AREA; i++) {
      if (view.b[i]) {
        stone(px(i), py(i), view.b[i], view.dead[i] ? 0.4 : 1);
        if (view.dead[i]) {
          ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 4; ctx.beginPath();
          ctx.moveTo(px(i) - 12, py(i) - 12); ctx.lineTo(px(i) + 12, py(i) + 12);
          ctx.moveTo(px(i) + 12, py(i) - 12); ctx.lineTo(px(i) - 12, py(i) + 12);
          ctx.stroke();
        }
      } else if (sc && sc.terr[i]) {
        ctx.fillStyle = sc.terr[i] === 1 ? '#111' : '#f4f4f4';
        ctx.strokeStyle = '#432610'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(px(i) - 11, py(i) - 11, 22, 22); ctx.fill(); ctx.stroke();
      }
    }
    if (view.phase === 'play' && view.last >= 0) {
      ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(px(view.last), py(view.last), 14, 0, Math.PI * 2); ctx.stroke();
    }
    if (hov >= 0 && canAct() && !engine.applyMove(view, hov, view.turn).err) stone(px(hov), py(hov), view.turn, 0.5);
  }

  // ---- text and buttons
  function statusText() {
    const v = view;
    if (v.phase === 'play') {
      const botTurn = v.vsBot && v.players[v.turn - 1] === 'bot';
      const lp = v.lastPass ? nameOf(v.players[2 - v.turn]) + ' passed. ' : '';
      if (v.players[0] === null || v.players[1] === null) return 'Waiting for an opponent to join.';
      if (botTurn) return lp + 'Bot is thinking…';
      // Unseated with two real players: say the useful thing, not "watching".
      if (!v.seat && v.players.indexOf('bot') < 0) return 'MiniGo is a two-player game — this table is full.';
      if (!v.seat) return '👁 Watching — ' + nameOf(v.players[v.turn - 1]) + ' to move.';
      return lp + (v.seat === v.turn ? 'Your move.' : 'Waiting for ' + nameOf(v.players[v.turn - 1]) + '…');
    }
    if (v.phase === 'score') {
      const sc = engine.score(v.b, v.dead, v.komi);
      return (v.seat ? 'Tap dead stones to remove them. ' : '👁 Watching the scoring. ') +
        'Black ' + sc.black + ' · White ' + sc.white + ' (komi ' + v.komi + ' included)';
    }
    const w = nameOf(v.players[v.winner - 1]);
    return v.how === 'resign' ? w + ' wins by resignation.'
      : w + ' wins by ' + v.margin + '. Black ' + v.black + ', White ' + v.white + ' (komi included).';
  }

  function render() {
    draw();
    if (!view) return;
    const v = view, b1 = q('#b1'), b2 = q('#b2');
    q('#n1').textContent = chipName(1);
    q('#n2').textContent = chipName(2);
    q('#p1').textContent = v.caps[1] ? 'took ' + v.caps[1] : '';
    q('#p2').textContent = v.caps[2] ? 'took ' + v.caps[2] : '';
    q('#c1').className = 'chip' + (v.phase === 'play' && v.turn === 1 ? ' on' : '');
    q('#c2').className = 'chip' + (v.phase === 'play' && v.turn === 2 ? ' on' : '');
    q('#st').textContent = statusText();
    if (v.phase === 'play') {
      b1.textContent = 'Pass'; b1.className = canAct() ? '' : 'dim'; b1.hidden = false;
      b2.textContent = resArm ? 'Tap again to resign' : 'Resign'; b2.className = v.seat ? '' : 'dim'; b2.hidden = false;
    } else if (v.phase === 'score') {
      b1.textContent = 'Accept score'; b1.className = v.seat ? '' : 'dim'; b1.hidden = false;
      b2.textContent = 'Keep playing'; b2.className = v.seat ? '' : 'dim'; b2.hidden = false;
    } else {
      b1.textContent = 'New game'; b1.className = v.seat ? '' : 'dim'; b1.hidden = false;
      b2.textContent = 'Swap sides'; b2.className = v.seat ? '' : 'dim'; b2.hidden = !v.vsBot;
    }
    q('#lvl').hidden = !(v.vsBot && v.seat);
    root.querySelectorAll('#lvl button').forEach(function (btn) {
      btn.className = btn.getAttribute('data-l') === level ? 'sel' : '';
    });
  }

  // ---- the bot
  function sendBot(key, r) {
    thinking = false;
    if (destroyed || !view || key !== view.gameNo + ':' + view.moves) return;
    api.send({ a: 'bot', i: r.move, n: view.moves, g: view.gameNo });
    // If the move was lost on the way, forget that we ever thought about this position.
    api.setTimeout(function () {
      if (!destroyed && view && key === view.gameNo + ':' + view.moves && thinkKey === key) { thinkKey = null; maybeBot(); }
    }, 4000);
  }

  function searchInline(pos, cfg, key) {
    if (!inline) inline = new engine.Searcher();
    inline.start(pos, cfg);
    const tick = function () {
      if (destroyed || thinkKey !== key) return;
      if (inline.step(25)) sendBot(key, inline.result());
      else api.setTimeout(tick, 0);
    };
    tick();
  }

  function ensureWorker() {
    if (worker || workerBad) return worker;
    try {
      workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
      worker = new Worker(workerUrl);
      worker.onmessage = function (e) { sendBot(e.data.id, e.data); };
      worker.onerror = function () {
        // No worker (blocked, or it crashed): carry on with a time-sliced search on the page.
        workerBad = true; worker = null;
        if (thinking && view) { const k = thinkKey; thinkKey = null; if (k) maybeBot(); }
      };
    } catch (e) { workerBad = true; worker = null; }
    return worker;
  }

  function maybeBot() {
    const v = view;
    if (destroyed || !v || v.phase !== 'play' || !v.vsBot) return;
    const bc = botColor();
    if (!bc || v.turn !== bc || !v.seat || v.seat === bc) return;       // only the seated human drives
    if (v.players[0] === null || v.players[1] === null) return;
    const key = v.gameNo + ':' + v.moves;
    if (thinkKey === key) return;
    thinkKey = key; thinking = true;
    const pos = { b: v.b, ko: v.ko, turn: v.turn, passes: v.passes, last: v.last, komi: v.komi, hist: v.hist };
    const cfg = LEVELS[level];
    const w = ensureWorker();
    if (w) w.postMessage({ cmd: 'search', id: key, pos: pos, cfg: cfg });
    else searchInline(pos, cfg, key);
  }

  // ---- input
  function at(e) {
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * SZ, y = (e.clientY - r.top) / r.height * SZ;
    const cx = Math.round((x - M) / CELL), cy = Math.round((y - M) / CELL);
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) return -1;
    return Math.hypot(x - (M + cx * CELL), y - (M + cy * CELL)) < CELL * 0.5 ? cy * N + cx : -1;
  }

  cv.addEventListener('pointerdown', function (e) {
    if (!view) return;
    const i = at(e);
    if (i < 0) return;
    if (view.phase === 'score') { if (view.seat) api.send({ a: 'mark', i: i }); return; }
    if (view.phase !== 'play') return;
    if (!view.seat) return flash(joinFail === 'full' ? 'This table is full — MiniGo is two players.' : '👁 You are watching this table.');
    if (view.players[0] === null || view.players[1] === null) return flash('Waiting for an opponent.');
    if (view.seat !== view.turn) return flash("It isn't your turn.");
    const r = engine.applyMove(view, i, view.turn);
    if (r.err) return flash(r.err);
    hov = -1;
    api.send({ a: 'play', i: i });
  });
  cv.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    const i = at(e);
    if (i !== hov) { hov = i; draw(); }
  });
  cv.addEventListener('pointerleave', function () { hov = -1; draw(); });

  q('#b1').addEventListener('click', function () {
    if (!view || !view.seat) return;
    if (view.phase === 'play') { if (canAct()) api.send({ a: 'pass' }); }
    else if (view.phase === 'score') api.send({ a: 'accept' });
    else api.send({ a: 'new', swap: false });
  });
  q('#b2').addEventListener('click', function () {
    if (!view || !view.seat) return;
    if (view.phase === 'play') {
      if (!resArm) {
        resArm = true; render();
        api.setTimeout(function () { resArm = false; render(); }, 3000);
      } else { resArm = false; api.send({ a: 'resign' }); }
    } else if (view.phase === 'score') api.send({ a: 'resume' });
    else api.send({ a: 'new', swap: true });
  });
  root.querySelectorAll('#lvl button').forEach(function (btn) {
    btn.addEventListener('click', function () { level = btn.getAttribute('data-l'); render(); });
  });

  return {
    // Never send from mount(): the hub has not assigned the handle yet. Everything that
    // talks to the host (taking a seat, the bot's moves) starts from the first update().
    update: function (v) {
      view = v;
      maybeJoin();
      render();
      maybeBot();
    },
    // The hub routes a refusal here. MiniGo had no denied() at all, so every
    // error reduce() returned — including "the table is full" — was dropped and
    // the client just sat there watching.
    denied: function (text) {
      if (destroyed) return;
      flash(text || 'Not allowed.');
      joinFail = text || 'Not allowed.';
      // A refusal means the table could not take us: ask again shortly, since
      // a seat can open up when somebody leaves.
      if (!retryTimer) retryTimer = api.setTimeout(function () {
        retryTimer = null; joinKey = ''; maybeJoin();
      }, 2500);
    },
    destroy: function () {
      destroyed = true;
      if (worker) worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    }
  };
}
