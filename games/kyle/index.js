// games/kyle/index.js: Kyle Vibe Prompt Game Maker & Window Length Tester
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

// Eight-note pentatonic scale (0 = lowest)
const SCALE = { labels: ['C', 'D', 'E', 'G', 'A', "C'", "D'", "E'"], hz: [262, 294, 330, 392, 440, 523, 587, 659] };
const S = SCALE.labels.length;

export const meta = {
  id: 'kyle',
  title: 'Kyle Vibe Prompt Maker',
  players: '1+',
  color: '#ff00ff',
  icon: '🎵',
  desc: 'Test call/response window lengths and record vibe prompts to a .txt file.',
  soloable: true
};

const STORAGE_KEY = 'kyle_vibe_prompts_txt_v1';

// Generate a pleasant random call of any window length
function randomCall(len, rng = Math.random) {
  const c = [Math.floor(rng() * S)];
  while (c.length < len) {
    const step = (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 3));
    const next = Math.max(0, Math.min(S - 1, c[c.length - 1] + step));
    c.push(next);
  }
  return c;
}

export function init() {
  return {
    phase: 'maker',
    callLen: 4,
    respLen: 4,
    call: [0, 2, 3, 2],
    say: "Type a vibe prompt below and test how different call & response window lengths feel!"
  };
}

export function reduce(s, a, ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  if (a.a === 'setCallLen') {
    const callLen = Number(a.len) || 4;
    return { ...s, callLen, call: randomCall(callLen, rng) };
  }
  if (a.a === 'setRespLen') {
    return { ...s, respLen: Number(a.len) || 4 };
  }
  if (a.a === 'newCall') {
    return { ...s, call: randomCall(s.callLen, rng) };
  }
  if (a.a === 'setCall' && Array.isArray(a.call)) {
    return { ...s, call: a.call, callLen: a.call.length };
  }
  return s;
}

export function project(s) {
  return { ...s };
}

