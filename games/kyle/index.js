// games/kyle/index.js — Kyle Knows the Code
const WORDS = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const SEEN_KEY = 'kyle.key.v1';   // first-ever round: the Key legend starts open
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

// A scale is six pitches (hz) with labels. A rhythm scale adds `dur`: its shortest and longest note, in seconds;
// the S lengths in play are spread evenly between them.
export const SCALES = {
  pent: { labels: ['C', 'D', 'E', 'G', 'A', "C'"], hz: [262, 294, 330, 392, 440, 523] },
  rhythm: { labels: ['1', '2', '3', '4', '5', '6'], hz: Array(6).fill(262), dur: [0.12, 0.78] },
};

// A path is a list of levels, easiest first. A level is:
//   name, S (notes of the scale in use), k (notes per unit), form, and optionally scale (default 'pent'), rule,
//   and tip (what Kyle says when the level starts; only where something is new).
// Form is the shape of the whole tune. CAPITALS are units you crack (A, B, ...); lowercase are units Kyle plays (a, b, ...).
//   'AB' = plain Mastermind, 'AABA' = a song built from two motifs, 'abAB' = Kyle's call, then your response.
// Rule limits what a unit may be (see RULES).
export const PATHS = {
  classic: { name: 'Classic Melodies', blurb: 'Plain Mastermind, in tunes.', levels: [
    { name: 'Pocket Duets', S: 4, k: 2, form: 'AB', tip: 'I know two secret 2-note melodies. Tap notes below to fill both slots, then Ask Kyle. Red: right melody, right spot. White: right melody, wrong spot.' },
    { name: 'Pentatonic Call & Response', S: 5, k: 2, form: 'AB' },
    { name: 'Pentatonic Breeze', S: 5, k: 1, form: 'ABCD', tip: 'Single notes now, not melodies — four lone notes to place. Same red and white clues.' },
    { name: 'Hexatonic Twin Phrases', S: 6, k: 2, form: 'AB' },
    { name: 'Double Triads', S: 3, k: 3, form: 'AB', tip: 'Three-note melodies now. Fill both slots — six notes — and Ask Kyle.' },
    { name: 'Three Little Intervals', S: 3, k: 2, form: 'ABC', tip: 'Three melodies to crack this time: A, B and C. Work them one at a time.' },
    { name: 'Classic Mastermind', S: 6, k: 1, form: 'ABCD' },
    { name: 'Tetratonic Stretch', S: 4, k: 1, form: 'ABCDE' },
    { name: 'Triad Telegraph', S: 3, k: 1, form: 'ABCDEF' },
    { name: 'Lucky Sevens Triad', S: 3, k: 1, form: 'ABCDEFG' },
  ] },
  pegs: { name: 'Orange & Blue', blurb: 'Right notes, wrong order: the extra clues.', levels: [
    { name: 'Tetratonic Trio', S: 4, k: 2, form: 'ABC', tip: 'New path, two new clues — and three slots to fill before you Ask Kyle. Orange: right notes, wrong order, right spot. Blue: right notes, wrong order, wrong spot. Red and white work as ever.' },
    { name: 'Pentatonic Phrasebook', S: 5, k: 2, form: 'ABC' },
    { name: 'Triple Triad Motifs', S: 3, k: 3, form: 'ABC' },
  ] },
  songs: { name: 'Song Forms', blurb: 'Crack the motifs, hear the whole song.', levels: [
    { name: 'Tin Pan Alley Hook', S: 5, k: 2, form: 'AABA', tip: 'My song is built from two melodies in the shape A-A-B-A. Crack them both — fill both slots and Ask Kyle — and ▶ plays the whole song.' },
    { name: 'Hexatonic Chorus', S: 6, k: 2, form: 'ABAB', tip: 'The song swaps back and forth this time: A-B-A-B. Still just two melodies to crack.' },
    { name: 'Mini Rondo', S: 4, k: 2, form: 'ABAC', tip: 'Three melodies this time: A, B and C.' },
    { name: 'Folk Ballad Arch', S: 4, k: 3, form: 'ABBA', tip: 'An arch this time: A-B-B-A. The middle repeats — crack B and half the song falls into place.' },
    { name: 'Pentatonic Rondo', S: 5, k: 2, form: 'ABACA', tip: 'Five parts, three melodies: A-B-A-C-A. A carries the song — pin it down first.' },
    { name: 'Blues Riff Cycle', S: 5, k: 3, form: 'AABA', tip: 'A tough one: 3-note melodies. Crack one motif at a time — A sounds three times, so start there.' },
    { name: 'Sixteen-Note Chiptune', S: 4, k: 4, form: 'AABA', tip: 'The final exam: 4-note melodies, eight notes a guess. Work one motif at a time and trust the pips.' },
  ] },
  calls: { name: 'Call & Response', blurb: 'Kyle plays a call. You crack the answer.', levels: [
    { name: "Kyle's 8-Note Jam", S: 5, k: 2, form: 'abAB', tip: 'Lowercase is me: I play my call openly and it stays on screen, already solved. CAPITALS are you: fill both slots and Ask Kyle, exactly like before. ▶ plays us both together.' },
    { name: 'Hexatonic Trading Fours', S: 6, k: 2, form: 'abAB' },
    { name: 'Twelve-Note Trading Triplets', S: 4, k: 3, form: 'abAB' },
    { name: 'Interleaved Duet', S: 5, k: 3, form: 'aAbB', tip: 'Now we trade twice over: my call, your answer, my call, your answer. And the melodies are 3 notes long — work one motif at a time.' },
  ] },
  motifs: { name: 'Constrained Motifs', blurb: 'Stepwise runs, turns and sweeps.', levels: [
    { name: 'Resolved Call & Response', S: 5, k: 3, form: 'abAB', rule: 'step', tip: 'New path, same game: fill both slots, Ask Kyle. Every melody moves one scale step at a time — no leaps. My call is open; your answer is hidden.' },
    { name: 'Stepwise Duet Walk', S: 6, k: 2, form: 'ABC', rule: 'step' },
    { name: 'Stepwise Sixteen-Note Chorale', S: 5, k: 4, form: 'AABA', rule: 'step', tip: 'My tune repeats two melodies, A and B: crack them.' },
    { name: 'Walking Triplets', S: 4, k: 3, form: 'ABC', rule: 'step' },
    { name: 'Baroque Mordents', S: 6, k: 3, form: 'ABC', rule: 'turn', tip: 'Every melody is a neighbor turn: X-Y-X, with Y one step from X.' },
    { name: 'Sweeping Arpeggio Hook', S: 6, k: 3, form: 'AABA', rule: 'sweep', tip: 'Every melody rises or falls the whole way.' },
    { name: 'Pentatonic Runs & Turns', S: 5, k: 3, form: 'ABC', rule: 'step' },
    { name: 'Pentatonic Stepwise Quartet', S: 5, k: 2, form: 'ABCD', rule: 'step' },
    { name: 'Stepwise Rondo Finale', S: 5, k: 3, form: 'ABACA', rule: 'step' },
    { name: 'Rising & Falling Triads', S: 5, k: 3, form: 'ABC', rule: 'sweep' },
  ] },
  rhythm: { name: 'Morse Melody', blurb: 'One pitch. Crack the rhythm.', levels: [
    { name: 'Morse Hello', S: 3, k: 1, form: 'ABC', scale: 'rhythm', tip: 'One pitch here — the numbers are note lengths, 1 is shortest. Tap lengths to fill the three slots, then Ask Kyle. You are cracking rhythm, not melody.' },
    { name: 'Four Lengths', S: 4, k: 1, form: 'ABC', scale: 'rhythm' },
    { name: 'Rhythm Pair', S: 3, k: 2, form: 'AB', scale: 'rhythm', tip: 'Each unit is two lengths now.' },
    { name: 'Morse Tap', S: 3, k: 1, form: 'ABCD', scale: 'rhythm' },
    { name: 'Rhythm Duets', S: 4, k: 2, form: 'AB', scale: 'rhythm' },
    { name: 'Morse Five', S: 3, k: 1, form: 'ABCDE', scale: 'rhythm' },
    { name: 'Rhythm Triplets', S: 3, k: 3, form: 'AB', scale: 'rhythm', tip: 'Three lengths per unit now — each slot holds a little rhythm of its own.' },
    { name: 'Rhythm Mastermind', S: 6, k: 1, form: 'ABCD', scale: 'rhythm' },
  ] },
};

