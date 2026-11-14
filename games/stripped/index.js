export const meta = {
  id: 'stripped',
  title: 'Stripped Speech',
  players: '2-6',
  color: '#f59e0b',
  icon: '〰️',
  desc: 'Push or duck. Words stripped out. The Ear reads the hum.',
  soloable: true
};

const SIDES = ['PUSH', 'DUCK'];
const LINES = [
  'I left it on the counter.',
  'We can talk about it tomorrow.',
  'That was the last one.',
  'I thought you called them.',
  'It is still by the door.',
  'You already knew about that.',
  'Leave it where you found it.',
  'I was just about to leave.'
];

function dealRound(state, round, rng) {
  const order = state.order;
  const ear = order[round % order.length];
  const speakers = order.length > 1 ? order.filter((id) => id !== ear) : [ear];
  const aims = {};
  speakers.forEach((id) => { aims[id] = SIDES[rng() < 0.5 ? 0 : 1]; });
  return {
    ...state,
    phase: 'speak',
    round,
    ear,
    line: LINES[Math.floor(rng() * LINES.length)],
    aims,
    clips: {},
    deck: [],
    picks: {}
  };
}

export function init(ctx) {
  const table = (ctx && ctx.atTable) || [];
  const order = table.filter((p) => !p.spectator).map((p) => p.id);
  const scores = {};
  order.forEach((id) => { scores[id] = 0; });
  return {
    epoch: 1,
    phase: 'lobby',
    order,
    scores,
    round: 0,
    ear: null,
    line: '',
    aims: {},
    clips: {},
    deck: [],
    picks: {},
    vault: [],
    winners: []
  };
}

export function prune(state, goneId) {
  if (state.order.indexOf(goneId) < 0) return state;
  const order = state.order.filter((id) => id !== goneId);
  if (!order.length) return { ...state, order, phase: 'lobby' };
  const aims = { ...state.aims };
  const clips = { ...state.clips };
  delete aims[goneId];
  delete clips[goneId];
  return { ...state, order, aims, clips };
}

export function roundId(state) { return 'e' + state.epoch; }

export function summarize(state, nameOf) {
  if (state.phase !== 'over' || !state.winners.length) return null;
  return `${state.winners.map(nameOf).join(' & ')} won ${meta.title}`;
}

export function reduce(state, action, ctx) {
  const id = (ctx && ctx.from && ctx.from.id) || '';
  const isHost = !!(ctx && ctx.from && ctx.from.host);
  const rng = (ctx && ctx.rng) || Math.random;
  if (!action || !action.a) return { error: 'Bad action.' };

  if (action.a === 'join') {
    if (!id || state.order.indexOf(id) >= 0) return state;
    return {
      ...state,
      order: [...state.order, id],
      scores: { ...state.scores, [id]: 0 }
    };
  }

  if (action.a === 'toLobby') {
    if (!isHost && state.order.length > 1) return { error: 'Host only.' };
    return { ...state, epoch: state.epoch + 1, phase: 'lobby', vault: [], winners: [] };
  }

  if (action.a === 'start') {
    if (!isHost && state.order.length > 1) return { error: 'Host only.' };
    const order = state.order.length ? state.order : (id ? [id] : []);
    if (!order.length) return { error: 'Need players.' };
    const scores = {};
    order.forEach((p) => { scores[p] = 0; });
    const fresh = { ...state, epoch: state.epoch + 1, order, scores, vault: [], winners: [] };
    return dealRound(fresh, 0, rng);
  }

  if (state.phase === 'speak' && action.a === 'clip') {
    if (!state.aims[id] || state.clips[id]) return { error: 'Not your turn.' };
    const frames = Array.isArray(action.frames) ? action.frames.slice(0, 90) : [];
    if (!frames.length) return { error: 'Empty clip.' };
    const clips = { ...state.clips, [id]: frames };
    const speakers = Object.keys(state.aims);
    if (speakers.every((s) => clips[s])) {
      const deck = speakers.map((s) => ({ owner: s, aim: state.aims[s], frames: clips[s] }));
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      return { ...state, phase: 'guess', clips, deck, picks: {} };
    }
    return { ...state, clips };
  }

  if (state.phase === 'guess' && action.a === 'pick') {
    if (id !== state.ear) return { error: 'Only The Ear picks.' };
    const idx = Number(action.idx);
    if (idx < 0 || idx >= state.deck.length || SIDES.indexOf(action.side) < 0) {
      return { error: 'Bad pick.' };
    }
    const picks = { ...state.picks, [idx]: action.side };
    if (Object.keys(picks).length < state.deck.length) return { ...state, picks };
    let pts = 0;
    state.deck.forEach((c, i) => { if (picks[i] === c.aim) pts++; });
    const scores = { ...state.scores, [state.ear]: (state.scores[state.ear] || 0) + pts };
    const vault = [...state.vault, ...state.deck.map((c) => c.frames)];
    return { ...state, phase: 'reveal', picks, scores, vault };
  }

  if (state.phase === 'reveal' && action.a === 'next') {
    if (id !== state.ear && !isHost) return { error: 'Wait for The Ear.' };
    const nextRound = state.round + 1;
    if (nextRound >= state.order.length) {
      const max = Math.max(0, ...state.order.map((p) => state.scores[p] || 0));
      const winners = state.order.filter((p) => (state.scores[p] || 0) === max);
      return { ...state, phase: 'over', winners };
    }
    return dealRound(state, nextRound, rng);
  }

  return { error: 'Invalid move.' };
}

