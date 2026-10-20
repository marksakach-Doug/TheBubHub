const GRID = 9;
const CELLS = GRID * GRID;
const MAX_LEVEL = CELLS;
const LEVEL_MS = 16000;
const WARN_MS = 3500;
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
  [77, 50, 71, 43, 66, 59, 52, 41, 58, 62, 44, 33],
  [28, 11, 35],
  [1, 11, 28, 65, 64, 38, 48, 41, 33, 27, 13, 21, 8, 14, 22, 39, 50],
  [18, 11, 28, 22, 39, 32, 50, 8],
  [55, 74, 72, 60, 50, 39, 68, 71, 43, 16, 23, 28],
  [14, 11, 30, 27, 45, 32, 28, 72, 64, 47, 0, 3, 5, 8, 25],
  [38, 39, 64, 55, 50, 32, 58, 52, 20, 5, 13, 36, 11, 19],
  [60, 43, 35, 3, 7, 20, 72, 76, 79, 36, 29, 32, 74],
  [64, 65, 66, 67, 68, 69, 70, 71, 43, 14, 8, 7, 16, 3, 5, 11, 1, 18],
  [55, 39, 43, 12, 5, 7, 8, 15, 14, 23, 32, 29, 50, 60, 71],
  [39, 22, 14, 32, 45, 27, 9, 38, 62, 34, 16, 24, 5, 19, 11, 40],
  [55, 11, 3, 8, 14, 25, 64, 20, 12, 17, 23, 33, 45, 27, 9, 66, 39, 22, 35],
  [55, 39, 22, 32, 11, 54, 38, 41, 30, 20, 45, 49, 29, 28, 18, 37, 47, 46, 65, 73],
  [39, 32, 48, 41, 28, 11, 37, 20, 50, 43, 58, 52, 60, 22, 69, 62, 18, 3, 80, 30, 71, 0, 6, 9, 8],
  [39, 30, 22, 50, 33, 43, 60, 52, 18, 9, 11, 28, 38, 71, 62, 55, 14, 8, 7, 5, 3, 1, 0, 23, 25, 35, 40],
  [39, 40, 22, 23, 48, 49, 30, 31, 25, 26, 7, 8, 33, 34, 16, 17, 28, 29, 10, 11, 37, 38, 1, 2],
  [39, 22, 14, 8, 80, 52, 33, 6, 75, 57, 50, 23, 10, 3, 58, 42],
  [0, 11, 22, 14, 18, 39, 50, 32, 45, 38, 30, 3, 64, 47, 60, 57, 43, 63, 74, 25, 28, 71],
  [32, 39, 59, 66, 13, 20, 29, 47, 26, 43, 7, 15, 74, 67, 49, 22, 4, 64, 57, 40, 65, 58, 19, 37, 55, 38, 9, 3, 30, 25, 8, 50],
  [55, 37, 47, 39, 49, 50, 32, 14, 57, 48, 30, 12, 74, 75, 68, 60, 70, 71, 43, 8, 35, 22, 28],
  [28, 20, 11, 39, 50, 41, 32, 60, 22, 33, 25, 0, 12, 3, 14, 5, 35, 23, 43, 18, 77, 79, 45, 74, 72, 8],
  [28, 12, 11, 39, 5, 23, 8, 45, 27, 52, 25, 64, 55, 47, 38, 50, 66, 60, 43, 14, 1, 0, 9, 33, 16, 3, 22],
  [50, 43, 28, 35, 66, 49, 45, 41, 72, 76, 73, 68, 36, 19, 0, 51, 74, 56, 38, 67, 78, 39, 21, 60, 55, 32, 11, 14, 8],
  [8, 74, 0, 50, 6, 64, 1, 48, 5, 57, 68, 3, 11, 28, 39, 17, 25, 32, 33, 43, 60, 52, 22, 14, 15, 23, 24, 31, 40, 18, 71],
  [39, 32, 30, 23, 48, 41, 28, 11, 50, 43, 52, 33, 58, 62, 60, 55, 47, 0, 18, 66, 37, 20, 64, 57, 71, 74, 8, 22],
  [8, 5, 1, 17, 14, 10, 12, 16, 3, 6, 9, 23, 35, 32, 28, 44, 41, 37, 39, 43, 30, 33, 36, 50, 62, 59, 55, 71, 68, 64, 66, 70, 57, 61, 63],
  [18, 0, 11, 3, 14, 7, 41, 35, 30, 13, 5, 16, 36, 47, 32, 51, 74, 56, 38, 67, 27, 10, 2, 31, 49, 42, 65, 59]
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

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Level N plays a pattern with N entries.
//  1. Prefer a pattern with exactly N entries (random pick if several).
//  2. If none exists, take the shortest pattern longer than N and use its first N entries.
//  3. If N is longer than every pattern, chain patterns together (no repeated cells),
//     then pad with random unused cells if still short.
function deal(rng, level) {
  const count = Math.min(level, MAX_LEVEL);
  const valid = PATTERNS.filter((p) => Array.isArray(p) && p.length > 0);
  const pick = (list) => list[Math.floor(rng() * list.length)];

  const exact = valid.filter((p) => p.length === count);
  if (exact.length) return pick(exact).slice();

  const longer = valid.filter((p) => p.length > count);
  if (longer.length) {
    const minLen = Math.min(...longer.map((p) => p.length));
    return pick(longer.filter((p) => p.length === minLen)).slice(0, count);
  }

  const out = [];
  const used = new Set();
  for (const p of shuffle(valid, rng)) {
    for (const cell of p) {
      if (out.length >= count) break;
      if (!used.has(cell)) { used.add(cell); out.push(cell); }
    }
    if (out.length >= count) break;
  }
  if (out.length < count) {
    const free = shuffle(Array.from({ length: CELLS }, (_, i) => i).filter((i) => !used.has(i)), rng);
    out.push(...free.slice(0, count - out.length));
  }
  return out;
}

