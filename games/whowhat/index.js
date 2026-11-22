// Who Did What?: a module game for Bub Hub.
//
// Everyone writes one true thing they did in the last five years, unsigned.
// Then everyone guesses who wrote each line. A right guess scores 1 point.
// Every wrong guess on your line scores you 1 point: you tricked them.
// Rules live only in reduce(). project() hides authorship until the reveal.

export const meta = {
  id: 'whowhat',
  title: 'Who Did What?',
  players: '3-8',
  color: '#00694E',
  icon: '🕵️',
  desc: 'Write one true thing you did in the last few years. Guess who wrote the rest.',
};

const MIN_SEATS = 3;
const MAX_SEATS = 8;
const MAX_LINE = 140;
const TOTAL_ROUNDS = 5;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = (s) => JSON.parse(JSON.stringify(s));
const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Used by prune() (no rng there). Keyed to the round so seat order never shows authorship.
function scrambled(list, seed) {
  const h = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619); return x >>> 0; };
  return list.slice().sort((x, y) => (h(seed + x) - h(seed + y)) || (x < y ? -1 : 1));
}

function seatAll(order, names, list) {
  (list || []).forEach((p) => {
    if (!p || !p.id) return;
    const nm = clean(p.name);
    if (order.indexOf(p.id) >= 0) { if (nm) names[p.id] = nm; return; }
    if (order.length >= MAX_SEATS) return;
    order.push(p.id);
    names[p.id] = nm || 'someone';
  });
}

// ---------------------------------------------------------------- contract

export function init(ctx) {
  const order = [];
  const names = {};
  seatAll(order, names, ctx && ctx.atTable);
  return {
    epoch: 0,
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    gameOver: false,
    phase: 'lobby',     // lobby | write | guess | reveal
    order,              // seated players
    names,              // id -> name
    writers: [],        // who must write and guess this round (snapshot at start)
    lines: {},          // writer id -> their line (hidden until reveal)
    shuffle: [],        // writer ids in the order the lines are shown (authorship)
    guesses: {},        // guesser id -> array: author id per shuffle index (null for own)
    scores: {},
  };
}

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const id = from.id || '';
  const rng = (ctx && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
  if (!id) return { error: 'Sit down at the table first.' };
  const a = action && action.a;
  const s = clone(state);
  if (a === 'join') {
    if (s.order.length >= MAX_SEATS && s.order.indexOf(id) < 0) return { error: 'The table is full. Eight is the most.' };
    seatAll(s.order, s.names, [{ id, name: from.name }]);
    return s;
  }
  if (a === 'start') return start(s, from, ctx);
  if (a === 'line') return line(s, id, from, action, rng);
  if (a === 'guess') return guess(s, id, action);
  if (a === 'reveal') return from.host ? finish(s) : { error: 'Only the host can reveal early.' };
  if (a === 'lobby') return from.host ? toLobby(s) : { error: 'Only the host can go back to the lobby.' };
  return { error: 'That is not a move in this game.' };
}

function start(s, from, ctx) {
  if (!from.host) return { error: 'Only the host starts the game.' };
  if (s.phase === 'write' || s.phase === 'guess') return { error: 'A round is already running.' };
  seatAll(s.order, s.names, ctx && ctx.atTable);
  if (s.order.length < MIN_SEATS) return { error: 'Need ' + MIN_SEATS + ' people seated. Anyone missing should press "Sit in".' };
  const newMatch = (s.phase === 'lobby' || s.gameOver);
  s.epoch = s.phase === 'lobby' ? s.epoch : s.epoch + 1;
  if (newMatch) {
    s.round = 0;
    s.scores = {};
    s.gameOver = false;
  }
  s.round += 1;
  s.totalRounds = TOTAL_ROUNDS;
  s.writers = s.order.slice();
  s.lines = {};
  s.shuffle = [];
  s.guesses = {};
  s.phase = 'write';
  return s;
}