export function mount(root, api) {
  let view = init();
  let call = [0, 2, 3, 2];
  let callLen = 4;
  let respLen = 4;
  let stepMs = 320; // Tempo: 450 (Slow), 320 (Normal), 200 (Fast)
  let editTarget = 'resp'; // 'resp' | 'call'
  let draft = [];
  let promptText = '';
  let formatMode = 'plain'; // 'plain' | 'window' | 'full'
  let savedLines = [];
  let ac, anim, animEnd;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) savedLines = raw.split('\n').filter((x) => x.trim().length > 0);
  } catch (e) { /* ignore storage errors */ }

  const $ = (q) => root.querySelector(q);
  const L = SCALE.labels;

  const saveToStorage = () => {
    try {
      localStorage.setItem(STORAGE_KEY, savedLines.join('\n'));
    } catch (e) { /* ignore */ }
  };

  const showFrame = (i) => {
    const k = $('#kyle');
    if (k) k.textContent = FRAMES[i];
  };

  const updateBubble = () => {
    const b = $('#bubble');
    if (!b) return;
    b.textContent = promptText.trim()
      ? `"${promptText.trim()}"`
      : `Testing [${callLen}-note Call -> ${respLen}-note Response]. Type a vibe prompt below!`;
  };

  const play = (...seqs) => {
    let totalSec = 0.4;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        ac = ac || new Ctx();
        if (ac.state === 'suspended') ac.resume();
        const stepSec = stepMs / 1000;
        let t = ac.currentTime + 0.02;
        const t0 = t;
        seqs.forEach((q, n) => {
          if (n) t += stepSec * 1.15;
          q.forEach((i) => {
            if (i != null && SCALE.hz[i]) {
              const o = ac.createOscillator(), g = ac.createGain();
              o.frequency.value = SCALE.hz[i];
              g.gain.setValueAtTime(0.45, t);
              g.gain.exponentialRampToValueAtTime(0.001, t + stepSec * 1.1);
              o.connect(g).connect(ac.destination);
              o.start(t);
              o.stop(t + stepSec * 1.1);
            }
            t += stepSec;
          });
        });
        totalSec = Math.max(0.25, t - t0);
      }
    } catch (e) {
      totalSec = 0.4;
    }
    let n = 0;
    clearInterval(anim);
    clearTimeout(animEnd);
    anim = setInterval(() => showFrame(1 + (n++ % 2)), 175);
    animEnd = setTimeout(() => { clearInterval(anim); showFrame(0); }, totalSec * 1000);
    return totalSec;
  };

  // Piano roll for any window length
  const roll = (u, len) =>
    [...L.keys()]
      .reverse()
      .map((r) => L[r].padEnd(3) + Array.from({ length: len }, (_, i) => (u[i] === r ? '●' : '·')).join('  '))
      .join('\n');

  const runTool = (t) => {
    const target = editTarget === 'call' ? call : draft;
    const maxLen = editTarget === 'call' ? callLen : respLen;

    if (t === 'clear') {
      if (editTarget === 'call') call = [];
      else draft = [];
    } else if (t === ' backspace') {
      if (editTarget === 'call') call = call.slice(0, -1);
      else draft = draft.slice(0, -1);
    } else if (t === 'copy') {
      if (!call.length) return;
      // Append call into draft up to respLen (clicking twice fills an 8-note window with two 4-note calls)
      if (draft.length === 0 || draft.length >= respLen) {
        draft = call.slice(0, respLen);
      } else {
        draft = [...draft, ...call].slice(0, respLen);
      }
      play(draft);
      renderRolls();
      return;
    } else if (target.length === 0) {
      return;
    } else {
      const p =
        t === 'up'
          ? target.map((x) => x + 1)
          : t === 'down'
          ? target.map((x) => x - 1)
          : t === 'flip'
          ? target.map((x) => 2 * target[0] - x)
          : target.slice().reverse();
      if (p.some((x) => x < 0 || x >= S)) {
        const b = $('#bubble');
        if (b) b.textContent = 'No room: that would leave the 8-note scale range. Slide ▲/▼ first!';
        return;
      }
      if (editTarget === 'call') call = p.slice(0, maxLen);
      else draft = p.slice(0, maxLen);
    }
    const after = editTarget === 'call' ? call : draft;
    if (after.length) play(after);
    renderRolls();
  };

  const formatLine = (rawPrompt) => {
    const clean = rawPrompt.trim();
    if (!clean) return '';
    if (formatMode === 'window') {
      return `[${callLen}->${respLen}] ${clean}`;
    }
    if (formatMode === 'full') {
      const cNotes = call.map((i) => L[i]).join('-');
      const rNotes = draft.length ? ` | resp:${draft.map((i) => L[i]).join('-')}` : '';
      return `[${callLen}->${respLen} | call:${cNotes}${rNotes}] ${clean}`;
    }
    return clean;
  };

  const appendPrompt = () => {
    const input = $('#promptInput');
    const val = (input ? input.value : promptText).trim();
    if (!val) return;
    const line = formatLine(val);
    savedLines.push(line);
    saveToStorage();
    promptText = '';
    if (input) input.value = '';
    renderTxtArea();
    updateBubble();
  };

  const downloadTxt = () => {
    const area = $('#txtOutput');
    const content = area ? area.value : savedLines.join('\n');
    const blob = new Blob([content + (content.endsWith('\n') ? '' : '\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vibe_prompts.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:15px 'Times New Roman',serif;padding:12px;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box}
    h1{color:#0ff;font:bold 22px Georgia;text-shadow:2px 2px #f0f;margin:4px 0}
    h3{margin:0 0 6px;font:bold 14px Arial;color:#0f0}
    td{vertical-align:top}
    pre{font:10px/1.05 'Courier New',monospace;color:#0f0;margin:0}
    #bubble{background:#fff;color:#000;border:3px solid #000;padding:10px;font:bold 16px Arial;min-height:42px}
    .rl{font:15px/1.35 'Courier New',monospace;color:#ff0;background:#000044;padding:8px;border:1px dashed #0ff;overflow-x:auto}
    button{font:bold 13px Arial;min-height:36px;margin:2px;padding:4px 10px;cursor:pointer;background:#ddd;color:#000;border:2px outset #fff}
    button.on{background:#0ff;color:#000;border:2px solid #fff}
    button.go{background:#0f0;color:#000;font-size:14px}
    #keys button{background:#fff;color:#000;min-width:40px;min-height:74px;font-size:15px}
    .box{border:2px solid #0f0;padding:8px;margin:8px 0;background:#000055}
    .maker-box{border:2px solid #0ff;padding:8px;margin:8px 0;background:#001144}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    @media(max-width:650px){.grid2{grid-template-columns:1fr}}
    input[type="text"],textarea{width:100%;box-sizing:border-box;font:bold 14px 'Courier New',monospace;padding:8px;background:#000033;color:#0f0;border:2px solid #0ff}
  </style>
  <div class="k">
    <marquee>★ KYLE'S VIBE PROMPT GAME MAKER ★ Test Window Lengths & Record Prompts to .txt ★</marquee>
    <table width="100%"><tr><td id="bubble"></td><td width="130"><pre id="kyle">${KYLE}</pre></td></tr></table>
    <h1>Kyle Vibe Prompt Studio</h1>

    <!-- 1. WINDOW LENGTH & TEMPO CONTROLS -->
    <div class="maker-box">
      <h3>1. Window Lengths & Tempo</h3>
      <div id="winControls"></div>
    </div>

    <!-- 2. CALL & RESPONSE SANDBOX -->
    <div class="grid2">
      <div class="box" id="callBox"></div>
      <div class="box" id="respBox"></div>
    </div>

    <!-- 3. KEYBOARD & COMPOSER TOOLS -->
    <div class="box">
      <div id="targetToggle" style="margin-bottom:6px"></div>
      <div id="keys">${L.map((n, i) => `<button data-k="${i}">${n}</button>`).join('')}</div>
      <div style="margin-top:6px">
        ${[
          'copy:Copy Call → Resp',
          'up:▲ Slide Up',
          'down:▼ Slide Down',
          'flip:Flip (Invert)',
          'rev:Reverse',
          ' backspace:⌫ Undo Note',
          'clear:Clear'
        ]
          .map((t) => `<button data-t="${t.split(':')[0]}">${t.split(':')[1]}</button>`)
          .join('')}
      </div>
      <div style="margin-top:6px">
        <button class="go" data-play="both">▶ Play Call + Response Together</button>
        <button data-play="call">▶ Hear Call Only</button>
        <button data-play="resp">▶ Hear Response Only</button>
      </div>
    </div>

    <!-- 4. VIBE PROMPT RECORDER (.TXT) -->
    <div class="maker-box">
      <h3>2. Record Vibe Prompts to .txt</h3>
      <div style="margin-bottom:6px" id="fmtControls"></div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <input id="promptInput" type="text" placeholder="Type a vibe prompt (e.g. 'Answer me like you're trying not to get caught') and hit Enter..." />
        <button class="go" data-act="append" style="white-space:nowrap">+ Append (Enter)</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        <small id="lineCount" style="color:#0ff;font-family:monospace">0 prompts recorded</small>
        <div>
          <label style="cursor:pointer;background:#ddd;color:#000;padding:4px 8px;font:bold 12px Arial;border:2px outset #fff;margin-right:4px">
            📂 Load/Append Existing .txt <input id="fileLoader" type="file" accept=".txt" style="display:none">
          </label>
          <button data-act="copytxt">📋 Copy All</button>
          <button class="go" data-act="download">⬇ Download vibe_prompts.txt</button>
          <button data-act="cleartxt" style="background:#922;color:#fff">Clear List</button>
        </div>
      </div>
      <textarea id="txtOutput" rows="8" placeholder="Appended vibe prompts will appear here... You can also edit this text directly before downloading."></textarea>
    </div>
  </div>`;

  const renderControls = () => {
    $('#winControls').innerHTML = `
      <div style="margin-bottom:4px">
        <b>Kyle's Call Window:</b>
        ${[2, 3, 4, 5, 6, 8]
          .map((n) => `<button class="${callLen === n ? 'on' : ''}" data-clen="${n}">${n} notes</button>`)
          .join('')}
        <button data-act="randCall" style="background:#ff0;color:#000">🎲 New Random Call</button>
      </div>
      <div style="margin-bottom:4px">
        <b>Player Response Window:</b>
        ${[2, 3, 4, 5, 6, 8, 10, 12]
          .map((n) => `<button class="${respLen === n ? 'on' : ''}" data-rlen="${n}">${n} notes</button>`)
          .join('')}
      </div>
      <div>
        <b>Playback Speed:</b>
        ${[
          { ms: 440, lbl: 'Slow' },
          { ms: 320, lbl: 'Normal' },
          { ms: 200, lbl: 'Fast' }
        ]
          .map((s) => `<button class="${stepMs === s.ms ? 'on' : ''}" data-tempo="${s.ms}">${s.lbl}</button>`)
          .join('')}
      </div>
    `;

    $('#targetToggle').innerHTML = `
      <b>Piano Keys & Tools Target:</b>
      <button class="${editTarget === 'resp' ? 'on' : ''}" data-target="resp">✏️ Editing Player Response (${draft.length}/${respLen})</button>
      <button class="${editTarget === 'call' ? 'on' : ''}" data-target="call">✏️ Editing Kyle's Call (${call.length}/${callLen})</button>
    `;

    $('#fmtControls').innerHTML = `
      <b>.txt Line Format:</b>
      <button class="${formatMode === 'plain' ? 'on' : ''}" data-fmt="plain">Plain Text Only</button>
      <button class="${formatMode === 'window' ? 'on' : ''}" data-fmt="window">With Window Tag [${callLen}->${respLen}]</button>
      <button class="${formatMode === 'full' ? 'on' : ''}" data-fmt="full">With Window + Notes</button>
    `;
  };

  const renderRolls = () => {
    $('#callBox').innerHTML = `
      <h3>Kyle's Call (${call.length}/${callLen} notes): ${call.map((i) => L[i]).join('-') || 'empty'}</h3>
      <pre class="rl">${roll(call, callLen)}</pre>
    `;
    $('#respBox').innerHTML = `
      <h3>Player Response (${draft.length}/${respLen} notes): ${draft.map((i) => L[i]).join('-') || 'empty'}</h3>
      <pre class="rl">${roll(draft, respLen)}</pre>
    `;
    renderControls();
    updateBubble();
  };

  const renderTxtArea = () => {
    const area = $('#txtOutput');
    if (area) area.value = savedLines.join('\n');
    const lc = $('#lineCount');
    if (lc) lc.textContent = `${savedLines.length} prompt${savedLines.length === 1 ? '' : 's'} recorded (auto-saved)`;
  };

  // Input listeners
  const pInput = $('#promptInput');
  pInput.addEventListener('input', (e) => {
    promptText = e.target.value;
    updateBubble();
  });
  pInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      appendPrompt();
    }
  });

  const tArea = $('#txtOutput');
  tArea.addEventListener('input', (e) => {
    savedLines = e.target.value.split('\n').filter((x) => x.trim().length > 0);
    saveToStorage();
    const lc = $('#lineCount');
    if (lc) lc.textContent = `${savedLines.length} prompt${savedLines.length === 1 ? '' : 's'} recorded (auto-saved)`;
  });

  const fLoader = $('#fileLoader');
  fLoader.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const existing = String(reader.result || '')
        .split(/\r?\n/)
        .filter((x) => x.trim().length > 0);
      savedLines = [...existing, ...savedLines];
      saveToStorage();
      renderTxtArea();
      const b = $('#bubble');
      if (b) b.textContent = `Loaded ${existing.length} prompts from ${file.name}! New prompts will append to the bottom.`;
    };
    reader.readAsText(file);
  });

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;

    if (d.clen) {
      callLen = Number(d.clen);
      if (call.length > callLen) call = call.slice(0, callLen);
      else while (call.length < callLen) call.push(randomCall(1)[0]);
      play(call);
      renderRolls();
    } else if (d.rlen) {
      respLen = Number(d.rlen);
      if (draft.length > respLen) draft = draft.slice(0, respLen);
      renderRolls();
    } else if (d.tempo) {
      stepMs = Number(d.tempo);
      play(call, draft);
      renderControls();
    } else if (d.target) {
      editTarget = d.target;
      renderControls();
    } else if (d.fmt) {
      formatMode = d.fmt;
      renderControls();
    } else if (d.k !== undefined) {
      const noteIdx = Number(d.k);
      if (editTarget === 'call') {
        call = [...call, noteIdx].slice(-callLen);
      } else {
        draft = [...draft, noteIdx].slice(-respLen);
      }
      play([noteIdx]);
      renderRolls();
    } else if (d.t) {
      runTool(d.t);
    } else if (d.play) {
      if (d.play === 'call') play(call);
      else if (d.play === 'resp') play(draft);
      else play(call, draft);
    } else if (d.act === 'randCall') {
      call = randomCall(callLen);
      play(call);
      renderRolls();
    } else if (d.act === 'append') {
      appendPrompt();
    } else if (d.act === 'download') {
      downloadTxt();
    } else if (d.act === 'copytxt') {
      const content = $('#txtOutput').value;
      if (navigator.clipboard) navigator.clipboard.writeText(content);
      const b = $('#bubble');
      if (b) b.textContent = 'Copied all prompts to clipboard!';
    } else if (d.act === 'cleartxt') {
      if (confirm('Clear all recorded prompts?')) {
        savedLines = [];
        saveToStorage();
        renderTxtArea();
      }
    }
  });

  renderRolls();
  renderTxtArea();

  return {
    update(v) {
      view = v || view;
    },
    denied(text) {
      const b = $('#bubble');
      if (b) b.textContent = String(text || 'Kyle refused that.');
    },
    destroy() {
      clearTimeout(animEnd);
      clearInterval(anim);
      if (ac) ac.close();
    }
  };
}

export function summarize(s) {
  return null;
}