const freshRun = (rng) => ({
  score: 0,
  queue: deal(rng, 1),
  step: 0, paused: false, timedOut: false, won: false, last: null, run: 1
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
    return state.paused
      ? same({ paused: false, queue: deal(rng, state.score + 1), step: 0 })
      : state;
  }
  if (kind !== 'hit') return { error: 'Unknown action: ' + kind };
  if (over) return state;

  const cell = Number(action.cell);
  if (!(cell >= 0 && cell < CELLS) || state.step >= state.queue.length) return state;
  if (state.queue[state.step] !== cell) return state;

  const step = state.step + 1;
  if (step < state.queue.length) return same({ step, last: null });
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
      let colour = 'blue';
      if (i === step) colour = 'red';
      else if (i === step + 1) colour = 'yellow';
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

  // Decreasing timer bar
  const timer = el('width:100%;height:12px;margin-bottom:10px;border-radius:6px;background:#232c3f;'
    + 'border:1px solid #2b3448;box-sizing:border-box;overflow:hidden;');
  const timerFill = el('height:100%;width:100%;border-radius:5px;background:#4cd137;');
  timer.append(timerFill);

  function setTimerFill(frac) {
    const f = Math.max(0, Math.min(1, frac));
    timerFill.style.width = (f * 100).toFixed(2) + '%';
  }
  function setTimerWarn(warn) {
    timerFill.style.background = warn ? '#ff4d4d' : '#4cd137';
  }

  const board = el('display:grid;grid-template-columns:repeat(' + GRID + ',1fr);'
    + 'gap:4px;width:100%;aspect-ratio:1/1;touch-action:none;padding:4px;border-radius:12px;');
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
  bar.append(reset);

  wrap.addEventListener('touchstart', () => unlockAudio(), { passive: true });
  wrap.addEventListener('dblclick', (e) => e.preventDefault());
  wrap.append(timer, board, card, bar);
  root.append(wrap);

  let view = null, spectating = false, destroyed = false;
  let clockKey = '', clockGen = 0, deadline = 0;

  function startLevelClock(limitMs) {
    const gen = ++clockGen;
    deadline = Date.now() + limitMs;
    setTimerFill(1);
    setTimerWarn(false);
    function tick() {
      if (destroyed || gen !== clockGen || !view || view.timedOut || view.won) return;
      const rem = Math.max(0, deadline - Date.now());
      setTimerFill(rem / limitMs);
      setTimerWarn(rem <= WARN_MS);
      if (rem > 0) api.setTimeout(tick, 40);
      else if (!spectating) api.send({ a: 'timeout' });
    }
    tick();
  }

  function onTap(cell) {
    if (spectating || !view || view.timedOut || view.won || view.paused) return;
    const b = cells[cell];
    b.style.transform = 'scale(.92)';
    api.setTimeout(() => { b.style.transform = ''; }, 90);

    const c = view.cells.find((x) => x.cell === cell && !x.done);
    if (!c || c.colour !== 'red') {
      voice(110, 0.16, 0.09, 'sine', 0);
      return;
    }

    const next = view.cells.find((x) => !x.done && x.cell !== cell && (x.colour === 'red' || x.colour === 'yellow'));
    playCounterpoint(cell, next ? next.cell : null);
    api.send({ a: 'hit', cell });
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

    const showCard = v.paused || over;
    card.style.display = showCard ? 'flex' : 'none';
    if (showCard) {
      clockGen++; // stop the countdown; the bar stays where it stopped
      if (v.timedOut) setTimerFill(0);
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
