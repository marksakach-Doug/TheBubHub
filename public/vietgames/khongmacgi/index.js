import data from './stripped.json' with { type: 'json' };

export const meta = {
  id: 'stripped-vi',
  title: 'Hum Tones',
  players: '2-6',
  color: '#f59e0b',
  icon: '〰️',
  desc: 'Say a Vietnamese sentence. Words stripped out. The Ear hears only the tones and picks the sentence.',
  soloable: true
};

const PAIRS = data.pairs;
// Praat-like pitch settings (think Sound > To Pitch (ac)...). Edit and reload.
const PITCH = {
  timeStep: 0.04,          // seconds between pitch frames (Praat "time step"); smaller = finer but heavier
  floor: 60,               // Hz, pitch floor; if you lower it, raise `window` too
  ceiling: 380,            // Hz, pitch ceiling
  silenceThreshold: 0.012, // frames quieter than this (RMS) count as unvoiced
  voicingThreshold: 0.6,  // min autocorrelation strength to count as voiced (Praat default is 0.45)
  octaveCost: 0.01,        // favors higher candidates (Praat default 0.01)
  octaveJumpCost: 0.35,    // penalizes jumping an octave from the previous frame (Praat default 0.35)
  window: 2048,            // samples analysed per frame, a power of 2 (2048 is steadier for low voices)
  maxSeconds: 4.8,         // longest recording
  normalizeTo: 150,        // Hz; each clip's median pitch is moved here so only the melody is heard
  glide: 0.015             // seconds; playback pitch smoothing (bigger = smoother hum)
};
const MAX_FRAMES = Math.round(PITCH.maxSeconds / PITCH.timeStep);