function line(s, id, from, action, rng) {
  if (s.phase !== 'write') return { error: 'Lines are not open right now.' };
  if (s.writers.indexOf(id) < 0) return { error: "You're not in this round. Sit in for the next one." };
  const text = clean(action && action.text);
  if (!text) return { error: 'Write something first.' };
  if (text.length > MAX_LINE) return { error: 'Keep it under ' + MAX_LINE + ' characters.' };
  s.lines[id] = text;
  s.names[id] = clean(from.name) || s.names[id];
  if (s.writers.every((w) => has(s.lines, w))) {
    s.shuffle = shuffled(s.writers, rng);
    s.phase = 'guess';
  }
  return s;
}

function guess(s, id, action) {
  if (s.phase !== 'guess') return { error: 'Guesses are not open right now.' };
  if (s.writers.indexOf(id) < 0) return { error: "You're not in this round." };
  const picks = action && action.picks;
  const n = s.shuffle.length;
  if (!Array.isArray(picks) || picks.length !== n) return { error: 'Guess every line first.' };
  for (let i = 0; i < n; i++) {
    if (s.shuffle[i] === id) continue;   // your own line: nothing to guess
    if (s.writers.indexOf(picks[i]) < 0) return { error: 'Pick a name for every line that is not yours.' };
  }
  s.guesses[id] = picks.map((p, i) => (s.shuffle[i] === id ? null : p));
  if (s.writers.every((w) => has(s.guesses, w))) return finish(s);
  return s;
}

// Scores. Right guess: +1 to the guesser. Wrong guess: +1 to the author (tricked).
// Someone who never guessed gives nobody anything.
function finish(s) {
  if (s.phase !== 'guess') return { error: 'Nothing to reveal yet.' };
  const scores = {};
  s.writers.forEach((w) => { scores[w] = (s.scores && s.scores[w]) || 0; });
  s.writers.forEach((g) => {
    if (!has(s.guesses, g)) return;
    s.shuffle.forEach((author, i) => {
      if (author === g) return;
      if (s.guesses[g][i] === author) scores[g] += 1;
      else scores[author] += 1;
    });
  });
  s.scores = scores;
  s.phase = 'reveal';
  if (s.round >= (s.totalRounds || TOTAL_ROUNDS)) s.gameOver = true;
  return s;
}

function toLobby(s) {
  s.epoch += 1;
  s.phase = 'lobby';
  s.round = 0;
  s.totalRounds = TOTAL_ROUNDS;
  s.gameOver = false;
  s.writers = [];
  s.lines = {};
  s.shuffle = [];
  s.guesses = {};
  s.scores = {};
  return s;
}

// A player leaves. Lobby and reveal just lose a seat. A leaver mid-write is
// dropped from the round; mid-guess, the round is abandoned (the lines would
// no longer line up with the guesses).
export function prune(state, goneId) {
  const s = clone(state);
  s.order = s.order.filter((x) => x !== goneId);
  if (s.phase !== 'write' && s.phase !== 'guess') return s;
  if (s.writers.indexOf(goneId) < 0) return s;
  if (s.phase === 'guess' || s.writers.length - 1 < MIN_SEATS) return toLobby(s);
  s.writers = s.writers.filter((x) => x !== goneId);
  delete s.lines[goneId];
  if (s.writers.every((w) => has(s.lines, w))) {
    s.shuffle = scrambled(s.writers, s.epoch + ':' + s.round);
    s.phase = 'guess';
  }
  return s;
}

export function roundId(state) {
  return 'e' + state.epoch + 'r' + state.round;
}

export function project(state, playerId) {
  const names = state.names;
  const reveal = state.phase === 'reveal';
  const showEntries = state.phase === 'guess' || reveal;
  return {
    you: playerId,
    phase: state.phase,
    epoch: state.epoch,
    round: state.round,
    totalRounds: state.totalRounds || TOTAL_ROUNDS,
    gameOver: !!state.gameOver,
    seated: state.order.map((x) => ({ id: x, name: names[x] || '…' })),
    writers: state.writers.map((x) => ({ id: x, name: names[x] || '…' })),
    canJoin: state.order.indexOf(playerId) < 0 && state.order.length < MAX_SEATS,
    isWriter: state.writers.indexOf(playerId) >= 0,
    writersTotal: state.writers.length,
    writtenCount: state.writers.filter((w) => has(state.lines, w)).length,
    myLine: has(state.lines, playerId) ? state.lines[playerId] : null,
    entries: showEntries ? state.shuffle.map((wid, i) => ({
      i,
      text: state.lines[wid],
      mine: wid === playerId,
      author: reveal ? (names[wid] || '…') : null,
    })) : [],
    myGuessed: has(state.guesses, playerId),
    guessedCount: state.writers.filter((w) => has(state.guesses, w)).length,
    board: state.order.map((x) => ({
      id: x,
      name: names[x] || '…',
      points: state.scores[x] || 0,
      you: x === playerId,
    })).sort((p, q) => q.points - p.points),
  };
}

