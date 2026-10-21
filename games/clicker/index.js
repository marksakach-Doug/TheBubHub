const GRID = 9;
const CELLS = GRID * GRID;
const LEVEL_MS = 16000;
const WARN_MS = 3500;
const REPLAY_GAP_MS = 1200;   // long hesitations are shortened to this in the replay
const SEQ_MAX = 32;
const SEQ_SLOTS = 8;
const A3 = 220;
const BG = '#1d2434';
const COLOURS = { red: '#ff4d4d', yellow: '#facc15', blue: '#2f6bd8', green: '#4cd137' };
const CANON_SEMI = 7;         // canon follower sounds this many semitones above the leader (7 = a fifth, 12 = octave)
const SPLIT_HI = 12;          // split mode: the column (x) voice sits this many semitones above the row (y) voice
const NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

// Subtle harmonic reference tints for Instrument & Sequencer (Tonic = red, 3rd = yellow, 5th = blue)
const ROLE_STYLE = {
  root:  { bg: '#38202c', border: '#8c3545', fg: '#ffb3b3' },
  third: { bg: '#332e22', border: '#806d28', fg: '#fde07b' },
  fifth: { bg: '#1e2d4a', border: '#2f589e', fg: '#9ec2ff' },
  other: { bg: BG,        border: '#2b3448', fg: '#6f7c99' }
};

// Scales available in the Instrument / Sequencer dropdowns: [id, label, semitone steps]
const SCALES = [
  ['chromatic', 'Chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  ['major', 'Major', [0, 2, 4, 5, 7, 9, 11]],
  ['minor', 'Minor', [0, 2, 3, 5, 7, 8, 10]],
  ['mixolydian', 'Mixolydian', [0, 2, 4, 5, 7, 9, 10]],
  ['dorian', 'Dorian', [0, 2, 3, 5, 7, 9, 10]],
  ['majpent', 'Maj pent', [0, 2, 4, 7, 9]],
  ['minpent', 'Min pent', [0, 3, 5, 7, 10]],
  ['blues', 'Blues', [0, 3, 5, 6, 7, 10]],
  ['whole', 'Whole tone', [0, 2, 4, 6, 8, 10]],
  ['harmonic', 'Harm minor', [0, 2, 3, 5, 7, 8, 11]]
];

// The mapping the PATTERNS were composed on: rows climb A Mixolydian from A3, columns bend up in semitones.
// The Game always uses this. Instrument and Sequencer can change it.
const DEFAULT_CFG = { row: 'mixolydian', col: 'chromatic', root: 0 };
const START_CFG = { row: 'major', col: 'major', root: 3 };

// Paste exported array from pattern-builder.html (or the Sequencer's Export button) here:
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
  [18, 0, 11, 3, 14, 7, 41, 35, 30, 13, 5, 16, 36, 47, 32, 51, 74, 56, 38, 67, 27, 10, 2, 31, 49, 42, 65, 59],
  [18, 11, 3, 12, 20, 30, 14, 5, 25, 32, 43, 50, 33, 16, 8, 7, 35, 55, 39, 22, 9, 72, 71],
  [72, 56, 40, 24, 8, 6, 14, 22, 30, 39, 32, 25, 17, 35, 43, 60, 77, 18, 11, 12, 3, 28, 38, 50, 55, 71, 66, 74, 45, 63],
  [40, 48, 41, 49, 42, 32, 25, 22, 28, 30, 12, 20, 37, 45, 39, 14, 50, 77, 70, 68, 61, 59, 53, 60, 43, 35, 17, 66, 38, 55, 18, 3, 8]
];

const VALID = PATTERNS.filter((p) => Array.isArray(p) && p.length > 0
  && p.every((c) => Number.isInteger(c) && c >= 0 && c < CELLS));
const LENGTHS = [...new Set(VALID.map((p) => p.length))].sort((a, b) => a - b);
const LAST_LEVEL = LENGTHS.length;

export const meta = {
  id: 'clicker',
  title: 'Clicker',
  players: 'solo',
  color: '#ff6b6b',
  icon: '🎯',
  desc: 'Always click the red button. Yellow shows which cell turns red next. Blue cells wait their turn. Clear each level inside 16 seconds, then hear it played back your way. Or switch to Instrument to just play the grid, or Sequencer to build patterns.',
  solo: true
};

function cellAt(cell) {
  return { col: cell % GRID, row: Math.floor(cell / GRID) };
}

function degrees(id, n) {
  const entry = SCALES.find((s) => s[0] === id) || SCALES[0];
  const steps = entry[2];
  return Array.from({ length: n }, (_, i) => 12 * Math.floor(i / steps.length) + steps[i % steps.length]);
}

