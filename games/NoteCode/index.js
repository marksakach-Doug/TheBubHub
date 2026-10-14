// games/kyle/index.js — Kyle Knows the Code
const C4 = 261.63;
const SIZE = 6;                                          // every scale has six notes
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

// Microtone scales: six notes that equally divide a given interval (in cents).
// Notes sit at i * interval / 6 for i = 0..5, so the interval itself is not repeated.
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

const DEFAULT_CFG = { ears: false, scale: 'pent', social: false };
const sanitize = (c = {}) => ({ ears: !!c.ears, scale: SCALES[c.scale] ? c.scale : 'pent', social: !!c.social });
const pick = (rng, len) => Array.from({ length: len }, () => Math.floor(rng() * SIZE));
const sameArr = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

export function init() {
  return { phase: 'home', cfg: DEFAULT_CFG, wins: 0, len: 3, code: null, rows: [], won: false, over: false, clues: [], seats: null };
}

function score(g, code) {
  let red = 0; const cu = {}, gu = {};
  g.forEach((n, i) => { if (n === code[i]) red++; else { gu[n] = (gu[n] || 0) + 1; cu[code[i]] = (cu[code[i]] || 0) + 1; } });
  let white = 0; for (const k in gu) white += Math.min(gu[k], cu[k] || 0);
  return [red, white];
}

function say(red, white) {
  const p = [];
  if (red) p.push(`${WORDS[red]} ${red === 1 ? 'note is' : 'notes are'} right and in the right spot.`);
  if (white) p.push(`${WORDS[white]} ${white === 1 ? 'note is' : 'notes are'} right, but in the wrong spot.`);
  return p.join(' ') || 'None of those notes are in the code.';
}

