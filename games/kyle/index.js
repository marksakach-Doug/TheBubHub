// games/kyle/index.js: Kyle Knows the Code (bare bones: answer Kyle's call with his secret twist)
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
// Kyle at the keyboard: left hand, then right hand. mount() swaps these in while any sound plays.
const PLAY_A = String.raw` ♪  _______
   /_______\___
  ( 0   o   )  ♫
   (   U   )
    \_____/
   __|   |__
  /  |   |  \
 [*|_|_|_|_|_|]
     |   |
    _|   |_
`;
const PLAY_B = String.raw`    _______  ♫
   /_______\___
  ( 0   o   )
   (   U   )  ♪
    \_____/
   __|   |__
  /  |   |  \
 [_|_|_|_|_|*]
     |   |
    _|   |_
`;
const FRAMES = [KYLE, PLAY_A, PLAY_B];

// One scale, eight notes. A melody is a list of positions on it (0 = lowest).
const SCALE = { labels: ['C', 'D', 'E', 'G', 'A', "C'", "D'", "E'"], hz: [262, 294, 330, 392, 440, 523, 587, 659] };
const S = SCALE.labels.length;

export const meta = { id: 'kyle', title: 'Kyle Knows the Code', players: '1+', color: '#ff00ff',
  icon: '🎵', desc: "Answer Kyle's call with his secret twist.", soloable: true };

// Every round hides a random twist that turns Kyle's call into his answer. A twist is 1 to 3 of these parts,
// applied in this order (the more rounds you prove, the more parts):
//   inv    upside down, mirrored around the call's first note     rev    backwards
//   slide  either a fixed shift (T.shift, in scale steps), or `land`: the answer must END on that position
const GOAL = { 0: 'home', 3: 'the fifth', 5: 'high home' }, SIZE = ['a step', 'a third', 'a fourth'];
function twist(rng, parts) {
  const pool = ['inv', 'rev', 'slide'];
  while (pool.length > parts) pool.splice(Math.floor(rng() * pool.length), 1);
  const T = {};
  let land = null;
  if (pool.includes('inv')) T.inv = 1;
  if (pool.includes('rev')) T.rev = 1;
  if (pool.includes('slide')) {
    if (rng() < 0.4) land = [0, 3, 5][Math.floor(rng() * 3)];
    else T.shift = (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 3));
  }
  return { T, land };
}
const describe = (T, land) => [T.inv && 'upside down', T.rev && 'backwards',
  land != null ? `landing on ${GOAL[land]}` : T.shift && `${T.shift > 0 ? 'up' : 'down'} ${SIZE[Math.abs(T.shift) - 1]}`]
  .filter(Boolean).join(', then ') + '.';

// Kyle's answer to a call: mirror (around the first note), then reverse, then slide.
const apply = (c, T, land) => {
  const u = T.inv ? c.map((x) => 2 * c[0] - x) : c.slice();
  if (T.rev) u.reverse();
  const s = land == null ? T.shift || 0 : land - u[u.length - 1];
  return u.map((x) => x + s);
};
const inRange = (u) => u.every((x) => x >= 0 && x < S);

// A random call whose answer stays in range and differs from the call. The call and its unslid twist
// must also fit the range together, so the on-screen tools can always get there without leaving it.
function makeCall(rng, len, T, land) {
  for (;;) {
    const c = [Math.floor(rng() * S)];
    while (c.length < len) c.push(c[c.length - 1] + (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 3)));
    const a = apply(c, T, land), both = [...c, ...apply(c, { ...T, shift: 0 }, null)];
    if (inRange(c) && inRange(a) && a.join() !== c.join() && Math.max(...both) - Math.min(...both) < S) return c;
  }
}