const RULES = {
  step: (u) => u.every((n, i) => !i || Math.abs(n - u[i - 1]) === 1),                              // adjacent scale steps only
  turn: (u) => u.length === 3 && u[0] === u[2] && Math.abs(u[0] - u[1]) === 1,                      // X-Y-X neighbor turn
  sweep: (u) => u.every((n, i) => !i || n > u[i - 1]) || u.every((n, i) => !i || n < u[i - 1]),   // strictly rising or falling
};

export const meta = { id: 'kyle', title: 'Kyle Knows the Code', players: '1+', color: '#ff00ff',
  icon: '🎵', desc: 'Crack the melody that Kyle knows.', soloable: true };

// A unit is one symbol of the code: a short melody of k pitches.
const key = (u) => u.join(',');
const sortKey = (u) => key(u.slice().sort((a, b) => a - b));   // same pitches, any order
const count = (form, re) => new Set(form.match(re)).size;
const pick = (rng, n, size) => Array.from({ length: n }, () => Math.floor(rng() * size));
const unit = (rng, c) => { let u; do u = pick(rng, c.k, c.S); while (c.rule && !RULES[c.rule](u)); return u; };

export function init() {
  return { phase: 'home', round: 0, prog: {}, rows: [], won: false, wonBy: null, code: null, given: [] };
}