export function project(state, playerId) {
  const showAll = state.phase === 'reveal' || state.phase === 'over';
  const deck = state.deck.map((c) => ({
    frames: c.frames,
    aim: showAll ? c.aim : null
  }));
  return {
    epoch: state.epoch,
    phase: state.phase,
    order: state.order,
    scores: state.scores,
    round: state.round,
    totalRounds: state.order.length,
    ear: state.ear,
    line: state.line,
    myAim: state.aims[playerId] || null,
    recorded: !!state.clips[playerId],
    waitingCount: Object.keys(state.aims).length - Object.keys(state.clips).length,
    deck,
    picks: state.picks,
    vault: state.phase === 'over' ? state.vault : [],
    winners: state.winners,
    you: playerId
  };
}

export function mount(root, api) {
  let actx = null, recStream = null, recTimer = null, playedWinEpoch = 0, joined = false;
  const getCtx = () => (actx = actx || new (window.AudioContext || window.webkitAudioContext)());

  function detectF0(buf, sr) {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.012) return [0, 0];
    const minL = Math.floor(sr / 380), maxL = Math.floor(sr / 70);
    let bestL = 0, bestC = 0;
    for (let l = minL; l <= maxL; l++) {
      let c = 0, n1 = 0, n2 = 0;
      for (let i = 0; i < buf.length - l; i += 2) {
        c += buf[i] * buf[i + l];
        n1 += buf[i] * buf[i];
        n2 += buf[i + l] * buf[i + l];
      }
      const r = c / Math.sqrt((n1 * n2) || 1);
      if (r > 0.72 && r > bestC) { bestC = r; bestL = l; }
    }
    return [bestL ? Math.round(sr / bestL) : 0, Math.min(100, Math.round(rms * 300))];
  }

  function playFrames(frames, baseHz = 150, delay = 0) {
    if (!frames || !frames.length) return;
    const ctx = getCtx();
    ctx.resume();
    const osc = ctx.createOscillator(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    osc.type = 'sawtooth';
    flt.type = 'lowpass';
    flt.frequency.value = 250;
    g.gain.value = 0;
    osc.connect(flt).connect(g).connect(ctx.destination);
    const t0 = ctx.currentTime + delay, dt = 0.04;
    frames.forEach(([f0, amp], i) => {
      const t = t0 + i * dt;
      if (f0 > 0) {
        osc.frequency.setTargetAtTime(f0 * (baseHz / 150), t, 0.015);
        g.gain.setTargetAtTime(Math.min(0.35, (amp / 100) * 0.35), t, 0.015);
      } else {
        g.gain.setTargetAtTime(0, t, 0.01);
      }
    });
    osc.start(t0);
    osc.stop(t0 + frames.length * dt + 0.05);
  }

  function playChoir(vault) {
    vault.forEach((frames, i) => playFrames(frames, 120 + (i % 6) * 22, (i % 4) * 0.06));
  }

  function drawCurve(cvs, frames) {
    const c = cvs.getContext('2d'), w = cvs.width, h = cvs.height;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#f59e0b';
    c.lineWidth = 2;
    c.beginPath();
    let down = false;
    frames.forEach(([f0], i) => {
      if (!f0) { down = false; return; }
      const x = (i / Math.max(1, frames.length - 1)) * w;
      const y = h - Math.min(1, Math.max(0, (f0 - 80) / 180)) * (h - 8) - 4;
      if (!down) { c.moveTo(x, y); down = true; } else c.lineTo(x, y);
    });
    c.stroke();
  }

  root.innerHTML = `<style>
    .wrap{font-family:system-ui,sans-serif;color:#f3f4f6;background:#111827;padding:16px;border-radius:12px;max-width:480px;margin:0 auto;text-align:center}
    .btn{min-height:42px;padding:8px 16px;margin:4px;border:0;border-radius:8px;font-weight:700;cursor:pointer;background:#374151;color:#fff}
    .btn.pri{background:#f59e0b;color:#111827}
    .btn.act{outline:2px solid #f59e0b;background:#1f2937}
    .card{background:#1f2937;padding:10px;margin:8px 0;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:8px}
    .big{font-size:1.35rem;font-weight:800;margin:8px 0}
    .sub{color:#9ca3af;font-size:.85rem}
    canvas{background:#030712;border-radius:6px;flex:1}
  </style><div class="wrap" id="app"></div>`;
  const app = root.getElementById('app');

  function stopRec(raw) {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    if (recStream) { recStream.getTracks().forEach((t) => t.stop()); recStream = null; }
    if (!raw || !raw.length) return;
    const voiced = raw.filter((f) => f[0] > 0).map((f) => f[0]).sort((a, b) => a - b);
    const med = voiced.length ? voiced[Math.floor(voiced.length / 2)] : 150;
    const norm = raw.map(([f0, a]) => [f0 ? Math.round((f0 * 150) / med) : 0, a]);
    api.send({ a: 'clip', frames: norm });
  }

  async function toggleRec(btn) {
    if (recTimer) { stopRec(btn._raw); return; }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = getCtx();
      const src = ctx.createMediaStreamSource(recStream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize), raw = [];
      btn._raw = raw;
      btn.textContent = '■ Done';
      recTimer = api.setInterval(() => {
        an.getFloatTimeDomainData(buf);
        raw.push(detectF0(buf, ctx.sampleRate));
        if (raw.length >= 70) stopRec(raw);
      }, 40);
    } catch (_) {
      btn.textContent = 'Mic blocked';
    }
  }

  function nameOf(id) {
    const p = (api.roster || []).find((r) => r.id === id);
    return p ? p.name : id.slice(0, 5);
  }

  function update(view) {
    if (!joined && !api.isSpectator && view.you && view.order.indexOf(view.you) < 0 && view.phase === 'lobby') {
      joined = true;
      api.send({ a: 'join' });
      return;
    }
    const spec = api.isSpectator ? `<div class="sub">👁 watching</div>` : '';
    const scores = view.order.map((id) => `${nameOf(id)}: ${view.scores[id] || 0}`).join(' · ');

    if (view.phase === 'lobby') {
      const canStart = (api.isHost || view.order.length <= 1) && !api.isSpectator;
      app.innerHTML = `${spec}<div class="big">Stripped Speech</div>
        <div class="sub">${view.order.length} at table · ${scores || 'waiting'}</div>
        <div style="margin-top:12px">
          <button class="btn pri" id="start" ${canStart ? '' : 'disabled'}>Start</button>
        </div>`;
      const s = app.querySelector('#start');
      if (s && canStart) s.onclick = () => api.send({ a: 'start' });
      return;
    }

    if (view.phase === 'over') {
      const won = view.winners.indexOf(view.you) >= 0;
      if (won && playedWinEpoch !== view.epoch && view.vault.length) {
        playedWinEpoch = view.epoch;
        playChoir(view.vault);
      }
      const canHost = (api.isHost || view.order.length <= 1) && !api.isSpectator;
      app.innerHTML = `${spec}<div class="big">${view.winners.map(nameOf).join(' & ')} won</div>
        <div class="sub">${scores}</div>
        <div style="margin-top:12px">
          <button class="btn" id="choir">🔊 Choir</button>
          <button class="btn pri" id="again" ${canHost ? '' : 'disabled'}>Play again</button>
          <button class="btn" id="lobby" ${canHost ? '' : 'disabled'}>Lobby</button>
        </div>`;
      app.querySelector('#choir').onclick = () => playChoir(view.vault);
      if (canHost) {
        app.querySelector('#again').onclick = () => api.send({ a: 'start' });
        app.querySelector('#lobby').onclick = () => api.send({ a: 'toLobby' });
      }
      return;
    }

    const head = `${spec}<div class="sub">Round ${view.round + 1}/${view.totalRounds} · The Ear: <b>${nameOf(view.ear)}</b> · ${scores}</div>`;

    if (view.phase === 'speak') {
      if (!view.myAim) {
        app.innerHTML = `${head}<div class="big">"${view.line}"</div><div class="sub">You are The Ear. Waiting (${view.waitingCount})…</div>`;
        return;
      }
      app.innerHTML = `${head}<div class="sub">Aim: <b>${view.myAim}</b></div>
        <div class="big">"${view.line}"</div>
        ${view.recorded ? `<div class="sub">Sent. Waiting (${view.waitingCount})…</div>` : `<button class="btn pri" id="rec">● Speak</button>`}`;
      const r = app.querySelector('#rec');
      if (r && !api.isSpectator) r.onclick = () => toggleRec(r);
      return;
    }

    const isEar = view.you === view.ear && !api.isSpectator;
    app.innerHTML = `${head}<div class="big">"${view.line}"</div><div id="list"></div>
      ${view.phase === 'reveal' && (isEar || api.isHost) ? `<button class="btn pri" id="nxt">Next</button>` : ''}`;
    const list = app.querySelector('#list');
    view.deck.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'card';
      const pick = view.picks[i];
      row.innerHTML = `<button class="btn" data-p="${i}">▶</button>
        <canvas width="140" height="36"></canvas>
        ${view.phase === 'reveal'
          ? `<b>${c.aim}</b> <span>${pick === c.aim ? '✓' : '✗'}</span>`
          : SIDES.map((s) => `<button class="btn ${pick === s ? 'act' : ''}" data-s="${s}" ${isEar ? '' : 'disabled'}>${s}</button>`).join('')}`;
      list.appendChild(row);
      drawCurve(row.querySelector('canvas'), c.frames);
      row.querySelector('[data-p]').onclick = () => playFrames(c.frames);
      row.querySelectorAll('[data-s]').forEach((b) => {
        b.onclick = () => api.send({ a: 'pick', idx: i, side: b.dataset.s });
      });
    });
    const nxt = app.querySelector('#nxt');
    if (nxt) nxt.onclick = () => api.send({ a: 'next' });
  }

  return {
    update,
    destroy() {
      stopRec();
      if (actx) actx.close().catch(() => {});
    }
  };
}