// pitch (in semitones above A3) = key + row step + column step. Top row is highest.
function buildTable(cfg) {
  const rd = degrees(cfg.row, GRID);
  const cd = degrees(cfg.col, GRID);
  const freq = [], name = [], role = [];
  for (let cell = 0; cell < CELLS; cell++) {
    const p = cellAt(cell);
    const s = cfg.root + rd[GRID - 1 - p.row] + cd[p.col];
    const pc = ((s % 12) + 12) % 12;
    const rel = ((s - cfg.root) % 12 + 12) % 12;
    freq.push(A3 * Math.pow(2, s / 12));
    name.push(NAMES[pc]);
    if (rel === 0) role.push('root');
    else if (rel === 3 || rel === 4) role.push('third');
    else if (rel === 7) role.push('fifth');
    else role.push('other');
  }
  return { freq, name, role };
}

const GAME_TABLE = buildTable(DEFAULT_CFG);

// Split mode (Instrument): the row (y) is the low voice and the column (x) is the high voice,
// instead of summing the two axes into one pitch. Cells are tinted by the interval BETWEEN the voices.
function splitSemis(cfg, cell) {
  const p = cellAt(cell);
  const rd = degrees(cfg.row, GRID), cd = degrees(cfg.col, GRID);
  return { lo: cfg.root + rd[GRID - 1 - p.row], hi: cfg.root + SPLIT_HI + cd[p.col] };
}

function buildSplitTable(cfg) {
  const name = [], role = [];
  const pc = (n) => NAMES[((n % 12) + 12) % 12];
  for (let cell = 0; cell < CELLS; cell++) {
    const v = splitSemis(cfg, cell);
    const iv = (((v.hi - v.lo) % 12) + 12) % 12;
    if (iv === 0) role.push('root');                                  // unison / octave
    else if (iv === 3 || iv === 4 || iv === 8 || iv === 9) role.push('third'); // thirds and sixths
    else if (iv === 7) role.push('fifth');
    else role.push('other');
    name.push(pc(v.lo) + '\u00b7' + pc(v.hi));
  }
  return { name, role };
}

function deal(rng, level) {
  const len = LENGTHS[Math.min(level, LAST_LEVEL) - 1];
  const options = VALID.filter((p) => p.length === len);
  return options.length ? options[Math.floor(rng() * options.length)].slice() : [];
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
  const won = score >= LAST_LEVEL;
  return same({ score, step, won, paused: !won, last: won ? { score } : null });
}

export function project(state, playerId, api) {
  const { queue, step, score, paused } = state;
  return {
    you: playerId || '',
    level: Math.min(score + 1, LAST_LEVEL),
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
    maxLevel: LAST_LEVEL,
    roster: (api && api.roster) || null
  };
}

export const roundId = (state) => 'run' + ((state && state.run) || 1);

export function summarize(state, nameOf) {
  const s = state.last ? state.last.score : 0;
  if (!(s > 0)) return null;
  return `${nameOf(state.players[0])} scored ${s} point${s === 1 ? '' : 's'} in Clicker, reaching level ${Math.min(s + 1, LAST_LEVEL)}`;
}

