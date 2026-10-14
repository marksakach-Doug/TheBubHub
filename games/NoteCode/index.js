// games/kyle/index.js — Kyle Knows the Code
const C4 = 261.63;
const SIZE = 6;                                          // every scale has six pitches
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const WORDS = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const KYLE = `    _______
   /_______\\___
  ( 0   o   )
   (   U   )
    \\_____/
   __|   |__
  /  |   |  \\
 /   |___|   \\
     |   |
    _|   |_
`;

// Equal-tempered six-note modes, given as semitones above C.
const et = (semis) => semis.map((s) => +(C4 * 2 ** (s / 12)).toFixed(2));
const sixNote = (name, group, semis) => ({ name, group, labels: semis.map((s) => NAMES[s % 12]), hz: et(semis) });

// Microtone scales: six pitches that equally divide a given interval (in cents).
// Pitches sit at i * interval / 6 for i = 0..5, so the interval itself is not repeated.
const micro = (name, group, cents) => {
  const at = Array.from({ length: SIZE }, (_, i) => (cents * i) / SIZE);
  return { name, group, labels: at.map((_, i) => String(i + 1)), hz: at.map((c) => +(C4 * 2 ** (c / 1200)).toFixed(2)) };
};

export const SCALES = {
  pent: { name: "Classic pentatonic (C D E G A C')", group: 'Classic',
    labels: ['C', 'D', 'E', 'G', 'A', "C'"], hz: [262, 294, 330, 392, 440, 523] },
  whole: sixNote('Whole tone', 'Six-note modes', [0, 2, 4, 6, 8, 10]),
  majblues: sixNote('Major blues', 'Six-note modes', [0, 2, 3, 4, 7, 9]),
  minblues: sixNote('Minor blues', 'Six-note modes', [0, 3, 5, 6, 7, 10]),
  dorian: sixNote('Dorian, no 7th', 'Six-note modes', [0, 2, 3, 5, 7, 9]),
  phrygian: sixNote('Phrygian, no 7th', 'Six-note modes', [0, 1, 3, 5, 7, 8]),
  edo6: micro('6-EDO octave (200 cent steps)', 'Advanced microtone', 1200),
  fifth6: micro('Fifth in 6 equal parts (~117 cent steps)', 'Advanced microtone', 700),
  step6: micro('Whole step in 6 equal parts (~33 cent steps)', 'Advanced microtone', 200),
};

export const meta = { id: 'kyle', title: 'Kyle Knows the Code', players: '1+', color: '#ff00ff',
  icon: '🎵', desc: 'Crack the melody that Kyle knows.', soloable: true };

const DEFAULT_CFG = { ears: false, scale: 'pent', social: false, perUnit: 1 };
const sanitize = (c = {}) => ({
  ears: !!c.ears,
  scale: SCALES[c.scale] ? c.scale : 'pent',
  social: !!c.social,
  perUnit: Math.min(5, Math.max(1, parseInt(c.perUnit, 10) || 1)),
});
const pick = (rng, n) => Array.from({ length: n }, () => Math.floor(rng() * SIZE));
// A unit is one symbol of the code: a short melody of perUnit pitches.
const key = (u) => u.join(',');
const sortKey = (u) => key(u.slice().sort((a, b) => a - b));   // same pitches, any order
const sameUnits = (A, B) => A.every((u, i) => key(u) === key(B[i]));
const nounFor = (k) => (k > 1 ? 'melody' : 'note');

export function init() {
  return { phase: 'home', cfg: DEFAULT_CFG, wins: 0, len: 3, code: null, rows: [], won: false, over: false, clues: [], seats: null };
}