// Three scores per guess: pitch (notes in place), contour (steps going the right way), size (steps the right distance).
const steps = (u) => u.slice(1).map((x, i) => x - u[i]);
const score = (g, a) => {
  const sg = steps(g), sa = steps(a);
  return { pitch: g.filter((x, i) => x === a[i]).length,
    contour: sg.filter((x, i) => Math.sign(x) === Math.sign(sa[i])).length,
    size: sg.filter((x, i) => Math.abs(x) === Math.abs(sa[i])).length };
};
const tell = (sc, m) => (sc.contour === 0 && sc.size === m - 1 ? 'Right distances, but you went the wrong way.'
  : sc.contour === m - 1 && sc.size < m - 1 ? 'Right shape, wrong distances.'
  : sc.contour === m - 1 ? 'Right shape and distances, wrong height. Slide it.'
  : `${sc.pitch} of ${m} notes in place.`);

export function init() {
  return { phase: 'home', round: 0, prog: 0, stage: 'find', parts: 1, call: [], T: null, land: null, how: '', rows: [], won: false, wonBy: null, say: '' };
}

function startRound(s, rng) {
  const parts = 1 + Math.min(2, Math.floor(s.prog / 3)), { T, land } = twist(rng, parts);
  return { ...s, phase: 'play', round: s.round + 1, stage: 'find', parts, T, land, how: describe(T, land),
    call: makeCall(rng, 4, T, land), rows: [], won: false, wonBy: null,
    say: s.prog ? `A new call. The twist has ${parts} part${parts > 1 ? 's' : ''}.`
      : 'I play a call. My answer is that tune with a secret twist. Play it on the keys, or copy my call and use the tools. Ask Kyle and I play both, then score you.' };
}

export function reduce(s, a, ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  const fromId = (ctx && ctx.from && ctx.from.id) || '';
  if (a.a === 'home') return { ...s, phase: 'home' };
  if (a.a === 'play') return startRound(s, rng);
  if (s.phase !== 'play') return { error: 'Press Play first.' };
  if (a.a === 'next') return s.won ? startRound(s, rng) : { error: 'Finish this round first.' };
  if (s.won) return { error: 'Round finished. Start the next one.' };
  const m = s.call.length;
  if (a.a !== 'guess' || !Array.isArray(a.g) || a.g.length !== m || a.g.some((n) => !Number.isInteger(n) || n < 0 || n >= S))
    return { error: `Kyle wants exactly ${m} notes.` };
  const sc = score(a.g, apply(s.call, s.T, s.land));
  const row = { g: a.g, call: s.call, stage: s.stage, ...sc, text: tell(sc, m) };
  if (sc.pitch < m) return { ...s, rows: [...s.rows, row] };
  if (s.stage === 'find') {            // cracked: Kyle throws a longer call under the same twist, to prove it was not luck
    row.text = `Cracked: ${s.how} Now prove it: ${m + 1} notes, same twist.`;
    return { ...s, rows: [...s.rows, row], stage: 'proof', call: makeCall(rng, m + 1, s.T, s.land) };
  }
  row.text = `Proved it${s.rows.some((r) => r.stage === 'proof') ? '' : ' on the first try'}!`;
  return { ...s, rows: [...s.rows, row], won: true, wonBy: fromId, prog: s.prog + 1 };
}

// The twist stays hidden.
export function project(s) { return { ...s, T: null, how: '' }; }

