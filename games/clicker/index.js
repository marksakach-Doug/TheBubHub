// Clicker — a solo module game.
//
// A 9x9 grid. Level 1 lights one button; every level adds one more button in a
// random free cell. You only ever click the red button: yellow shows which cell
// will turn red next, and blue cells are waiting further back in the queue.
// Clear the whole queue before the 16.0s level clock expires to score a point
// and grow the level.
//
// Determinism lives in reduce(), and the DOM in mount() renders what project()
// hands it while driving the per-level countdown clock.

const GRID = 9;                 // 9x9, as asked for
const MAX_LEVEL = GRID * GRID;  // the grid is full; nothing can be added after this
const LEVEL_MS = 16000;         // 16.0s per level (~197.5ms/click at level 81)

export const meta = {
  id: 'clicker',
  title: 'Clicker',
  players: 'solo',
  color: '#ff6b6b',
  icon: '🎯',
  desc: 'Always click the red button. Yellow shows which cell turns red next; blue cells wait their turn. Clear each level inside 16 seconds.',
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
// step already cleared. Index 0 is red (click now), 1 is yellow (turns red
// next), and the rest are blue (waiting).
function colourOf(queue, cell, step) {
  const i = queue.indexOf(cell) - step;
  if (i === 0) return 'red';
  if (i === 1) return 'yellow';
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
    timedOut: false,// true when the level clock expires
    won: false,     // true when level 81 is cleared in time
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
    const next = freshRun(rng);
    next.players = state.players;
    next.run = state.run + 1;
    next.last = (state.timedOut || state.won)
      ? state.last
      : { score: state.score, level: state.level };
    return next;
  }

  if (kind === 'timeout') {
    if (state.timedOut || state.won) return state;
    return same({
      timedOut: true,
      last: { score: state.score, level: state.level }
    });
  }

  if (kind !== 'hit') return { error: 'Unknown action: ' + kind };

  if (state.timedOut) return { error: 'Time ran out — reset the run to play again.' };
  if (state.won) return { error: 'You beat all 81 levels — reset to play again.' };

  const cell = Number(action.cell);
  if (!isFinite(cell) || cell < 0 || cell >= GRID * GRID) {
    return { error: 'That is not a cell on the board.' };
  }
  if (state.step >= state.queue.length) return { error: 'Level already cleared.' };

  if (state.queue[state.step] !== cell) {
    const c = colourOf(state.queue, cell, state.step);
    if (c === 'yellow') {
      return { error: 'Not yet — yellow just shows which one turns red next.' };
    }
    return { error: 'Only click the red button.' };
  }

  const step = state.step + 1;

  if (step < state.queue.length) {
    // Still clearing this level. `last` is dropped here so the record sheet
    // stops reporting a run that has already been written down.
    return same({ step: step, misses: 0, last: null });
  }

  // Queue cleared inside the time limit: score a point and advance.
  const score = state.score + 1;
  if (state.level >= MAX_LEVEL) {
    return same({
      score: score,
      step: step,
      won: true,
      misses: 0,
      last: { score: score, level: state.level }
    });
  }

  const level = state.level + 1;
  return same({
    level: level,
    score: score,
    queue: deal(rng, level),
    step: 0,
    misses: 0,
    last: null
  });
}

// -------------------------------------------------------------- project ----

