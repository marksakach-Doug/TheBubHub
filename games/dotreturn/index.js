// Dot Return — a module game.
//
// The contract has no tick: state only moves through reduce(), so this game
// splits its physics from its authority. Every client integrates the dots with
// the same fixed step from the same authoritative headings, so the table sees
// one motion; the host owns the things that must not drift — the shared return
// tally, the headings themselves, and the round clock. Anything a client wants
// to change is an intent (swipe/reroll/exit), validated host-side.
//
// The new mechanic: a dot that drifts back to dead centre rerolls a fresh
// random trajectory. It is asked for as an intent rather than applied locally,
// so every client sees the same new heading — and it is silent on purpose: no
// flash, no counter, just a dot that suddenly no longer wants to go that way.

export const meta = {
  id: 'dotreturn',
  title: 'Dot Return',
  players: { min: 1, max: 4 },
  color: '#e9e4d8',
  icon: '⚪',
  desc: 'Swipe to steer a slow dot around a centre you cannot see — every time it drifts home it picks a new direction.',
  soloable: true
};

// Geometry is in fractions of the shorter side of the field, which is what the
// original full-screen prototype meant by vmin.
const R = 0.03;          // radius of the hidden circle the dot must stay inside
const V = 0.002;         // drift speed, per second
const DURATION = 120;    // round length, seconds
const DT = 1 / 60;       // fixed integration step
const MAX_STEPS = 8;     // catch-up cap, so a backgrounded tab cannot spiral

// "Back at the centre" is a tolerance, not a point: a dot that clips past the
// exact middle still counts, and the wider release stops it oscillating on the
// boundary and rerolling over and over.
const CENTER = R * 0.2;
const CENTER_RELEASE = R * 0.35;

const REROLL_CD = 300;      // host-side floor between two rerolls for one dot
const REROLL_RETRY = 400;  // client-side re-ask, must exceed REROLL_CD
const FINISH_GRACE = 1000; // clock skew allowance when ending the round
const SHOW_CIRCLE = 0;     // 1 reveals the hidden circle while tuning

const PALETTE = ['#e9e4d8', '#7dd3fc', '#a3e635', '#fbbf24'];
const BEST_KEY = 'dotreturn.best.v2';
const MAX_DOTS = 4;

// ---------------------------------------------------------------- state ----

function freshState() {
  return {
    epoch: 0,               // bumped per round; clients re-anchor their sim on it
    phase: 'ready',         // 'ready' | 'play' | 'over'
    endsAt: 0,
    duration: DURATION,
    returns: 0,             // one group tally, summed over every dot
    players: [],
    dots: {},               // id -> { a, out, lastReroll }
    over: null
  };
}

function seatIds(seats) {
  const ids = [];
  (seats || []).forEach(function (m) {
    if (m && m.id && ids.indexOf(m.id) < 0 && ids.length < MAX_DOTS) ids.push(m.id);
  });
  return ids;
}

export function init(ctx) {
  const st = freshState();
  st.players = seatIds(ctx && ctx.seats);
  st.players.forEach(function (id) {
    st.dots[id] = { a: 0, out: false, lastReroll: 0 };
  });
  return st;
}

