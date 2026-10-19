// Clicker — a solo module game.
//
// A 9x9 grid. Level 1 lights one button; every level adds one more button in a
// random free cell. The buttons carry a hidden order: the one you owe a click
// is red, the one that comes after it is orange, everything else is blue. Clear
// the whole queue and you score a point and the level grows.
//
// The contract has no tick — nothing moves except when the player clicks — so
// every rule below lives in reduce(), and the DOM in mount() only ever renders
// what project() hands it.

const GRID = 9;                 // 9x9, as asked for
const MAX_LEVEL = GRID * GRID;  // the grid is full; nothing can be added after this

export const meta = {
  id: 'clicker',
  title: 'Clicker',
  players: 'solo',
  color: '#ff6b6b',
  icon: '🎯',
  desc: 'One button is red, the next is orange, the rest are blue. Clear the queue to score, and the grid grows a button every level.',
  solo: true
};

// ---------------------------------------------------------------- helpers ----

// A shuffled queue of cells, one per level. The shuffle is what makes the red
// button jump around between levels rather than always being the newest one.
function deal(rng, level) {
  const free = [];
  for (let i = 0; i < GRID * GRID; i++) free.push(i);
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = free[i]; free[i] = free[j]; free[j] = t;
  }
  return free.slice(0, Math.min(level, MAX_LEVEL));
}

function cellAt(cell) {
  return { col: cell % GRID, row: Math.floor(cell / GRID) };
}

// How a cell should be painted, from its position in the queue RELATIVE to the
// step already cleared. Index 0 is red (click me now), 1 orange (then me), the
// rest blue. The offset matters: at step 1 of 5, the queue's own index 1 is the
// one owed a click, not the one after it.
function colourOf(queue, cell, step) {
  const i = queue.indexOf(cell) - step;
  if (i === 0) return 'red';
  if (i === 1) return 'orange';
  return 'blue';
}

// ------------------------------------------------------------------ state ----

function freshRun(rng) {
  return {
    players: [],
    level: 1,
    score: 0,
    queue: deal(rng, 1),
    step: 0,        // how many of `queue` have been cleared
    misses: 0,      // wrong clicks this run, shown as a wobble
    last: null,     // { score, level } of a finished run, for the record sheet
    run: 1          // bumped per reset; roundId() keys on it
  };
}

// The hub hands init() the whole room roster under `seats`, which is not who is
// at this table — `atTable` is. Skip spectators: a watcher with a queue to play
// is worse than no lobby at all.
function tableOf(ctx) {
  const c = ctx || {};
  const list = c.atTable || c.seats || [];
  const ids = [];
  list.forEach(function (m) {
    if (!m || !m.id || m.spectator) return;
    if (ids.indexOf(m.id) < 0) ids.push(m.id);
  });
  return ids.slice(0, 1);   // solo by nature: seat exactly one
}

export function init(ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  const st = freshRun(rng);
  st.players = tableOf(ctx);
  return st;
}

// ----------------------------------------------------------------- reduce ----

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const rng = (ctx && ctx.rng) || Math.random;
  const id = from.id || '';
  const kind = (action && action.a) || '';
  const same = function (extra) { return Object.assign({}, state, extra); };

  if (!id) return { error: 'No identity — reopen the game.' };
  if (state.players.indexOf(id) < 0) return { error: 'You are watching — not seated.' };

  if (kind === 'reset') {
    // A solo table of one is always its own host, and ctx.from.host is true in
    // the Solo Corner too — but this game has nothing table-shared to gate, so
    // the seated check above is the whole permission model.
    const next = freshRun(rng);
    next.players = state.players;
    next.run = state.run + 1;
    next.last = { score: state.score, level: state.level };
    return next;
  }

  if (kind !== 'hit') return { error: 'Unknown action: ' + kind };

  const cell = Number(action.cell);
  if (!isFinite(cell) || cell < 0 || cell >= GRID * GRID) {
    return { error: 'That is not a cell on the board.' };
  }
  if (state.step >= state.queue.length) return { error: 'Level already cleared.' };

  if (state.queue[state.step] !== cell) {
    // A wrong click costs nothing but the step is unchanged, so the red button
    // stays exactly where it was. The wobble is cosmetic and lives in the view.
    return { error: 'That one is blue — find the red button.' };
  }

  const step = state.step + 1;

  if (step < state.queue.length) {
    // Still clearing this level. `last` is dropped here so the record sheet
    // stops reporting a run that has already been written down.
    return same({ step: step, misses: 0, last: null });
  }

  // Queue cleared: a point, and one more button for the next level. Nothing is
  // laid out until the player clicks, so the new board appears on this view.
  const level = state.level + 1;
  return same({
    level: level,
    score: state.score + 1,
    queue: level > MAX_LEVEL ? state.queue : deal(rng, level),
    step: 0,
    misses: 0,
    last: null
  });
}

