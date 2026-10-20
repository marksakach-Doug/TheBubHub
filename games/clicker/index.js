const GRID = 9;
const CELLS = GRID * GRID;
const MAX_LEVEL = CELLS;
const LEVEL_MS = 16000;
const BG = '#1d2434';
const COLOURS = { red: '#ff4d4d', yellow: '#facc15', blue: '#2f6bd8' };

export const meta = {
  id: 'clicker',
  title: 'Clicker',
  players: 'solo',
  color: '#ff6b6b',
  icon: '🎯',
  desc: 'Always click the red button. Yellow shows which cell turns red next. Blue cells wait their turn. Clear each level inside 16 seconds.',
  solo: true
};

// Fisher-Yates over all cells; the first `level` are the queue. (rng call order matters for seeded replays.)
function deal(rng, level) {
  const free = Array.from({ length: CELLS }, (_, i) => i);
  for (let i = CELLS - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return free.slice(0, Math.min(level, MAX_LEVEL));
}

const freshRun = (rng) => ({
  score: 0, queue: deal(rng, 1), step: 0,
  paused: false, timedOut: false, won: false, last: null, run: 1
});

export function init(ctx) {
  const c = ctx || {};
  const seat = (c.atTable || c.seats || []).find((m) => m && m.id && !m.spectator);
  return { ...freshRun(c.rng || Math.random), players: seat ? [seat.id] : [] };
}

export function reduce(state, action, ctx) {
  const c = ctx || {};
  const id = (c.from && c.from.id) || '';
  const rng = c.rng || Math.random;
  const kind = (action && action.a) || '';
  const same = (extra) => ({ ...state, ...extra });
  const over = state.timedOut || state.won;

  if (!id) return { error: 'No identity. Reopen the game.' };
  if (!state.players.includes(id)) return { error: 'You are watching. Not seated.' };

  if (kind === 'reset') {
    return {
      ...freshRun(rng), players: state.players, run: state.run + 1,
      last: over ? state.last : { score: state.score }
    };
  }
  if (kind === 'timeout') return over ? state : same({ timedOut: true, last: { score: state.score } });
  if (kind === 'next') {
    return state.paused ? same({ paused: false, queue: deal(rng, state.score + 1), step: 0 }) : state;
  }
  if (kind !== 'hit') return { error: 'Unknown action: ' + kind };
  if (state.timedOut) return { error: 'Time ran out. Reset the run to play again.' };
  if (state.won) return { error: 'You beat all 81 levels. Reset to play again.' };

  const { queue } = state;
  const cell = Number(action.cell);
  if (!(cell >= 0 && cell < CELLS)) return { error: 'That is not a cell on the board.' };
  if (state.step >= queue.length) return { error: 'Level already cleared.' };
  if (queue[state.step] !== cell) {
    return { error: queue[state.step + 1] === cell
      ? 'Do not click yellow.'
      : 'Only click the red button.' };
  }

  const step = state.step + 1;
  if (step < queue.length) return same({ step, last: null });
  const score = state.score + 1;
  const won = score >= MAX_LEVEL;
  return same({ score, step, won, paused: !won, last: won ? { score } : null });
}

export function project(state, playerId, api) {
  const { queue, step, score, paused } = state;
  return {
    you: playerId || '',
    level: Math.min(score + 1, MAX_LEVEL),
    score, step, paused,
    total: queue.length,
    timedOut: !!state.timedOut,
    won: !!state.won,
    levelMs: LEVEL_MS,
    run: state.run,
    last: state.last,
    cells: paused ? [] : queue.map((cell, i) => {
      const p = cellAt(cell);
      return { cell, col: p.col, row: p.row, done: i < step,
        colour: i === step ? 'red' : i === step + 1 ? 'yellow' : 'blue' };
    }),
    maxLevel: MAX_LEVEL,
    roster: (api && api.roster) || null
  };
}

function cellAt(cell) {
  return { col: cell % GRID, row: Math.floor(cell / GRID) };
}

export const roundId = (state) => 'run' + ((state && state.run) || 1);

export function summarize(state, nameOf) {
  const s = state.last ? state.last.score : 0;
  if (!(s > 0)) return null;
  return `${nameOf(state.players[0])} scored ${s} point${s === 1 ? '' : 's'} in Clicker, reaching level ${Math.min(s + 1, MAX_LEVEL)}`;
}

export function mount(root, api) {
  const el = (css, text = '', tag = 'div') => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    e.textContent = text;
    return e;
  };

  const wrap = el('position:relative;max-width:min(460px, 65vh);margin:0 auto;padding:8px 10px 18px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;'
    + 'user-select:none;-webkit-user-select:none;touch-action:none;');
  const head = el('display:flex;align-items:baseline;gap:10px;margin-bottom:4px;');
  const scoreEl = el('font-size:26px;font-weight:700;');
  const timerEl = el('font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;margin-left:auto;');
  const levelEl = el('font-size:15px;opacity:.75;');
  head.append(scoreEl, timerEl, levelEl);

  const track = el('width:100%;height:6px;background:' + BG + ';border-radius:3px;overflow:hidden;margin-bottom:8px;');
  const fill = el('height:100%;width:100%;background:#4cd137;transition:width .05s linear;');
  track.append(fill);
  const hint = el('font-size:14px;opacity:.8;margin-bottom:10px;min-height:20px;');

  const board = el('display:grid;grid-template-columns:repeat(' + GRID + ',1fr);'
    + 'gap:4px;width:100%;aspect-ratio:1/1;touch-action:none;');
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const b = el('border-radius:8px;background:' + BG + ';border:1px solid #2b3448;'
      + 'cursor:pointer;touch-action:none;transition:background .12s ease,transform .08s ease;');
    b.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault();
      onTap(i);
    });
    return b;
  });
  board.append(...cells);

  const card = el('display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'flex-direction:column;align-items:center;gap:10px;padding:26px;text-align:center;'
    + 'background:rgba(29,36,52,.95);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);'
    + 'z-index:10;');
  const scoreBig = el('font-size:48px;font-weight:700;');
  const moreSmall = el('font-size:18px;opacity:.8;');
  const nextBtn = el('font:inherit;font-size:18px;padding:10px 20px;border-radius:8px;border:none;background:#4cd137;color:#111;cursor:pointer;', 'NEXT', 'button');
  nextBtn.addEventListener('click', () => api.send({ a: 'next' }));
  card.append(scoreBig, moreSmall, nextBtn);

  const bar = el('display:flex;align-items:center;gap:10px;margin-top:12px;');
  const reset = el('font:inherit;font-size:15px;padding:9px 14px;min-height:40px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;', 'Reset run', 'button');
  reset.addEventListener('click', () => api.send({ a: 'reset' }));