export function summarize(state, nameOf) {
  if (state.phase !== 'reveal') return null;
  const ids = Object.keys(state.scores);
  if (!ids.length) return null;
  const best = ids.slice().sort((x, y) => state.scores[y] - state.scores[x])[0];
  return nameOf(best) + ' fooled the table best this round.';
}

// ---------------------------------------------------------------- view

const CSS = `
.card{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#00694E;color:#F4F1E8;padding:16px;border-radius:10px;max-width:640px}
h2{margin:0 0 4px;font-size:22px}
.box{background:#024230;border-radius:8px;padding:12px;margin:10px 0}
.muted{opacity:.8;font-size:13px;margin:6px 0}
textarea{width:100%;min-height:70px;padding:10px;border-radius:6px;border:0;font:16px system-ui,sans-serif;box-sizing:border-box}
button{background:#F4F1E8;color:#024230;border:0;border-radius:6px;padding:9px 14px;font-weight:700;cursor:pointer;margin:4px 4px 4px 0}
button[disabled]{opacity:.4;cursor:not-allowed}
button.on{background:#024230;color:#F4F1E8;outline:2px solid #F4F1E8}
.entry{border-top:1px solid #024230;padding:10px 0}
.chip{display:inline-block;background:#024230;border-radius:999px;padding:3px 10px;margin:3px}
.chip b{color:#F4F1E8}
`;