// Scores a guess against the code, unit by unit. Each unit is classified once, in this order:
//   red    exact melody in the right slot       white  exact melody in a different slot
//   orange same notes, wrong order, right slot  blue   same notes, wrong order, different slot
function scoreUnits(g, code) {
  const n = code.length, gu = Array(n).fill(false), cu = Array(n).fill(false);
  const out = { red: 0, white: 0, orange: 0, blue: 0 };
  const pass = (name, f, anySlot) => {
    for (let i = 0; i < n; i++) {
      if (gu[i]) continue;
      const j = anySlot ? code.findIndex((c, x) => !cu[x] && f(c) === f(g[i])) : (!cu[i] && f(code[i]) === f(g[i]) ? i : -1);
      if (j >= 0) { out[name]++; gu[i] = cu[j] = true; }
    }
  };
  pass('red', key, false); pass('white', key, true); pass('orange', sortKey, false); pass('blue', sortKey, true);
  return out;
}

const SAY = {
  red: ['is', 'are', 'right and in the right spot'],
  orange: ['has', 'have', 'the right notes out of order, in the right spot'],
  white: ['is', 'are', 'right, but in the wrong spot'],
  blue: ['has', 'have', 'the right notes out of order, in the wrong spot'],
};
const say = (fb, noun) => {
  const plural = noun === 'melody' ? 'melodies' : `${noun}s`;
  return Object.entries(SAY).filter(([c]) => fb[c])
    .map(([c, [one, many, t]]) => `${WORDS[fb[c]]} ${fb[c] > 1 ? plural : noun} ${fb[c] > 1 ? many : one} ${t}.`).join(' ')
    || `None of those ${plural} are in the code.`;
};

// Builds a round of the path's current level: a hidden code, plus any units Kyle plays openly.
function startRound(s, path, rng) {
  const levels = PATHS[path].levels, lvl = (s.prog[path] || 0) % levels.length, cfg = levels[lvl];
  const draw = (re) => Array.from({ length: count(cfg.form, re) }, () => unit(rng, cfg));
  return { ...s, phase: 'play', round: s.round + 1, path, lvl, cfg, code: draw(/[A-Z]/g), given: draw(/[a-z]/g), rows: [], won: false, wonBy: null };
}