function viewFrom(state, you, api) {
  const cells = [];
  state.queue.forEach(function (cell, i) {
    const p = cellAt(cell);
    cells.push({
      col: p.col,
      row: p.row,
      colour: colourOf(state.queue, cell, state.step),
      done: i < state.step
    });
  });
  return {
    you: you || '',
    level: state.level,
    score: state.score,
    step: state.step,
    total: state.queue.length,
    misses: state.misses,
    timedOut: !!state.timedOut,
    won: !!state.won,
    levelMs: LEVEL_MS,
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

export function roundId(state) {
  return 'run' + ((state && state.run) || 1);
}

export function summarize(state, nameOf) {
  if (!state.last || state.last.score <= 0) return null;
  const s = state.last.score;
  return nameOf(state.players[0]) + ' scored ' + s + ' point' + (s === 1 ? '' : 's')
    + ' in Clicker, reaching level ' + state.last.level;
}

// ------------------------------------------------------------------- mount ----

export function mount(root, api) {
  const wrap = document.createElement('div');
  
  wrap.addEventListener('touchstart', function (e) {
    if (e.target !== reset) e.preventDefault();
  }, { passive: false });
  wrap.addEventListener('touchend', function (e) {
    if (e.target !== reset) e.preventDefault();
  }, { passive: false });
  wrap.addEventListener('dblclick', function (e) {
    e.preventDefault();
  });
  
wrap.style.cssText = 'max-width:min(460px, 65vh);margin:0 auto;padding:8px 10px 18px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;'
    + 'user-select:none;-webkit-user-select:none;touch-action:none;';
    
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:baseline;gap:10px;margin-bottom:4px;';

  const scoreEl = document.createElement('div');
  scoreEl.style.cssText = 'font-size:26px;font-weight:700;';
  const timerEl = document.createElement('div');
  timerEl.style.cssText = 'font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;margin-left:auto;';
  const levelEl = document.createElement('div');
  levelEl.style.cssText = 'font-size:15px;opacity:.75;';
  head.appendChild(scoreEl);
  head.appendChild(timerEl);
  head.appendChild(levelEl);

  const track = document.createElement('div');
  track.style.cssText = 'width:100%;height:6px;background:#1d2434;border-radius:3px;overflow:hidden;margin-bottom:8px;';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:100%;background:#4cd137;transition:width .05s linear;';
  track.appendChild(fill);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:14px;opacity:.8;margin-bottom:10px;min-height:20px;';

  const board = document.createElement('div');
  board.style.cssText = 'display:grid;grid-template-columns:repeat(' + GRID + ',1fr);'
    + 'gap:4px;width:100%;aspect-ratio:1/1;touch-action:none;';

  const cells = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const b = document.createElement('div');
    b.dataset.cell = String(i);
    b.style.cssText = 'border-radius:8px;background:#1d2434;border:1px solid #2b3448;'
      + 'cursor:pointer;touch-action:none;transition:background .12s ease,transform .08s ease;';
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
  [['#ff4d4d', 'click now'], ['#facc15', 'red next'], ['#2f6bd8', 'queued']].forEach(function (pair) {
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
  wrap.appendChild(track);
  wrap.appendChild(hint);
  wrap.appendChild(board);
  wrap.appendChild(bar);
  root.appendChild(wrap);

  let view = null;
  let spectating = false;
  let destroyed = false;
  let clockKey = '';
  let clockGen = 0;
  let deadline = 0;

  function startLevelClock(limitMs) {
    clockGen++;
    const gen = clockGen;
    deadline = Date.now() + limitMs;

    function tick() {
      if (destroyed || gen !== clockGen || !view) return;
      if (view.timedOut || view.won) return;
      const rem = Math.max(0, deadline - Date.now());
      const pct = Math.max(0, Math.min(100, (rem / limitMs) * 100));
      timerEl.textContent = (rem / 1000).toFixed(1) + 's';
      timerEl.style.color = rem <= 3500 ? '#ff4d4d' : (rem <= 7000 ? '#facc15' : '#8ef5a0');
      fill.style.width = pct + '%';
      fill.style.background = timerEl.style.color;

      if (rem <= 0) {
        if (!spectating) api.send({ a: 'timeout' });
        return;
      }
      api.setTimeout(tick, 50);
    }
    tick();
  }

  function onTap(cell) {
    if (spectating || !view || view.timedOut || view.won) return;
    if (view.cells.some(function (c) {
      return c.col + c.row * GRID === cell && !c.done && c.colour !== 'red';
    })) {
      wobble(cell);
      return;
    }
    api.send({ a: 'hit', cell: cell });
  }

  function wobble(cell) {
    const b = cells[cell];
    if (!b) return;
    api.setTimeout(function () { b.style.transform = ''; }, 160);
    b.style.transform = 'scale(.88)';
    b.style.transition = 'transform .08s ease';
  }

  function update(v) {
    view = v;
    spectating = !!api.isSpectator;

    const nextKey = v.run + ':' + v.level;
    if (nextKey !== clockKey && !v.timedOut && !v.won) {
      clockKey = nextKey;
      startLevelClock(v.levelMs || LEVEL_MS);
    }

    scoreEl.textContent = v.score + (v.score === 1 ? ' point' : ' points');
    levelEl.textContent = 'Level ' + v.level + ' of ' + v.maxLevel
      + '  ·  ' + v.step + '/' + v.total;

    if (v.timedOut) {
      clockGen++;
      timerEl.textContent = '0.0s';
      timerEl.style.color = '#ff4d4d';
      fill.style.width = '0%';
      hint.textContent = 'Time ran out on level ' + v.level + '! Reset to try again.';
      hint.style.color = '#ff6b6b';
    } else if (v.won) {
      clockGen++;
      hint.textContent = 'Sub-superhuman! All 81 levels cleared!';
      hint.style.color = '#8ef5a0';
    } else if (spectating) {
      hint.textContent = '👁 watching — nobody is playing at this table.';
      hint.style.color = '#ffd479';
    } else {
      hint.textContent = 'Click only the red button — yellow shows which one turns red next.';
      hint.style.color = '#e8ecf4';
    }

    cells.forEach(function (b) { b.style.background = '#1d2434'; });
    v.cells.forEach(function (c) {
      const b = cells[c.col + c.row * GRID];
      if (!b) return;
      if (c.done) b.style.background = '#1d2434';
      else if (c.colour === 'red') b.style.background = '#ff4d4d';
      else if (c.colour === 'yellow') b.style.background = '#facc15';
      else b.style.background = '#2f6bd8';
    });

    reset.style.display = (v.score > 0 || v.timedOut || v.won) ? '' : 'none';
  }

  function denied(text) {
    hint.textContent = text || 'Not allowed.';
    hint.style.color = '#ffd479';
  }

  function destroy() {
    destroyed = true;
    clockGen++;
    view = null;
    cells.forEach(function (b) { b.replaceWith(b.cloneNode(true)); });
  }

  return { update: update, denied: denied, destroy: destroy };
}