function dealRound(state, round, rng) {
  const order = state.order;
  const ear = order[round % order.length];
  const speakers = order.length > 1 ? order.filter((id) => id !== ear) : [ear];
  const pair = PAIRS[Math.floor(rng() * PAIRS.length)];
  const aims = {};
  speakers.forEach((id) => { aims[id] = pair[rng() < 0.5 ? 0 : 1]; });
  return {
    ...state,
    phase: 'speak',
    round,
    ear,
    pair,
    line: '',
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
    pair: ['', ''],
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
    const frames = Array.isArray(action.frames) ? action.frames.slice(0, MAX_FRAMES) : [];
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
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.deck.length || state.pair.indexOf(action.side) < 0) {
      return { error: 'Bad pick.' };
    }
    const picks = { ...state.picks, [idx]: action.side };
    if (Object.keys(picks).length < state.deck.length) return { ...state, picks };
    const scores = { ...state.scores };
    state.deck.forEach((c, i) => {
      if (picks[i] !== c.aim) return;
      scores[state.ear] = (scores[state.ear] || 0) + 1;
      if (c.owner !== state.ear) scores[c.owner] = (scores[c.owner] || 0) + 1;
    });
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
    aim: showAll ? c.aim : null,
    owner: showAll ? c.owner : null
  }));
  return {
    epoch: state.epoch,
    phase: state.phase,
    order: state.order,
    scores: state.scores,
    round: state.round,
    totalRounds: state.order.length,
    ear: state.ear,
    pair: state.pair,
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
  let actx = null, master = null, recStream = null, recTimer = null;
  let playedWinEpoch = 0, joined = false, lastView = null;
  const rec = { key: '', mode: 'idle', n: 0, raw: [], err: false }; // mode: idle | count | rec | sent

  const getCtx = () => {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createDynamicsCompressor();
      master.connect(actx.destination);
    }
    return actx;
  };

  function detectF0(buf, sr, prev) {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < PITCH.silenceThreshold) return [0, 0];
    const minL = Math.floor(sr / PITCH.ceiling), maxL = Math.floor(sr / PITCH.floor);
    let bestL = 0, bestScore = -Infinity;
    for (let l = minL; l <= maxL; l++) {
      let c = 0, n1 = 0, n2 = 0;
      for (let i = 0; i < buf.length - l; i += 2) {
        c += buf[i] * buf[i + l];
        n1 += buf[i] * buf[i];
        n2 += buf[i + l] * buf[i + l];
      }
      const r = c / Math.sqrt((n1 * n2) || 1);
      if (r <= PITCH.voicingThreshold) continue;
      const hz = sr / l;
      let score = r + PITCH.octaveCost * Math.log2(hz / PITCH.floor);
      if (prev) score -= PITCH.octaveJumpCost * Math.abs(Math.log2(hz / prev));
      if (score > bestScore) { bestScore = score; bestL = l; }
    }
    return [bestL ? Math.round(sr / bestL) : 0, Math.min(100, Math.round(rms * 300))];
  }

  // Schwa: a buzzing source through three fixed formants (about 500, 1500, 2500 Hz),
  // like Praat's artificial vowel. Edit FORMANTS to change the vowel: [Hz, loudness].
  const FORMANTS = [[500, 1], [1500, 0.7], [2500, 0.4]];

  function playFrames(frames, baseHz = PITCH.normalizeTo, delay = 0, vol = 1) {
    if (!frames || !frames.length) return;
    const ctx = getCtx();
    ctx.resume();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = baseHz;
    g.gain.value = 0;
    FORMANTS.forEach(([hz, amp]) => {
      const f = ctx.createBiquadFilter(), a = ctx.createGain();
      f.type = 'bandpass';
      f.frequency.value = hz;
      f.Q.value = 3;
      a.gain.value = amp;
      osc.connect(f);
      f.connect(a);
      a.connect(g);
    });
    g.connect(master);
    const t0 = ctx.currentTime + delay, dt = PITCH.timeStep;
    frames.forEach(([f0, amp], i) => {
      const t = t0 + i * dt;
      if (f0 > 0) {
        osc.frequency.setTargetAtTime(f0 * (baseHz / PITCH.normalizeTo), t, PITCH.glide);
        g.gain.setTargetAtTime(vol * (0.8 + 0.8 * Math.min(1, amp / 30)), t, PITCH.glide);
      } else {
        g.gain.setTargetAtTime(0, t, 0.01);
      }
    });
    osc.start(t0);
    osc.stop(t0 + frames.length * dt + 0.05);
  }

  function playChoir(vault) {
    const vol = Math.min(1, 1.5 / Math.sqrt(vault.length || 1));
    vault.forEach((frames, i) => playFrames(frames, 110 + (i % 6) * 20, (i % 4) * 0.06, vol));
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
    .stage{position:relative;min-height:80vh;display:flex;align-items:center;justify-content:center;padding:8px}
    .board{position:absolute;top:8px;right:8px;z-index:5;min-width:120px;padding:8px 12px;border-radius:10px;background:#111827;color:#f3f4f6;font:600 .85rem system-ui,sans-serif;text-align:left}
    .board div{display:flex;justify-content:space-between;gap:14px}
    .board .me{color:#f59e0b}
    .say{text-align:left;font-size:2rem;line-height:1.25;font-weight:800;margin:18px 0 12px}
    .say{container-type:inline-size}
    .say .l2{margin-left:1.2em;white-space:nowrap}
    .say .l3{margin-left:2.4em}
    .say b{color:#f59e0b}
    .card [data-s]{flex:1 1 100%}
    @media (max-width:700px){.stage{flex-direction:column}.board{position:static;align-self:flex-end;margin-bottom:8px}}
    .wrap{font-family:system-ui,sans-serif;color:#f3f4f6;background:#111827;padding:16px;border-radius:12px;width:100%;max-width:480px;text-align:center}
    .btn{min-height:42px;padding:8px 16px;margin:4px;border:0;border-radius:8px;font-weight:700;cursor:pointer;background:#374151;color:#fff}
    .btn.pri{background:#f59e0b;color:#111827}
    .btn.act{outline:2px solid #f59e0b;background:#1f2937}
    .card{background:#1f2937;padding:10px;margin:8px 0;border-radius:8px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;border-left:6px solid transparent}
    .card.ok{border-left-color:#22c55e;background:#14532d}
    .card.bad{border-left-color:#ef4444;background:#7f1d1d}
    .big{font-size:1.35rem;font-weight:800;margin:8px 0}
    .count{font-size:5rem;font-weight:800;color:#f59e0b;margin:12px 0}
    .mark{font-size:1.8rem;font-weight:800}
    .note{width:100%;text-align:left;font-size:.9rem}
    .sub{color:#9ca3af;font-size:.85rem}
    canvas{background:#030712;border-radius:6px;flex:1;min-width:80px}
  </style><div class="stage"><div class="board" id="board"></div><div class="wrap" id="app"></div></div>`;
  const app = root.getElementById('app');
  const board = root.getElementById('board');

  const article = (m) => (/^[aeiou]/i.test(m) ? 'an' : 'a');
  const redraw = () => { if (lastView) update(lastView); };

  function cancelRec() {
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    if (recStream) { recStream.getTracks().forEach((t) => t.stop()); recStream = null; }
    rec.mode = 'idle';
    rec.raw = [];
  }

  function finishRec() {
    const raw = rec.raw;
    cancelRec();
    if (!raw.length) { redraw(); return; }
    const voiced = raw.filter((f) => f[0] > 0).map((f) => f[0]).sort((a, b) => a - b);
    const med = voiced.length ? voiced[Math.floor(voiced.length / 2)] : PITCH.normalizeTo;
    const norm = raw.map(([f0, a]) => [f0 ? Math.round((f0 * PITCH.normalizeTo) / med) : 0, a]);
    api.send({ a: 'clip', frames: norm });
    rec.mode = 'sent';
    redraw();
  }

  async function beginRec() {
    if (rec.mode !== 'idle') return;
    const ctx = getCtx();
    ctx.resume();
    rec.err = false;
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      rec.err = true;
      redraw();
      return;
    }
    const an = ctx.createAnalyser();
    an.fftSize = PITCH.window;
    ctx.createMediaStreamSource(recStream).connect(an);
    const buf = new Float32Array(an.fftSize);
    rec.mode = 'count';
    rec.n = 3;
    rec.raw = [];
    redraw();
    recTimer = api.setInterval(() => {
      rec.n--;
      if (rec.n > 0) { redraw(); return; }
      clearInterval(recTimer);
      rec.mode = 'rec';
      recTimer = api.setInterval(() => {
        an.getFloatTimeDomainData(buf);
        const last = rec.raw.length ? rec.raw[rec.raw.length - 1][0] : 0;
        rec.raw.push(detectF0(buf, ctx.sampleRate, last));
        if (rec.raw.length >= MAX_FRAMES) finishRec();
      }, PITCH.timeStep * 1000);
      redraw();
    }, 1000);
  }

  function nameOf(id) {
    const p = (api.roster || []).find((r) => r.id === id);
    return p ? p.name : id.slice(0, 5);
  }

  function update(view) {
    lastView = view;
    const key = view.epoch + ':' + view.round;
    if (key !== rec.key) { cancelRec(); rec.key = key; }

    if (!joined && !api.isSpectator && view.you && view.order.indexOf(view.you) < 0 && view.phase === 'lobby') {
      joined = true;
      api.send({ a: 'join' });
      return;
    }
    const spec = api.isSpectator ? `<div class="sub">👁 watching</div>` : '';
    const earNow = ['speak', 'guess', 'reveal'].indexOf(view.phase) >= 0 ? view.ear : null;
    board.style.display = view.order.length ? '' : 'none';
    board.innerHTML = view.order
      .map((id) => `<div class="${id === view.you ? 'me' : ''}"><span>${id === earNow ? '👂 ' : ''}${nameOf(id)}</span><b>${view.scores[id] || 0}</b></div>`)
      .join('');

    if (view.phase === 'lobby') {
      const canStart = (api.isHost || view.order.length <= 1) && !api.isSpectator;
      app.innerHTML = `${spec}<div class="big">Stripped Speech</div>
        <div class="sub">${view.order.length} at table</div>
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

    const head = `${spec}<div class="sub">Round ${view.round + 1}/${view.totalRounds} · The Ear: <b>${nameOf(view.ear)}</b></div>`;
    const sentence = '';

    if (view.phase === 'speak') {
      if (!view.myAim) {
        const isEar = view.you === view.ear;
        app.innerHTML = `${head}${sentence}<div class="sub">${isEar
          ? `You are The Ear. Others are speaking. Listen for <b>${view.pair[0]}</b> or <b>${view.pair[1]}</b>. Waiting (${view.waitingCount})…`
          : `Waiting (${view.waitingCount})…`}</div>`;
        return;
      }
      let ctl;
      if (view.recorded || rec.mode === 'sent') {
        ctl = `<div class="sub">Sent. Waiting (${view.waitingCount})…</div>`;
      } else if (rec.mode === 'count') {
        ctl = `<div class="count">${rec.n}</div>`;
      } else if (rec.mode === 'rec') {
        ctl = `<div class="sub">● Recording…</div><button class="btn pri" id="rec">■ Done</button>`;
      } else {
        ctl = `<button class="btn pri" id="rec">● Speak</button>${rec.err ? '<div class="sub">Mic blocked</div>' : ''}`;
      }
      const say = `<div class="say"><div>Say</div><div class="l2" style="font-size:min(2rem,${(100 / (1.2 + 0.62 * (view.myAim.length + 2))).toFixed(2)}cqw)">"${view.myAim}"</div></div>`;
      app.innerHTML = `${head}${say}${ctl}`;
      const r = app.querySelector('#rec');
      if (r && !api.isSpectator) r.onclick = () => (rec.mode === 'rec' ? finishRec() : beginRec());
      return;
    }

    const isEar = view.you === view.ear && !api.isSpectator;
    const reveal = view.phase === 'reveal';
    const total = view.deck.length;
    const right = view.deck.filter((c, i) => view.picks[i] === c.aim).length;
    const picked = Object.keys(view.picks).length;
    const banner = reveal
      ? `<div class="big" style="color:${right === total ? '#22c55e' : right === 0 ? '#ef4444' : '#f59e0b'}">${nameOf(view.ear)} got ${right} of ${total} right</div>`
      : `<div class="sub">${isEar ? 'Which way was each one said?' : 'The Ear is listening…'} (${picked}/${total})</div>`;
    app.innerHTML = `${head}${sentence}${banner}<div id="list"></div>
      ${reveal && (isEar || api.isHost) ? `<button class="btn pri" id="nxt">Next</button>` : ''}`;
    const list = app.querySelector('#list');
    view.deck.forEach((c, i) => {
      const row = document.createElement('div');
      const pick = view.picks[i];
      const ok = pick === c.aim;
      row.className = 'card' + (reveal ? (ok ? ' ok' : ' bad') : '');
      row.innerHTML = `<button class="btn" data-p="${i}">▶</button>
        <canvas width="140" height="36"></canvas>
        ${reveal
          ? `<div class="mark">${ok ? '✓' : '✗'}</div>
             <div class="note"><b>${nameOf(c.owner)}</b> meant <b>${c.aim}</b> · Ear heard <b>${pick}</b>${ok ? (c.owner !== view.ear ? ' · +1 each' : ' · +1') : ''}</div>`
          : view.pair.map((s) => `<button class="btn ${pick === s ? 'act' : ''}" data-s="${s}" ${isEar ? '' : 'disabled'}>${s}</button>`).join('')}`;
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
      cancelRec();
      if (actx) actx.close().catch(() => {});
    }
  };
}
