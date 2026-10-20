const GRID = 9;
const CELLS = GRID * GRID;
const MAX_LEVEL = CELLS;
const LEVEL_MS = 16000;
const BG = '#1d2434';
const COLOURS = { red: '#ff4d4d', yellow: '#facc15', blue: '#2f6bd8' };
const SCALE = [220, 246.94, 277.18, 329.63, 369.99, 440, 493.88, 554.37, 659.25];

// Paste exported patterns from pattern-builder.html here:
const PATTERNS = [
  [36, 38, 40, 22, 4, 20, 36],
  [72, 64, 56, 48, 40, 32, 24, 16, 8],
  [40, 31, 22, 32, 42, 50, 48, 39, 30, 40]
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

function deal(rng, level, mode) {
  if (mode === 'patterns' && PATTERNS.length > 0) {
    const pat = PATTERNS[(level - 1) % PATTERNS.length];
    if (pat && pat.length > 0) {
      const out = [];
      for (let i = 0; i < Math.min(level, MAX_LEVEL); i++) {
        out.push(pat[i % pat.length]);
      }
      return out;
    }
  }
  const free = Array.from({ length: CELLS }, (_, i) => i);
  for (let i = CELLS - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return free.slice(0, Math.min(level, MAX_LEVEL));
}

const freshRun = (rng, mode = null) => ({
  mode,
  score: 0,
  queue: mode ? deal(rng, 1, mode) : [],
  step: 0,
  paused: false,
  timedOut: false,
  won: false,
  last: null,
  run: 1,
  t0: 0,
  cadence: 0
});

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

  if (!id) return { error: 'No identity.' };
  if (!state.players.includes(id)) return { error: 'Not seated.' };

  if (kind === 'mode') {
    const m = action.mode;
    if (m !== 'tempo' && m !== 'fork' && m !== 'patterns') return state;
    return { ...freshRun(rng, m), players: state.players, run: state.run + 1 };
  }
  if (kind === 'menu') {
    return { ...freshRun(rng, null), players: state.players, run: state.run + 1 };
  }
  if (kind === 'reset') {
    return {
      ...freshRun(rng, state.mode), players: state.players, run: state.run + 1,
      last: over ? state.last : { score: state.score }
    };
  }
  if (kind === 'timeout') return over ? state : same({ timedOut: true, last: { score: state.score } });
  if (kind === 'next') {
    if (!state.paused) return state;
    const nextLvl = state.score + 1;
    return same({ paused: false, queue: deal(rng, nextLvl, state.mode), step: 0, t0: 0, cadence: 0 });
  }
  if (kind !== 'hit') return { error: 'Unknown action' };
  if (!state.mode || state.timedOut || state.won) return state;

  const queue = state.queue.slice();
  const cell = Number(action.cell);
  const now = Number(action.t) || 0;
  if (!(cell >= 0 && cell < CELLS) || state.step >= queue.length) return state;

  if (state.mode === 'fork' && state.step > 0 && queue[state.step] !== cell) {
    return state;
  }
  if (queue[state.step] !== cell) return state;

  // In Fork mode, player chooses which of the two yellows (step+1 or step+2) becomes the next Red
  if (state.mode === 'fork' && action.pick !== undefined) {
    const p = Number(action.pick);
    if (state.step + 2 < queue.length && p === queue[state.step + 2]) {
      const tmp = queue[state.step + 1];
      queue[state.step + 1] = queue[state.step + 2];
      queue[state.step + 2] = tmp;
    }
  }

  // In Tempo mode, first two taps set cadence; later taps must stay near that rhythm
  let t0 = state.t0;
  let cadence = state.cadence;
  if (state.mode === 'tempo' && now > 0) {
    if (state.step === 0) {
      t0 = now;
      cadence = 0;
    } else if (state.step === 1 && t0 > 0) {
      cadence = Math.max(120, Math.min(2500, now - t0));
      t0 = now;
    } else if (cadence > 0 && t0 > 0) {
      const dt = now - t0;
      if (Math.abs(dt - cadence) > Math.max(220, cadence * 0.55)) {
        return same({ timedOut: true, last: { score: state.score } });
      }
      t0 = now;
    }
  }

  const step = state.step + 1;
  if (step < queue.length) return same({ queue, step, t0, cadence, last: null });
  const score = state.score + 1;
  const won = score >= MAX_LEVEL;
  return same({ queue, score, step, t0, cadence, won, paused: !won, last: won ? { score } : null });
}

export function project(state, playerId, api) {
  const { queue, step, score, paused, mode } = state;
  const fork = mode === 'fork';
  return {
    you: playerId || '',
    mode,
    level: Math.min(score + 1, MAX_LEVEL),
    score, step, paused,
    total: queue.length,
    timedOut: !!state.timedOut,
    won: !!state.won,
    levelMs: LEVEL_MS,
    run: state.run,
    last: state.last,
    cells: paused || !mode ? [] : queue.map((cell, i) => {
      const p = cellAt(cell);
      const isYellow = fork ? (i === step + 1 || i === step + 2) : (i === step + 1);
      return {
        cell, col: p.col, row: p.row, done: i < step,
        colour: i === step ? 'red' : isYellow ? 'yellow' : 'blue'
      };
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
  return `${nameOf(state.players[0])} scored ${s} in Clicker`;
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

  function playCounterpoint(redCell, yellows) {
    const r = cellAt(redCell);
    const rFreq = SCALE[GRID - 1 - r.row] * (1 + (r.col - 4) * 0.015);
    const rPan = ((r.col / (GRID - 1)) * 2 - 1) * 0.75;
    voice(rFreq, rPan, 0.16, 0.19, 'triangle', 0);

    (yellows || []).forEach((yCell, idx) => {
      const y = cellAt(yCell);
      const yFreq = SCALE[GRID - 1 - y.row] * 1.5 * (1 + (y.col - 4) * 0.015);
      const yPan = ((y.col / (GRID - 1)) * 2 - 1) * 0.75;
      voice(yFreq, yPan, 0.07, 0.28, 'sine', 0.045 + idx * 0.035);
    });
  }

  const wrap = el('position:relative;max-width:min(460px, 68vh);margin:0 auto;padding:12px 10px 18px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;'
    + 'user-select:none;-webkit-user-select:none;touch-action:none;');

  const menu = el('display:flex;flex-direction:column;gap:10px;padding:24px;background:' + BG
    + ';border:1px solid #2b3448;border-radius:12px;');
  const btnCss = 'font:inherit;font-size:18px;font-weight:700;padding:14px;border-radius:10px;'
    + 'border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;';
  [
    ['tempo', 'Tempo'],
    ['fork', 'Double Yellow'],
    ['patterns', 'MarkDoug Patterns']
  ].forEach(([m, label]) => {
    const b = el(btnCss, label, 'button');
    b.addEventListener('click', () => api.send({ a: 'mode', mode: m }));
    menu.append(b);
  });

  const board = el('display:none;grid-template-columns:repeat(' + GRID + ',1fr);'
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
    + 'flex-direction:column;align-items:center;gap:12px;padding:26px;text-align:center;'
    + 'background:rgba(29,36,52,.95);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:10;');
  const scoreBig = el('font-size:48px;font-weight:700;');
  const nextBtn = el('font:inherit;font-size:18px;padding:10px 20px;border-radius:8px;border:none;background:#4cd137;color:#111;cursor:pointer;', 'NEXT', 'button');
  nextBtn.addEventListener('pointerdown', () => api.send({ a: 'next' }));
  card.append(scoreBig, nextBtn);

  const bar = el('display:none;justify-content:center;gap:10px;margin-top:12px;');
  const reset = el('font:inherit;font-size:15px;padding:9px 14px;min-height:40px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;', 'Reset', 'button');
  const modesBtn = el('font:inherit;font-size:15px;padding:9px 14px;min-height:40px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;', 'Modes', 'button');
  reset.addEventListener('click', () => api.send({ a: 'reset' }));
  modesBtn.addEventListener('click', () => api.send({ a: 'menu' }));
  bar.append(reset, modesBtn);

  wrap.append(menu, board, card, bar);
  root.append(wrap);

  let view = null, spectating = false, destroyed = false;
  let clockKey = '', clockGen = 0, deadline = 0, nextPick = null;

  function startLevelClock(limitMs) {
    const gen = ++clockGen;
    deadline = Date.now() + limitMs;
    board.style.borderColor = 'transparent';
    function tick() {
      const now = Date.now();
      if (destroyed || gen !== clockGen || !view || view.timedOut || view.won || !view.mode) return;
      const rem = Math.max(0, deadline - now);
      board.style.borderColor = rem <= 3500 ? 'rgba(255,77,77,.45)' : 'transparent';
      if (rem > 0) api.setTimeout(tick, 100);
      else if (!spectating) api.send({ a: 'timeout' });
    }
    tick();
  }

  function onTap(cell) {
    if (spectating || !view || !view.mode || view.timedOut || view.won || view.paused) return;
    const b = cells[cell];
    b.style.transform = 'scale(.92)';
    api.setTimeout(() => { b.style.transform = ''; }, 90);

    const active = view.cells.filter((x) => !x.done);
    const c = active.find((x) => x.cell === cell);
    if (!c) {
      voice(110, 0, 0.1, 0.09, 'sine', 0);
      return;
    }
    if (view.mode === 'fork' && c.colour === 'yellow') {
      nextPick = cell;
      playCounterpoint(cell, []);
      return;
    }
    if (c.colour !== 'red') {
      voice(110, 0, 0.1, 0.09, 'sine', 0);
      return;
    }
    const yellows = active.filter((x) => x.colour === 'yellow').map((x) => x.cell);
    playCounterpoint(cell, yellows);
    const pick = nextPick;
    nextPick = null;
    api.send({ a: 'hit', cell, pick, t: Date.now() });
  }

  function update(v) {
    view = v;
    spectating = !!api.isSpectator;
    const over = v.timedOut || v.won;

    if (!v.mode) {
      clockGen++;
      menu.style.display = 'flex';
      board.style.display = 'none';
      card.style.display = 'none';
      bar.style.display = 'none';
      return;
    }

    menu.style.display = 'none';
    board.style.display = 'grid';

    const key = v.mode + ':' + v.run + ':' + v.level + ':' + (v.paused ? 'p' : 'c');
    if (key !== clockKey && !over) {
      clockKey = key;
      if (!v.paused) startLevelClock(v.levelMs || LEVEL_MS);
    }

    card.style.display = v.paused ? 'flex' : 'none';
    if (over || v.paused) {
      clockGen++;
      board.style.borderColor = over && v.timedOut ? '#ff4d4d' : 'transparent';
    }
    if (v.paused) scoreBig.textContent = v.score;

    const byCell = new Map();
    v.cells.forEach((c) => {
      if (!c.done && !byCell.has(c.cell)) byCell.set(c.cell, c);
    });
    cells.forEach((b, i) => {
      const c = byCell.get(i);
      b.style.background = c ? COLOURS[c.colour] : BG;
    });
    bar.style.display = (v.paused || over) ? 'flex' : 'none';
  }

  return {
    update,
    denied() {},
    destroy() {
      destroyed = true;
      clockGen++;
      view = null;
      if (actx) actx.close().catch(() => {});
      cells.forEach((b) => b.replaceWith(b.cloneNode(true)));
    }
  };
}