// --------------------------------------------------------------- reduce ----

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const rng = (ctx && ctx.rng) || Math.random;
  const id = from.id || '';
  const kind = (action && action.a) || '';
  const now = Date.now();

  const players = state.players.slice();
  const dots = Object.assign({}, state.dots);
  const same = function (extra) { return Object.assign({}, state, extra); };

  if (!id) return { error: 'No identity — reopen the game.' };

  // Someone opened the table while a round was already running. They join at
  // the centre with a fresh heading, which is the same thing the game does to
  // a dot that drifts home.
  if (kind === 'join') {
    if (players.indexOf(id) >= 0) return same({ dots: dots });
    if (players.length >= MAX_DOTS) return { error: 'Dot Return holds four dots.' };
    players.push(id);
    dots[id] = { a: rng() * Math.PI * 2, out: false, lastReroll: 0 };
    return same({ players: players, dots: dots });
  }

  const mine = dots[id];
  if (players.indexOf(id) < 0 || !mine) return { error: 'You are watching — not seated.' };

  if (kind === 'start') {
    if (state.phase === 'play') return { error: 'A round is already running.' };
    players.forEach(function (pid) {
      dots[pid] = { a: rng() * Math.PI * 2, out: false, lastReroll: 0 };
    });
    return same({
      epoch: state.epoch + 1,
      phase: 'play',
      endsAt: now + state.duration * 1000,
      returns: 0,
      over: null,
      players: players,
      dots: dots
    });
  }

  if (kind === 'finish') {
    if (state.phase !== 'play') return same({});
    if (now < state.endsAt - FINISH_GRACE) return { error: 'The clock is still running.' };
    return same({ phase: 'over', over: { returns: state.returns }, dots: dots });
  }

  if (state.phase !== 'play') return { error: 'Wait for the next round.' };

  if (kind === 'swipe') {
    const ang = Number(action.ang);
    if (!isFinite(ang)) return { error: 'A swipe needs a direction.' };
    dots[id] = Object.assign({}, mine, { a: ang });
    return same({ dots: dots });
  }

  if (kind === 'reroll') {
    // The cooldown is the only brake on this, because the client has to be able
    // to re-ask after a dropped or slow answer.
    if (now - (mine.lastReroll || 0) < REROLL_CD) return same({ dots: dots });
    dots[id] = Object.assign({}, mine, { a: rng() * Math.PI * 2, lastReroll: now });
    return same({ dots: dots });
  }

  if (kind === 'exit') {
    // Latched, so a client that re-reports a crossing cannot inflate the tally.
    if (mine.out) return same({ dots: dots });
    dots[id] = Object.assign({}, mine, { out: true });
    return same({ dots: dots, returns: state.returns + 1 });
  }

  if (kind === 'in') {
    if (!mine.out) return same({ dots: dots });
    dots[id] = Object.assign({}, mine, { out: false });
    return same({ dots: dots });
  }

  return { error: 'Unknown action: ' + kind };
}

// -------------------------------------------------------------- project ----

export function project(state, playerId) {
  // The whole point of the round is the reveal, so the tally simply is not in
  // the snapshot until the clock runs out.
  const hidden = state.phase !== 'over';
  return Object.assign({}, state, {
    you: playerId || '',
    returns: hidden ? null : state.returns,
    over: hidden ? null : state.over
  });
}

// ------------------------------------------------------------ summarize ----

export function summarize(state, nameOf) {
  if (state.phase !== 'over' || !state.over) return null;
  const n = state.over.returns;
  const who = state.players.map(function (id) { return nameOf(id); })
    .filter(function (w) { return !!w; });
  // Same 'A and B' / 'A, B and C' join the record sheet uses elsewhere.
  const names = who.length === 2 ? who[0] + ' and ' + who[1]
    : (who.length > 2 ? who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1]
      : (who[0] || 'Someone'));
  return names + ' held the dot for ' + state.duration + 's — ' +
    n + (n === 1 ? ' return' : ' returns');
}

// ----------------------------------------------------------------- mount ----

const CSS = [
  '.dr-wrap{position:absolute;inset:0;display:flex;flex-direction:column;',
  'overflow:hidden;background:#15181d;color:#8b8f98;',
  'font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}',
  '.dr-field{position:relative;flex:1;overflow:hidden;touch-action:none;cursor:crosshair}',
  '.dr-ring{position:absolute;left:50%;top:50%;border:1px solid rgba(255,255,255,.25);',
  'border-radius:50%;display:none;pointer-events:none}',
  '.dr-dot{position:absolute;left:0;top:0;width:10px;height:10px;border-radius:50%;',
  'transform:translate(-50%,-50%);will-change:transform}',
  '.dr-tag{position:absolute;left:0;top:0;font-size:11px;letter-spacing:.02em;',
  'opacity:.6;transform:translate(-50%,7px);white-space:nowrap;pointer-events:none}',
  '.dr-hud{position:absolute;top:0;left:0;padding:14px 18px;pointer-events:none}',
  '.dr-time{font-size:1.15rem;font-weight:600;color:#e9e4d8}',
  '.dr-meta{margin-top:2px;font-size:11px;opacity:.65}',
  '.dr-overlay{position:absolute;inset:0;display:flex;flex-direction:column;',
  'align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;',
  'background:rgba(21,24,29,.94)}',
  '.dr-overlay[hidden]{display:none}',
  '.dr-title{margin:0;font-size:1.7rem;font-weight:600;color:#e9e4d8}',
  '.dr-body{max-width:23rem;margin:0}',
  '.dr-num{font-size:2.4rem;font-weight:700;color:#e9e4d8}',
  '.dr-btn{font:inherit;font-weight:600;font-size:1rem;padding:12px 34px;min-height:44px;',
  'border:0;border-radius:8px;background:#e9e4d8;color:#15181d;cursor:pointer}',
  '.dr-btn:disabled{opacity:.4;cursor:default}',
  '.dr-note{font-size:.9rem;color:#a3a8b0;margin:0}',
  '.dr-hi{color:#e9e4d8;font-weight:600}'
].join('');

function readBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw === null ? null : parseInt(raw, 10);
  } catch (e) {
    return null;
  }
}

function saveBest(n) {
  try {
    const b = readBest();
    if (b === null || n < b) localStorage.setItem(BEST_KEY, String(n));
  } catch (e) { /* incognito */ }
}

export function mount(root, api) {
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'dr-wrap';
  wrap.innerHTML =
    '<div class="dr-field"><div class="dr-ring"></div></div>' +
    '<div class="dr-hud"><div class="dr-time">120s</div><div class="dr-meta"></div></div>' +
    '<div class="dr-overlay"><h1 class="dr-title">Dot Return</h1>' +
    '<p class="dr-body"></p><p class="dr-num" hidden></p><p class="dr-note"></p>' +
    '<button class="dr-btn" type="button">Start</button></div>';
  root.appendChild(wrap);

  const field = wrap.querySelector('.dr-field');
  const ring = wrap.querySelector('.dr-ring');
  const hudTime = wrap.querySelector('.dr-time');
  const hudMeta = wrap.querySelector('.dr-meta');
  const overlay = wrap.querySelector('.dr-overlay');
  const ovTitle = wrap.querySelector('.dr-title');
  const ovBody = wrap.querySelector('.dr-body');
  const ovNum = wrap.querySelector('.dr-num');
  const ovNote = wrap.querySelector('.dr-note');
  const btn = wrap.querySelector('.dr-btn');

  const dotEls = {};   // playerId -> { dot, tag }
  const names = {};    // playerId -> display name

  let view = null;
  let myId = (api.me && api.me.id) || '';
  let unit = 100, w = 0, h = 0;

  // The simulation is deliberately not the view: it is integrated locally and
  // only ever corrected from authoritative headings and a new epoch.
  const sim = { epoch: -1, last: 0, acc: 0, dots: {} };
  let rafId = null;
  let running = false;
  let askedFinish = false;
  let pendingReroll = false;
  let lastRerollReq = 0;
  let latched = false;
  let localOut = false;
  let scoredEpoch = -1;
  let joined = false;

  (api.roster || []).forEach(function (m) { names[m.id] = m.name; });

  function measure() {
    w = field.clientWidth || 300;
    h = field.clientHeight || 300;
    unit = Math.min(w, h);
    if (SHOW_CIRCLE) {
      ring.style.display = 'block';
      ring.style.width = R * 2 * unit + 'px';
      ring.style.height = R * 2 * unit + 'px';
      ring.style.transform = 'translate(-50%,-50%)';
    }
  }

  function resetSim() {
    sim.epoch = view.epoch;
    sim.acc = 0;
    sim.dots = {};
    (view.players || []).forEach(function (id) {
      const d = view.dots[id] || {};
      sim.dots[id] = { x: 0, y: 0, a: d.a || 0 };
    });
    askedFinish = false;
    pendingReroll = false;
    latched = false;
    localOut = false;
  }

  function startLoop() {
    if (running) return;
    running = true;
    sim.last = 0;
    rafId = api.raf(frame);
  }

  function stopLoop() {
    running = false;
    if (rafId === null) return;
    api.cancelRaf(rafId);
    rafId = null;
  }

  function frame(now) {
    rafId = null;
    advance(now);
    render();
    // `running`, not rafId, is the guard: advance() can send an intent, which
    // comes straight back through update() mid-frame, and a null-check here
    // would let that nested start() add a second loop.
    if (running && view && view.phase === 'play') rafId = api.raf(frame);
  }

  function advance(now) {
    if (!view || view.phase !== 'play') return;
    if (view.epoch !== sim.epoch) { resetSim(); sim.last = now; return; }

    const dt = sim.last ? Math.min(0.25, (now - sim.last) / 1000) : 0;
    sim.last = now;

    // A dot that appears mid-round (someone opened the table late) starts at
    // the centre with whatever heading the host gave it.
    (view.players || []).forEach(function (id) {
      if (sim.dots[id]) return;
      const d = view.dots[id] || {};
      sim.dots[id] = { x: 0, y: 0, a: d.a || 0 };
    });

    // Authoritative headings win over anything integrated locally.
    (view.players || []).forEach(function (id) {
      const s = sim.dots[id];
      const d = view.dots[id];
      if (!s || !d || d.a === s.a) return;
      s.a = d.a;
      if (id === myId && pendingReroll) {
        pendingReroll = false;
        latched = true; // it answered; don't ask again while still inside
      }
    });

    sim.acc += dt;
    let steps = 0;
    while (sim.acc >= DT && steps < MAX_STEPS) {
      sim.acc -= DT;
      steps++;
      Object.keys(sim.dots).forEach(function (id) {
        const s = sim.dots[id];
        s.x += Math.cos(s.a) * V * DT;
        s.y += Math.sin(s.a) * V * DT;
      });
    }
    if (steps >= MAX_STEPS) sim.acc = 0;

    // Only your own dot reports. Everyone renders it; only its owner decides
    // when it has drifted home or left the circle.
    const mine = sim.dots[myId];
    if (mine) {
      const dist = Math.hypot(mine.x, mine.y);
      if (dist > CENTER_RELEASE) { latched = false; pendingReroll = false; }
      if (!latched && !pendingReroll && dist <= CENTER && now - lastRerollReq > REROLL_RETRY) {
        lastRerollReq = now;
        pendingReroll = true;
        api.send({ a: 'reroll' });
      }
      const out = dist > R;
      if (out !== localOut) {
        localOut = out;
        api.send({ a: out ? 'exit' : 'in' });
      }
    }

    const left = Math.max(0, (view.endsAt - Date.now()) / 1000);
    hudTime.textContent = Math.ceil(left) + 's';
    if (left <= 0 && !askedFinish) {
      askedFinish = true;
      api.send({ a: 'finish' });
    }
  }

  function dotFor(id) {
    let els = dotEls[id];
    if (!els) {
      const dot = document.createElement('div');
      dot.className = 'dr-dot';
      const tag = document.createElement('div');
      tag.className = 'dr-tag';
      field.appendChild(dot);
      field.appendChild(tag);
      els = dotEls[id] = { dot: dot, tag: tag };
    }
    return els;
  }

  function render() {
    if (!view) return;
    const cx = w / 2;
    const cy = h / 2;
    const list = view.players || [];
    Object.keys(dotEls).forEach(function (id) {
      // someone left the table: stop painting their dot
      if (list.indexOf(id) < 0) dotEls[id].dot.style.display = 'none';
    });
    list.forEach(function (id, i) {
      const els = dotFor(id);
      const s = sim.dots[id] || { x: 0, y: 0 };
      const colour = PALETTE[i % PALETTE.length];
      const px = cx + s.x * unit;
      const py = cy + s.y * unit;
      els.dot.style.display = view.phase === 'play' ? 'block' : 'none';
      els.dot.style.transform = 'translate(' + px + 'px,' + py + 'px) translate(-50%,-50%)';
      els.dot.style.background = colour;
      els.tag.style.transform = 'translate(' + px + 'px,' + py + 'px) translate(-50%,7px)';
      els.tag.style.color = colour;
      els.tag.textContent = (id === myId ? 'you' : (names[id] || 'player'));
    });
  }

  function renderChrome() {
    if (!view) return;
    const playing = view.phase === 'play';
    overlay.hidden = playing;
    hudTime.parentNode.style.visibility = playing ? 'visible' : 'hidden';

    const list = (view.players || []).map(function (id) {
      return id === myId ? 'you' : (names[id] || 'a player');
    });
    const solo = list.length <= 1;
    hudMeta.textContent = playing
      ? (solo ? 'keep it inside' : 'table: ' + list.join(', '))
      : '';

    const seated = list.indexOf('you') >= 0;
    btn.disabled = !seated;
    btn.textContent = view.phase === 'over' ? 'Play Again' : 'Start';

    if (playing) return;

    if (view.phase === 'over') {
      const n = view.returns;
      ovTitle.textContent = solo ? 'Round Over' : 'Table Round Over';
      ovBody.innerHTML = 'The dot stayed out of the ring for <span class="dr-hi">' +
        view.duration + ' seconds</span>, and the group returned it <span class="dr-hi">' +
        n + '</span> time' + (n === 1 ? '' : 's') + '.';
      ovNum.hidden = false;
      ovNum.textContent = String(n);
      const best = readBest();
      ovNote.textContent = !seated
        ? '👁 watching — you are not seated at this table'
        : (solo
          ? (best === null ? 'your best is still unwritten'
            : (n <= best ? 'a new personal best'
              : 'personal best: ' + best + (best === 1 ? ' return' : ' returns')))
          : '');
      if (solo && view.epoch !== scoredEpoch) {
        scoredEpoch = view.epoch;
        saveBest(n);
      }
      return;
    }

    ovTitle.textContent = 'Dot Return';
    ovBody.innerHTML = 'Keep a slow dot inside a circle you cannot see.<br>' +
      'Swipe anywhere to redirect the drift.<br>' +
      'Each time it drifts back to dead centre it picks a <span class="dr-hi">new direction</span>.<br>' +
      'The group tally is revealed when the ' + view.duration + 's clock runs out.<br>' +
      'Goal: <span class="dr-hi">fewest returns.</span>';
    ovNum.hidden = true;
    const best = readBest();
    ovNote.textContent = seated
      ? (best === null ? '' : 'personal best: ' + best + (best === 1 ? ' return' : ' returns'))
      : '👁 watching — you are not seated at this table';
  }

  // ---- input -------------------------------------------------------------
  let sx = 0, sy = 0, tracking = false;

  field.addEventListener('pointerdown', function (e) {
    if (!view || view.phase !== 'play') return;
    tracking = true;
    sx = e.clientX;
    sy = e.clientY;
    try { field.setPointerCapture(e.pointerId); } catch (err) {}
  });

  field.addEventListener('pointerup', function (e) {
    if (!tracking || !view || view.phase !== 'play') return;
    tracking = false;
    try { field.releasePointerCapture(e.pointerId); } catch (err) {}
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    // Direction only — length is ignored, and a tap is not a swipe.
    if (Math.hypot(dx, dy) > 9) api.send({ a: 'swipe', ang: Math.atan2(dy, dx) });
  });

  field.addEventListener('pointercancel', function () { tracking = false; });
  field.addEventListener('contextmenu', function (e) { e.preventDefault(); });

btn.addEventListener('click', function () {
    if (!view || view.phase === 'play') return;
    if ((view.players || []).indexOf(myId) < 0) return;
    api.send({ a: 'start' });
  });

  // ---- sizing ------------------------------------------------------------
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(function () { measure(); render(); });
    ro.observe(field);
  }
  window.addEventListener('resize', onResize);
  function onResize() { measure(); render(); }
  measure();

  return {
    update: function (next) {
      if (!next) return;
      view = next;
      if (typeof next.you === 'string' && next.you) myId = next.you;
      (api.roster || []).forEach(function (m) { names[m.id] = m.name; });
      measure();
      // A new epoch means a new round: re-anchor the sim from the host's
      // headings rather than correcting into the previous round's positions.
      if (next.epoch !== sim.epoch) {
        stopLoop();
        resetSim();
        if (next.phase === 'play') startLoop();
      } else if (next.phase === 'play') {
        startLoop();
      } else {
        stopLoop();
      }
      renderChrome();
      render();
      // init() seats whoever was in the room when the table was created, so
      // this is how somebody who opened it later gets a dot mid-round. It waits
      // for the first update() because a send from inside mount() comes back
      // before the hub has even assigned the handle to route it. A spectator
      // must not ask — read-only has to mean read-only — and the hub hands
      // reduce() no seat map, so this guard is all there is.
      if (!joined && !api.isSpectator) {
        joined = true;
        api.send({ a: 'join' });
      }
    },
    destroy: function () {
      stopLoop();
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onResize);
      Object.keys(dotEls).forEach(function (id) { delete dotEls[id]; });
    }
  };
}