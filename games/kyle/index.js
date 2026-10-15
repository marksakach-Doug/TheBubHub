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

// One scale, eight notes. A melody is a list of positions on it (0 = lowest).
const SCALE = { labels: ['C', 'D', 'E', 'G', 'A', "C'", "D'", "E'"], hz: [262, 294, 330, 392, 440, 523, 587, 659] };
const S = SCALE.labels.length;

// Each level hides one twist that turns Kyle's call into his answer:
//   inv    upside down, mirrored around the call's first note        rev    backwards
//   shift  slide the whole thing by this many scale steps (2 = a third)
//   land   no fixed slide: the answer must END on this position (0 = home), so the slide is whatever gets it there
// `how` is what Kyle says when you crack it; `tip` is what he says when the level starts.
export const LEVELS = [
  { how: 'Same shape, a third higher.', T: { shift: 2 },
    tip: 'I play a call. My answer is that same tune with a secret twist. Use the tools, then Ask Kyle: I play both, then score you.' },
  { how: 'Upside down.', T: { inv: 1 } },
  { how: 'Backwards.', T: { rev: 1 } },
  { how: 'Upside down, then up a third.', T: { inv: 1, shift: 2 } },
  { how: 'Upside down, landing on home.', T: { inv: 1, land: 0 },
    tip: 'New: my answer always ends on home (C). That tells you where the whole answer has to sit.' },
  { how: 'Backwards and upside down, landing on the fifth.', T: { rev: 1, inv: 1, land: 3 },
    tip: 'Now my answer ends on the fifth (G).' },
];

export const meta = { id: 'kyle', title: 'Kyle Knows the Code', players: '1+', color: '#ff00ff',
  icon: '🎵', desc: "Answer Kyle's call with his secret twist.", soloable: true };

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
  return { phase: 'home', round: 0, prog: 0, stage: 'find', call: [], T: null, land: null, rows: [], won: false, wonBy: null, say: '' };
}

function startLevel(s, lvl, rng) {
  const { land, ...T } = LEVELS[lvl].T;
  return { ...s, phase: 'play', round: s.round + 1, lvl, stage: 'find', T, land: land == null ? null : land,
    call: makeCall(rng, 4, T, land), rows: [], won: false, wonBy: null, say: LEVELS[lvl].tip || 'A new call. Find the twist.' };
}

export function reduce(s, a, ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  const fromId = (ctx && ctx.from && ctx.from.id) || '';
  if (a.a === 'home') return { ...s, phase: 'home' };
  if (a.a === 'play') return startLevel(s, s.prog % LEVELS.length, rng);
  if (s.phase !== 'play') return { error: 'Press Play first.' };
  if (a.a === 'next') return s.won ? startLevel(s, (s.lvl + 1) % LEVELS.length, rng) : { error: 'Finish this round first.' };
  if (s.won) return { error: 'Round finished. Start the next one.' };
  const m = s.call.length;
  if (a.a !== 'guess' || !Array.isArray(a.g) || a.g.length !== m || a.g.some((n) => !Number.isInteger(n) || n < 0 || n >= S))
    return { error: `Kyle wants exactly ${m} notes.` };
  const sc = score(a.g, apply(s.call, s.T, s.land));
  const row = { g: a.g, call: s.call, stage: s.stage, ...sc, text: tell(sc, m) };
  if (sc.pitch < m) return { ...s, rows: [...s.rows, row] };
  if (s.stage === 'find') {            // cracked: Kyle throws a longer call under the same twist, to prove it was not luck
    row.text = `Cracked: ${LEVELS[s.lvl].how} Now prove it: ${m + 1} notes, same twist.`;
    return { ...s, rows: [...s.rows, row], stage: 'proof', call: makeCall(rng, m + 1, s.T, s.land) };
  }
  row.text = `Proved it${s.rows.some((r) => r.stage === 'proof') ? '' : ' on the first try'}!`;
  return { ...s, rows: [...s.rows, row], won: true, wonBy: fromId, prog: Math.max(s.prog, s.lvl + 1) };
}