// Builds a fresh round. In Social Code Break, the table gets players+1 prefilled clues,
// dealt round-robin, so no single player holds the full set but the group together has enough.
function startRound(cfg, len, wins, rng, players) {
  const code = pick(rng, len);
  const s = { phase: 'play', cfg, len, wins, code, rows: [], won: false, over: false, clues: [], seats: null };
  if (!cfg.social) return s;
  const seats = Array.isArray(players) ? players.slice() : [];
  if (seats.length < 2) return { error: 'Social Code Break needs at least 2 players.' };
  const total = seats.length + 1;
  for (let k = 0; k < total; k++) {
    let g;
    do { g = pick(rng, len); } while (sameArr(g, code) || s.clues.some((c) => sameArr(c.g, g)));
    const [red, white] = score(g, code);
    s.clues.push({ g, red, white, text: say(red, white), seat: k % seats.length });
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
  if (a.a !== 'guess' || !Array.isArray(a.g) || a.g.length !== s.len || a.g.some((n) => !(n >= 0 && n < SIZE)))
    return { error: `Kyle wants exactly ${s.len} notes.` };
  const [red, white] = score(a.g, s.code);
  const won = red === s.len;
  return {
    ...s,
    rows: [...s.rows, { g: a.g, red, white, text: say(red, white) }],
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

export function mount(root, api) {
  let view = null, sel = [], len = 0, seen = 0, wonSeen = false, endSeen = false, ac, bubbleTimer = 0, lastPhase = null;
  const $ = (q) => root.querySelector(q);
  const scaleOf = () => SCALES[(view && view.cfg && view.cfg.scale) || 'pent'];
  const tone = (hz) => {
    ac = ac || new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = hz;
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.6);
  };
  const playIdx = (i) => tone(scaleOf().hz[i]);
  // Speech bubble: always visible, text fades out after a few seconds.
  const bubble = (text) => {
    const my = ++bubbleTimer;
    $('#bubble').textContent = text;
    $('#bubble').style.visibility = 'visible';
    api.setTimeout(() => { if (my === bubbleTimer) $('#bubble').style.visibility = 'hidden'; }, 5000);
  };
  // Note names are clickable so anyone can replay a note (essential in ears-only mode).
  const noteSpans = (g) => g.map((i) =>
    `<span class="nt" data-p="${i}">${view.cfg.ears ? '***' : scaleOf().labels[i]}</span>`).join(' ');
  const pips = (red, white) => `<span>${'<i class="r"></i>'.repeat(red)}${'<i class="w"></i>'.repeat(white)}</span>`;

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:16px 'Times New Roman',serif;padding:12px;min-height:100%}
    h1{color:#0ff;font:bold 24px Georgia;text-shadow:3px 3px #f0f;margin:6px 0}
    #kyle{font:14px/1.1 'Courier New',monospace;color:#0f0;margin:0}
    #bubble{position:relative;background:#fff;color:#000;border:3px solid #000;padding:10px;min-height:60px;min-width:200px;font:bold 16px Arial;visibility:hidden}
    #bubble:before{content:'';position:absolute;left:-18px;top:20px;border:9px solid transparent;border-right:9px solid #000}
    .top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:8px}
    .board{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
    .card{border:2px ridge #0f0;background:#000;padding:6px 8px;white-space:nowrap}
    .clue{border-color:#ff0}
    .nt{cursor:pointer;color:#0ff;text-decoration:underline dotted;font-family:'Courier New',monospace}
    .r,.w{display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid #000;margin-left:3px}
    .r{background:#f00}.w{background:#fff}
    button{font:bold 16px Arial;min-width:48px;min-height:44px;margin:3px;background:#c0c0c0;border:3px outset #eee;cursor:pointer}
    select{font:16px Arial;min-height:36px;max-width:100%}
    .slot{display:inline-block;width:52px;height:44px;line-height:44px;border:2px inset #888;background:#fff;color:#000;text-align:center;margin:3px;font:bold 18px Arial}
    #home label{display:block;margin:12px 0}
    #home input[type=checkbox]{transform:scale(1.4);margin-right:10px}
    #home h2{color:#0ff;font:bold 20px Georgia;margin:6px 0}
  </style>
  <div class="k">
    <marquee>★ welcome to Kyle's Music  Page   ★ Kyle knows  the code.<span class="r">     Right note, right spot. <span class="w">     Right note, wrong spot.</marquee>
    <h1>Kyle Knows the Code</h1>
    <div class="top">
      <pre id="kyle">${KYLE}</pre>
      <div id="bubble">I'm Kyle and I know the code.</div>
    </div>
    <div id="home" style="display:none">
      <h2>Choose your game</h2>
      <label><input type="checkbox" id="ears"> Ears only (no note letters; tap a feedback note to hear it)</label>
      <label>Scale <select id="scale">${scaleOptions()}</select></label>
      <label><input type="checkbox" id="social"> Multiplayer Social Code Break (2+ players; shared clues, one guess for the table)</label>
      <p><button id="start">Start</button></p>
    </div>
    <div id="game" style="display:none">
      <p id="meta"></p>
      <div id="slots"></div>
      <div id="pad"></div>
      <div id="ctl"></div>
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
    if (home) {
      // Load the last-used settings when entering the home screen, not on every update.
      if (lastPhase !== 'home') {
        $('#ears').checked = !!view.cfg.ears;
        $('#scale').value = view.cfg.scale;
        $('#social').checked = !!view.cfg.social;
      }
      $('#start').disabled = spec;
      lastPhase = 'home';
      return;
    }
    lastPhase = 'play';

    const sc = scaleOf();
    const ears = view.cfg.ears;
    const end = view.won || view.over;
    $('#meta').textContent = `Notes in this code: ${view.len} · Rounds cracked: ${view.wins}`
      + `${view.cfg.social ? ' · Social: one guess for the whole table' : ''}${spec ? ' · 👁 watching' : ''}`;
    $('#slots').innerHTML = Array.from({ length: view.len }, (_, k) =>
      `<span class="slot">${sel[k] !== undefined ? (ears ? '***' : sc.labels[sel[k]]) : '·'}</span>`).join('');
    $('#pad').innerHTML = sc.labels.map((n, i) => `<button data-i="${i}" ${off}>${ears ? '♪' : n}</button>`).join('');

    const clueCards = view.clues.map((c, n) =>
      `<div class="card clue"><b>Clue ${n + 1}</b> ${noteSpans(c.g)} ${pips(c.red, c.white)}<br><small>${c.text}</small></div>`);
    const guessCards = view.rows.map((r, n) =>
      `<div class="card"><b>${n + 1}.</b> ${noteSpans(r.g)} ${pips(r.red, r.white)}</div>`);
    $('#board').innerHTML = [
      view.cfg.social ? `<p>Your clues: ${view.clues.length} of ${view.totalClues} held by the table.</p>` : '',
      ...clueCards, ...guessCards,
    ].join('');

    $('#ctl').innerHTML = end
      ? `<p><b>${view.won ? 'You cracked it!' : (view.cfg.social ? 'The one guess missed.' : 'Out of guesses.')}</b>
           The code was ${noteSpans(view.code)}.</p>
         <button data-a="next" ${off}>Next round (${view.len < 10 ? view.len + 1 : 3} notes)</button>
         <button data-a="home" ${off}>Modes</button>`
      : `<button data-a="clear" ${off}>Clear</button> <button data-a="submit" ${off}>Ask Kyle</button>
         <button data-a="home" ${off}>Modes</button>`;
  };

  root.addEventListener('click', (e) => {
    if (!view) return;
    const start = e.target.closest('#start');
    if (start) {
      if (api.isSpectator) return;
      sel = [];
      api.send({ a: 'start', cfg: { ears: $('#ears').checked, scale: $('#scale').value, social: $('#social').checked } });
      return;
    }
    const nt = e.target.closest('.nt');                    // replay a note: local only, allowed for spectators
    if (nt) { playIdx(+nt.dataset.p); return; }
    const b = e.target.closest('button');
    if (!b || api.isSpectator) return;
    if (b.dataset.i !== undefined) { if (sel.length < len) { sel.push(+b.dataset.i); playIdx(+b.dataset.i); render(); } }
    else if (b.dataset.a === 'clear') { sel = []; render(); }
    else if (b.dataset.a === 'submit' && sel.length === len) { api.send({ a: 'guess', g: sel }); sel = []; }
    else if (b.dataset.a === 'next') { sel = []; api.send({ a: 'next' }); }
    else if (b.dataset.a === 'home') { sel = []; api.send({ a: 'home' }); }
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