;
  bar.append(reset);

  // Block page gestures (scroll/zoom/double-tap) everywhere except the reset button.
  ['touchstart', 'touchend'].forEach((t) => wrap.addEventListener(t, (e) => {
    if (e.target !== reset) e.preventDefault();
  }, { passive: false }));
  wrap.addEventListener('dblclick', (e) => e.preventDefault());

  wrap.append(head, track, hint, board, card, bar);
  root.append(wrap);

  let view = null, spectating = false, destroyed = false;
  let clockKey = '', clockGen = 0, deadline = 0;

  function startLevelClock(limitMs) {
    const gen = ++clockGen;
    deadline = Date.now() + limitMs;
    function tick() {
      const now = Date.now();
      if (tick.l === now) return;
      tick.l = now;
      if (destroyed || gen !== clockGen || !view || view.timedOut || view.won) return;
      const rem = Math.max(0, deadline - now);
      const col = rem <= 3500 ? '#ff4d4d' : rem <= 7000 ? '#facc15' : '#8ef5a0';
      timerEl.textContent = (rem / 1000).toFixed(1) + 's';
      timerEl.style.color = col;
      fill.style.width = Math.min(100, (rem / limitMs) * 100) + '%';
      fill.style.background = col;
      if (rem > 0) api.setTimeout(tick, 50);
      else if (!spectating) api.send({ a: 'timeout' });
    }
    tick();
  }

  function onTap(cell) {
    if (spectating || !view || view.timedOut || view.won || view.paused) return;
    const c = view.cells.find((c) => c.cell === cell);
    if (c && !c.done && c.colour !== 'red') return; // yellow/blue: ignore client-side
    api.send({ a: 'hit', cell });
  }

  function say(text, colour) {
    hint.textContent = text;
    hint.style.color = colour;
  }

  function update(v) {
    view = v;
    spectating = !!api.isSpectator;
    const over = v.timedOut || v.won;
    const playing = !v.paused && !over;

    const key = v.run + ':' + v.level + ':' + (v.paused ? 'p' : 'c');
    if (key !== clockKey && !over) {
      clockKey = key;
      if (!v.paused) startLevelClock(v.levelMs || LEVEL_MS);
    }

    head.style.display = 'flex';
    track.style.display = '';
    board.style.display = 'grid';
    card.style.display = v.paused ? '' : 'none';
    scoreEl.textContent = v.score + (v.score === 1 ? ' point' : ' points');
    levelEl.textContent = `Level ${v.level} of ${v.maxLevel}  ·  ${v.step}/${v.total}`;

    if (over || v.paused) clockGen++; // stop the clock
    if (v.paused) {
      scoreBig.textContent = 'Score: ' + v.score;
      moreSmall.textContent = (MAX_LEVEL - v.score) + ' more to 81';
      say('', hint.style.color);
    } else if (v.timedOut) {
      timerEl.textContent = '0.0s';
      timerEl.style.color = '#ff4d4d';
      fill.style.width = '0%';
      say(`Time ran out on level ${v.level}! Reset to try again.`, '#ff6b6b');
    } else if (v.won) {
      say('Sub-superhuman! All 81 levels cleared!', '#8ef5a0');
    } else if (spectating) {
      say('👁 watching. Nobody is playing at this table.', '#ffd479');
    } else {
      say('Click only the red button.', '#e8ecf4');
    }

    const byCell = new Map(v.cells.map((c) => [c.cell, c]));
    cells.forEach((b, i) => {
      const c = byCell.get(i);
      b.style.background = c && !c.done ? COLOURS[c.colour] : BG;
    });
    reset.style.display = v.score > 0 || over ? '' : 'none';
  }

  return {
    update,
    denied: (text) => say(text || 'Not allowed.', '#ffd479'),
    destroy() {
      destroyed = true;
      clockGen++;
      view = null;
      cells.forEach((b) => b.replaceWith(b.cloneNode(true)));
    }
  };
}
