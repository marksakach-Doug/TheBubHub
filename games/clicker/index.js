const GRID = 9;
const CELLS = GRID * GRID;
const MAX_LEVEL = CELLS;
const LEVEL_MS = 16000;
const BG = '#1d2434';
const COLOURS = { red: '#ff4d4d', yellow: '#facc15', blue: '#2f6bd8' };
// 9-note warm pentatonic scale across two octaves for row/col interval mapping
const SCALE = [220, 246.94, 277.18, 329.63, 369.99, 440, 493.88, 554.37, 659.25];

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

  let actx = null;
  function voice(freq, pan, gainVal, dur, type = 'triangle', delay = 0) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + delay;
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gainVal, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      if (actx.createStereoPanner) {
        const p = actx.createStereoPanner();
        p.pan.setValueAtTime(pan, t);
        osc.connect(g).connect(p).connect(actx.destination);
      } else {
        osc.connect(g).connect(actx.destination);
      }
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (_) {}
  }

  function playCounterpoint(redCell, yellowCell) {
    const r = cellAt(redCell);
    const rFreq = SCALE[GRID - 1 - r.row] * (1 + (r.col - 4) * 0.015);
    const rPan = ((r.col / (GRID - 1)) * 2 - 1) * 0.75;
    voice(rFreq, rPan, 0.16, 0.19, 'triangle', 0);

    if (yellowCell != null) {
      const y = cellAt(yellowCell);
      const yFreq = SCALE[GRID - 1 - y.row] * 1.5 * (1 + (y.col - 4) * 0.015);
      const yPan = ((y.col / (GRID - 1)) * 2 - 1) * 0.75;
      voice(yFreq, yPan, 0.075, 0.28, 'sine', 0.045);
    }
  }

  const wrap = el('position:relative;max-width:min(460px, 68vh);margin:0 auto;padding:12px 10px 18px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;'
    + 'user-select:none;-webkit-user-select:none;touch-action:none;');
  const hint = el('font-size:14px;opacity:.8;margin-bottom:8px;min-height:20px;text-align:center;');

  const board = el('display:grid;grid-template-columns:repeat(' + GRID + ',1fr);'
    + 'gap:4px;width:100%;aspect-ratio:1/1;touch-action:none;padding:4px;border-radius:12px;'
    + 'border:1px solid transparent;transition:border-color .3s ease;');
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const b = el('border-radius:8px;background:' + BG + ';border:1px solid #2b3448;'
      + 'cursor:pointer;touch-action:none;transition:background .1s ease,transform .08s ease;');
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
    + 'background:rgba(29,36,52,.95);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:10;');
  const scoreBig = el('font-size:48px;font-weight:700;');
  const moreSmall = el('font-size:18px;opacity:.8;');
  const nextBtn = el('font:inherit;font-size:18px;padding:10px 20px;border-radius:8px;border:none;background:#4cd137;color:#111;cursor:pointer;', 'NEXT', 'button');
  nextBtn.addEventListener('pointerdown', () => api.send({ a: 'next' }));
  card.append(scoreBig, moreSmall, nextBtn);

  const bar = el('display:flex;justify-content:center;margin-top:12px;');
  const reset = el('font:inherit;font-size:15px;padding:9px 14px;min-height:40px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;', 'Reset run', 'button');
  reset.addEventListener('click', () => api.send({ a: 'reset' }));
  bar.append(reset);

  ['touchstart', 'touchend'].forEach((t) => wrap.addEventListener(t, (e) => {
    if (e.target !== reset) e.preventDefault();
  }, { passive: false }));
  wrap.addEventListener('dblclick', (e) => e.preventDefault());

  wrap.append(hint, board, card, bar);
  root.append(wrap);

  let view = null, spectating = false, destroyed = false;
  let clockKey = '', clockGen = 0, deadline = 0;

  function startLevelClock(limitMs) {
    const gen = ++clockGen;
    deadline = Date.now() + limitMs;
    board.style.borderColor = 'transparent';
    function tick() {
      const now = Date.now();
      if (tick.l === now) return;
      tick.l = now;
      if (destroyed || gen !== clockGen || !view || view.timedOut || view.won) return;
      const rem = Math.max(0, deadline - now);
      board.style.borderColor = rem <= 3500 ? 'rgba(255,77,77,.45)' : 'transparent';
      if (rem > 0) api.setTimeout(tick, 100);
      else if (!spectating) api.send({ a: 'timeout' });
    }
    tick();
  }

  function onTap(cell) {
    if (spectating || !view || view.timedOut || view.won || view.paused) return;
    const b = cells[cell];
    b.style.transform = 'scale(.92)';
    api.setTimeout(() => { b.style.transform = ''; }, 90);

    const c = view.cells.find((x) => x.cell === cell);
    if (!c || c.done || c.colour !== 'red') {
      voice(110, 0, 0.1, 0.09, 'sine', 0);
      if (c && !c.done) say(c.colour === 'yellow' ? 'Wait—yellow is next.' : 'Only tap red.', '#ffd479');
      return;
    }
    const yellow = view.cells.find((x) => !x.done && x.colour === 'yellow');
    playCounterpoint(cell, yellow ? yellow.cell : null);
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

    const key = v.run + ':' + v.level + ':' + (v.paused ? 'p' : 'c');
    if (key !== clockKey && !over) {
      clockKey = key;
      if (!v.paused) startLevelClock(v.levelMs || LEVEL_MS);
    }

    card.style.display = v.paused ? 'flex' : 'none';
    if (over || v.paused) {
      clockGen++;
      board.style.borderColor = 'transparent';
    }

    if (v.paused) {
      scoreBig.textContent = v.score;
      moreSmall.textContent = (MAX_LEVEL - v.score) + ' more to 81';
      say('', '#e8ecf4');
    } else if (v.timedOut) {
      say(`Time slipped on level ${v.level} (${v.step}/${v.total}).`, '#ff6b6b');
    } else if (v.won) {
      say('All 81 levels held steady.', '#8ef5a0');
    } else if (spectating) {
      say('👁 watching.', '#ffd479');
    } else {
      say('', '#e8ecf4');
    }

    const byCell = new Map(v.cells.map((c) => [c.cell, c]));
    cells.forEach((b, i) => {
      const c = byCell.get(i);
      b.style.background = c && !c.done ? COLOURS[c.colour] : BG;
    });
    reset.style.display = (v.paused || over) && (v.score > 0 || over) ? '' : 'none';
  }

  return {
    update,
    denied: (text) => say(text || 'Not allowed.', '#ffd479'),
    destroy() {
      destroyed = true;
      clockGen++;
      view = null;
      if (actx) actx.close().catch(() => {});
      cells.forEach((b) => b.replaceWith(b.cloneNode(true)));
    }
  };
}