// Scores a guess against the code, unit by unit. Each unit is classified once, in this order:
//   red    exact melody in the right slot
//   white  exact melody in a different slot
//   orange same notes, wrong order, in the right slot
//   blue   same notes, wrong order, in a different slot
function scoreUnits(g, code) {
  const n = code.length;
  const gUsed = Array(n).fill(false), cUsed = Array(n).fill(false);
  const out = { red: 0, white: 0, orange: 0, blue: 0 };
  for (let i = 0; i < n; i++) if (key(g[i]) === key(code[i])) { out.red++; gUsed[i] = cUsed[i] = true; }
  for (let i = 0; i < n; i++) {
    if (gUsed[i]) continue;
    const j = code.findIndex((c, j2) => !cUsed[j2] && key(c) === key(g[i]));
    if (j >= 0) { out.white++; gUsed[i] = cUsed[j] = true; }
  }
  for (let i = 0; i < n; i++) {
    if (gUsed[i]) continue;
    if (!cUsed[i] && sortKey(g[i]) === sortKey(code[i])) { out.orange++; gUsed[i] = cUsed[i] = true; }
  }
  for (let i = 0; i < n; i++) {
    if (gUsed[i]) continue;
    const j = code.findIndex((c, j2) => !cUsed[j2] && sortKey(c) === sortKey(g[i]));
    if (j >= 0) { out.blue++; gUsed[i] = cUsed[j] = true; }
  }
  return out;
}

function say(fb, noun) {
  const p = [];
  const pl = (n) => (n === 1 ? noun : `${noun}s`);
  if (fb.red) p.push(`${WORDS[fb.red]} ${pl(fb.red)} ${fb.red === 1 ? 'is' : 'are'} right and in the right spot.`);
  if (fb.orange) p.push(`${WORDS[fb.orange]} ${pl(fb.orange)} ${fb.orange === 1 ? 'has' : 'have'} the right notes out of order, in the right spot.`);
  if (fb.white) p.push(`${WORDS[fb.white]} ${pl(fb.white)} ${fb.white === 1 ? 'is' : 'are'} right, but in the wrong spot.`);
  if (fb.blue) p.push(`${WORDS[fb.blue]} ${pl(fb.blue)} ${fb.blue === 1 ? 'has' : 'have'} the right notes out of order, in the wrong spot.`);
  return p.join(' ') || `None of those ${noun}s are in the code.`;
}

// Builds a fresh round. In Social Code Break, the table gets players+1 prefilled clues,
// dealt round-robin, so no single player holds the full set but the group together has enough.
function startRound(cfg, len, wins, rng, players) {
  const code = Array.from({ length: len }, () => pick(rng, cfg.perUnit));
  const s = { phase: 'play', cfg, len, wins, code, rows: [], won: false, over: false, clues: [], seats: null };
  if (!cfg.social) return s;
  const seats = Array.isArray(players) ? players.slice() : [];
  if (seats.length < 2) return { error: 'Social Code Break needs at least 2 players.' };
  const total = seats.length + 1;
  const noun = nounFor(cfg.perUnit);
  for (let k = 0; k < total; k++) {
    let g;
    do { g = Array.from({ length: len }, () => pick(rng, cfg.perUnit)); }
    while (sameUnits(g, code) || s.clues.some((c) => sameUnits(c.g, g)));
    const fb = scoreUnits(g, code);
    s.clues.push({ g, ...fb, text: say(fb, noun), seat: k % seats.length });
  }
  s.seats = seats;
  return s;
}

export function reduce(s, a, ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  const players = ctx && ctx.players;
  if (a.a === 'home') return { ...s, phase: 'home' };
  if (a.a === 'start') return startRound(sanitize(a.cfg), 3, s.wins || 0, rng, players);
  if (s.phase !== 'play') return { error: 'Pick a mode and start a round first.' };
  if (a.a === 'next') {
    if (!(s.won || s.over)) return { error: 'Finish this round first.' };
    return startRound(s.cfg, s.len < 10 ? s.len + 1 : 3, s.wins, rng, players);
  }
  if (s.won || s.over) return { error: 'Round finished. Start the next one.' };
  const k = s.cfg.perUnit;
  if (a.a !== 'guess' || !Array.isArray(a.g) || a.g.length !== s.len * k || a.g.some((n) => !(n >= 0 && n < SIZE)))
    return { error: `Kyle wants exactly ${s.len * k} notes.` };
  const g = Array.from({ length: s.len }, (_, i) => a.g.slice(i * k, i * k + k));
  const fb = scoreUnits(g, s.code);
  const won = fb.red === s.len;
  return {
    ...s,
    rows: [...s.rows, { g, ...fb, text: say(fb, nounFor(k)) }],
    won,
    over: !won && !!s.cfg.social,                         // social: the table's one guess is spent
    wins: s.wins + (won ? 1 : 0),
  };
}

