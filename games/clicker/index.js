const GRID = 9;
const CELLS = GRID * GRID;
const LEVEL_MS = 16000;
const WARN_MS = 3500;
const REPLAY_GAP_MS = 1200;   // long hesitations are shortened to this in the replay
const SEQ_MAX = 32;
const SEQ_SLOTS = 8;
const A3 = 220;
const BG = '#1d2434';
const COLOURS = { red: '#ff4d4d', yellow: '#facc15', blue: '#2f6bd8' };
// Reference notes in Instrument + Sequencer: tonic = red, third = yellow, fifth = blue.
// bg is the game colour mixed about 42% into the board colour, so the full-strength red/yellow/blue
// stay free for the sequencer's playback and step markers. hue is the full colour, used as a ring.
const REF = {
  r: { hue: '#ff4d4d', bg: '#7c353e' },
  t: { hue: '#facc15', bg: '#7a6b27' },
  f: { hue: '#2f6bd8', bg: '#254279' }
};
const FLASH = '#e8ecf4';
const NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

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
  [77, 50, 71, 43, 66, 59, 52, 41, 58, 62, 44, 33]
];

// Levels come only from your patterns: one level per distinct pattern length, shortest first.
// With a 1, 2, 3, 4... run of lengths, level N is the pattern with N entries.
// A missing length is skipped (no 3-note pattern yet, so level 3 is the 4-note one). Nothing is made up.
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
  const freq = [], name = [], ref = [];
  for (let cell = 0; cell < CELLS; cell++) {
    const p = cellAt(cell);
    const step = rd[GRID - 1 - p.row] + cd[p.col];   // semitones above the key
    const s = cfg.root + step;
    const pc = ((s % 12) + 12) % 12;
    const rel = step % 12;
    freq.push(A3 * Math.pow(2, s / 12));
    name.push(NAMES[pc]);
    ref.push(rel === 0 ? 'r' : (rel === 3 || rel === 4) ? 't' : rel === 7 ? 'f' : '');
  }
  return { freq, name, ref };
}

const GAME_TABLE = buildTable(DEFAULT_CFG);

