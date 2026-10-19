// Nim — the reference starter for `scripts/new-game.mjs`.
//
// This file is what a builder agent is shown before it writes anything: a
// small, complete, correct module game with every part of the contract present
// and in the house style. Its job is to answer "what does a correct one look
// like?" without the model having to hold the contract in its head.
//
// It passes `node scripts/check-game.mjs nim` completely unmodified. That is
// the test of the starter: if the starter does not pass the gate, no builder
// run against it can be judged.

const STICKS = 15;        // on the table to start
const TAKE_MIN = 1;       // a legal move is one of these...
const TAKE_MAX = 3;       // ...up to and including this
const NAMES = { take: 'Take' };

export const meta = {
  id: 'nim',
  title: 'Nim',
  players: { min: 2, max: 2 },
  color: '#8ab4f8',
  icon: '🎯',
  desc: 'Fifteen sticks. Take one to three on your turn. Whoever takes the last stick loses.'
};

function tableOf(ctx) {
  const c = ctx || {};
  const list = c.atTable || c.seats || [];
  const ids = [];
  list.forEach(function (m) {
    if (!m || !m.id || m.spectator) return;
    if (ids.indexOf(m.id) < 0) ids.push(m.id);
  });
  return ids.slice(0, 2);
}

function fresh(ctx) {
  return {
    epoch: 0,          // bumped every time a game ends; roundId() keys on it
    players: tableOf(ctx),
    turn: '',
    sticks: STICKS,
    over: null,        // { winner } once somebody has lost
    last: { player: '', n: 0 }
  };
}

export function init(ctx) {
  const st = fresh(ctx);
  st.turn = st.players[0] || '';
  return st;
}

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const id = from.id || '';
  const kind = (action && action.a) || '';
  // `same` copies. Never write to `state` — the previous state may already
  // have been sent to another player, or written into project().
  const same = function (extra) { return Object.assign({}, state, extra); };
  // `bad` refuses. Every one of its messages is shown to a player on screen.
  const bad = function (why) { return { error: why }; };

  if (!id) return bad('No identity — reopen the game.');
  if (state.players.indexOf(id) < 0) return bad('You are watching — not seated.');

  if (kind === 'reset') {
    const st = fresh(ctx);
    st.epoch = state.epoch + 1;
    st.turn = st.players[0] || '';
    return st;
  }

  if (kind !== 'take') return bad('Unknown action: ' + kind);
  if (state.over) return bad('That game is over — reset to play again.');

  const n = action.n;
  // Every field an action carries is untrusted: any peer can send anything.
  if (typeof n !== 'number' || !Number.isInteger(n) || n < TAKE_MIN || n > TAKE_MAX) {
    return bad('Take ' + TAKE_MIN + ' to ' + TAKE_MAX + ' sticks.');
  }
  if (n > state.sticks) return bad('Only ' + state.sticks + ' left.');
  if (id !== state.turn) return bad('It is not your turn.');

  const left = state.sticks - n;
  const next = state.players[(state.players.indexOf(id) + 1) % state.players.length];

  // Taking the last stick loses — so the game is over the moment `left` hits
  // zero, and the player who emptied the table is NOT the winner.
  if (left === 0) {
    return same({
      epoch: state.epoch + 1,
      over: { winner: next },
      turn: '',
      sticks: 0,
      last: { player: id, n: n }
    });
  }
  return same({
    turn: next,
    sticks: left,
    last: { player: id, n: n }
  });
}

export function project(state, playerId) {
  // Everything here is public — a Nim board is not a secret — so the view is
  // the state plus whose seat this is. A game with hidden information must
  // build its view field by field instead.
  return Object.assign({}, state, { you: playerId || '' });
}

export function roundId(state) {
  return 'e' + ((state && state.epoch) || 0);
}