export function mount(root, api) {
  const style = document.createElement('style');
  style.textContent = CSS;
  const card = document.createElement('div');
  card.className = 'card';
  root.appendChild(style);
  root.appendChild(card);
  const el = card;
  let view = null;
  let key = null;
  let draft = '';
  let picks = null;   // one author id (or null) per shuffle index

  function body() {
    const v = view;
    if (v.phase === 'lobby') {
      return '<div class="box"><p class="muted">There are 5 rounds. Each round, everyone writes one thing they did in the last few years that the other people dont know about. '
        + ' Everyone guesses who wrote each line. Right guess: 1 point, and when someone guesses wrong on your line: 1 point.' + 'This is for us to catch up with each other. I made it so the game has actual OU color themes.</p></div>'        + '<div class="box">' + v.seated.map((p) => '<span class="chip">' + esc(p.name) + '</span>').join('') + '</div>'
        + (v.canJoin ? '<button data-act="join">Sit in</button>' : '')
        + (api.isHost ? '<button data-act="start" ' + (v.seated.length < MIN_SEATS ? 'disabled' : '') + '>Start (need ' + MIN_SEATS + ')</button>' : '<p class="muted">The host starts the game.</p>');
    }
    if (v.phase === 'write') {
      if (v.isWriter && !v.myLine) {
        return '<div class="box"><p>Write one true thing you did in the last few years. </p>'
          + '<textarea id="line" maxlength="' + MAX_LINE + '" placeholder="I once...">' + esc(draft) + '</textarea>'
          + '<button data-act="send">Send it in</button></div>';
      }
      const sitting = v.isWriter ? '' : '<p class="muted">You are sitting this round out.</p>';
      return '<div class="box"><p>' + (v.isWriter ? 'Your line is in.' : '') + ' Waiting on ' + (v.writersTotal - v.writtenCount) + ' more.</p>' + sitting + '</div>'
        + (api.isHost ? '<button data-act="reveal">Skip ahead to guessing</button>' : '');
    }
    if (v.phase === 'guess') {
      if (!v.isWriter) return '<div class="box"><p>Watching. Lines are in, guessing is on.</p></div>';
      if (v.myGuessed) return '<div class="box"><p>Locked in. Waiting on ' + (v.writersTotal - v.guessedCount) + ' more guesses.</p></div>';
      const rows = v.entries.filter((e) => !e.mine).map((e) => '<div class="entry"><p>#' + (e.i + 1) + ': ' + esc(e.text) + '</p>'
        + v.writers.map((w) => '<button data-pick="' + e.i + '" data-who="' + w.id + '" class="' + (picks[e.i] === w.id ? 'on' : '') + '">' + esc(w.name) + '</button>').join('')
        + '</div>').join('');
      const ready = v.entries.every((e) => e.mine || picks[e.i] !== null);
      return '<div class="box"><p>Who wrote each one? (Yours is marked.)</p>' + v.entries.map((e) => e.mine ? '<div class="entry muted">#' + (e.i + 1) + ' (yours): ' + esc(e.text) + '</div>' : '').join('')
        + rows + '<button data-act="lock" ' + (ready ? '' : 'disabled') + '>Lock my guesses</button></div>';
    }
    // reveal
    const lines = v.entries.map((e) => '<div class="entry"><p>' + esc(e.text) + '</p><p class="muted">Written by <b>' + esc(e.author) + '</b></p></div>').join('');
    const toast = v.gameOver ? (function () {
      const best = Math.max.apply(null, v.board.map((p) => p.points));
      const winners = v.board.filter((p) => p.points === best).map((p) => p.name);
      const msg = winners.length === 1 ? winners[0] + ' won the game!' : winners.join(' and ') + ' won the game! It is a Thai.';
      return '<div class="box" style="text-align:center;font-size:24px;font-weight:800;margin:10px 0">' + esc(msg) + '</div>';
    })() : '';
    const acts = v.gameOver
      ? (api.isHost ? '<button data-act="start">Play again</button><button data-act="lobby">Back to lobby</button>' : '<p class="muted">The host can play again or go back to the lobby.</p>')
      : (api.isHost ? '<button data-act="start">Next round</button><button data-act="lobby">Back to lobby</button>' : '<p class="muted">The host starts the next round.</p>');
    return '<div class="box"><h2>Round ' + v.round + ' of ' + v.totalRounds + ' reveal</h2>' + lines + '</div>'
      + toast + acts;
  }

  function render() {
    if (!view) return;
    const k = view.epoch + ':' + view.round + ':' + view.phase;
    if (k !== key) {
      key = k;
      draft = '';
      picks = view.phase === 'guess' ? view.entries.map(() => null) : null;
    }
    const board = '<div class="box"><div class="muted"><b>Scores</b></div>' + view.board.map((p) => '<span class="chip' + (p.you ? '" style="outline:1px solid #F4F1E8' : '') + '">'
      + esc(p.name) + ' <b>' + p.points + '</b></span>').join('') + '</div>';
    const html = '<h2>Who Did What?</h2>' + body() + (view.phase === 'lobby' ? '' : board);
    if (typeof document.createRange === 'function') {
      el.replaceChildren(document.createRange().createContextualFragment(html));
    } else {
      el.textContent = html;
    }
  }

  function onClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-pick')) {
      picks[Number(t.getAttribute('data-pick'))] = t.getAttribute('data-who');
      render();
      return;
    }
    const act = t.getAttribute('data-act');
    if (act === 'join') api.send({ a: 'join' });
    else if (act === 'start') api.send({ a: 'start' });
    else if (act === 'lobby') api.send({ a: 'lobby' });
    else if (act === 'reveal') api.send({ a: 'reveal' });
    else if (act === 'send') {
      const text = clean(draft);
      if (text) api.send({ a: 'line', text });
    } else if (act === 'lock') api.send({ a: 'guess', picks: picks.slice() });
  }

  function onInput(e) {
    if (e.target && e.target.id === 'line') draft = e.target.value;
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);

  return {
    update(v) {
      view = v;
      if (v.canJoin) api.send({ a: 'join' });
      render();
    },
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
    },
  };
}
