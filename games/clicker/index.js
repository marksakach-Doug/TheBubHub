const GRID = 9;
const CELLS = GRID * GRID;
const MAX_LEVEL = CELLS;
const LEVEL_MS = 16000;
const BG = '#1d2434';
const COLOURS = { red: '#ff4d4d', yellow: '#facc15', blue: '#2f6bd8' };
// A Mixolydian from bottom row (A3) to top row (B4)
const SCALE = [220.00, 246.94, 277.18, 293.66, 329.63, 369.99, 392.00, 440.00, 493.88];

// Paste exported array from pattern-builder.html here:
const PATTERNS = [
  [39],
  [50, 11],
  [28, 32, 37, 41],
  [14, 25, 16, 35, 12],
  [44, 43, 33, 32, 14, 25],
  [35, 25, 14, 5, 3, 1, 0],
  [12, 11, 23, 22, 39, 32, 58, 41],
  [39, 32, 14, 6, 16, 23, 28, 11, 58, 41],
  [18, 11, 3, 55, 38, 30, 72, 54, 36],
  [50, 52, 43, 33, 11, 28, 48, 41, 32, 22, 30, 39],
  [22, 14, 8, 7, 25, 33, 43, 32, 35, 50, 11],
  [14, 32, 8, 27, 45, 20, 30, 48, 23, 64, 71, 68],
  [77, 50, 71, 43, 66, 59, 52, 41, 58, 62, 44, 33]
];

export const meta = {
  id: 'clicker',
  title: 'Clicker',
  players: 'solo',
  color: '#ff6b6b',
  icon: '🎯',
  desc: 'Always click the red button. Yellow shows which cell turns red next. Blue cells wait their turn. Clear each level inside 16 seconds.',
  solo: true
};

function cellAt(cell) {
  return { col: cell % GRID, row: Math.floor(cell / GRID) };
}

function cellFreq(cell) {
  const p = cellAt(cell);
  return SCALE[GRID - 1 - p.row] * Math.pow(2, p.col / 12);
}