export function reduce(s, a, ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  const fromId = (ctx && ctx.from && ctx.from.id) || '';
  if (a.a === 'home') return { ...s, phase: 'home' };
  if (a.a === 'play') return PATHS[a.path] ? startRound(s, a.path, rng) : { error: 'No such path.' };
  if (s.phase !== 'play') return { error: 'Pick a path first.' };
  if (a.a === 'next') return s.won ? startRound(s, s.path, rng) : { error: 'Finish this round first.' };
  if (s.won) return { error: 'Round finished. Start the next one.' };
  const { k, S, rule } = s.cfg, H = s.code.length;
  if (a.a !== 'guess' || !Array.isArray(a.g) || a.g.length !== H * k || a.g.some((n) => !Number.isInteger(n) || n < 0 || n >= S))
    return { error: `Kyle wants exactly ${H * k} notes.` };
  const g = Array.from({ length: H }, (_, i) => a.g.slice(i * k, i * k + k));
  if (rule && !g.every(RULES[rule])) return { error: 'Those notes break this level\'s rule.' };
  const fb = scoreUnits(g, s.code), won = fb.red === H;
  return { ...s, rows: [...s.rows, { g, ...fb, text: say(fb, k > 1 ? 'melody' : 'note') }], won,
    wonBy: won ? fromId : s.wonBy,
    prog: won ? { ...s.prog, [s.path]: s.lvl + 1 } : s.prog };
}

// The code stays hidden until it is cracked.
export function project(s) { return { ...s, code: s.won ? s.code : null }; }