// The twist stays hidden.
export function project(s) { return { ...s, T: null }; }

export function mount(root, api) {
  let view = null, draft = [], seen = 0, revealed = 0, round = 0, callKey = '', ac, timer;
  const $ = (q) => root.querySelector(q);
  const talk = (t) => { $('#bubble').textContent = t; };
  const L = SCALE.labels;

  const note = (hz, t) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + 0.4);
  };
  // Plays melodies back to back; returns how many seconds that takes.
  const play = (...seqs) => {
    ac = ac || new AudioContext();
    let t = ac.currentTime + 0.02;
    const t0 = t;
    seqs.forEach((q, n) => { if (n) t += 0.4; q.forEach((i) => { note(SCALE.hz[i], t); t += 0.35; }); });
    return t - t0;
  };

  // Piano roll: one row per scale note, high at the top. Cells are tappable when editing.
  const roll = (u, edit) => [...L.keys()].reverse().map((r) => L[r].padEnd(3) +
    u.map((x, c) => `<u ${edit ? `data-c="${c}" data-r="${r}"` : ''}>${x === r ? '●' : '·'}</u>`).join('')).join('\n');
  const dots = (x, max) => '●'.repeat(x) + '○'.repeat(max - x);
  const chan = (r) => `<b class="red">pitch ${dots(r.pitch, r.g.length)}</b> <b class="orange">shape ${dots(r.contour, r.g.length - 1)}</b> <b class="blue">size ${dots(r.size, r.g.length - 1)}</b>`;

  // The tools mirror what a composer does to a motif. Each one plays its result.
  const tool = (t) => {
    const d = draft;
    const p = t === 'up' ? d.map((x) => x + 1) : t === 'down' ? d.map((x) => x - 1) : t === 'flip' ? d.map((x) => 2 * d[0] - x)
      : t === 'rev' ? d.slice().reverse() : view.call.slice();
    if (p.some((x) => x < 0 || x >= L.length)) return talk('No room: that would leave my range. Slide it first.');
    draft = p; play(p); render();
  };

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:16px 'Times New Roman',serif;padding:10px;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;box-sizing:border-box}
    h1{color:#0ff;font:bold 22px Georgia;text-shadow:3px 3px #f0f}
    td{vertical-align:top}
    pre{font:10px/1.05 'Courier New',monospace;color:#0f0;margin:0}
    #bubble{background:#fff;color:#000;border:3px solid #000;padding:8px;font:bold 15px Arial}
    u{color:#0ff;cursor:pointer;font-family:'Courier New',monospace}
    .rl{font:16px/1.4 'Courier New',monospace;color:#ff0}
    .rl u{display:inline-block;width:34px;text-align:center;text-decoration:none}
    .red{color:#f55}.orange{color:orange}.blue{color:#6af}
    button{font:bold 16px Arial;min-width:44px;min-height:44px;margin:3px}
    #callbox,#work{border:2px solid #0f0;padding:6px;margin:6px 0}
    h3{margin:0 0 4px;font:bold 15px Arial;color:#0f0}
  </style>
  <div class="k">
    <marquee>★ welcome to Kyle's Music Page ★ Kyle knows the twist ★</marquee>
    <table width="100%"><tr><td id="bubble">I'm Kyle. I know the twist.</td><td><pre>${KYLE}</pre></td></tr></table>
    <h1>Kyle Knows the Code</h1><hr>
    <div id="home"></div>
    <div id="game" hidden>
      <button data-a="home">« Home</button>
      <p id="meta"></p>
      <div id="callbox"></div><div id="work"></div><div id="end"></div>
      <details><summary>Key</summary>
        <p>Every guess: I play my call, then your answer, then score it.
        <b class="red">pitch</b> notes in the right place. <b class="orange">shape</b> steps going the right way, up or down.
        <b class="blue">size</b> steps the right distance. Tap a dot on the roll to move a note.
        ▲▼ slide the whole answer. Flip turns it upside down. Reverse runs it backwards.</p>
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
        <p><button data-a="play" ${off}>${view.prog ? 'Continue' : 'Play'}</button> <small>(${Math.min(view.prog, LEVELS.length)}/${LEVELS.length} cleared)</small></p>`;
      return;
    }
    const { call, land, rows, won } = view, busy = revealed < rows.length;
    $('#meta').textContent = `Level ${view.lvl + 1} of ${LEVELS.length} · ${view.stage === 'proof' ? 'proof: same twist, new call' : 'find the twist'} · ${call.length}-note call${land != null ? ` · my answer ends on ${L[land]}` : ''}${api.isSpectator ? ' · 👁 watching' : ''}`;
    $('#callbox').innerHTML = `<h3>Kyle's call</h3><pre class="rl">${roll(call)}</pre><button data-p="${call}">▶ Hear the call</button>`;
    $('#work').hidden = busy || won;
    $('#work').innerHTML = `<h3>Your answer</h3><pre class="rl">${roll(draft, true)}</pre>
      ${['up:▲', 'down:▼', 'flip:Flip', 'rev:Reverse', 'reset:Reset'].map((t) => `<button data-t="${t.split(':')[0]}" ${off}>${t.split(':')[1]}</button>`).join('')}<br>
      <button data-p="${call}|${draft}">▶ Play both</button> <button data-a="submit" ${off}>Ask Kyle</button>`;
    $('#end').innerHTML = busy ? '<p>♪ Kyle is answering…</p>' : won ? `<p><b>You proved it!</b></p><button data-a="next" ${off}>Next level</button>` : '';
    $('#board').innerHTML = rows.map((r, n) =>
      `<p><tt>${n + 1}.</tt> <u data-p="${r.call}|${r.g}">▶</u> ${r.g.map((i) => L[i]).join('-')} ${n < revealed ? chan(r) : '…'}</p>`).join('');
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-p],[data-t],[data-c],[data-a]');
    if (!t || !view) return;
    ac = ac || new AudioContext();                            // created inside the tap, so the browser allows sound later
    if (ac.state === 'suspended') ac.resume();
    const d = t.dataset;
    if (d.p) return play(...d.p.split('|').map((q) => q.split(',').map(Number)));   // listening is local, so spectators may do it
    if (api.isSpectator || revealed < view.rows.length) return;
    if (d.t) tool(d.t);
    else if (d.c !== undefined) { draft[+d.c] = +d.r; play([+d.r]); render(); }
    else api.send(d.a === 'submit' ? { a: 'guess', g: draft } : { a: d.a });          // submit, home, play, next
  });

  return {
    update(v) {
      const first = !view;
      view = v;
      if (first || v.round !== round) { round = v.round; seen = revealed = v.rows.length; if (v.phase === 'play') talk(v.say); }
      if (v.phase === 'play' && v.call.join() !== callKey) { callKey = v.call.join(); draft = v.call.slice(); }
      if (v.rows.length > seen) {            // Kyle plays call then answer first; the scores pop up only afterwards
        const r = v.rows[v.rows.length - 1], n = v.rows.length;
        clearTimeout(timer);
        timer = setTimeout(() => { revealed = n; talk(view.rows[n - 1].text); render(); }, play(r.call, r.g) * 1000);
      }
      seen = v.rows.length;
      render();
    },
    denied(text) { talk(String(text || 'Kyle refused that.')); },
    destroy() { clearTimeout(timer); if (ac) ac.close(); },
  };
}

export function summarize(s, nameOf) {
  if (!s || !s.won || s.phase !== 'play') return null;
  let who = 'Someone';
  try { who = nameOf(s.wonBy) || who; } catch (e) { /* keep the default */ }
  return `${who} proved level ${s.lvl + 1} in ${s.rows.length} ${s.rows.length === 1 ? 'try' : 'tries'}`;
}