export function mount(root, api) {
  let view = null, draft = [], seen = 0, revealed = 0, round = 0, callKey = '', ac, timer, anim, animEnd;
  const $ = (q) => root.querySelector(q);
  const talk = (t) => { $('#bubble').textContent = t; };
  const show = (i) => { $('#kyle').textContent = FRAMES[i]; };
  const L = SCALE.labels;

  const note = (hz, t) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + 0.4);
  };
  // Plays melodies back to back, with Kyle playing along; returns how many seconds that takes.
  const play = (...seqs) => {
    ac = ac || new AudioContext();
    let t = ac.currentTime + 0.02;
    const t0 = t;
    seqs.forEach((q, n) => { if (n) t += 0.4; q.forEach((i) => { note(SCALE.hz[i], t); t += 0.35; }); });
    let n = 0;
    clearInterval(anim); clearTimeout(animEnd);
    anim = setInterval(() => show(1 + (n++ % 2)), 175);
    animEnd = setTimeout(() => { clearInterval(anim); show(0); }, (t - t0) * 1000);
    return t - t0;
  };

  // Piano roll (read-only): one row per scale note, high at the top.
  const roll = (u) => [...L.keys()].reverse().map((r) => L[r].padEnd(3) + u.map((x) => (x === r ? '●' : '·')).join('  ')).join('\n');
  const dots = (x, max) => '●'.repeat(x) + '○'.repeat(max - x);
  const chan = (r) => `<b class="red">pitch ${dots(r.pitch, r.g.length)}</b> <b class="orange">shape ${dots(r.contour, r.g.length - 1)}</b> <b class="blue">size ${dots(r.size, r.g.length - 1)}</b>`;

  // Tools mirror what a composer does to a motif; each plays its result. They need a full answer to work on.
  const tool = (t) => {
    const d = draft;
    if (t === 'clear') draft = [];
    else if (t === 'copy') draft = view.call.slice();
    else if (d.length < view.call.length) return talk('Play all the notes first, or copy my call.');
    else {
      const p = t === 'up' ? d.map((x) => x + 1) : t === 'down' ? d.map((x) => x - 1) : t === 'flip' ? d.map((x) => 2 * d[0] - x) : d.slice().reverse();
      if (p.some((x) => x < 0 || x >= S)) return talk('No room: that would leave my range. Slide it first.');
      draft = p;
    }
    if (draft.length) play(draft);
    render();
  };

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:16px 'Times New Roman',serif;padding:10px;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;box-sizing:border-box}
    h1{color:#0ff;font:bold 22px Georgia;text-shadow:3px 3px #f0f}
    td{vertical-align:top}
    pre{font:10px/1.05 'Courier New',monospace;color:#0f0;margin:0}
    #bubble{background:#fff;color:#000;border:3px solid #000;padding:8px;font:bold 15px Arial}
    u{color:#0ff;cursor:pointer;font-family:'Courier New',monospace}
    .rl{font:16px/1.4 'Courier New',monospace;color:#ff0}
    .red{color:#f55}.orange{color:orange}.blue{color:#6af}
    button{font:bold 16px Arial;min-width:44px;min-height:44px;margin:3px}
    #keys button{background:#fff;color:#000;min-width:38px;min-height:90px}
    #callbox,#work{border:2px solid #0f0;padding:6px;margin:6px 0}
    h3{margin:0 0 4px;font:bold 15px Arial;color:#0f0}
  </style>
  <div class="k">
    <marquee>★ welcome to Kyle's Music Page ★ Kyle knows the twist ★</marquee>
    <table width="100%"><tr><td id="bubble">I'm Kyle. I know the twist.</td><td><pre id="kyle">${KYLE}</pre></td></tr></table>
    <h1>Kyle Knows the Code</h1><hr>
    <div id="home"></div>
    <div id="game" hidden>
      <button data-a="home">« Home</button>
      <p id="meta"></p>
      <div id="callbox"></div><div id="work"></div><div id="end"></div>
      <details><summary>Key</summary>
        <p>Every guess: I play my call, then your answer, then score it.
        <b class="red">pitch</b> notes in the right place. <b class="orange">shape</b> steps going the right way, up or down.
        <b class="blue">size</b> steps the right distance. Play the keys like a piano: your last notes are your answer.
        ▲▼ slide it. Flip turns it upside down. Reverse runs it backwards. Copy puts my call in your answer to work on.</p>
      </details>
      <hr><div id="board"></div>
    </div>
  </div>`;

  const render = () => {
    const off = api.isSpectator ? 'disabled' : '';
    const home = view.phase === 'home';
    $('#home').hidden = !home; $('#game').hidden = home;
    if (home) {
      $('#home').innerHTML = `<p>I play a call. You answer with the same tune, changed by a twist I will not name. Find the twist, then prove it.</p>
        <p><button data-a="play" ${off}>Play</button> <small>(${view.prog} proved)</small></p>`;
      return;
    }
    const { call, land, rows, won } = view, busy = revealed < rows.length;
    $('#meta').textContent = `${view.stage === 'proof' ? 'Proof: same twist, new call' : 'Find the twist'} · ${view.parts} part${view.parts > 1 ? 's' : ''} · ${call.length}-note call${land != null ? ` · my answer ends on ${GOAL[land]} (${L[land]})` : ''} · ${view.prog} proved${api.isSpectator ? ' · 👁 watching' : ''}`;
    $('#callbox').innerHTML = `<h3>Kyle's call</h3><pre class="rl">${roll(call)}</pre><button data-p="${call}">▶ Hear the call</button>`;
    $('#work').hidden = busy || won;
    $('#work').innerHTML = `<h3>Your answer: play it</h3><pre class="rl">${roll(Array.from({ length: call.length }, (_, i) => draft[i]))}</pre>
      <div id="keys">${L.map((n, i) => `<button data-k="${i}" ${off}>${n}</button>`).join('')}</div>
      ${['up:▲', 'down:▼', 'flip:Flip', 'rev:Reverse', 'copy:Copy call', 'clear:Clear'].map((t) => `<button data-t="${t.split(':')[0]}" ${off}>${t.split(':')[1]}</button>`).join('')}<br>
      <button data-p="${call}|${draft}">▶ Play both</button> <button data-a="submit" ${off}>Ask Kyle</button>`;
    $('#end').innerHTML = busy ? '<p>♪ Kyle is answering…</p>' : won ? `<p><b>You proved it!</b></p><button data-a="next" ${off}>Next round</button>` : '';
    $('#board').innerHTML = rows.map((r, n) =>
      `<p><tt>${n + 1}.</tt> <u data-p="${r.call}|${r.g}">▶</u> ${r.g.map((i) => L[i]).join('-')} ${n < revealed ? chan(r) : '…'}</p>`).join('');
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-p],[data-t],[data-k],[data-a]');
    if (!t || !view) return;
    ac = ac || new AudioContext();                            // created inside the tap, so the browser allows sound later
    if (ac.state === 'suspended') ac.resume();
    const d = t.dataset;
    if (d.p) return play(...d.p.split('|').map((q) => (q ? q.split(',').map(Number) : [])));   // listening is local, so spectators may do it
    if (api.isSpectator || (view.phase === 'play' && revealed < view.rows.length)) return;
    if (d.t) tool(d.t);
    else if (d.k !== undefined) { draft = [...draft, +d.k].slice(-view.call.length); play([+d.k]); render(); }   // the keys: your last notes are your answer
    else if (d.a === 'submit') {
      if (draft.length < view.call.length) return talk(`Play ${view.call.length} notes first.`);
      api.send({ a: 'guess', g: draft });
    } else api.send({ a: d.a });                              // home, play, next
  });

  return {
    update(v) {
      const first = !view;
      view = v;
      if (first || v.round !== round) { round = v.round; seen = revealed = v.rows.length; if (v.phase === 'play') talk(v.say); }
      if (v.phase === 'play' && v.call.join() !== callKey) { callKey = v.call.join(); draft = []; }
      if (v.rows.length > seen) {            // Kyle plays call then answer first; the scores pop up only afterwards
        const r = v.rows[v.rows.length - 1], n = v.rows.length;
        clearTimeout(timer);
        timer = setTimeout(() => { revealed = n; talk(view.rows[n - 1].text); render(); }, play(r.call, r.g) * 1000);
      }
      seen = v.rows.length;
      render();
    },
    denied(text) { talk(String(text || 'Kyle refused that.')); },
    destroy() { clearTimeout(timer); clearTimeout(animEnd); clearInterval(anim); if (ac) ac.close(); },
  };
}

export function summarize(s, nameOf) {
  if (!s || !s.won || s.phase !== 'play') return null;
  let who = 'Someone';
  try { who = nameOf(s.wonBy) || who; } catch (e) { /* keep the default */ }
  return `${who} proved a ${s.parts}-part twist in ${s.rows.length} ${s.rows.length === 1 ? 'try' : 'tries'}`;
}