// Level N plays one of your patterns of the Nth distinct length. No filling, no truncating.
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
  const el = (css, text = '', tag = 'div') => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    e.textContent = text;
    return e;
  };
  const press = (node, fn) => node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    fn(e);
  });

  const SMALL_BTN = 'font:inherit;font-size:15px;padding:8px 12px;min-height:40px;border-radius:10px;'
    + 'border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;';
  // compact row controls (16px text so iOS never zooms in on them)
  const CHEVRON = "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238f9bb5' stroke-width='1.6'/></svg>\")";
  const SELECT_CSS = 'font:inherit;font-size:16px;line-height:1.2;height:38px;box-sizing:border-box;padding:0 16px 0 6px;'
    + 'border-radius:8px;border:1px solid #3a465f;background:#232c3f ' + CHEVRON + ' no-repeat right 5px center;'
    + 'color:#e8ecf4;width:100%;min-width:0;-webkit-appearance:none;appearance:none;text-overflow:ellipsis;';
  const CBTN = 'font:inherit;font-size:16px;height:38px;box-sizing:border-box;padding:0 10px;border-radius:8px;'
    + 'border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;flex:none;';

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

  function playCounterpoint(hitCell, nextCell) {
    voice(GAME_TABLE.freq[hitCell], 0.24, 0.18, 'triangle', 0);
    if (nextCell != null) {
      voice(GAME_TABLE.freq[nextCell], 0.14, 0.26, 'sine', 0.045);
    }
  }

  // ---------- state ----------
  const cfg = { ...DEFAULT_CFG };
  let table = buildTable(cfg);          // used by Instrument + Sequencer
  let uiMode = 'game';                  // 'game' | 'instrument' | 'sequencer'
  let view = null, spectating = false, destroyed = false;
  let clockKey = '', clockGen = 0, deadline = 0;
  let byCell = new Map();               // game: cell -> its current (first not-done) entry
  let levelHits = [], replayGen = 0, prevDone = false;
  const seqs = Array.from({ length: SEQ_SLOTS }, () => []);
  let seqSlot = 0, bpm = 100, playing = false, seqGen = 0, seqIdx = -1;
  let seqPositions = new Map();

  // ---------- layout ----------
  const wrap = el('position:relative;max-width:min(460px, 68vh);margin:0 auto;padding:8px 10px 14px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;color-scheme:dark;'
    + 'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-x pan-y;');

  // mode tabs
  const tabs = el('display:flex;gap:6px;margin-bottom:8px;');
  const tabBtns = {};
  [['game', 'Game'], ['instrument', 'Instrument'], ['sequencer', 'Sequencer']].forEach(([id, label]) => {
    const b = el('flex:1;font:inherit;font-size:14px;padding:7px 6px;border-radius:10px;'
      + 'border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;', label, 'button');
    press(b, () => setMode(id));
    tabBtns[id] = b;
    tabs.append(b);
  });

  // pitch controls (Instrument + Sequencer): one slim row, no labels (arrows say which axis)
  function makeSelect(options, value, onChange, title) {
    const s = document.createElement('select');
    s.style.cssText = SELECT_CSS;
    s.title = title || '';
    s.setAttribute('aria-label', title || 'choose');
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
  const slot = (css, node) => { const d = el(css); d.append(node); return d; };
  const rootSel = makeSelect(NAMES.map((n, i) => [String(i), '♪' + n]), String(cfg.root), (v) => { cfg.root = Number(v); retune(); }, 'Key');
  const rowSel = makeSelect(SCALES.map(([id, label]) => [id, '↑ ' + label]), cfg.row, (v) => { cfg.row = v; retune(); }, 'Scale going up');
  const colSel = makeSelect(SCALES.map(([id, label]) => [id, '→ ' + label]), cfg.col, (v) => { cfg.col = v; retune(); }, 'Scale going across');
  const gameScaleBtn = el(CBTN + 'width:38px;padding:0;', '↺', 'button');
  gameScaleBtn.title = 'Back to the Game scale';
  gameScaleBtn.setAttribute('aria-label', 'Back to the Game scale');
  press(gameScaleBtn, () => {
    Object.assign(cfg, DEFAULT_CFG);
    rootSel.value = String(cfg.root);
    rowSel.value = cfg.row;
    colSel.value = cfg.col;
    retune();
  });
  const tune = el('display:none;gap:6px;margin-bottom:8px;');
  tune.append(slot('flex:0 0 60px;min-width:0;', rootSel), slot('flex:1 1 0;min-width:0;', rowSel),
    slot('flex:1 1 0;min-width:0;', colSel), gameScaleBtn);

  // sequencer controls: one slim row
  const patSel = makeSelect(Array.from({ length: SEQ_SLOTS }, (_, i) => [String(i), '']), '0', (v) => {
    seqSlot = Number(v);
    seqStop();
    refreshPatternLabels();
    paintAll();
  }, 'Pattern');
  const tempoSel = makeSelect([60, 80, 100, 120, 140, 160, 200].map((v) => [String(v), '♩' + v]), String(bpm), (v) => { bpm = Number(v); }, 'Tempo (bpm)');
  const playBtn = el(CBTN + 'width:42px;padding:0;background:#4cd137;color:#111;border:none;font-weight:700;', '▶', 'button');
  const undoBtn = el(CBTN + 'width:38px;padding:0;', '↶', 'button');
  const clearBtn = el(CBTN + 'width:38px;padding:0;', '✕', 'button');
  const exportBtn = el(CBTN, 'Copy', 'button');
  playBtn.title = 'Play / stop'; undoBtn.title = 'Undo last note'; clearBtn.title = 'Clear pattern'; exportBtn.title = 'Copy patterns as code';
  [playBtn, undoBtn, clearBtn, exportBtn].forEach((b) => b.setAttribute('aria-label', b.title));
  const seqBar = el('display:none;gap:5px;margin-bottom:8px;');
  seqBar.append(slot('flex:1.5 1 0;min-width:0;', patSel), slot('flex:1 1 0;min-width:0;', tempoSel),
    playBtn, undoBtn, clearBtn, exportBtn);

  // export sheet floats over the board so the page never grows
  const exportBox = el('display:none;position:absolute;top:50%;left:10px;right:10px;transform:translateY(-50%);z-index:11;'
    + 'padding:12px;background:rgba(29,36,52,.98);border:1px solid #3a465f;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.5);');
  const exportNote = el('font-size:13px;color:#8f9bb5;margin-bottom:6px;line-height:1.35;');
  const exportArea = document.createElement('textarea');
  exportArea.readOnly = true;
  exportArea.style.cssText = 'width:100%;box-sizing:border-box;height:120px;font:16px ui-monospace,Menlo,Consolas,monospace;'
    + 'background:#232c3f;color:#e8ecf4;border:1px solid #3a465f;border-radius:8px;padding:8px;user-select:text;-webkit-user-select:text;';
  const exportClose = el(SMALL_BTN + 'margin-top:8px;width:100%;', 'Close', 'button');
  press(exportClose, () => { exportBox.style.display = 'none'; });
  exportBox.append(exportNote, exportArea, exportClose);

  // decreasing timer bar (Game)
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

  // the grid
  const board = el('display:grid;grid-template-columns:repeat(' + GRID + ',1fr);'
    + 'gap:4px;width:100%;aspect-ratio:1/1;touch-action:none;padding:4px;border-radius:12px;');
  const CELL_CSS = 'display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;'
    + 'line-height:1;overflow:hidden;border-radius:8px;background:' + BG + ';border:1px solid #2b3448;'
    + 'cursor:pointer;touch-action:none;transition:background .1s ease,transform .08s ease;';
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const b = el(CELL_CSS);
    b.dataset.i = String(i);
    return b;
  });
  board.append(...cells);

  // one pointer handler for the whole board: multi-touch, and drag across cells to glide in Instrument.
  // A tap uses the element that was actually touched (works inside iframes and shadow roots);
  // gliding has to use coordinates, because touch pointers stay locked to the first cell.
  const down = new Map();
  function cellFromEvent(e, byPoint) {
    if (!byPoint) {
      const hit = e.target && e.target.closest ? e.target.closest('[data-i]') : null;
      if (hit) return Number(hit.dataset.i);
    }
    const rn = wrap.getRootNode ? wrap.getRootNode() : document;
    const finder = rn && rn.elementFromPoint ? rn : document;
    const t = finder.elementFromPoint(e.clientX, e.clientY);
    const c = t && t.closest ? t.closest('[data-i]') : null;
    return c ? Number(c.dataset.i) : -1;
  }
  board.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    unlockAudio();
    const c = cellFromEvent(e, false);
    if (c < 0) return;
    down.set(e.pointerId, c);
    onTap(c);
  });
  board.addEventListener('pointermove', (e) => {
    if (uiMode !== 'instrument' || !down.has(e.pointerId)) return;
    if (e.buttons === 0) { down.delete(e.pointerId); return; }
    const c = cellFromEvent(e, true);
    if (c < 0 || c === down.get(e.pointerId)) return;
    down.set(e.pointerId, c);
    onTap(c);
  });
  const lift = (e) => down.delete(e.pointerId);
  board.addEventListener('pointerup', lift);
  board.addEventListener('pointercancel', lift);

  // level-cleared card (Game)
  const card = el('display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'flex-direction:column;align-items:center;gap:12px;padding:26px;text-align:center;'
    + 'background:rgba(29,36,52,.95);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:10;');
  const scoreBig = el('font-size:48px;font-weight:700;');
  const actionBtn = el('font:inherit;font-size:18px;padding:10px 20px;border-radius:8px;border:none;background:#4cd137;color:#111;cursor:pointer;', 'NEXT', 'button');
  actionBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    replayGen++;
    if (view && (view.timedOut || view.won)) api.send({ a: 'reset' });
    else api.send({ a: 'next' });
  });
  const replayBtn = el(SMALL_BTN, '↻ Replay', 'button');
  press(replayBtn, () => playReplay());
  card.append(scoreBig, actionBtn, replayBtn);

  const bar = el('display:flex;justify-content:center;gap:10px;margin-top:12px;');
  const reset = el(SMALL_BTN, 'Reset', 'button');
  press(reset, () => api.send({ a: 'reset' }));
  bar.append(reset);

  const prevTouchAction = root.style.touchAction;
  root.style.touchAction = 'pan-x pan-y';             // scroll yes, pinch / double-tap zoom no
  wrap.addEventListener('gesturestart', (e) => e.preventDefault());   // Safari pinch
  wrap.addEventListener('touchstart', () => unlockAudio(), { passive: true });
  wrap.addEventListener('dblclick', (e) => e.preventDefault());
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
    let bg = BG, text = '', fg = '#8f9bb5', ring = '';
    if (uiMode === 'game') {
      const c = byCell.get(i);
      if (c) bg = COLOURS[c.colour];
    } else {
      const ref = table.ref[i];
      text = table.name[i];
      fg = ref ? '#f1f4fa' : '#6f7c99';
      if (ref) { bg = REF[ref].bg; ring = 'inset 0 0 0 2px ' + REF[ref].hue; }
      if (uiMode === 'sequencer') {
        const pos = seqPositions.get(i);
        if (pos) {
          bg = COLOURS.blue;
          fg = '#fff';
          text = pos.length > 3 ? pos.slice(0, 3).join('·') + '…' : pos.join('·');
        }
        const sq = seqs[seqSlot];
        if (playing && seqIdx >= 0 && sq.length) {
          if (sq[seqIdx] === i) { bg = COLOURS.red; fg = '#fff'; }
          else if (sq.length > 1 && sq[(seqIdx + 1) % sq.length] === i) { bg = COLOURS.yellow; fg = '#111'; }
        }
      }
    }
    b.style.background = bg;
    b.style.color = fg;
    b.style.boxShadow = ring;
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
    clockGen++;
    replayGen++;
    down.clear();
    if (m === 'game') {
      clockKey = '';
      prevDone = false;
      if (!api.isSpectator) api.send({ a: 'reset' });   // coming back starts a fresh run
    }
    layout();
    if (m === 'game' && api.isSpectator && view) renderGame();
  }

  function retune() {
    table = buildTable(cfg);
    paintAll();
  }

  // ---------- instrument ----------
  function playNote(cell, dur = 0.9) {
    const f = table.freq[cell];
    voice(f, 0.22, dur, 'triangle', 0);
    voice(f * 2, 0.05, dur * 0.45, 'sine', 0);
  }

  function onTap(cell) {
    if (uiMode === 'instrument') { playNote(cell); flash(cell, FLASH); return; }
    if (uiMode === 'sequencer') { seqTap(cell); return; }
    gameTap(cell);
  }

  // ---------- sequencer ----------
  function refreshPatternLabels() {
    [...patSel.options].forEach((o, i) => {
      const n = seqs[i].length;
      o.textContent = '#' + (i + 1) + ' · ' + n + '♪';
    });
  }

  function seqTap(cell) {
    const s = seqs[seqSlot];
    if (s.length >= SEQ_MAX) { voice(110, 0.16, 0.09, 'sine', 0); return; }
    s.push(cell);
    playNote(cell, 0.5);
    flash(cell, FLASH);
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
    playBtn.textContent = '▶';
    if (uiMode === 'sequencer') paintAll();
  }

  function seqStart() {
    if (!seqs[seqSlot].length) { voice(110, 0.16, 0.09, 'sine', 0); return; }
    const gen = ++seqGen;
    playing = true;
    playBtn.textContent = '■';
    let i = 0, due = Date.now();
    const tick = () => {
      if (destroyed || gen !== seqGen || uiMode !== 'sequencer') return;
      const s = seqs[seqSlot];
      if (!s.length) { seqStop(); return; }
      seqIdx = i % s.length;
      playNote(s[seqIdx], 0.5);
      paintAll();
      i = seqIdx + 1;
      due += 30000 / bpm;                       // each step is an eighth note
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
  // 'click' (not pointerdown) so the browser lets us touch the clipboard
  exportBtn.addEventListener('click', () => {
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
      msg += 'These cell numbers only sound like this under the Game scale (Mixolydian up, Chromatic across, key A). Tap ↺ to hear them as the Game will.';
    }
    exportNote.textContent = msg;
  });

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
    playCounterpoint(cell, next ? next.cell : null);
    api.send({ a: 'hit', cell });
  }

  // After a level clears, play it back with the gaps the player actually left.
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
      clockGen++; // stop the countdown; the bar stays where it stopped
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

  layout();
  refreshPatternLabels();

  return {
    update,
    denied: () => {},
    destroy() {
      destroyed = true;
      clockGen++;
      seqGen++;
      replayGen++;
      view = null;
      root.style.touchAction = prevTouchAction;
      if (actx) actx.close().catch(() => {});
      cells.forEach((b) => b.replaceWith(b.cloneNode(true)));
    }
  };
}