// Each viewer sees only their own prefilled clues. The code is hidden until the round ends.
export function project(s, pid) {
  const end = s.won || s.over;
  const idx = s.seats ? s.seats.indexOf(pid) : -1;
  return {
    ...s,
    code: end ? s.code : null,
    clues: idx >= 0 ? s.clues.filter((c) => c.seat === idx) : [],
    totalClues: s.clues.length,
    seats: undefined,
    you: pid,
  };
}

const scaleOptions = () => {
  const groups = {};
  for (const [id, sc] of Object.entries(SCALES)) {
    if (!groups[sc.group]) groups[sc.group] = [];
    groups[sc.group].push(`<option value="${id}">${sc.name}</option>`);
  }
  return Object.entries(groups).map(([g, opts]) => `<optgroup label="${g}">${opts.join('')}</optgroup>`).join('');
};

const perUnitOptions = () => [1, 2, 3, 4, 5]
  .map((n) => `<option value="${n}">${n === 1 ? '1 note (single notes)' : `${n}-note melody`}</option>`).join('');

export function mount(root, api) {
  let view = null, sel = [], len = 0, seen = 0, wonSeen = false, endSeen = false, ac, bubbleTimer = 0, lastPhase = null;
  const $ = (q) => root.querySelector(q);
  const scaleOf = () => SCALES[(view && view.cfg && view.cfg.scale) || 'pent'];
  const perUnit = () => (view && view.cfg ? view.cfg.perUnit : 1);

  // Scroll the whole game inside its own box, so it works in a short phone viewport.
  root.style.height = '100%';
  root.style.overflowY = 'auto';
  root.style.touchAction = 'pan-y';

  // One note: a short plucked tone starting at audio time `when`.
  const note = (hz, when) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.5, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.4);
    o.connect(g).connect(ac.destination);
    o.start(when); o.stop(when + 0.4);
  };
  // A melody: the pitches played one after another. A single pitch is a one-note melody.
  const playMelody = (idxs) => {
    ac = ac || new AudioContext();
    const hz = scaleOf().hz;
    const t0 = ac.currentTime + 0.02;
    idxs.forEach((i, j) => note(hz[i], t0 + j * 0.35));
  };
  const playIdx = (i) => playMelody([i]);

  // Speech bubble: always visible, text fades out after a few seconds.
  const bubble = (text) => {
    const my = ++bubbleTimer;
    $('#bubble').textContent = text;
    $('#bubble').style.visibility = 'visible';
    api.setTimeout(() => { if (my === bubbleTimer) $('#bubble').style.visibility = 'hidden'; }, 5000);
  };
  // Each unit is clickable and plays its whole melody. In ears-only mode the letters are hidden.
  const unitLabel = (u) => (view.cfg.ears ? '***' : u.map((i) => scaleOf().labels[i]).join('-'));
  const unitSpans = (units) => units.map((u) =>
    `<span class="nt" data-p="${u.join(',')}">${unitLabel(u)}</span>`).join(' ');
  const pips = (fb) => `<span>${'<i class="r"></i>'.repeat(fb.red)}${'<i class="o"></i>'.repeat(fb.orange)}`
    + `${'<i class="w"></i>'.repeat(fb.white)}${'<i class="b"></i>'.repeat(fb.blue)}</span>`;

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:16px 'Times New Roman',serif;padding:10px;min-height:100%;box-sizing:border-box}
    h1{color:#0ff;font:bold 22px Georgia;text-shadow:3px 3px #f0f;margin:4px 0}
    #kyle{font:10px/1.05 'Courier New',monospace;color:#0f0;margin:0}
    .top{display:flex;align-items:flex-start;gap:10px;margin-bottom:4px}
    #bubble{flex:1;position:relative;background:#fff;color:#000;border:3px solid #000;padding:8px;min-height:44px;min-width:0;font:bold 15px Arial;visibility:hidden;margin-right:12px}
    #bubble:before{content:'';position:absolute;right:-18px;top:14px;border:9px solid transparent;border-left:9px solid #000}
    .tr{display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0}
    #modes{min-width:0;min-height:36px;font-size:14px;margin:0 0 4px 0}
    .board{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
    .card{border:2px ridge #0f0;background:#000;padding:5px 7px;white-space:nowrap}
    .clue{border-color:#ff0}
    .nt{cursor:pointer;color:#0ff;text-decoration:underline dotted;font-family:'Courier New',monospace}
    .r,.w,.o,.b{display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid #000;margin-left:3px}
    .r{background:#f00}.w{background:#fff}.o{background:#ffa500}.b{background:#1e90ff;border-color:#fff}
    button{font:bold 16px Arial;min-width:44px;min-height:44px;margin:3px;background:#c0c0c0;border:3px outset #eee;cursor:pointer}
    select{font:16px Arial;min-height:36px;max-width:100%}
    #slots{display:flex;flex-wrap:wrap;align-items:center}
    .grp{display:inline-flex;margin-right:12px}
    .slot{display:inline-block;width:46px;height:40px;line-height:40px;border:2px inset #888;background:#fff;color:#000;text-align:center;margin:3px;font:bold 17px Arial}
    #home label{display:block;margin:12px 0}
    #home input[type=checkbox]{transform:scale(1.4);margin-right:10px}
    #home h2{color:#0ff;font:bold 20px Georgia;margin:6px 0}
    details{margin:6px 0;font-size:14px}
    summary{cursor:pointer;color:#0ff}
  </style>
  <div class="k">
    <marquee>★ welcome to Kyle's Music  Page   ★ Kyle knows  the code.<span class="r">     Right note, right spot. <span class="w">     Right note, wrong spot.</marquee>
    <div class="top">
      <div id="bubble">I'm Kyle and I know the code.</div>
      <div class="tr">
        <button id="modes" style="display:none">Modes</button>
        <pre id="kyle">${KYLE}</pre>
      </div>
    </div>
    <h1>Kyle Knows the Code</h1>
    <div id="home" style="display:none">
      <h2>Choose your game</h2>
      <label><input type="checkbox" id="ears"> Ears only (no note letters; tap a feedback unit to hear its melody)</label>
      <label>Scale <select id="scale">${scaleOptions()}</select></label>
      <label>Notes per unit <select id="perunit">${perUnitOptions()}</select></label>
      <label><input type="checkbox" id="social"> Multiplayer Social Code Break (2+ players; shared clues, one guess for the table)</label>
      <p><button id="start">Start</button></p>
    </div>
    <div id="game" style="display:none">
      <p id="meta"></p>
      <div id="slots"></div>
      <div id="pad"></div>
      <div id="ctl"></div>
      <details><summary>Dot key</summary>
        <p><i class="r"></i> right melody, right slot &nbsp; <i class="w"></i> right melody, wrong slot<br>
        <i class="o"></i> right notes, wrong order, right slot &nbsp; <i class="b"></i> right notes, wrong order, wrong slot</p>
      </details>
      <div class="board" id="board"></div>
    </div>
  </div>`;
  bubble("I'm Kyle. I know the code.");

  const render = () => {
    if (!view) return;
    const spec = !!api.isSpectator;
    const off = spec ? 'disabled' : '';
    const home = view.phase === 'home';
    $('#home').style.display = home ? 'block' : 'none';
    $('#game').style.display = home ? 'none' : 'block';
    $('#modes').style.display = home ? 'none' : 'inline-block';
    $('#modes').disabled = spec;
    if (home) {
      // Load the last-used settings when entering the home screen, not on every update.
      if (lastPhase !== 'home') {
        $('#ears').checked = !!view.cfg.ears;
        $('#scale').value = view.cfg.scale;
        $('#perunit').value = String(view.cfg.perUnit);
        $('#social').checked = !!view.cfg.social;
      }
      $('#start').disabled = spec;
      lastPhase = 'home';
      return;
    }
    lastPhase = 'play';

    const sc = scaleOf();
    const ears = view.cfg.ears;
    const k = perUnit();
    const end = view.won || view.over;
    $('#meta').textContent = `Units in this code: ${view.len}${k > 1 ? ` (${k}-note melodies)` : ''}`
      + ` · Rounds cracked: ${view.wins}`
      + `${view.cfg.social ? ' · Social: one guess for the whole table' : ''}${spec ? ' · 👁 watching' : ''}`;

    // Slots are grouped by unit: k boxes per unit, filled left to right.
    let slots = '';
    for (let u = 0; u < view.len; u++) {
      let inner = '';
      for (let j = 0; j < k; j++) {
        const p = u * k + j;
        const txt = sel[p] !== undefined ? (ears ? '***' : sc.labels[sel[p]]) : '·';
        inner += `<span class="slot">${txt}</span>`;
      }
      slots += `<span class="grp">${inner}</span>`;
    }
    $('#slots').innerHTML = slots;
    $('#pad').innerHTML = sc.labels.map((n, i) => `<button data-i="${i}" ${off}>${ears ? '♪' : n}</button>`).join('');

    const clueCards = view.clues.map((c, n) =>
      `<div class="card clue"><b>Clue ${n + 1}</b> ${unitSpans(c.g)} ${pips(c)}<br><small>${c.text}</small></div>`);
    const guessCards = view.rows.map((r, n) =>
      `<div class="card"><b>${n + 1}.</b> ${unitSpans(r.g)} ${pips(r)}</div>`);
    $('#board').innerHTML = [
      view.cfg.social ? `<p>Your clues: ${view.clues.length} of ${view.totalClues} held by the table.</p>` : '',
      ...clueCards, ...guessCards,
    ].join('');

    $('#ctl').innerHTML = end
      ? `<p><b>${view.won ? 'You cracked it!' : (view.cfg.social ? 'The one guess missed.' : 'Out of guesses.')}</b>
           The code was ${unitSpans(view.code)}.</p>
         <button data-a="next" ${off}>Next round (${view.len < 10 ? view.len + 1 : 3} units)</button>`
      : `<button data-a="clear" ${off}>Clear</button> <button data-a="submit" ${off}>Ask Kyle</button>`;
  };

  root.addEventListener('click', (e) => {
    if (!view) return;
    const start = e.target.closest('#start');
    if (start) {
      if (api.isSpectator) return;
      sel = [];
      api.send({ a: 'start', cfg: {
        ears: $('#ears').checked,
        scale: $('#scale').value,
        perUnit: $('#perunit').value,
        social: $('#social').checked,
      } });
      return;
    }
    const modes = e.target.closest('#modes');
    if (modes) { if (!api.isSpectator) { sel = []; api.send({ a: 'home' }); } return; }
    const nt = e.target.closest('.nt');                    // replay a unit's melody: local only, allowed for spectators
    if (nt) { playMelody(nt.dataset.p.split(',').map(Number)); return; }
    const b = e.target.closest('button');
    if (!b || api.isSpectator) return;
    const need = len * perUnit();
    if (b.dataset.i !== undefined) { if (sel.length < need) { sel.push(+b.dataset.i); playIdx(+b.dataset.i); render(); } }
    else if (b.dataset.a === 'clear') { sel = []; render(); }
    else if (b.dataset.a === 'submit' && sel.length === need) { api.send({ a: 'guess', g: sel }); sel = []; }
    else if (b.dataset.a === 'next') { sel = []; api.send({ a: 'next' }); }
  });

  return {
    update(v) {
      view = v;
      if (v.len !== len) { len = v.len; sel = []; }
      if (v.rows.length < seen) {                         // new round: board was reset
        seen = 0; sel = [];
        if (v.phase === 'play' && v.cfg.social) bubble('Kyle has given some clues. Share them, then make one guess.');
      }
      if (v.rows.length > seen) bubble(v.rows[v.rows.length - 1].text);
      seen = v.rows.length;
      if (v.won && !wonSeen) bubble('You cracked it! Hit Next round.');
      wonSeen = v.won;
      const ended = v.won || v.over;
      if (v.over && !endSeen) bubble('The one guess missed. Kyle is smug.');
      endSeen = ended;
      render();
    },
    destroy() { if (ac) ac.close(); },
  };
}

export function summarize(s, nameOf) { return null; }
