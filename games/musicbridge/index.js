// games/musicbridge/index.js: Music Bridge
const SCALE = { labels: ['C', 'D', 'E', 'G', 'A', "C'", "D'", "E'"], hz: [262, 294, 330, 392, 440, 523, 587, 659] };
const S = SCALE.labels.length;

export const meta = {
  id: 'musicbridge',
  title: 'Music Bridge',
  players: { min: 1, max: 8 },
  color: '#2d5b83',
  icon: '🌉',
  desc: 'Compose a 4-beat bridge connecting a random intro and outro.',
  soloable: true
};

function randomPhrase(len, rng) {
  const p = [];
  for (let i = 0; i < len; i++) {
    p.push(Math.floor(rng() * S));
  }
  return p;
}

export function init(ctx) {
  const rng = ctx && ctx.rng ? ctx.rng : Math.random;
  const order = (ctx && ctx.atTable) ? ctx.atTable.map(m => m.id) : ['solo'];
  const names = {};
  if (ctx && ctx.atTable) {
    ctx.atTable.forEach(m => { names[m.id] = m.name; });
  } else {
    names['solo'] = 'Player';
  }
  return {
    inst: Date.now(),
    round: 1,
    phase: 'play', // 'play' | 'reveal' | 'over'
    order,
    names,
    arbiter: order[0] || 'solo',
    intro: randomPhrase(4, rng),
    outro: randomPhrase(4, rng),
    locked: {},
    submissions: {}, // id -> 4-beat array
    approved: {},    // id -> boolean
    found: 0,
    played: 0
  };
}

export function reduce(state, action, ctx) {
  const rng = ctx && ctx.rng ? ctx.rng : Math.random;
  const id = ctx && ctx.from && ctx.from.id ? ctx.from.id : '';

  if (action.a === 'lock') {
    if (state.phase !== 'play') return { error: 'Not taking bridges right now.' };
    if (!id || state.order.indexOf(id) < 0) return { error: 'You are watching — not seated.' };
    if (!Array.isArray(action.bridge) || action.bridge.length !== 4) return { error: 'Bridge must be exactly 4 beats.' };
    if (action.bridge.some(n => !Number.isInteger(n) || n < 0 || n >= S)) return { error: 'Invalid notes.' };

    const locked = { ...state.locked, [id]: true };
    const submissions = { ...state.submissions, [id]: action.bridge };
    
    // Check if all players locked in
    let allIn = state.order.every(pid => locked[pid]);
    const nextPhase = allIn ? 'reveal' : 'play';

    return {
      ...state,
      phase: nextPhase,
      locked,
      submissions,
      played: allIn ? state.played + state.order.length : state.played
    };
  }

  if (action.a === 'approve') {
    if (state.phase !== 'reveal') return { error: 'Not in reveal phase.' };
    if (id !== state.arbiter) return { error: 'Only the arbiter can judge.' };
    const targetId = action.targetId;
    if (!targetId || state.order.indexOf(targetId) < 0) return { error: 'Unknown player.' };
    const currentVal = !!state.approved[targetId];
    const approved = { ...state.approved, [targetId]: !currentVal };
    
    let found = 0;
    Object.values(approved).forEach(v => { if (v) found++; });

    return { ...state, approved, found };
  }

  if (action.a === 'next') {
    if (state.phase !== 'reveal') return { error: 'Not ready for next round.' };
    if (id !== state.arbiter) return { error: 'Only the arbiter can advance.' };

    const nextArbiterIdx = (state.order.indexOf(state.arbiter) + 1) % state.order.length;
    return {
      ...state,
      round: state.round + 1,
      phase: 'play',
      arbiter: state.order[nextArbiterIdx],
      intro: randomPhrase(4, rng),
      outro: randomPhrase(4, rng),
      locked: {},
      submissions: {},
      approved: {}
    };
  }

  return { error: 'Unknown action.' };
}

