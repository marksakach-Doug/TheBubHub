// Example module game — the smallest complete thing that satisfies the v10
// game contract. It exists so there is something to copy; delete the folder
// and the registry just stops listing it.
//
// Every export here is mandatory:
//   meta      -> what the button, invites and record call the game
//   init()    -> fresh authoritative state (hub runs it once, host-side)
//   reduce()  -> the ONLY place state changes; pure-ish, host-only
//   project() -> per-player view; what each client actually renders
//   mount()   -> build the UI in the shadow root, return { update, destroy }
//   summarize()-> one line for BubHub Record
//
// Try it: npm run dev, then open the game solo (Solo Corner) or in a room.

export const meta = {
  id: 'example',
  title: 'Example',
  players: '1-2',
  color: '#7dd3fc',
  icon: '🧪',
  desc: 'Reference implementation of the module contract. Copy this to start.',
  soloable: true,
  noRecord: false
};

const TARGET = 20;

// ---------------------------------------------------------------- state ----
// Scores and charges are public. `boost` is each player's secret bonus value:
// reduce() generates it with the hub-supplied rng (never Math.random, so the
// host stays deterministic and a replay reproduces), and project() is what
// keeps it hidden from everyone else.
function freshState(seats) {
  const players = (seats || []).slice(0, 2).map(function (m) { return m.id; });
  return {
    target: TARGET,
    players: players,
    turn: players[0] || null,
    scores: {},
    charges: {},
    boost: {},
    over: null
  };
}

export function init(ctx) {
  const st = freshState(ctx && ctx.seats);
  // Seed the derived fields for everyone at once so project() has something
  // consistent to redact even before anyone acts.
  st.players.forEach(function (id) { st.scores[id] = 0; st.charges[id] = 2; });
  return st;
}

// --------------------------------------------------------------- reduce ----
// Runs on the host only. Every action, whether it came from a local click or
// a remote guest's send(), arrives here — so validation lives here and nowhere
// else. Returning { error } rejects the action and routes the text back to the
// sender; returning a state applies it.
export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const rng = (ctx && ctx.rng) || Math.random;
  const id = from.id;
  const a = (action && action.a) || '';

  // Defensive: never trust a client that is not actually seated.
  if (state.over) return { error: 'This game is already over.' };
  if (!id || state.players.indexOf(id) < 0) return { error: 'You are watching — not seated.' };
  if (id !== state.turn) return { error: "It isn't your turn." };

  if (a === 'boost') {
    if (state.charges[id] <= 0) return { error: 'No boosts left.' };
    // Only reached on first spend, so both players cannot collide on the same
    // field (reduce is single-threaded on the host).
    const value = state.boost[id] || (3 + Math.floor(rng() * 6));
    const scores = Object.assign({}, state.scores);
    scores[id] += value;
    const charges = Object.assign({}, state.charges, {});
    charges[id] -= 1;
    const next = Object.assign({}, state, {
      scores: scores, charges: charges,
      boost: Object.assign({}, state.boost, { [id]: value }),
      turn: nextPlayer(state, id)
    });
    if (scores[id] >= state.target) {
      next.over = { winner: id, why: 'reached ' + state.target };
    }
    return next;
  }

  if (a === 'pass') {
    return Object.assign({}, state, { turn: nextPlayer(state, id) });
  }

  return { error: 'Unknown action: ' + a };
}

function nextPlayer(state, id) {
  const i = state.players.indexOf(id);
  return state.players[(i + 1) % state.players.length] || id;
}

// -------------------------------------------------------------- project ----
// The single most important export for multiplayer. It runs once per player
// and its return value is exactly what that client sees — so anything secret
// has to be stripped here, not in the UI. If you skip project() and just send
// `state`, you have shipped everyone's boost values to everyone.
export function project(state, playerId) {
  const boost = {};
  state.players.forEach(function (id) {
    boost[id] = (id === playerId || state.over) ? (state.boost[id] || 0) : null;
  });
  return Object.assign({}, state, { boost: boost, you: playerId });
}