// -------------------------------------------------------------- project ----

// One place that turns state into a view, so `project()` and the defensive
// path in update() can never drift apart.
function viewFrom(state, you, api) {
  // Cells are public information — they are on the board either way — but the
  // queue is not, so the view carries colours rather than the order itself. The
  // colour IS the order to the client, which is the point: the board tells you
  // what to do, and only `step` tells the hub how far you have got.
  const cells = [];
  state.queue.forEach(function (cell, i) {
    const p = cellAt(cell);
    cells.push({ col: p.col, row: p.row, colour: colourOf(state.queue, cell, state.step), done: i < state.step });
  });
  return {
    you: you || '',
    level: state.level,
    score: state.score,
    step: state.step,
    total: state.queue.length,
    misses: state.misses,
    run: state.run,
    last: state.last,
    cells: cells,
    maxLevel: MAX_LEVEL,
    clear: state.step >= state.queue.length,
    roster: (api && api.roster) || null
  };
}

export function project(state, playerId, api) {
  return viewFrom(state, playerId, api);
}

// ------------------------------------------------------------------ record ----

// A stable id for the run `state` is currently in. summarize() re-succeeds on
// every reduce() after a reset, so keying on the sentence would either throttle
// genuinely distinct identical runs or write the same run to the sheet twice.
export function roundId(state) {
  return 'run' + ((state && state.run) || 1);
}

export function summarize(state, nameOf) {
  // Clicker has no natural finish line — it runs until you press Reset — so the
  // run is reported when it ends, and `last` is cleared on the first click of
  // the next one. Null while a run is still going.
  if (!state.last || state.last.score <= 0) return null;
  const s = state.last.score;
  return nameOf(state.players[0]) + ' scored ' + s + ' point' + (s === 1 ? '' : 's')
    + ' in Clicker, reaching level ' + state.last.level;
}

// ------------------------------------------------------------------- mount ----

