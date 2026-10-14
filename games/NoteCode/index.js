// games/kyle/index.js — Kyle Knows the Code: a musical mastermind game
const NOTES = ['C', 'D', 'E', 'G', 'A', "C'"];          // C major pentatonic, one octave
const HZ = [262, 294, 330, 392, 440, 523];
const WORDS = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const KYLE = `
    _______
   /_______\\
  ( ><   >< )
   (   ,   )
    \\_____/
   __|   |__
  /  |   |  \\
 /___|   |___\\
     |   |
    _|   |_
`;
const pick = (rng, len) => Array.from({ length: len }, () => Math.floor(rng() * 6));
const fresh = (len, rng, wins = 0) => ({ len, wins, code: pick(rng, len), rows: [], won: false });

export const meta = { id: 'kyle', title: 'Kyle Knows the Code', players: '1+', color: '#ff00ff',
  icon: '🎵', desc: 'Crack the five-note melody Kyle is hiding.', soloable: true };

export function init() { return fresh(3, Math.random); }

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

export function reduce(s, a, ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  if (a.a === 'next') return s.won ? fresh(s.len < 10 ? s.len + 1 : 3, rng, s.wins) : { error: 'Finish this round first.' };
  if (s.won) return { error: 'Round already won. Start the next one.' };
  if (a.a !== 'guess' || !Array.isArray(a.g) || a.g.length !== s.len || a.g.some((n) => !(n >= 0 && n < 6)))
    return { error: `Kyle wants exactly ${s.len} notes.` };
  const [red, white] = score(a.g, s.code);
  const won = red === s.len;
  return { ...s, rows: [...s.rows, { g: a.g, red, white, text: say(red, white) }], won, wins: s.wins + (won ? 1 : 0) };
}

export function project(s, pid) { return { ...s, code: s.won ? s.code : null, you: pid }; }

export function mount(root, api) {
  let view = null, sel = [], len = 0, seen = 0, wonSeen = false, ac, bubbleTimer = 0;
  const $ = (q) => root.querySelector(q);
  const tone = (i) => {
    ac = ac || new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = HZ[i];
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.6);
  };
  // Speech bubble: always visible, text fades out after a few seconds.
  const bubble = (text) => {
    const my = ++bubbleTimer;
    $('#bubble').textContent = text;
    $('#bubble').style.visibility = 'visible';
    api.setTimeout(() => { if (my === bubbleTimer) $('#bubble').style.visibility = 'hidden'; }, 5000);
  };
  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:16px 'Times New Roman',serif;padding:12px;min-height:100%}
    h1{color:#0ff;font:bold 34px Georgia;text-shadow:3px 3px #f0f;margin:6px 0}
    #kyle{font:14px/1.1 'Courier New',monospace;color:#0f0;margin:0}
    #bubble{position:relative;background:#fff;color:#000;border:3px solid #000;padding:10px;min-height:60px;min-width:200px;font:bold 16px Arial;visibility:hidden}
    #bubble:before{content:'';position:absolute;left:-18px;top:20px;border:9px solid transparent;border-right:9px solid #000}
    .top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:8px}
    .board{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
    .card{border:2px ridge #0f0;background:#000;padding:6px 8px;white-space:nowrap}
    .r,.w{display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid #000;margin-left:3px}
    .r{background:#f00}.w{background:#fff}
    button{font:bold 16px Arial;min-width:48px;min-height:44px;margin:3px;background:#c0c0c0;border:3px outset #eee;cursor:pointer}
    .slot{display:inline-block;width:52px;height:44px;line-height:44px;border:2px inset #888;background:#fff;color:#000;text-align:center;margin:3px;font:bold 18px Arial}
  </style>
  <div class="k">
    <marquee>★ Welcome to Kyle's Music Page ★ Sign my guestbook ★</marquee>
    <h1>Kyle Knows the Code</h1>
    <p><b>Kyle knows the code.</b></p>
    <div class="top">
      <pre id="kyle">${KYLE}</pre>
      <div id="bubble">I'm Kyle. I know the code.</div>
    </div>
    <p id="meta"></p>
    <div id="slots"></div>
    <div id="pad">${NOTES.map((n, i) => `<button data-i="${i}">${n}</button>`).join('')}</div>
    <div id="ctl"></div>
    <div class="board" id="board"></div>
    <p><span class="r"></span> right note, right spot &nbsp; <span class="w"></span> right note, wrong spot</p>
  </div>`;
  bubble("I'm Kyle. I know the code.");
  const render = () => {
    if (!view) return;
    const off = api.isSpectator ? 'disabled' : '';
    $('#meta').textContent = `Notes in this code: ${view.len} · Rounds cracked: ${view.wins}${api.isSpectator ? ' · 👁 watching' : ''}`;
    $('#slots').innerHTML = Array.from({ length: view.len }, (_, k) =>
      `<span class="slot">${sel[k] !== undefined ? NOTES[sel[k]] : '·'}</span>`).join('');
    $('#pad').querySelectorAll('button').forEach((b) => b.disabled = !!api.isSpectator);
    $('#board').innerHTML = view.rows.map((r, n) => `<div class="card"><b>${n + 1}.</b> ${r.g.map((i) => NOTES[i]).join(' ')}
      <span>${'<i class="r"></i>'.repeat(r.red)}${'<i class="w"></i>'.repeat(r.white)}</span></div>`).join('');
    $('#ctl').innerHTML = view.won
      ? `<p><b>You cracked it!</b> The code was ${view.code.map((i) => NOTES[i]).join(' ')}.</p>
         <button data-a="next" ${off}>Next round (${view.len < 10 ? view.len + 1 : 3} notes)</button>`
      : `<button data-a="clear" ${off}>Clear</button> <button data-a="submit" ${off}>Ask Kyle</button>`;
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !view || api.isSpectator) return;
    if (b.dataset.i !== undefined) { if (sel.length < len) { sel.push(+b.dataset.i); tone(+b.dataset.i); render(); } }
    else if (b.dataset.a === 'clear') { sel = []; render(); }
    else if (b.dataset.a === 'submit' && sel.length === len) { api.send({ a: 'guess', g: sel }); sel = []; }
    else if (b.dataset.a === 'next') api.send({ a: 'next' });
  });
  return {
    update(v) {
      view = v;
      if (v.len !== len) { len = v.len; sel = []; }
      if (v.rows.length < seen) seen = 0;               // new round: board was reset
      if (v.rows.length > seen) bubble(v.rows[v.rows.length - 1].text);
      seen = v.rows.length;
      if (v.won && !wonSeen) bubble('You cracked it! Hit Next round.');
      wonSeen = v.won;
      render();
    },
    destroy() { if (ac) ac.close(); },
  };
}

export function summarize(s, nameOf) { return null; }