// ------------------------------------------------------------ summarize ----
// Called by the hub after every reduce() so the game can log one line. Return
// null to say nothing. `nameOf` maps a player id to a display name using the
// hub's roster, so never hand-compose names yourself.
export function summarize(state, nameOf) {
  if (!state.over || !state.over.winner) return null;
  return nameOf(state.over.winner) + ' won ' + meta.title + ' (' + state.over.why + ')';
}

// ----------------------------------------------------------------- mount ----
// `root` is a Shadow DOM node: nothing you write escapes into the hub, so no
// id/class prefixing is needed. `api` carries identity, seating, send(),
// plus tracked raf/setTimeout/setInterval that the hub cancels for you when
// the game closes — use those instead of the globals and you cannot leak a loop.
export function mount(root, api) {
  root.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:16px;font:15px/1.5 system-ui,sans-serif;color:#e2e8f0';
  root.appendChild(wrap);

  let view = null;

  const btn = document.createElement('button');
  btn.textContent = 'Boost';
  btn.style.cssText = 'font:inherit;font-weight:700;padding:12px 20px;border-radius:12px;' +
    'border:1px solid #7dd3fc;background:#0e7490;color:#fff;cursor:pointer';

  // No click listener of your own decides anything — it just sends. The host
  // validates and broadcasts, so a crafted send() cannot cheat either.
  btn.addEventListener('click', function () { api.send({ a: 'boost' }); });

  const skip = document.createElement('button');
  skip.textContent = 'Pass';
  skip.style.cssText = btn.style.cssText + ';background:#334155;border-color:#64748b;margin-left:8px';
  skip.addEventListener('click', function () { api.send({ a: 'pass' }); });

  function render() {
    if (!view) return;
    const mine = view.you === view.turn;
    wrap.innerHTML = '';

    const h = document.createElement('h2');
    h.textContent = meta.title + ' — first to ' + view.target;
    h.style.cssText = 'margin:0 0 12px;font-size:18px';
    wrap.appendChild(h);

    const ul = document.createElement('ul');
    ul.style.cssText = 'list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:6px';
    view.players.forEach(function (id) {
      const li = document.createElement('li');
      const name = id === view.you ? 'You' : (api.roster.filter(function (m) { return m.id === id; })[0] || {}).name || 'Player';
      const boost = view.boost[id];
      li.textContent = name + ' — ' + view.scores[id] + ' / ' + view.target +
        '  (boosts left: ' + view.charges[id] + ')' +
        (boost ? '  secret boost: +' + boost : '') +
        (id === view.turn ? '  ← your turn' : '');
      li.style.cssText = 'padding:8px 10px;border-radius:8px;background:#1e293b;' +
        (id === view.turn ? 'border:1px solid #7dd3fc' : '');
      ul.appendChild(li);
    });
    wrap.appendChild(ul);

    if (view.over) {
      const done = document.createElement('p');
      const who = view.over.winner === view.you ? 'You win!' : 'Someone wins';
      done.textContent = who + ' — ' + view.over.why;
      done.style.cssText = 'font-weight:700;color:#7dd3fc';
      wrap.appendChild(done);
    } else if (!view.players.length) {
      const wait = document.createElement('p');
      wait.textContent = 'Waiting for players…';
      wrap.appendChild(wait);
    } else if (!mine) {
      const wait = document.createElement('p');
      // A frozen board with no explanation reads as broken. Say whose turn it is.
      wait.textContent = '👁 watching — waiting for your turn';
      wrap.appendChild(wait);
    } else {
      const row = document.createElement('div');
      row.appendChild(btn);
      row.appendChild(skip);
      wrap.appendChild(row);
    }
  }

  return {
    update: function (next) { view = next; render(); },
    destroy: function () {
      // The hub cancels tracked raf/timers and empties the shadow root for you.
      // Only clean up things the hub cannot see: audio, sockets, observers.
    }
  };
}