function deal(rng, level, mode, patIdx = 0) {
  const count = Math.min(level, MAX_LEVEL);
  if (mode === 'patterns' && PATTERNS.length > 0) {
    const p = PATTERNS[patIdx % PATTERNS.length];
    if (Array.isArray(p) && p.length > 0) {
      return Array.from({ length: count }, (_, i) => p[i % p.length]);
    }
  }
  const free = Array.from({ length: CELLS }, (_, i) => i);
  for (let i = CELLS - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return free.slice(0, count);
}

const freshRun = (rng, mode = null) => {
  const patIdx = PATTERNS.length > 0 ? Math.floor(rng() * PATTERNS.length) : 0;
  return {
    mode, patIdx, score: 0,
    queue: mode ? deal(rng, 1, mode, patIdx) : [],
    step: 0, paused: false, timedOut: false, won: false, last: null, run: 1
  };
};

export function init(ctx) {
  const c = ctx || {};
  const seat = (c.atTable || c.seats || []).find((m) => m && m.id && !m.spectator);
  return { ...freshRun(c.rng || Math.random, null), players: seat ? [seat.id] : [] };
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

  if (kind === 'mode') {
    const m = ['tempo', 'fork', 'patterns'].includes(action.mode) ? action.mode : 'tempo';
    return { ...freshRun(rng, m), players: state.players, run: state.run + 1 };
  }
  if (kind === 'menu') {
    return { ...freshRun(rng, null), players: state.players, run: state.run + 1 };
  }
  if (kind === 'reset') {
    return {
      ...freshRun(rng, state.mode || 'tempo'), players: state.players, run: state.run + 1,
      last: over ? state.last : { score: state.score }
    };
  }
  if (kind === 'timeout') return over ? state : same({ timedOut: true, last: { score: state.score } });
  if (kind === 'next') {
    return state.paused
      ? same({ paused: false, queue: deal(rng, state.score + 1, state.mode, state.patIdx || 0), step: 0 })
      : state;
  }
  if (kind !== 'hit') return { error: 'Unknown action: ' + kind };
  if (!state.mode || state.timedOut || state.won) return state;

  const queue = state.queue.slice();
  const cell = Number(action.cell);
  if (!(cell >= 0 && cell < CELLS) || state.step >= queue.length) return state;

  const isForkChoice = state.mode === 'fork' && state.step + 1 < queue.length && queue[state.step + 1] === cell;
  if (queue[state.step] !== cell && !isForkChoice) return state;
  if (isForkChoice) {
    [queue[state.step], queue[state.step + 1]] = [queue[state.step + 1], queue[state.step]];
  }

  const step = state.step + 1;
  if (step < queue.length) return same({ queue, step, last: null });
  const score = state.score + 1;
  const won = score >= MAX_LEVEL;
  return same({ queue, score, step, won, paused: !won, last: won ? { score } : null });
}

export function project(state, playerId, api) {
  const { queue, step, score, paused, mode } = state;
  const fork = mode === 'fork';
  return {
    you: playerId || '',
    mode: mode || null,
    level: Math.min(score + 1, MAX_LEVEL),
    score, step, paused,
    total: queue.length,
    timedOut: !!state.timedOut,
    won: !!state.won,
    levelMs: LEVEL_MS,
    run: state.run,
    last: state.last,
    cells: (paused || !mode) ? [] : queue.map((cell, i) => {
      const p = cellAt(cell);
      let colour = 'blue';
      if (i === step || (fork && i === step + 1)) colour = 'red';
      else if (i === step + 1 || (fork && (i === step + 2 || i === step + 3))) colour = 'yellow';
      return { cell, col: p.col, row: p.row, done: i < step, colour };
    }),
    maxLevel: MAX_LEVEL,
    roster: (api && api.roster) || null
  };
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
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (_) {}
  }

  function voice(freq, gainVal, dur, type = 'triangle', delay = 0) {
    try {
      unlockAudio();
      if (!actx) return;
      const t = actx.currentTime + delay;
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gainVal, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(actx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (_) {}
  }

  function playCounterpoint(hitCell, nextCell) {
    voice(cellFreq(hitCell), 0.24, 0.18, 'triangle', 0);
    if (nextCell != null) {
      voice(cellFreq(nextCell), 0.14, 0.26, 'sine', 0.045);
    }
  }

  const wrap = el('position:relative;max-width:min(460px, 68vh);margin:0 auto;padding:12px 10px 18px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;'
    + 'user-select:none;-webkit-user-select:none;touch-action:none;');

  const menu = el('display:flex;flex-direction:column;gap:10px;padding:24px 16px;background:rgba(29,36,52,.95);'
    + 'border-radius:12px;border:1px solid #2b3448;');
  [['tempo', 'Tempo'], ['fork', 'Fork'], ['patterns', 'Patterns']].forEach(([m, label]) => {
    const btn = el('font:inherit;font-size:18px;font-weight:600;padding:14px;border-radius:8px;'
      + 'border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;', label, 'button');
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      unlockAudio();
      api.send({ a: 'mode', mode: m });
    });
    menu.append(btn);
  });

  const board = el('display:none;grid-template-columns:repeat(' + GRID + ',1fr);'
    + 'gap:4px;width:100%;aspect-ratio:1/1;touch-action:none;padding:4px;border-radius:12px;'
    + 'border:2px solid transparent;transition:border-color .12s ease;');
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const b = el('border-radius:8px;background:' + BG + ';border:1px solid #2b3448;'
      + 'cursor:pointer;touch-action:none;transition:background .1s ease,transform .08s ease;');
    b.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault();
      unlockAudio();
      onTap(i);
    });
    return b;
  });
  board.append(...cells);

  const card = el('display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'flex-direction:column;align-items:center;gap:12px;padding:26px;text-align:center;'
    + 'background:rgba(29,36,52,.95);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:10;');
  const scoreBig = el('font-size:48px;font-weight:700;');
  const actionBtn = el('font:inherit;font-size:18px;padding:10px 20px;border-radius:8px;border:none;background:#4cd137;color:#111;cursor:pointer;', 'NEXT', 'button');
  actionBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    if (view && (view.timedOut || view.won)) api.send({ a: 'reset' });
    else api.send({ a: 'next' });
  });
  card.append(scoreBig, actionBtn);

  const bar = el('display:flex;justify-content:center;gap:10px;margin-top:12px;');
  const reset = el('font:inherit;font-size:15px;padding:9px 14px;min-height:40px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;', 'Reset', 'button');
  reset.addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); api.send({ a: 'reset' }); });
  const modeBtn = el('font:inherit;font-size:15px;padding:9px 14px;min-height:40px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;', 'Modes', 'button');
  modeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); api.send({ a: 'menu' }); });
  bar.append(reset, modeBtn);

  wrap.addEventListener('touchstart', () => unlockAudio(), { passive: true });
  wrap.addEventListener('dblclick', (e) => e.preventDefault());
  wrap.append(menu, board, card, bar);
  root.append(wrap);

  let view = null, spectating = false, destroyed = false;
  let clockKey = '', clockGen = 0, deadline = 0;
  let lastTapAt = 0, beatMs = 0;

  function startLevelClock(limitMs) {
    const gen = ++clockGen;
    deadline = Date.now() + limitMs;
    lastTapAt = 0;
    beatMs = 0;
    board.style.borderColor = 'transparent';
    function tick() {
      const now = Date.now();
      if (destroyed || gen !== clockGen || !view || view.timedOut || view.won || !view.mode) return;
      const rem = Math.max(0, deadline - now);
      if (rem <= 3500) {
        board.style.borderColor = 'rgba(255,77,77,.6)';
      } else if (view.mode === 'tempo' && beatMs > 0 && lastTapAt > 0) {
        const phase = (now - lastTapAt) % beatMs;
        const onBeat = phase < beatMs * 0.22 || phase > beatMs * 0.78;
        board.style.borderColor = onBeat ? 'rgba(76,209,55,.75)' : 'transparent';
      } else {
        board.style.borderColor = 'transparent';
      }
      if (rem > 0) api.setTimeout(tick, 40);
      else if (!spectating) api.send({ a: 'timeout' });
    }
    tick();
  }

  function onTap(cell) {
    if (spectating || !view || !view.mode || view.timedOut || view.won || view.paused) return;
    const b = cells[cell];
    b.style.transform = 'scale(.92)';
    api.setTimeout(() => { b.style.transform = ''; }, 90);

    const c = view.cells.find((x) => x.cell === cell && !x.done);
    if (!c || c.colour !== 'red') {
      voice(110, 0.16, 0.09, 'sine', 0);
      return;
    }

    const now = Date.now();
    if (view.mode === 'tempo') {
      if (view.step === 1 && lastTapAt > 0) {
        beatMs = Math.max(160, Math.min(2000, now - lastTapAt));
      } else if (view.step > 1 && beatMs > 0) {
        const dt = now - lastTapAt;
        if (dt < beatMs * 0.45 || dt > beatMs * 1.85) {
          voice(110, 0.16, 0.09, 'sine', 0);
          board.style.borderColor = '#facc15';
          lastTapAt = now;
          return;
        }
      }
      lastTapAt = now;
    }

    const next = view.cells.find((x) => !x.done && x.cell !== cell && (x.colour === 'red' || x.colour === 'yellow'));
    playCounterpoint(cell, next ? next.cell : null);
    api.send({ a: 'hit', cell });
  }

  function update(v) {
    view = v;
    spectating = !!api.isSpectator;
    const over = v.timedOut || v.won;
    const inMenu = !v.mode;

    menu.style.display = inMenu ? 'flex' : 'none';
    board.style.display = inMenu ? 'none' : 'grid';
    bar.style.display = inMenu ? 'none' : 'flex';

    const key = v.run + ':' + (v.mode || '') + ':' + v.level + ':' + (v.paused ? 'p' : 'c');
    if (key !== clockKey && !over && !inMenu) {
      clockKey = key;
      if (!v.paused) startLevelClock(v.levelMs || LEVEL_MS);
    }

    const showCard = !inMenu && (v.paused || over);
    card.style.display = showCard ? 'flex' : 'none';
    if (showCard || inMenu) {
      clockGen++;
      board.style.borderColor = 'transparent';
    }
    if (showCard) {
      scoreBig.textContent = v.score;
      actionBtn.textContent = over ? 'AGAIN' : 'NEXT';
    }

    const byCell = new Map(v.cells.map((c) => [c.cell, c]));
    cells.forEach((b, i) => {
      const c = byCell.get(i);
      b.style.background = c && !c.done ? COLOURS[c.colour] : BG;
    });
  }

  return {
    update,
    denied: () => {},
    destroy() {
      destroyed = true;
      clockGen++;
      view = null;
      if (actx) actx.close().catch(() => {});
      cells.forEach((b) => b.replaceWith(b.cloneNode(true)));
    }
  };
}