export function mount(root, api) {
  // Lock viewport scaling on mobile browsers so rapid taps and <select> menus never zoom
  try {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      document.head.appendChild(vp);
    }
    vp.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    document.documentElement.style.touchAction = 'manipulation';
    document.body.style.touchAction = 'manipulation';
  } catch (_) {}

  const el = (css, text = '', tag = 'div') => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    e.textContent = text;
    return e;
  };

  // Debounced press handler: fires immediately on pointerdown, while touchstart/touchend prevent mobile zoom
  const press = (node, fn) => {
    let last = 0;
    const run = (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - last < 80) return;
      last = now;
      unlockAudio();
      fn(e);
    };
    node.addEventListener('pointerdown', run);
    node.addEventListener('touchstart', run, { passive: false });
    node.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
  };

  // font-size:16px on <select> prevents iOS Safari from auto-zooming when opening dropdowns
  const SMALL_BTN = 'font:inherit;font-size:13px;padding:4px 9px;min-height:30px;border-radius:8px;'
    + 'border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;white-space:nowrap;touch-action:none;';
  const SELECT_CSS = 'font:inherit;font-size:16px;padding:2px 4px;height:30px;border-radius:8px;border:1px solid #3a465f;'
    + 'background:#232c3f;color:#e8ecf4;width:100%;min-width:0;touch-action:manipulation;';

  // ---------- audio ----------
  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
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

  // A sustained voice for Split mode: rings until release() is called.
  function holdVoice(freq, gainVal, type = 'triangle') {
    try {
      unlockAudio();
      if (!actx) return null;
      const t = actx.currentTime;
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gainVal, t + 0.02);
      osc.connect(g);
      g.connect(actx.destination);
      osc.start(t);
      let done = false;
      return {
        release(fade = 0.25) {
          if (done) return;
          done = true;
          try {
            const n = actx.currentTime;
            g.gain.cancelScheduledValues(n);
            g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), n);
            g.gain.exponentialRampToValueAtTime(0.0001, n + fade);
            osc.stop(n + fade + 0.02);
          } catch (_) {}
        }
      };
    } catch (_) { return null; }
  }

  function playCounterpoint(hitCell, nextCell, tbl = GAME_TABLE) {
    voice(tbl.freq[hitCell], 0.24, 0.18, 'triangle', 0);
    if (nextCell != null) {
      voice(tbl.freq[nextCell], 0.14, 0.26, 'sine', 0.045);
    }
  }

  // ---------- state ----------
  const cfg = { ...START_CFG };
  let table = buildTable(cfg);          // used by Instrument + Sequencer
  let splitTbl = buildSplitTable(cfg);  // role/name per cell for Split mode
  let uiMode = 'instrument';                  // 'game' | 'instrument' | 'sequencer'
  let counterpointMode = false;          // counterpoint enabled in Instrument + Sequencer
  let splitMode = true;                // Instrument: row = low voice, column = high voice
  let canonMode = false;                // Sequencer: a follower plays the pattern lagging behind the leader
  let splitHeld = null, splitGen = 0;   // currently ringing split voices {row, col, lo, hi}
  let canonIdx = -1;                    // index of the canon follower's current step (-1 = silent)
  let lastInstCell = null;              // previous note for Instrument counterpoint
  let view = null, spectating = false, destroyed = false;
  let clockKey = '', clockGen = 0, deadline = 0;
  let byCell = new Map();               // game: cell -> its current (first not-done) entry
  let levelHits = [], replayGen = 0, prevDone = false;
  const seqs = Array.from({ length: SEQ_SLOTS }, () => []);
  let seqSlot = 0, bpm = 100, playing = false, seqGen = 0, seqIdx = -1;
  let seqPositions = new Map();

  // ---------- layout ----------
  const wrap = el('position:relative;max-width:min(440px, 55vh);margin:0 auto;padding:6px 8px 10px;touch-action:none;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;color-scheme:dark;'
    + 'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;');

  // mode tabs
  const tabs = el('display:flex;gap:5px;margin-bottom:6px;');
  const tabBtns = {};
  [['game', 'Game'], ['instrument', 'Instrument'], ['sequencer', 'Sequencer']].forEach(([id, label]) => {
    const b = el('flex:1;font:inherit;font-size:14px;padding:6px 4px;border-radius:8px;'
      + 'border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;touch-action:none;', label, 'button');
    press(b, () => setMode(id));
    tabBtns[id] = b;
    tabs.append(b);
  });

  // compact pitch + counterpoint controls (Instrument + Sequencer)
  function makeSelect(options, value, onChange) {
    const s = document.createElement('select');
    s.style.cssText = SELECT_CSS;
    options.forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      s.append(o);
    });
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  const scaleOptions = SCALES.map(([id, label]) => [id, label]);
  const rootSel = makeSelect(NAMES.map((n, i) => [String(i), n]), String(cfg.root), (v) => { cfg.root = Number(v); retune(); });
  const rowSel = makeSelect(scaleOptions.map(([id, l]) => [id, '↑' + l]), cfg.row, (v) => { cfg.row = v; retune(); });
  const colSel = makeSelect(scaleOptions.map(([id, l]) => [id, '→' + l]), cfg.col, (v) => { cfg.col = v; retune(); });
  rootSel.style.flex = '0 0 54px';
  rowSel.style.flex = '1 1 0';
  colSel.style.flex = '1 1 0';

  const cpBtn = el(SMALL_BTN + 'padding:4px 7px;', '♪ CP', 'button');
  const syncCpBtn = () => {
    cpBtn.style.borderColor = counterpointMode ? '#facc15' : '#3a465f';
    cpBtn.style.color = counterpointMode ? '#facc15' : '#8f9bb5';
    cpBtn.style.background = counterpointMode ? '#332e22' : '#232c3f';
  };
  syncCpBtn();
  press(cpBtn, () => {
    counterpointMode = !counterpointMode;
    lastInstCell = null;
    if (counterpointMode) { splitMode = false; canonMode = false; releaseSplit(); syncSplitBtn(); syncCanonBtn(); paintAll(); }
    syncCpBtn();
  });

  const styleToggle = (btn, on) => {
    btn.style.borderColor = on ? '#facc15' : '#3a465f';
    btn.style.color = on ? '#facc15' : '#8f9bb5';
    btn.style.background = on ? '#332e22' : '#232c3f';
  };
  const splitBtn = el(SMALL_BTN + 'padding:4px 7px;', 'Split', 'button');
  const canonBtn = el(SMALL_BTN + 'padding:4px 7px;', 'Canon', 'button');
  const syncSplitBtn = () => styleToggle(splitBtn, splitMode);
  const syncCanonBtn = () => styleToggle(canonBtn, canonMode);
  syncSplitBtn();
  syncCanonBtn();
  press(splitBtn, () => {
    splitMode = !splitMode;
    if (splitMode) { counterpointMode = false; canonMode = false; syncCpBtn(); syncCanonBtn(); }
    lastInstCell = null;
    releaseSplit();
    syncSplitBtn();
    paintAll();
  });
  press(canonBtn, () => {
    canonMode = !canonMode;
    if (canonMode) { counterpointMode = false; splitMode = false; syncCpBtn(); syncSplitBtn(); releaseSplit(); }
    else canonIdx = -1;
    syncCanonBtn();
    paintAll();
  });

  const gameScaleBtn = el(SMALL_BTN + 'padding:4px 7px;', '↺', 'button');
  gameScaleBtn.title = 'Reset to Game scale';
  press(gameScaleBtn, () => {
    Object.assign(cfg, DEFAULT_CFG);
    rootSel.value = String(cfg.root);
    rowSel.value = cfg.row;
    colSel.value = cfg.col;
    retune();
  });

  const tune = el('display:none;gap:4px;margin-bottom:6px;align-items:center;');
  tune.append(rootSel, rowSel, colSel, cpBtn, splitBtn, canonBtn, gameScaleBtn);

  // compact sequencer controls (2 slim rows)
  const patSel = makeSelect(Array.from({ length: SEQ_SLOTS }, (_, i) => [String(i), '']), '0', (v) => {
    seqSlot = Number(v);
    seqStop();
    refreshPatternLabels();
    paintAll();
  });
  const tempoSel = makeSelect([60, 80, 100, 120, 140, 160, 200].map((v) => [String(v), v + ' bpm']), String(bpm), (v) => { bpm = Number(v); });
  patSel.style.flex = '1.2 1 0';
  tempoSel.style.flex = '1 1 0';

  const playBtn = el(SMALL_BTN + 'background:#4cd137;color:#111;border:none;font-weight:600;flex:0.8 1 0;', '▶ Play', 'button');
  const undoBtn = el(SMALL_BTN + 'flex:1;', 'Undo', 'button');
  const clearBtn = el(SMALL_BTN + 'flex:1;', 'Clear', 'button');
  const exportBtn = el(SMALL_BTN + 'flex:1;', 'Export', 'button');

  const seqBar = el('display:none;flex-direction:column;gap:4px;margin-bottom:6px;');
  const seqRow1 = el('display:flex;gap:4px;align-items:center;');
  const seqRow2 = el('display:flex;gap:4px;');
  seqRow1.append(patSel, tempoSel, playBtn);
  seqRow2.append(undoBtn, clearBtn, exportBtn);
  seqBar.append(seqRow1, seqRow2);

  const exportBox = el('display:none;margin-top:8px;');
  const exportNote = el('font-size:12px;color:#8f9bb5;margin-bottom:4px;line-height:1.3;');
  const exportArea = document.createElement('textarea');
  exportArea.readOnly = true;
  exportArea.style.cssText = 'width:100%;box-sizing:border-box;height:80px;font:16px ui-monospace,Menlo,Consolas,monospace;'
    + 'background:#232c3f;color:#e8ecf4;border:1px solid #3a465f;border-radius:8px;padding:6px;user-select:text;-webkit-user-select:text;';
  exportBox.append(exportNote, exportArea);

  // decreasing timer bar (Game)
  const timer = el('width:100%;height:10px;margin-bottom:6px;border-radius:5px;background:#232c3f;'
    + 'border:1px solid #2b3448;box-sizing:border-box;overflow:hidden;');
  const timerFill = el('height:100%;width:100%;border-radius:4px;background:#4cd137;');
  timer.append(timerFill);
  function setTimerFill(frac) {
    const f = Math.max(0, Math.min(1, frac));
    timerFill.style.width = (f * 100).toFixed(2) + '%';
  }
  function setTimerWarn(warn) {
    timerFill.style.background = warn ? '#ff4d4d' : '#4cd137';
  }

  // the grid
  const board = el('display:grid;grid-template-columns:repeat(' + GRID + ',1fr);'
    + 'gap:4px;width:100%;aspect-ratio:1/1;touch-action:none;padding:2px;border-radius:10px;box-sizing:border-box;');
  const CELL_CSS = 'display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;'
    + 'line-height:1;overflow:hidden;border-radius:7px;background:' + BG + ';border:1.5px solid #2b3448;'
    + 'cursor:pointer;touch-action:none;transition:background .1s ease,transform .08s ease;';
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const b = el(CELL_CSS);
    b.dataset.i = String(i);
    return b;
  });
  board.append(...cells);

  // ---------- board input (works inside Shadow DOM + prevents mobile zoom) ----------
  const down = new Map();
  let lastPointerMs = 0;

  // Calculate cell from bounding box coordinates (never fails in Shadow DOM)
  function cellFromCoords(clientX, clientY) {
    const r = board.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return -1;
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return -1;
    const col = Math.min(GRID - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * GRID)));
    const row = Math.min(GRID - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * GRID)));
    return row * GRID + col;
  }

  function cellFromEvent(e) {
    // 1. Direct DOM target lookup (fastest & most reliable for taps)
    if (e.target && e.target.closest) {
      const t = e.target.closest('[data-i]');
      if (t && t.dataset.i !== undefined) return Number(t.dataset.i);
    }
    // 2. Fallback to bounding-box math (for gliding or tapping the 4px gap between cells)
    const pt = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]) || e;
    if (pt && typeof pt.clientX === 'number') {
      return cellFromCoords(pt.clientX, pt.clientY);
    }
    return -1;
  }

  board.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    unlockAudio();
    const c = cellFromEvent(e);
    if (c < 0) return;
    lastPointerMs = Date.now();
    down.set(e.pointerId, c);
    onTap(c);
  });

  board.addEventListener('pointermove', (e) => {
    if (uiMode !== 'instrument' || !down.has(e.pointerId)) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { down.delete(e.pointerId); return; }
    const c = cellFromCoords(e.clientX, e.clientY);
    if (c < 0 || c === down.get(e.pointerId)) return;
    down.set(e.pointerId, c);
    onTap(c);
  });

  const lift = (e) => down.delete(e.pointerId);
  board.addEventListener('pointerup', lift);
  board.addEventListener('pointercancel', lift);

  // Suppress mobile double-tap zoom on the board while providing touch fallback if pointerdown was skipped
  board.addEventListener('touchstart', (e) => {
    e.preventDefault();
    unlockAudio();
    if (Date.now() - lastPointerMs > 80) {
      const c = cellFromEvent(e);
      if (c >= 0) {
        lastPointerMs = Date.now();
        onTap(c);
      }
    }
  }, { passive: false });

  board.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (uiMode !== 'instrument') return;
    const pt = e.changedTouches && e.changedTouches[0];
    if (!pt) return;
    const c = cellFromCoords(pt.clientX, pt.clientY);
    if (c >= 0 && c !== down.get('touch')) {
      down.set('touch', c);
      onTap(c);
    }
  }, { passive: false });

  board.addEventListener('touchend', (e) => {
    e.preventDefault();
    down.delete('touch');
  }, { passive: false });

  // level-cleared card (Game)
  const card = el('display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'flex-direction:column;align-items:center;gap:12px;padding:24px;text-align:center;'
    + 'background:rgba(29,36,52,.95);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:10;touch-action:none;');
  const scoreBig = el('font-size:44px;font-weight:700;');
  const actionBtn = el('font:inherit;font-size:17px;padding:9px 18px;border-radius:8px;border:none;background:#4cd137;color:#111;cursor:pointer;touch-action:none;', 'NEXT', 'button');
  press(actionBtn, () => {
    replayGen++;
    if (view && (view.timedOut || view.won)) api.send({ a: 'reset' });
    else api.send({ a: 'next' });
  });
  const replayBtn = el(SMALL_BTN, '↻ Replay', 'button');
  press(replayBtn, () => playReplay());
  card.append(scoreBig, actionBtn, replayBtn);

  const bar = el('display:flex;justify-content:center;gap:10px;margin-top:8px;');
  const reset = el(SMALL_BTN, 'Reset', 'button');
  press(reset, () => api.send({ a: 'reset' }));
  bar.append(reset);

  // Prevent double-tap zoom on empty areas of wrap while leaving <select> and <textarea> native
  let lastWrapTouchEnd = 0;
  wrap.addEventListener('touchstart', () => unlockAudio(), { passive: true });
  wrap.addEventListener('touchend', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'OPTION') return;
    const now = Date.now();
    if (now - lastWrapTouchEnd <= 400) {
      e.preventDefault();
    }
    lastWrapTouchEnd = now;
  }, { passive: false });
  wrap.addEventListener('dblclick', (e) => e.preventDefault());
  wrap.addEventListener('gesturestart', (e) => e.preventDefault());

  if (root && root.style) {
    root.style.touchAction = 'none';
  }
  wrap.append(tabs, tune, seqBar, timer, board, card, bar, exportBox);
  root.append(wrap);

  // ---------- painting ----------
  function computePositions() {
    seqPositions = new Map();
    seqs[seqSlot].forEach((c, n) => {
      if (!seqPositions.has(c)) seqPositions.set(c, []);
      seqPositions.get(c).push(n + 1);
    });
  }

  function paintCell(i) {
    const b = cells[i];
    let bg = BG, text = '', fg = '#8f9bb5', border = '#2b3448';
    if (uiMode === 'game') {
      const c = byCell.get(i);
      if (c) bg = COLOURS[c.colour];
    } else {
      const useSplit = splitMode && uiMode === 'instrument';
      const rs = ROLE_STYLE[(useSplit ? splitTbl : table).role[i]] || ROLE_STYLE.other;
      bg = rs.bg;
      fg = rs.fg;
      border = rs.border;
      text = (useSplit ? splitTbl : table).name[i];

      if (uiMode === 'sequencer') {
        const pos = seqPositions.get(i);
        if (pos) {
          bg = COLOURS.blue;
          fg = '#fff';
          border = table.role[i] === 'other' ? '#6ea2ff' : rs.fg;
          text = pos.length > 3 ? pos.slice(0, 3).join('·') + '…' : pos.join('·');
        }
        const s = seqs[seqSlot];
        if (playing && seqIdx >= 0 && s.length) {
          if (s[seqIdx] === i) {
            bg = COLOURS.red;
            fg = '#fff';
            border = '#fff';
          } else if (canonMode && canonIdx >= 0 && s[canonIdx] === i) {
            bg = COLOURS.green;
            fg = '#111';
            border = '#fff';
          } else if (!canonMode && s.length > 1 && s[(seqIdx + 1) % s.length] === i) {
            bg = COLOURS.yellow;
            fg = '#111';
            border = '#fff';
          }
        }
      }
    }
    b.style.background = bg;
    b.style.color = fg;
    b.style.borderColor = border;
    if (b.textContent !== text) b.textContent = text;
  }

  function paintAll() {
    if (uiMode === 'sequencer') computePositions();
    for (let i = 0; i < CELLS; i++) paintCell(i);
  }

  function flash(cell, colour) {
    const b = cells[cell];
    b.style.transform = 'scale(.92)';
    if (colour) b.style.background = colour;
    api.setTimeout(() => { b.style.transform = ''; paintCell(cell); }, 110);
  }

  function layout() {
    const g = uiMode === 'game', s = uiMode === 'sequencer';
    tune.style.display = g ? 'none' : 'flex';
    splitBtn.style.display = uiMode === 'instrument' ? '' : 'none';
    canonBtn.style.display = s ? '' : 'none';
    seqBar.style.display = s ? 'flex' : 'none';
    timer.style.display = g ? 'block' : 'none';
    bar.style.display = g ? 'flex' : 'none';
    if (!g) card.style.display = 'none';
    if (!s) exportBox.style.display = 'none';
    Object.entries(tabBtns).forEach(([id, b]) => {
      const on = id === uiMode;
      b.style.borderColor = on ? '#ff6b6b' : '#3a465f';
      b.style.background = on ? '#33405c' : '#232c3f';
    });
    paintAll();
  }

  function setMode(m) {
    if (m === uiMode) return;
    uiMode = m;
    seqStop();
    releaseSplit();
    canonIdx = -1;
    clockGen++;
    replayGen++;
    down.clear();
    lastInstCell = null;
    if (m === 'game') {
      clockKey = '';
      prevDone = false;
      if (!api.isSpectator) api.send({ a: 'reset' });
    }
    layout();
    if (m === 'game' && api.isSpectator && view) renderGame();
  }

  function retune() {
    table = buildTable(cfg);
    splitTbl = buildSplitTable(cfg);
    paintAll();
  }

  // ---------- instrument ----------
  function playNote(cell, dur = 0.9) {
    const f = table.freq[cell];
    voice(f, 0.22, dur, 'triangle', 0);
    voice(f * 2, 0.05, dur * 0.45, 'sine', 0);
  }

  function onTap(cell) {
    if (uiMode === 'instrument') {
      if (splitMode) { splitTap(cell); flash(cell, COLOURS.yellow); return; }
      if (counterpointMode) {
        playCounterpoint(cell, lastInstCell !== cell ? lastInstCell : null, table);
        if (lastInstCell !== null && lastInstCell !== cell) flash(lastInstCell, COLOURS.blue);
        lastInstCell = cell;
      } else {
        playNote(cell);
      }
      flash(cell, COLOURS.yellow);
      return;
    }
    if (uiMode === 'sequencer') { seqTap(cell); return; }
    gameTap(cell);
  }

  // ---------- split mode ----------
  function releaseSplit() {
    splitGen++;
    if (splitHeld) {
      if (splitHeld.lo) splitHeld.lo.release();
      if (splitHeld.hi) splitHeld.hi.release();
      splitHeld = null;
    }
  }

  // Vertical move changes only the low voice, horizontal only the high voice, diagonal changes both.
  // A voice whose coordinate did not change keeps ringing.
  function splitTap(cell) {
    const p = cellAt(cell);
    const v = splitSemis(cfg, cell);
    const flo = A3 * Math.pow(2, v.lo / 12);
    const fhi = A3 * Math.pow(2, v.hi / 12);
    const prev = splitHeld;
    const rowSame = !!prev && prev.row === p.row;
    const colSame = !!prev && prev.col === p.col;
    let lo, hi;
    if (!prev || (rowSame && colSame)) {
      releaseSplit();
      lo = holdVoice(flo, 0.2, 'triangle');
      hi = holdVoice(fhi, 0.12, 'sine');
    } else {
      if (rowSame) lo = prev.lo;
      else { if (prev.lo) prev.lo.release(); lo = holdVoice(flo, 0.2, 'triangle'); }
      if (colSame) hi = prev.hi;
      else { if (prev.hi) prev.hi.release(); hi = holdVoice(fhi, 0.12, 'sine'); }
    }
    const gen = ++splitGen;
    splitHeld = { row: p.row, col: p.col, lo, hi };
    api.setTimeout(() => { if (gen === splitGen) releaseSplit(); }, 1500);
  }

  // ---------- sequencer ----------
  function refreshPatternLabels() {
    [...patSel.options].forEach((o, i) => {
      const n = seqs[i].length;
      o.textContent = 'Pat ' + (i + 1) + ' (' + n + ')';
    });
  }

  function seqTap(cell) {
    const s = seqs[seqSlot];
    if (s.length >= SEQ_MAX) { voice(110, 0.16, 0.09, 'sine', 0); return; }
    const prev = s.length ? s[s.length - 1] : null;
    s.push(cell);
    if (counterpointMode) {
      playCounterpoint(cell, prev, table);
    } else {
      playNote(cell, 0.5);
    }
    flash(cell, COLOURS.yellow);
    afterSeqEdit();
  }

  function afterSeqEdit() {
    refreshPatternLabels();
    paintAll();
  }

  function seqStop() {
    seqGen++;
    playing = false;
    seqIdx = -1;
    canonIdx = -1;
    playBtn.textContent = '▶ Play';
    if (uiMode === 'sequencer') paintAll();
  }

  function seqStart() {
    if (!seqs[seqSlot].length) { voice(110, 0.16, 0.09, 'sine', 0); return; }
    const gen = ++seqGen;
    playing = true;
    playBtn.textContent = '■ Stop';
    let i = 0, n = 0, due = Date.now();
    const tick = () => {
      if (destroyed || gen !== seqGen || uiMode !== 'sequencer') return;
      const s = seqs[seqSlot];
      if (!s.length) { seqStop(); return; }
      seqIdx = i % s.length;
      const nextIdx = s.length > 1 ? (seqIdx + 1) % s.length : null;
      if (canonMode) {
        // follower replays the pattern `lag` steps behind, a fifth up, in a sine voice
        const lag = Math.max(1, Math.floor(s.length / 2));
        canonIdx = n >= lag ? (n - lag) % s.length : -1;
        if (canonIdx >= 0) voice(table.freq[s[canonIdx]] * Math.pow(2, CANON_SEMI / 12), 0.14, 0.5, 'sine', 0);
      } else canonIdx = -1;
      if (counterpointMode) {
        playCounterpoint(s[seqIdx], nextIdx !== null ? s[nextIdx] : null, table);
      } else {
        playNote(s[seqIdx], 0.5);
      }
      paintAll();
      i = seqIdx + 1;
      n++;
      due += 30000 / bpm;
      api.setTimeout(tick, Math.max(0, due - Date.now()));
    };
    tick();
  }

  press(playBtn, () => { if (playing) seqStop(); else seqStart(); });
  press(undoBtn, () => { seqs[seqSlot].pop(); afterSeqEdit(); });
  press(clearBtn, () => { seqs[seqSlot].length = 0; afterSeqEdit(); });

  function isDefaultCfg() {
    return cfg.row === DEFAULT_CFG.row && cfg.col === DEFAULT_CFG.col && cfg.root === DEFAULT_CFG.root;
  }

  function doExport() {
    const rows = seqs.filter((s) => s.length).map((s) => '  [' + s.join(', ') + ']');
    const text = rows.length ? '[\n' + rows.join(',\n') + '\n]' : '';
    exportArea.value = text || '(no notes yet)';
    exportBox.style.display = 'block';
    let msg = text ? 'Paste into PATTERNS. ' : 'Tap some cells first. ';
    if (text) {
      let ok = false;
      try {
        exportArea.focus();
        exportArea.select();
        exportArea.setSelectionRange(0, text.length);
        ok = document.execCommand('copy');
      } catch (_) {}
      msg = (ok ? 'Copied. ' : 'Select and copy the text. ') + msg;
    }
    if (!isDefaultCfg()) {
      msg += 'Tap ↺ to hear them in the Game scale.';
    }
    exportNote.textContent = msg;
  }
  press(exportBtn, doExport);

  // ---------- game ----------
  function startLevelClock(limitMs) {
    const gen = ++clockGen;
    levelHits = [];
    replayGen++;
    deadline = Date.now() + limitMs;
    setTimerFill(1);
    setTimerWarn(false);
    function tick() {
      if (destroyed || gen !== clockGen || uiMode !== 'game' || !view || view.timedOut || view.won) return;
      const rem = Math.max(0, deadline - Date.now());
      setTimerFill(rem / limitMs);
      setTimerWarn(rem <= WARN_MS);
      if (rem > 0) api.setTimeout(tick, 40);
      else if (!spectating) api.send({ a: 'timeout' });
    }
    tick();
  }

  function gameTap(cell) {
    if (spectating || !view || view.timedOut || view.won || view.paused) return;
    flash(cell, null);
    const c = byCell.get(cell);
    if (!c || c.colour !== 'red') {
      voice(110, 0.16, 0.09, 'sine', 0);
      return;
    }
    const next = view.cells.find((x) => !x.done && x.cell !== cell && (x.colour === 'red' || x.colour === 'yellow'));
    levelHits.push({ cell, t: Date.now() });
    playCounterpoint(cell, next ? next.cell : null, GAME_TABLE);
    api.send({ a: 'hit', cell });
  }

  function playReplay() {
    const hits = levelHits.slice();
    if (!hits.length) return;
    const gen = ++replayGen;
    let at = 500;
    hits.forEach((h, i) => {
      if (i > 0) at += Math.min(h.t - hits[i - 1].t, REPLAY_GAP_MS);
      api.setTimeout(() => {
        if (gen !== replayGen || destroyed || uiMode !== 'game') return;
        voice(GAME_TABLE.freq[h.cell], 0.24, 0.35, 'triangle', 0);
        flash(h.cell, COLOURS.yellow);
      }, at);
    });
  }

  function renderGame() {
    const v = view;
    if (!v) return;
    const over = v.timedOut || v.won;

    const key = v.run + ':' + v.level + ':' + (v.paused ? 'p' : 'c');
    if (key !== clockKey && !over) {
      clockKey = key;
      if (!v.paused) startLevelClock(v.levelMs || LEVEL_MS);
    }

    const showCard = v.paused || over;
    card.style.display = showCard ? 'flex' : 'none';
    if (showCard) {
      clockGen++;
      if (v.timedOut) setTimerFill(0);
      scoreBig.textContent = v.score;
      actionBtn.textContent = over ? 'AGAIN' : 'NEXT';
    }

    const cleared = (v.paused || v.won) && !v.timedOut;
    replayBtn.style.display = cleared && levelHits.length ? '' : 'none';
    if (cleared && !prevDone && levelHits.length) playReplay();
    prevDone = cleared;

    byCell = new Map();
    v.cells.forEach((c) => { if (!c.done && !byCell.has(c.cell)) byCell.set(c.cell, c); });
    paintAll();
  }

  function update(v) {
    view = v;
    spectating = !!api.isSpectator;
    if (uiMode === 'game') renderGame();
  }


  rootSel.value = String(cfg.root);
  rowSel.value = cfg.row;
  colSel.value = cfg.col;
  retune();
  layout();
  refreshPatternLabels();
  
  return {
    update,
    denied: () => {},
    destroy() {
      destroyed = true;
      releaseSplit();
      clockGen++;
      seqGen++;
      replayGen++;
      view = null;
      if (actx) actx.close().catch(() => {});
      cells.forEach((b) => b.replaceWith(b.cloneNode(true)));
    }
  };
}