export function mount(root, api) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:520px;margin:0 auto;padding:8px 10px 18px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;'
    + 'user-select:none;-webkit-user-select:none;';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:baseline;gap:10px;margin-bottom:2px;';

  const scoreEl = document.createElement('div');
  scoreEl.style.cssText = 'font-size:26px;font-weight:700;';
  const levelEl = document.createElement('div');
  levelEl.style.cssText = 'font-size:16px;opacity:.75;margin-left:auto;';
  head.appendChild(scoreEl);
  head.appendChild(levelEl);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:14px;opacity:.8;margin-bottom:10px;min-height:20px;';

  const board = document.createElement('div');
  board.style.cssText = 'display:grid;grid-template-columns:repeat(' + GRID + ',1fr);'
    + 'gap:4px;width:100%;aspect-ratio:1/1;touch-action:manipulation;';

  const cells = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const b = document.createElement('div');
    b.dataset.cell = String(i);
    b.style.cssText = 'border-radius:8px;background:#1d2434;border:1px solid #2b3448;'
      + 'cursor:pointer;transition:background .12s ease,transform .08s ease;';
    // pointerdown, not click: a tap that starts as a scroll must not count as a
    // miss, and touch-action:manipulation above stops the 300ms delay.
    b.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      onTap(Number(b.dataset.cell));
    });
    board.appendChild(b);
    cells.push(b);
  }

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:12px;';
  const reset = document.createElement('button');
  reset.textContent = 'Reset run';
  reset.style.cssText = 'font:inherit;font-size:15px;padding:9px 14px;min-height:40px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;';
  reset.addEventListener('click', function () { api.send({ a: 'reset' }); });
  const legend = document.createElement('div');
  legend.style.cssText = 'font-size:13px;opacity:.7;margin-left:auto;text-align:right;';
  // Built with real elements, not innerHTML. Nothing here comes from another
  // player, but the habit is the point: every game in this repo that reaches
  // for innerHTML is one refactor away from shipping someone else's <script>.
  [['#ff4d4d', 'click me'], ['#ff9f43', 'then me'], ['#2f6bd8', 'not yet']].forEach(function (pair) {
    const bit = document.createElement('span');
    bit.style.color = pair[0];
    const box = document.createElement('span');
    box.style.cssText = 'font-size:11px;vertical-align:middle;';
    box.textContent = '■';
    bit.appendChild(box);
    bit.appendChild(document.createTextNode(' ' + pair[1]));
    legend.appendChild(bit);
    legend.appendChild(document.createTextNode('  '));
  });
  bar.appendChild(reset);
  bar.appendChild(legend);

  wrap.appendChild(head);
  wrap.appendChild(hint);
  wrap.appendChild(board);
  wrap.appendChild(bar);
  root.appendChild(wrap);

  // Live view of what the last update painted, kept so a local tap can be
  // ignored instantly rather than waiting for the round trip.
  let view = null;
  let spectating = false;

  function onTap(cell) {
    if (spectating || !view) return;
    // Local courtesy check only. The authority is reduce(); this just stops a
    // tap on a blue square from becoming a round trip and a red wobble.
    if (view.cells.some(function (c) {
      return c.col + c.row * GRID === cell && !c.done && c.colour !== 'red';
    })) {
      wobble(cell);
      return;
    }
    api.send({ a: 'hit', cell: cell });
  }

  let wobbleId = 0;
  function wobble(cell) {
    const b = cells[cell];
    if (!b) return;
    const to = api.setTimeout(function () { b.style.transform = ''; }, 160);
    b.style.transform = 'scale(.88)';
    b.style.transition = 'transform .08s ease';
    wobbleId = to;
  }

  function update(v) {
    view = v;
    spectating = !!api.isSpectator;

    scoreEl.textContent = v.score + (v.score === 1 ? ' point' : ' points');
    levelEl.textContent = 'Level ' + v.level + ' of ' + v.maxLevel
      + '  ·  ' + v.step + '/' + v.total;

    if (spectating) {
      hint.textContent = '👁 watching — nobody is playing at this table.';
      hint.style.color = '#ffd479';
    } else if (v.clear) {
      hint.textContent = 'Level ' + v.level + ' cleared! Click any button.';
      hint.style.color = '#8ef5a0';
    } else {
      hint.textContent = 'Click the red button, then the orange one.';
      hint.style.color = '#e8ecf4';
    }

    // Paint every cell from the view — a stale colour left over from the
    // previous level is the one bug this board cannot show.
    cells.forEach(function (b) { b.style.background = '#1d2434'; });
    v.cells.forEach(function (c) {
      const b = cells[c.col + c.row * GRID];
      if (!b) return;
      if (c.done) b.style.background = '#1d2434';
      else if (c.colour === 'red') b.style.background = '#ff4d4d';
      else if (c.colour === 'orange') b.style.background = '#ff9f43';
      else b.style.background = '#2f6bd8';
    });

    reset.style.display = v.score > 0 ? '' : 'none';
  }

  // The hub routes a refused intent here so the board can say why.
  function denied(text) {
    hint.textContent = text || 'Not allowed.';
    hint.style.color = '#ffd479';
  }

  function destroy() {
    view = null;
    cells.forEach(function (b) { b.replaceWith(b.cloneNode(true)); });
  }

  return { update: update, denied: denied, destroy: destroy };
}