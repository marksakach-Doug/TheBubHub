// games/kyle/index.js: Kyle Vibe Prompt & Rhythm Game Maker (No Call & Response)
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
const SCALE = { labels: ['C', 'D', 'E', 'G', 'A', "C'", "D'", "E'"], hz: [262, 294, 330, 392, 440, 523, 587, 659] };
const S = SCALE.labels.length;
const STORAGE_KEY = 'kyle_vibe_prompts_txt_v2';
const DUR_SYM = { q: '●', e: '♪', t: '▴' };
const DUR_LBL = { q: '♩1', e: '♫8', t: '3t' };

export const meta = {
  id: 'kyle',
  title: 'Kyle Vibe Prompt Maker',
  players: '1+',
  color: '#ff00ff',
  icon: '🎵',
  desc: 'Compose with tempo, swing, eighths & triplets, and record vibe prompts to .txt.',
  soloable: true
};

export function init() {
  return { phase: 'maker' };
}

export function reduce(s) {
  return s;
}

export function project(s) {
  return { ...s };
}

export function mount(root) {
  let winLen = 8, bpm = 120, swing = 50, curDur = 'q', formatMode = 'plain', promptText = '';
  let savedLines = [];
  let draft = [
    { p: 0, d: 'q' }, { p: 2, d: 'e' }, { p: 3, d: 'e' }, { p: 4, d: 'q' },
    { p: 3, d: 't' }, { p: 2, d: 't' }, { p: 0, d: 't' }, { p: 0, d: 'q' }
  ];
  let ac, anim, animEnd;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) savedLines = raw.split('\n').filter((x) => x.trim().length > 0);
  } catch (e) {}

  const $ = (q) => root.querySelector(q);
  const L = SCALE.labels;
  const save = () => { try { localStorage.setItem(STORAGE_KEY, savedLines.join('\n')); } catch (e) {} };
  const show = (i) => { const k = $('#kyle'); if (k) k.textContent = FRAMES[i]; };
  const updateBubble = () => {
    const b = $('#bubble');
    if (b) b.textContent = promptText.trim() ? `"${promptText.trim()}"` : `Type a Vibe Prompt below! Compose a ${winLen}-slot tune with Tempo, Swing, Eighths & Triplets.`;
  };

  const play = (seq = draft) => {
    if (!seq.length) return 0;
    const beatSec = 60 / bpm, swingRatio = swing / 100;
    let totalSec = 0.25;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        ac = ac || new Ctx();
        if (ac.state === 'suspended') ac.resume();
        let t = ac.currentTime + 0.02, t0 = t, eParity = 0;
        seq.forEach((it) => {
          let beats = 1;
          if (it.d === 'e') { beats = eParity % 2 === 0 ? swingRatio : 1 - swingRatio; eParity++; }
          else if (it.d === 't') { beats = 1 / 3; eParity = 0; }
          else { beats = 1; eParity = 0; }
          const stepSec = beats * beatSec;
          if (it.p >= 0 && SCALE.hz[it.p]) {
            const o = ac.createOscillator(), g = ac.createGain();
            o.frequency.value = SCALE.hz[it.p];
            g.gain.setValueAtTime(0.45, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + stepSec * 0.92);
            o.connect(g).connect(ac.destination);
            o.start(t); o.stop(t + stepSec * 0.95);
          }
          t += stepSec;
        });
        totalSec = Math.max(0.25, t - t0);
      }
    } catch (e) {}
    let n = 0;
    clearInterval(anim); clearTimeout(animEnd);
    anim = setInterval(() => show(1 + (n++ % 2)), 160);
    animEnd = setTimeout(() => { clearInterval(anim); show(0); }, totalSec * 1000);
    return totalSec;
  };

  const roll = (u, len) =>
    [...L.keys()].reverse().map((r) =>
      L[r].padEnd(3) + Array.from({ length: len }, (_, i) => {
        const it = u[i];
        if (!it) return '·';
        if (it.p === r) return DUR_SYM[it.d] || '●';
        if (it.p === -1 && r === 3) return '-';
        return '·';
      }).join('  ')
    ).join('\n');

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:15px 'Times New Roman',serif;padding:10px;height:100%;overflow-y:auto;box-sizing:border-box}
    h1{color:#0ff;font:bold 22px Georgia;text-shadow:2px 2px #f0f;margin:4px 0}
    h3{margin:0 0 6px;font:bold 14px Arial;color:#0f0}
    td{vertical-align:top} pre{font:10px/1.05 'Courier New',monospace;color:#0f0;margin:0}
    #bubble{background:#fff;color:#000;border:3px solid #000;padding:10px;font:bold 16px Arial;min-height:42px}
    .rl{font:15px/1.35 'Courier New',monospace;color:#ff0;background:#000044;padding:8px;border:1px dashed #0ff;overflow-x:auto}
    button{font:bold 13px Arial;min-height:34px;margin:2px;padding:4px 8px;cursor:pointer;background:#ddd;color:#000;border:2px outset #fff}
    button.on{background:#0ff;color:#000;border:2px solid #fff}
    button.go{background:#0f0;color:#000}
    button.rhy-cell{min-width:34px;min-height:28px;padding:2px 4px;margin:1px;font:bold 12px monospace;background:#002266;color:#0ff;border:1px solid #0ff}
    #keys button{background:#fff;color:#000;min-width:42px;min-height:74px;font-size:15px}
    .box{border:2px solid #0f0;padding:8px;margin:8px 0;background:#000055}
    .maker-box{border:2px solid #0ff;padding:8px;margin:8px 0;background:#001144}
    .srow{display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap;font:13px Arial}
    input[type="range"]{flex:1;min-width:130px;accent-color:#0ff}
    input[type="text"],textarea{width:100%;box-sizing:border-box;font:bold 14px monospace;padding:8px;background:#000033;color:#0f0;border:2px solid #0ff}
  </style>
  <div class="k">
    <marquee>★ KYLE'S VIBE PROMPT STUDIO ★ Tempo + Swing + Eighths & Triplets ★</marquee>
    <table width="100%"><tr><td id="bubble"></td><td width="130"><pre id="kyle">${KYLE}</pre></td></tr></table>
    <h1>Kyle Vibe Prompt Game Maker</h1>
    <div class="maker-box">
      <h3>1. Window Length, Tempo & Swing</h3>
      <div id="winRow" style="margin-bottom:6px"></div>
      <div class="srow">
        <b style="min-width:155px" id="bpmLbl">Tempo: 120 BPM</b>
        <input id="bpmS" type="range" min="60" max="220" step="2" value="120">
        <button data-bpm="85">Slow</button><button data-bpm="120">Med</button><button data-bpm="165">Fast</button>
      </div>
      <div class="srow">
        <b style="min-width:155px" id="swLbl">Swing: 50% (Straight)</b>
        <input id="swS" type="range" min="50" max="75" step="1" value="50">
        <button data-sw="50">Straight</button><button data-sw="62">Swing</button><button data-sw="67">Shuffle</button>
      </div>
    </div>
    <div class="box" id="pianoBox"></div>
    <div class="maker-box">
      <h3>2. Record Vibe Prompts to .txt</h3>
      <div id="fmtRow" style="margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <input id="pInp" type="text" placeholder="Type a vibe prompt and press Enter...">
        <button class="go" data-act="append">+ Append</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        <small id="lCnt" style="color:#0ff;font-family:monospace"></small>
        <div>
          <button data-act="copytxt">Copy All</button>
          <button class="go" data-act="download">⬇ Download .txt</button>
          <button data-act="cleartxt" style="background:#922;color:#fff">Clear</button>
        </div>
      </div>
      <textarea id="txtOut" rows="7"></textarea>
    </div>
  </div>`;

  const renderPiano = () => {
    $('#winRow').innerHTML = `<b>Window Slots: </b>` + [4, 6, 8, 10, 12, 16].map((n) => `<button class="${winLen === n ? 'on' : ''}" data-wlen="${n}">${n}</button>`).join('');
    $('#fmtRow').innerHTML = `<b>.txt Format: </b><button class="${formatMode === 'plain' ? 'on' : ''}" data-fmt="plain">Plain Text</button><button class="${formatMode === 'meta' ? 'on' : ''}" data-fmt="meta">With [${winLen} slots | ${bpm} BPM | ${swing}% swing]</button>`;
    const rhyRow = Array.from({ length: winLen }, (_, i) =>
      draft[i] ? `<button class="rhy-cell" data-tog="${i}">${DUR_LBL[draft[i].d]}</button>` : `<button class="rhy-cell" disabled style="opacity:.3">--</button>`
    ).join('');
    $('#pianoBox').innerHTML = `
      <h3>Your Melody (${draft.length}/${winLen} slots)</h3>
      <pre class="rl">${roll(draft, winLen)}</pre>
      <div style="margin:4px 0 8px;font:12px monospace;color:#0ff">Tap to change note rhythm (♩1 / ♫8 / 3t):<br>${rhyRow}</div>
      <div style="margin-bottom:6px">
        <b>Key Speed: </b>
        <button class="${curDur === 'q' ? 'on' : ''}" data-dur="q">♩ Quarter (●)</button>
        <button class="${curDur === 'e' ? 'on' : ''}" data-dur="e">♫ Eighth (♪)</button>
        <button class="${curDur === 't' ? 'on' : ''}" data-dur="t">🎶 Triplet (▴)</button>
        <button data-key="-1" style="background:#557;color:#fff">+ Rest (-)</button>
      </div>
      <div id="keys">${L.map((n, i) => `<button data-key="${i}">${n}</button>`).join('')}</div>
      <div style="margin-top:6px">
        <b>Grooves: </b>
        <button data-grv="all_q">All ♩</button><button data-grv="all_e">All ♫</button><button data-grv="all_t">All 3</button>
        <button data-grv="bounce">Bounce (♩ ♫♫)</button><button data-grv="gallop">Gallop (♩ 333)</button>
      </div>
      <div style="margin-top:6px">
        <b>Pitch: </b>
        <button data-tl="up">▲</button><button data-tl="down">▼</button><button data-tl="flip">Flip</button><button data-tl="rev">Reverse</button>
        <button data-tl="rand" style="background:#ff0">🎲 Random</button><button data-tl="back">⌫</button><button data-tl="clear">Clear</button>
        <button class="go" data-act="play">▶ Play Tune</button>
      </div>`;
    updateBubble();
  };

  const renderTxt = () => {
    $('#txtOut').value = savedLines.join('\n');
    $('#lCnt').textContent = `${savedLines.length} prompts recorded`;
  };

  const append = () => {
    const val = $('#pInp').value.trim();
    if (!val) return;
    savedLines.push(formatMode === 'meta' ? `[${winLen} slots | ${bpm} BPM | ${swing}% swing] ${val}` : val);
    save();
    promptText = ''; $('#pInp').value = '';
    renderTxt(); updateBubble();
  };

  $('#bpmS').addEventListener('input', (e) => { bpm = +e.target.value; $('#bpmLbl').textContent = `Tempo: ${bpm} BPM`; renderPiano(); });
  $('#bpmS').addEventListener('change', () => play());
  $('#swS').addEventListener('input', (e) => { swing = +e.target.value; $('#swLbl').textContent = `Swing: ${swing}%`; renderPiano(); });
  $('#swS').addEventListener('change', () => play());
  $('#pInp').addEventListener('input', (e) => { promptText = e.target.value; updateBubble(); });
  $('#pInp').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); append(); } });
  $('#txtOut').addEventListener('input', (e) => { savedLines = e.target.value.split('\n').filter((x) => x.trim()); save(); $('#lCnt').textContent = `${savedLines.length} prompts recorded`; });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.wlen) { winLen = +d.wlen; draft = draft.slice(0, winLen); renderPiano(); }
    else if (d.bpm) { bpm = +d.bpm; $('#bpmS').value = bpm; $('#bpmLbl').textContent = `Tempo: ${bpm} BPM`; play(); renderPiano(); }
    else if (d.sw) { swing = +d.sw; $('#swS').value = swing; $('#swLbl').textContent = `Swing: ${swing}%`; play(); renderPiano(); }
    else if (d.dur) { curDur = d.dur; renderPiano(); }
    else if (d.tog !== undefined) {
      const i = +d.tog, ord = ['q', 'e', 't'];
      if (draft[i]) { draft[i].d = ord[(ord.indexOf(draft[i].d) + 1) % 3]; play(); renderPiano(); }
    } else if (d.key !== undefined) {
      const it = { p: +d.key, d: curDur };
      draft = [...draft, it].slice(-winLen);
      play([it]); renderPiano();
    } else if (d.grv) {
      draft.forEach((it, i) => {
        it.d = d.grv === 'all_q' ? 'q' : d.grv === 'all_e' ? 'e' : d.grv === 'all_t' ? 't' : d.grv === 'bounce' ? (i % 3 === 0 ? 'q' : 'e') : (i % 4 === 0 ? 'q' : 't');
      });
      play(); renderPiano();
    } else if (d.tl) {
      if (d.tl === 'clear') draft = [];
      else if (d.tl === 'back') draft = draft.slice(0, -1);
      else if (d.tl === 'rev') draft = draft.slice().reverse();
      else if (d.tl === 'rand') {
        const dp = ['q', 'q', 'e', 'e', 't'];
        let c = Math.floor(Math.random() * S);
        draft = Array.from({ length: winLen }, () => {
          c = Math.max(0, Math.min(S - 1, c + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
          return { p: c, d: dp[Math.floor(Math.random() * dp.length)] };
        });
      } else if (draft.length) {
        const fp = (draft.find((x) => x.p >= 0) || { p: 0 }).p;
        const nx = draft.map((it) => ({ p: it.p < 0 ? -1 : d.tl === 'up' ? it.p + 1 : d.tl === 'down' ? it.p - 1 : 2 * fp - it.p, d: it.d }));
        if (!nx.some((it) => it.p !== -1 && (it.p < 0 || it.p >= S))) draft = nx;
      }
      if (draft.length) play();
      renderPiano();
    } else if (d.fmt) { formatMode = d.fmt; renderPiano(); }
    else if (d.act === 'play') play();
    else if (d.act === 'append') append();
    else if (d.act === 'copytxt') { if (navigator.clipboard) navigator.clipboard.writeText($('#txtOut').value); }
    else if (d.act === 'cleartxt') { savedLines = []; save(); renderTxt(); }
    else if (d.act === 'download') {
      const blob = new Blob([$('#txtOut').value + '\n'], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'vibe_prompts.txt'; a.click();
    }
  });

  renderPiano(); renderTxt();
  return { update() {}, denied() {}, destroy() { clearInterval(anim); clearTimeout(animEnd); if (ac) ac.close(); } };
}

export function summarize() { return null; }