export function summarize(state, nameOf) {
  if (!state.over || !state.over.winner) return null;
  // The winner, and the player who actually emptied the table — NOT "the last
  // player in seat order", which is only the loser when the last two moves
  // happened to go that way. `last.player` is who took the last stick.
  const loser = (state.last && state.last.player) || '';
  // nameOf is the hub's own roster. Never compose a name out of an id, or the
  // shared record sheet gets "a3f9 beat 7c21 at Nim".
  return nameOf(state.over.winner) + ' beat ' + nameOf(loser) + ' at Nim';
}

export function prune(state, goneId) {
  if (state.players.indexOf(goneId) < 0) return state;
  const players = state.players.filter(function (id) { return id !== goneId; });
  if (players.length < 2) return Object.assign({}, state, { players: players, turn: '', over: { winner: '' } });
  const turn = players.indexOf(state.turn) >= 0 ? state.turn : players[0];
  return Object.assign({}, state, { players: players, turn: turn });
}

// ------------------------------------------------------------------ mount ----

export function mount(root, api) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:420px;margin:0 auto;padding:16px 12px 24px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;'
    + 'user-select:none;-webkit-user-select:none;text-align:center;';

  const head = document.createElement('div');
  head.style.cssText = 'font-size:19px;font-weight:600;margin-bottom:4px;';
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:14px;opacity:.75;min-height:20px;margin-bottom:14px;';

  const pile = document.createElement('div');
  pile.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;justify-content:center;'
    + 'min-height:64px;margin-bottom:16px;';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:center;';
  const buttons = [];
  for (let n = TAKE_MIN; n <= TAKE_MAX; n++) {
    const b = document.createElement('button');
    b.textContent = NAMES.take + ' ' + n;
    b.style.cssText = 'font:inherit;font-size:16px;min-width:72px;min-height:44px;padding:10px 14px;'
      + 'border-radius:10px;border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;';
    b.addEventListener('click', function () { api.send({ a: 'take', n: n }); });
    row.appendChild(b);
    buttons.push(b);
  }

  const reset = document.createElement('button');
  reset.textContent = 'New game';
  reset.style.cssText = 'font:inherit;font-size:14px;min-height:40px;margin-top:14px;padding:8px 14px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#1b2231;color:#e8ecf4;cursor:pointer;';
  reset.addEventListener('click', function () { api.send({ a: 'reset' }); });

  wrap.appendChild(head);
  wrap.appendChild(sub);
  wrap.appendChild(pile);
  wrap.appendChild(row);
  wrap.appendChild(reset);
  root.appendChild(wrap);

  let last = null;
  const names = {};
  ((api && api.roster) || []).forEach(function (r) { names[r.id] = r.name; });
  const who = function (id) { return names[id] || 'someone'; };

  function paintSticks(n) {
    // Repainted from scratch every time. Leaving last turn's pile on screen is
    // the bug nobody can explain and nothing logs.
    pile.textContent = '';
    for (let i = 0; i < n; i++) {
      const stick = document.createElement('span');
      stick.style.cssText = 'display:inline-block;width:5px;height:38px;border-radius:3px;background:#d8dee9;';
      pile.appendChild(stick);
    }
  }

  function update(view) {
    if (!view) return;
    const mine = view.you && view.turn === view.you;
    const yours = view.over ? null : view.turn;
    head.textContent = view.over
      ? who(view.over.winner) + ' wins'
      : 'Nim — ' + view.sticks + (view.sticks === 1 ? ' stick' : ' sticks') + ' left';
    sub.textContent = view.over
      ? 'New game to play again.'
      : (mine ? 'Your turn.' : (yours ? 'Waiting for ' + who(yours) + '.' : 'Waiting for a player.'));

    paintSticks(view.sticks);

    buttons.forEach(function (b, i) {
      const n = i + TAKE_MIN;
      b.disabled = !!(view.over || !mine || n > view.sticks);
      b.style.opacity = b.disabled ? '.45' : '1';
    });
    reset.style.display = view.over || view.epoch > 0 ? '' : 'none';
    last = view;
  }

  function denied(text) {
    sub.textContent = text || 'Not allowed.';
    sub.style.color = '#ffd479';
  }

  function destroy() {
    last = null;
  }

  return { update: update, denied: denied, destroy: destroy, get last() { return last; } };
}