export function project(state, playerId) {
  // Hide other players' bridges while composing so the table cannot copy.
  // Locked status stays visible so everyone knows who is still writing.
  if (state.phase === 'play') {
    return {
      ...state,
      submissions: {},
      you: playerId,
      isArbiter: playerId === state.arbiter
    };
  }
  return {
    ...state,
    you: playerId,
    isArbiter: playerId === state.arbiter
  };
}

export function mount(root, api) {
  let view = null;
  let ac = null;
  let draft = [-1, -1, -1, -1]; // -1 means empty or click to place

  const playSequence = (bridgeNotes) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ac = ac || new Ctx();
      if (ac.state === 'suspended') ac.resume();
      
      const fullSeq = [...view.intro, ...(bridgeNotes || [-1,-1,-1,-1]), ...view.outro];
      let t = ac.currentTime + 0.05;
      const beatSec = 0.28;

      fullSeq.forEach((noteIdx, idx) => {
        if (noteIdx >= 0 && SCALE.hz[noteIdx]) {
          const o = ac.createOscillator();
          const g = ac.createGain();
          o.frequency.value = SCALE.hz[noteIdx];
          g.gain.setValueAtTime(0.4, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + beatSec * 0.9);
          o.connect(g).connect(ac.destination);
          o.start(t);
          o.stop(t + beatSec * 0.95);
        }
        t += beatSec;
      });
    } catch(e) {}
  };

  root.innerHTML = `
    <style>
      .mb { background: #fff; color: #000; font-family: "Courier New", monospace; padding: 16px; box-sizing: border-box; }
      h2 { margin: 0 0 8px; font-size: 20px; }
      .box { border: 2px solid #000; padding: 12px; margin-bottom: 12px; background: #f9f9f9; }
      button { font: inherit; background: #fff; border: 2px solid #000; padding: 6px 14px; cursor: pointer; font-weight: bold; margin: 2px; }
      button:hover { background: #000; color: #fff; }
      button.primary { background: #000; color: #fff; }
      button:disabled { opacity: 0.5; cursor: default; }
      .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }
      .col { display: flex; flex-direction: column-reverse; gap: 4px; background: #eee; padding: 6px; border: 1px solid #ccc; }
      .cell { min-height: 40px; background: #fff; border: 1px solid #999; cursor: pointer; text-align: center; font-size: 14px; line-height: 38px; }
      .cell.lit { background: #000; color: #fff; }
      .status { font-weight: bold; margin: 8px 0; }
      .err { color: #b91c1c; font-weight: bold; margin: 8px 0; min-height: 1.2em; }
      .watch { background: #fef3c7; border: 2px solid #000; padding: 8px; margin-bottom: 12px; font-weight: bold; }
    </style>
    <div class="mb">
      <h2>Music Bridge</h2>
      <div id="status" class="status"></div>
      <div id="err" class="err" role="alert"></div>
      <div class="box" id="promptBox"></div>
      <div id="controlsBox"></div>
    </div>
  `;

  const render = () => {
    if (!view) return;
    const L = SCALE.labels;
    const isReveal = view.phase === 'reveal';
    const watching = view.order.indexOf(view.you) < 0;

    root.querySelector('#status').textContent = `Round ${view.round} · Arbiter: ${view.names[view.arbiter] || '???'}`;

    let promptHtml = `
      <div><b>Intro (Random):</b> ${view.intro.map(i => L[i]).join('-')}</div>
      <div style="margin: 6px 0; color: #555;">[ 4 Empty Beats for Bridge ]</div>
      <div><b>Outro (Random):</b> ${view.outro.map(i => L[i]).join('-')}</div>
    `;
    root.querySelector('#promptBox').innerHTML = promptHtml;

    let ctrlHtml = '';
    if (watching) {
      ctrlHtml += `<div class="watch">👁 watching — waiting for your turn</div>`;
    }
    if (!isReveal) {
      const lockedIn = view.locked[view.you];
      ctrlHtml += `
        <h3>Compose Your 4-Beat Bridge</h3>
        <p style="font-size: 13px;">Click cells in the 4 columns below to set pitches (Low at bottom, High at top):</p>
        <div class="grid" id="bridgeGrid"></div>
        <div style="margin-top: 10px;">
          <button id="btnPlayDraft">▶ Preview Full Sequence</button>
          <button class="primary" id="btnLock" ${lockedIn ? 'disabled' : ''}>${lockedIn ? 'Locked In ✓' : 'Lock In Bridge'}</button>
        </div>
      `;
    } else {
      ctrlHtml += `<h3>Table Submissions</h3>`;
      view.order.forEach(pid => {
        const sub = view.submissions[pid] || null;
        const subLabel = sub ? sub.map(i => L[i]).join('-') : '—';
        const isAppr = !!view.approved[pid];
        ctrlHtml += `
          <div style="border-bottom: 1px solid #ccc; padding: 6px 0; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <b>${view.names[pid]}</b>: Bridge [${subLabel}]
            </div>
            <div>
              <button data-play="${pid}">▶ Play</button>
              ${view.isArbiter ? `<button data-approve="${pid}" style="background:${isAppr ? '#000' : '#fff'}; color:${isAppr ? '#fff' : '#000'}">${isAppr ? 'Approved ✓' : 'Approve'}</button>` : `<span>${isAppr ? '✓ True Bridge' : ''}</span>`}
            </div>
          </div>
        `;
      });

      if (view.isArbiter) {
        ctrlHtml += `<div style="margin-top: 14px;"><button class="primary" id="btnNext">Next Round →</button></div>`;
      }
    }

    root.querySelector('#controlsBox').innerHTML = ctrlHtml;

    // Render interactive grid if playing
    if (!isReveal) {
      const gridEl = root.querySelector('#bridgeGrid');
      if (gridEl) {
        let gridContent = '';
        for (let col = 0; col < 4; col++) {
          let colCells = '';
          for (let row = S - 1; row >= 0; row--) {
            const isLit = draft[col] === row;
            colCells += `<div class="cell ${isLit ? 'lit' : ''}" data-col="${col}" data-row="${row}">${L[row]}</div>`;
          }
          gridContent += `<div class="col">${colCells}</div>`;
        }
        gridEl.innerHTML = gridContent;
      }
    }
  };

  const showError = (msg) => {
    const el = root.querySelector('#err');
    if (el) el.textContent = msg || '';
  };

  // NOTE: `root` is a ShadowRoot, which has no `onclick` IDL attribute —
  // assigning it would silently drop every click. Use addEventListener.
  root.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) {
      const col = parseInt(cell.dataset.col, 10);
      const row = parseInt(cell.dataset.row, 10);
      draft[col] = draft[col] === row ? -1 : row;
      if (draft[col] >= 0) playSequence(draft);
      render();
      return;
    }

    if (e.target.id === 'btnPlayDraft') {
      playSequence(draft);
    } else if (e.target.id === 'btnLock') {
      if (draft.some(n => n < 0)) {
        showError('Please fill all 4 beats of your bridge.');
        return;
      }
      showError('');
      api.send({ a: 'lock', bridge: draft.slice() });
    } else if (e.target.dataset.play) {
      const pid = e.target.dataset.play;
      playSequence(view.submissions[pid]);
    } else if (e.target.dataset.approve) {
      const pid = e.target.dataset.approve;
      api.send({ a: 'approve', targetId: pid });
    } else if (e.target.id === 'btnNext') {
      api.send({ a: 'next' });
    }
  });

  return {
    update(newView) {
      view = newView;
      render();
    },
    denied(msg) {
      showError(msg || 'Move rejected.');
    },
    destroy() {
      if (ac) ac.close();
    }
  };
}

export function summarize(state, nameOf) {
  if (!state || state.phase !== 'reveal' || !state.found) return null;
  const bridgeWord = state.found === 1 ? 'bridge' : 'bridges';
  const playWord = state.played === 1 ? 'play' : 'plays';
  return `Music Bridge: ${state.found} approved ${bridgeWord} across ${state.played} ${playWord}.`;
}