export function mount(root, api) {
  let view = null, sel = [], seen = 0, round = 0, ac;
  const $ = (q) => root.querySelector(q);
  const talk = (t) => { $('#bubble').textContent = t; };
  const sc = () => SCALES[view.cfg.scale || 'pent'];
  const need = () => count(view.cfg.form, /[A-Z]/g) * view.cfg.k;

  // One note at audio time t. Pitched scales pluck; rhythm scales hold for d seconds, then release.
  const note = (hz, t, d, hold) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.5, t);
    g.gain.setValueAtTime(0.5, hold ? t + d : t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d + (hold ? 0.05 : 0.1));
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + d + 0.1);
  };
  const play = (idxs) => {
    ac = ac || new AudioContext();
    const { hz, dur } = sc();
    let t = ac.currentTime + 0.02;
    for (const i of idxs) { const d = dur ? dur[0] + ((dur[1] - dur[0]) * i) / (view.cfg.S - 1) : 0.3; note(hz[i], t, d, !!dur); t += d + 0.05; }
  };

  // The whole tune for a set of cracked units: the form's letters, filled in. Kyle's units are lowercase.
  const full = (u) => [...view.cfg.form].flatMap((c) => (c < 'a' ? u[c.charCodeAt(0) - 65] : view.given[c.charCodeAt(0) - 97]));
  const spans = (units) => units.map((u) => `<u data-p="${u}">${u.map((i) => sc().labels[i]).join('-')}</u>`).join(' ');
  const pips = (fb) => ['red', 'orange', 'white', 'blue'].map((c) => `<i class="${c}"></i>`.repeat(fb[c])).join('');

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:16px 'Times New Roman',serif;padding:10px;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;box-sizing:border-box}
    h1{color:#0ff;font:bold 22px Georgia;text-shadow:3px 3px #f0f}
    td{vertical-align:top}
    pre{font:10px/1.05 'Courier New',monospace;color:#0f0;margin:0}
    #bubble{background:#fff;color:#000;border:3px solid #000;padding:8px;font:bold 15px Arial}
    u{color:#0ff;cursor:pointer;font-family:'Courier New',monospace}
    i{display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid #fff;margin-left:3px}
    .red{background:red}.orange{background:orange}.white{background:white}.blue{background:dodgerblue}
    button{font:bold 16px Arial;min-width:44px;min-height:44px;margin:3px}
  </style>
  <div class="k">
    <marquee>★ welcome to Kyle's Music Page ★ Kyle knows the code ★</marquee>
    <table width="100%"><tr><td id="bubble">I'm Kyle. I know the code.</td><td><pre>${KYLE}</pre></td></tr></table>
    <h1>Kyle Knows the Code</h1><hr>
    <div id="home"></div>
    <div id="game" hidden>
      <button data-a="home">« Home</button>
      <p id="meta"></p><p id="given"></p><p><tt id="slots"></tt></p>
      <div id="pad"></div><div id="ctl"></div>
      <details id="key"><summary>Key</summary>
        <p><i class="red"></i> right melody, right slot &nbsp; <i class="white"></i> right melody, wrong slot<br>
        <i class="orange"></i> right notes, wrong order, right slot &nbsp; <i class="blue"></i> right notes, wrong order, wrong slot<br>
        Form: CAPITALS are the units you crack, lowercase are Kyle's. Click an underlined melody to hear it; ▶ plays the whole tune.</p>
      </details>
      <hr><div id="board"></div>
    </div>
  </div>`;

  // First-ever round: the legend starts open, so the pips mean something
  // while Kyle's tip is still on screen. Afterwards it stays as the player
  // left it — render() never touches it.
  try { if (!localStorage.getItem(SEEN_KEY)) $('#key').open = true; } catch (e) { $('#key').open = true; }

  const render = () => {
    const off = api.isSpectator ? 'disabled' : '';
    const home = view.phase === 'home';
    $('#home').hidden = !home; $('#game').hidden = home;
    if (home) {
      $('#home').innerHTML = '<h2>Choose a path</h2>' + Object.entries(PATHS).map(([id, p]) =>
        `<p><button data-path="${id}" ${off}>${p.name}</button> ${p.blurb} <small>(${Math.min(view.prog[id] || 0, p.levels.length)}/${p.levels.length} cleared)</small></p>`).join('');
      return;
    }
    const { k, S, form, name } = view.cfg, c = sc(), p = PATHS[view.path], H = need() / k;
    $('#meta').textContent = `${p.name} · level ${view.lvl + 1} of ${p.levels.length}: ${name} · ${S} ${sc().dur ? 'lengths' : 'notes'} · ${k}-note units · form ${form}${api.isSpectator ? ' · 👁 watching' : ''}`;
    $('#given').innerHTML = view.given.length ? `Kyle plays: ${spans(view.given)}` : '';
    $('#slots').textContent = Array.from({ length: H }, (_, u) =>
      Array.from({ length: k }, (_, j) => c.labels[sel[u * k + j]] || '_').join(' ')).join(' | ');
    $('#pad').innerHTML = c.labels.slice(0, S).map((n, i) => `<button data-i="${i}" ${off}>${n}</button>`).join('');
    $('#ctl').innerHTML = view.won
      ? `<p><b>You cracked it!</b> The code was ${spans(view.code)} <u data-p="${full(view.code)}">▶</u></p><button data-a="next" ${off}>Next game</button>`
      : `<button data-a="clear" ${off}>Clear</button> <button data-a="submit" ${off}>Ask Kyle</button>`;
    $('#board').innerHTML = view.rows.map((r, n) =>
      `<p><tt>${n + 1}.</tt> <u data-p="${full(r.g)}">▶</u> ${spans(r.g)} ${pips(r)}</p>`).join('');
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-p],[data-i],[data-a],[data-path]');
    if (!t || !view) return;
    const d = t.dataset;
    if (d.p) return play(d.p.split(',').map(Number));        // listening is local, so spectators may do it
    if (api.isSpectator) return;
    if (d.path) { sel = []; api.send({ a: 'play', path: d.path }); }
    else if (d.i !== undefined) { if (sel.length < need()) { sel.push(+d.i); play([+d.i]); render(); } }
    else if (d.a === 'clear') { sel = []; render(); }
    else if (d.a === 'submit') { if (sel.length === need()) { api.send({ a: 'guess', g: sel }); sel = []; } }
    else { sel = []; api.send({ a: d.a }); }                  // home, next
  });

  return {
    update(v) {
      view = v;
      if (v.phase === 'play' && v.round !== round) {
        round = v.round; sel = []; seen = 0; talk(v.cfg.tip || 'A new code. I know it.');
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* incognito */ }
      }
      if (v.rows.length > seen) talk(v.rows[v.rows.length - 1].text + (v.won ? ' You cracked it!' : ''));
      seen = v.rows.length;
      render();
    },
    denied(text) { talk(String(text || 'Kyle refused that.')); },
    destroy() { if (ac) ac.close(); },
  };
}

export function summarize(s, nameOf) {
  if (!s || !s.won || s.phase !== 'play') return null;
  const lvl = (s.cfg && s.cfg.name) || 'the code';
  let who = 'Someone';
  try { who = nameOf(s.wonBy) || 'Someone'; } catch (e) { who = 'Someone'; }
  const n = (s.rows || []).length;
  return `${who} cracked ${lvl} in ${n} ${n === 1 ? 'try' : 'tries'}`;
}
