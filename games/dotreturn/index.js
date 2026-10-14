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
// Tuning: R/V = 4.0s for dot to leave circle with no input (V = R/4).
// R=0.036 gives ~14.04px radius on 390px viewport; V=0.009 gives ~3.51px/s.
const R = 0.036;          // radius of the hidden circle the dot must stay inside
const V = 0.009;        // drift speed, per second (kept consistent with R/V=4.0)
const DURATION = 120;    // round length, seconds
const DT = 1 / 60;       // fixed integration step
const MAX_STEPS = 8;     // catch-up cap, so a backgrounded tab cannot spiral

// "Back at the centre" is a tolerance, not a point: a dot that clips past the
// exact middle still counts, and the wider release stops it oscillating on the
// boundary and rerolling over and over.
const CENTER = R * 0.15;
const CENTER_RELEASE = R * 0.35;

const REROLL_CD = 300;      // host-side floor between two rerolls for one dot
const REROLL_RETRY = 400;  // client-side re-ask, must exceed REROLL_CD
const FINISH_GRACE = 1000; // clock skew allowance when ending the round
const SHOW_CIRCLE = 0;     // 1 reveals the hidden circle while tuning
const REVEAL_TIME = 3000;  // 3s reveal before clock starts

// One dot is on screen and it is always yours, so there is nothing to
// colour-match against. The palette went when the other dots did.
const BEST_KEY = 'dotreturn.best.v2';
const MAX_DOTS = 4;

// ---------------------------------------------------------------- state ----

function freshState() {
  return {
    epoch: 0,               // bumped per round; clients re-anchor their sim on it
    phase: 'ready',         // 'ready' | 'reveal' | 'play' | 'running' | 'over'
    endsAt: 0,
    revealEndsAt: 0,
    duration: DURATION,
    returns: 0,             // one group tally, summed over every dot
    players: [],
    hostId: '',             // owns starting a round; you in the solo corner
    solo: false,            // was the round just played one player? frozen at start
    table: [],              // who was actually at the table when it started
    dots: {},               // id -> { a, out, lastReroll }
    over: null
  };
}

// The hub hands init() the whole room roster under `seats`, which is not who is
// at this table — `atTable` is. Prefer it, and skip spectators wherever we are
// given a list of members, because a watcher with a dot is worse than no lobby.
function tableOf(ctx) {
  const c = ctx || {};
  const list = c.atTable || c.seats || [];
  const ids = [];
  list.forEach(function (m) {
    if (!m || !m.id || m.spectator) return;
    if (ids.indexOf(m.id) < 0 && ids.length < MAX_DOTS) ids.push(m.id);
  });
  return ids;
}

export function init(ctx) {
  const st = freshState();
  st.players = tableOf(ctx);
  st.hostId = st.players[0] || '';
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
  //
  // The epoch bump is load-bearing: clients only re-anchor their simulation
  // when it moves, so without it the newcomer's dot integrates from x=0 on
  // every client while the host's authoritative heading is ignored, and it
  // never lines up with anyone else's picture.
  if (kind === 'join') {
    if (players.indexOf(id) >= 0) return same({ dots: dots });
    if (players.length >= MAX_DOTS) return { error: 'Dot Return holds four dots.' };
    players.push(id);
    dots[id] = { a: rng() * Math.PI * 2, out: false, lastReroll: 0 };
    return same({ epoch: state.epoch + 1, players: players, dots: dots });
  }

  const mine = dots[id];
  if (players.indexOf(id) < 0 || !mine) return { error: 'You are watching — not seated.' };

  if (kind === 'start') {
    // A round can be begun from the lobby or replayed from the results screen.
    // Otherwise `over` is terminal and the table is stuck until the host acts.
    if (state.phase === 'play' || state.phase === 'reveal') return { error: 'A round is already running.' };
    if (state.phase !== 'ready' && state.phase !== 'over') {
      return { error: 'Wait for the next round.' };
    }
    // Host owns the room. The exception is a table of one: whoever is left
    // holding it may play, which is what makes "Start solo" real and stops the
    // solo corner from needing a room at all. Tested against the live roster
    // rather than `state.solo`, which is a record of the round just played.
    const alone = players.length < 2;
    if (state.hostId && state.hostId !== id && !alone) {
      return { error: 'Waiting for the host to start the round.' };
    }
    players.forEach(function (pid) {
      dots[pid] = { a: rng() * Math.PI * 2, out: false, lastReroll: 0 };
    });
    return same({
      epoch: state.epoch + 1,
      phase: 'reveal',
      revealEndsAt: now + REVEAL_TIME,
      endsAt: now + REVEAL_TIME + state.duration * 1000,
      returns: 0,
      over: null,
      solo: alone,
      table: players.slice(),
      players: players,
      dots: dots
    });
  }

  if (kind === 'finish') {
    if (state.phase !== 'play') return same({});
    if (now < state.endsAt - FINISH_GRACE) return { error: 'The clock is still running.' };
    return same({ phase: 'over', over: { returns: state.returns }, dots: dots });
  }

  if (kind === 'revealend') {
    if (state.phase !== 'reveal') return same({});
    return same({ phase: 'play' });
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
  // `table`, not `players`: the roster carries everyone in the room, and a
  // record line that thanks the whole lobby for a two-person game is a lie.
  const ids = (state.table && state.table.length) ? state.table : state.players;
  const who = (ids || []).map(function (id) { return nameOf(id); })
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
  '.dr-centre{position:absolute;left:50%;top:50%;border:1px solid rgba(255,255,255,.4);',
  'border-radius:50%;display:none;pointer-events:none}',
  '.dr-dot{position:absolute;left:0;top:0;width:10px;height:10px;border-radius:50%;',
  // Its own colour, not one picked per player from a palette at paint time:
  // when PALETTE went with the other dots, this rule inherited nothing and the
  // dot shipped as a transparent box — present, moving, and invisible.
  'background:#e9e4d8;',
  'transform:translate(-50%,-50%);will-change:transform}',
  '.dr-hud{position:absolute;top:0;left:0;padding:14px 18px;pointer-events:none}',
  '.dr-time{font-size:1.15rem;font-weight:600;color:#e9e4d8}',
  '.dr-meta{margin-top:2px;font-size:11px;opacity:.65}',
  // The one thing a watcher most needs to know, and must not have to guess.
  '.dr-hud.watching .dr-time{color:#fbbf24;letter-spacing:.18em;font-size:.95rem}',
  '.dr-hud.watching .dr-meta{opacity:.75}',
  '.dr-toast{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:3;',
  'color:#e9e4d8;font-size:0.95rem;opacity:0;transition:opacity 0.15s ease-in-out;',
  'white-space:nowrap;pointer-events:none;will-change:opacity}',
  '.dr-toast.show{opacity:1;transition:opacity 0.1s ease-in-out}',
  '.dr-overlay{position:absolute;inset:0;display:flex;flex-direction:column;',
  'align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;',
  'background:rgba(21,24,29,.94)}',
  '.dr-overlay[hidden]{display:none}',
  '.dr-title{margin:0;font-size:1.7rem;font-weight:600;color:#e9e4d8}',
  '.dr-title.observing{color:#fbbf24;letter-spacing:.18em;font-size:1.3rem}',
  '.dr-body{max-width:23rem;margin:0}',
  '.dr-num{font-size:2.4rem;font-weight:700;color:#e9e4d8}',
  '.dr-btns{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}',
  '.dr-btn{font:inherit;font-weight:600;font-size:1rem;padding:12px 34px;min-height:44px;',
  'border:0;border-radius:8px;background:#e9e4d8;color:#15181d;cursor:pointer}',
  '.dr-btn.alt{background:transparent;color:#e9e4d8;box-shadow:inset 0 0 0 1px #3a4048}',
  '.dr-btn:disabled{opacity:.4;cursor:default}',
  // Dots only. The table size is public; who is sitting in it is not our
  // business to paint, and a name here is the one leak the game cannot undo.
  '.dr-table{display:flex;gap:9px;justify-content:center;align-items:center;min-height:16px}',
  '.dr-seat{width:9px;height:9px;border-radius:50%;background:#3a4048}',
  '.dr-seat.on{background:#e9e4d8}',
  '.dr-seat.self{box-shadow:0 0 0 2px #15181d,0 0 0 3px #7dd3fc}',
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
    '<div class="dr-field"><div class="dr-ring"></div><div class="dr-centre"></div><div class="dr-dot" hidden></div></div>' +
    '<div class="dr-hud"><div class="dr-time">120s</div><div class="dr-meta"></div></div><div class="dr-toast"></div>' +
    '<div class="dr-overlay"><h1 class="dr-title">Dot Return</h1>' +
    '<p class="dr-body"></p><p class="dr-num" hidden></p>' +
    '<div class="dr-table" hidden></div>' +
    '<div class="dr-btns"><button class="dr-btn" type="button">Start</button></div>' +
    '<p class="dr-note"></p></div>';
  root.appendChild(wrap);

  const field = wrap.querySelector('.dr-field');
  const ring = wrap.querySelector('.dr-ring');
  const centre = wrap.querySelector('.dr-centre');
  const dotEl = wrap.querySelector('.dr-dot');
  const hud = wrap.querySelector('.dr-hud');
  const hudTime = wrap.querySelector('.dr-time');
  const hudMeta = wrap.querySelector('.dr-meta');
  const toast = wrap.querySelector('.dr-toast');
  const overlay = wrap.querySelector('.dr-overlay');
  const ovTitle = wrap.querySelector('.dr-title');
  const ovBody = wrap.querySelector('.dr-body');
  const ovNum = wrap.querySelector('.dr-num');
  const ovTable = wrap.querySelector('.dr-table');
  const ovNote = wrap.querySelector('.dr-note');
  const btns = wrap.querySelector('.dr-btns');
  const btn = wrap.querySelector('.dr-btn');

  // A second, quieter button: "Start solo" when the host is alone in a room.
  // Without it, being the first one in is a dead end, which is exactly the
  // "it is single player and nothing else" trap.
  const btnSolo = document.createElement('button');
  btnSolo.className = 'dr-btn alt';
  btnSolo.type = 'button';
  btnSolo.textContent = 'Start solo';

  let view = null;
  let myId = (api.me && api.me.id) || '';
  let unit = 100, w = 0, h = 0;

  // The simulation is deliberately not the view: it is integrated locally and
  // only ever corrected from authoritative headings and a new epoch. Every dot
  // is integrated even though only yours is painted — the host has to know
  // where all of them are to count the returns.
  const sim = { epoch: -1, last: 0, acc: 0, dots: {} };
  let rafId = null;
  let running = false;
  let askedFinish = false;
  let askedRevealEnd = false;
  let pendingReroll = false;
  let lastRerollReq = 0;
  let latched = false;
  let localOut = false;
  let scoredEpoch = -1;
  let joined = false;
  let toastTimer = null;

  const soloCorner = !api.isInRoom;

  function updateRings() {
    if (!view) return;
    if (view.phase === 'reveal') {
      ring.style.display = 'block';
      centre.style.display = 'block';
    } else if (view.phase === 'play') {
      ring.style.display = SHOW_CIRCLE ? 'block' : 'none';
      centre.style.display = 'none';
    } else {
      ring.style.display = SHOW_CIRCLE ? 'block' : 'none';
      centre.style.display = 'none';
    }
  }

  function measure() {
    w = field.clientWidth || 300;
    h = field.clientHeight || 300;
    unit = Math.min(w, h);
    ring.style.width = R * 2 * unit + 'px';
    ring.style.height = R * 2 * unit + 'px';
    ring.style.transform = 'translate(-50%,-50%)';
    centre.style.width = CENTER * 2 * unit + 'px';
    centre.style.height = CENTER * 2 * unit + 'px';
    centre.style.transform = 'translate(-50%,-50%)';
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
    askedRevealEnd = false;
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

  function showToast(text) {
    if (!toast) return;
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = text;
    toast.classList.add('show');
    toastTimer = setTimeout(function () {
      toast.classList.remove('show');
      toastTimer = null;
    }, 1200);
  }

  function frame(now) {
    rafId = null;
    advance(now);
    render();
    // `running`, not rafId, is the guard: advance() can send an intent, which
    // comes straight back through update() mid-frame, and a null-check here
    // would let that nested start() add a second loop.
    if (running && view && (view.phase === 'play' || view.phase === 'reveal')) rafId = api.raf(frame);
  }

  function advance(now) {
    if (!view) return;
    if (view.epoch !== sim.epoch) { resetSim(); sim.last = now; return; }

    if (view.phase === 'reveal') {
      if (!askedRevealEnd && Date.now() >= (view.revealEndsAt || 0)) {
        askedRevealEnd = true;
        api.send({ a: 'revealend' });
      }
      sim.last = now;
      if (!sim.dots[myId]) {
        const d = (view.dots && view.dots[myId]) || {};
        sim.dots[myId] = { x: 0, y: 0, a: d.a || 0 };
      }
      const mineR = sim.dots[myId];
      if (mineR && view.revealEndsAt) {
        hudTime.textContent = Math.ceil(view.duration) + 's';
      }
      return;
    }
    if (view.phase !== 'play') return;

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

    // Only your own dot reports. Only your own dot is painted too, but the
    // other dots still have to be integrated or the group tally drifts.
    const mine = sim.dots[myId];
    if (mine) {
      const dist = Math.hypot(mine.x, mine.y);
      if (dist > CENTER_RELEASE) { latched = false; pendingReroll = false; }
      if (!latched && !pendingReroll && dist <= CENTER && now - lastRerollReq > REROLL_RETRY) {
        lastRerollReq = now;
        pendingReroll = true;
        showToast('Dot hit dead center');
        api.send({ a: 'reroll' });
      }
      const out = dist > R;
      if (out !== localOut) {
        localOut = out;
        api.send({ a: out ? 'exit' : 'in' });
      }
    }

    // A watcher's HUD belongs to OBSERVING. Writing the countdown over it 60
    // times a second would replace the one thing that tells them they have no
    // dot — this clock belongs to somebody else's round.
    if (!mine) return;

    let left;
    if (view.phase === 'reveal') {
      left = Math.max(0, ((view.revealEndsAt || Date.now()) - Date.now()) / 1000);
      hudTime.textContent = Math.ceil(left) + 's';
    } else if (view.phase === 'play') {
      left = Math.max(0, (view.endsAt - Date.now()) / 1000);
      hudTime.textContent = Math.ceil(left) + 's';
      if (left <= 0 && !askedFinish) {
        askedFinish = true;
        api.send({ a: 'finish' });
      }
    } else {
      left = Math.max(0, (view.endsAt - Date.now()) / 1000);
      hudTime.textContent = Math.ceil(left) + 's';
    }
  }

  function render() {
    if (!view) return;
    const cx = w / 2;
    const cy = h / 2;
    const list = view.players || [];

    // One dot, yours. The others are integrated in sim.dots so the tally is
    // right, but painting them would leak both the table and the shape of the
    // hidden circle — and a second dot bouncing around is not this game.
    const visible = view.phase === 'play' || view.phase === 'reveal';
    const mine = sim.dots[myId];
    dotEl.hidden = !(visible && mine);
    if (mine) {
      dotEl.style.transform = 'translate(' + (cx + mine.x * unit) + 'px,' +
        (cy + mine.y * unit) + 'px) translate(-50%,-50%)';
    }
  }

  // Are you at the table, or looking at one? Everything on screen branches on
  // this, and it is decided by the state you were actually given a dot in — not
  // by the hub flag, which is only true for an unseatied guest in a room and is
  // false for someone who is seated at a table they did not create.
  function seated() {
    return !!view && (view.players || []).indexOf(myId) >= 0;
  }

  // The host is the id the host side picked when the table was created; fall
  // back to the hub flag for a table that predates this client.
  function iAmHost() {
    if (!view) return false;
    if (view.hostId) return view.hostId === myId;
    return !!api.isHost;
  }

  // Dots only: how many, and which one is you. No names, ever. Empty slots are
  // drawn up to capacity so a lone host can see that room is being made for
  // people without anyone being named.
  function renderSeats(list, show) {
    ovTable.hidden = !show;
    if (!show) return;
    ovTable.innerHTML = '';
    for (let i = 0; i < MAX_DOTS; i++) {
      const id = list[i];
      const d = document.createElement('div');
      d.className = 'dr-seat' + (id ? ' on' : '') + (id === myId ? ' self' : '');
      ovTable.appendChild(d);
    }
  }

  function renderChrome() {
    if (!view) return;
    const playing = view.phase === 'play' || view.phase === 'reveal';
    const inPlay = view.phase === 'play';
    const list = view.players || [];
    const atTable = seated();
    const watching = !atTable;
    const host = iAmHost();
    const n = list.length;
    const alone = n < 2;

    overlay.hidden = playing;

    // OBSERVING is a top-of-screen state in every phase, including mid-round.
    // A watcher who opens a live game previously got no signal at all, and the
    // frozen field just reads as a broken one.
    hud.classList.toggle('watching', watching);
    hud.style.visibility = (playing || watching) ? 'visible' : 'hidden';
    if (watching) {
      hudTime.textContent = 'OBSERVING';
      hudMeta.textContent = n + (n === 1 ? ' dot at the table' : ' dots at the table');
    } else {
      hudMeta.textContent = inPlay ? 'keep it inside' : '';
    }

    ovTitle.classList.toggle('observing', watching);
    renderSeats(list, !playing && !watching);

    // Buttons are rebuilt per render because who may start depends on the
    // table size, which changes while this screen is up.
    btns.innerHTML = '';
    const showStart = !playing && !watching;
    if (showStart) {
      // Mirrors reduce()'s gate exactly: the host, or whoever is left holding a
      // table of one. Testing `view.solo` here instead would be wrong — it is
      // frozen at the last round, so a solo round that someone then joined would
      // hand the button to a guest the host is about to refuse.
      const canStart = host || alone;
      btn.textContent = view.phase === 'over'
        ? (canStart ? 'Play again' : 'Waiting for host')
        : 'Start round';
      btn.disabled = !canStart;
      btns.appendChild(btn);
      // Host, alone, in a room: a table of one is a valid game, so say so
      // rather than greying out the only way forward.
      if (alone && !soloCorner && host && view.phase === 'ready') {
        btnSolo.textContent = 'Start solo round';
        btnSolo.disabled = false;
        btns.appendChild(btnSolo);
      }
    }

    if (inPlay) return;

    if (watching) {
      ovTitle.textContent = 'Observing';
      ovBody.innerHTML = 'Someone else started this round.<br>' +
        'You are watching — your swipe would not move anything, so it is not offered.';
      ovNum.hidden = true;
      ovNote.textContent = n + (n === 1 ? ' player is at' : ' players are at') + ' this table.';
      return;
    }

    if (view.phase === 'over') {
      const t = view.returns;
      ovTitle.textContent = alone ? 'Round Over' : 'Table Round Over';
      ovBody.innerHTML = 'The dot stayed out of the ring for <span class="dr-hi">' +
        view.duration + ' seconds</span>, and the group returned it <span class="dr-hi">' +
        t + '</span> time' + (t === 1 ? '' : 's') + '.';
      ovNum.hidden = false;
      ovNum.textContent = String(t);
      const best = readBest();
      ovNote.textContent = alone
        ? (best === null ? 'your best is still unwritten'
          : (t <= best ? 'a new personal best'
            : 'personal best: ' + best + (best === 1 ? ' return' : ' returns')))
        : '';
      if (alone && view.epoch !== scoredEpoch) {
        scoredEpoch = view.epoch;
        saveBest(t);
      }
      return;
    }

    ovTitle.textContent = 'Dot Return';
    // The old copy said "the group tally" to a lone player in an empty room.
    ovBody.innerHTML = 'Keep a dot inside the invisible circle.<br>' +
      'It is moving.<br>' +
      'Swipe anywhere to redirect the dot.<br>' +
      'You are scored on returns. A return is when the dot returns to the circle after leaving.<br>' +
      'Try to get the fewest possible returns. Groups are all working together against the dot.<br>' +
      'Each member has their own dots and scored are added together. Bigger groups end up with higher numbers.<br>' +
      'Each time it hits dead centre it picks a <span class="dr-hi">new direction</span>.<br>' +
      'The ' + (alone ? 'tally' : 'group tally') + ' is revealed when the ' +
      view.duration + 's clock runs out.<br>' +
      'Goal: <span class="dr-hi">fewest returns.</span>';
    ovNum.hidden = true;
    const best = readBest();
    ovNote.textContent = lobbyNote(host, alone, n, best);
  }

  // The status line wordbridge's statusText() would print: who has to act, and
  // what they are waiting on. Before this, the screen said the same thing to
  // the host of a full table and to a guest who could not press the button.
  function lobbyNote(host, alone, n, best) {
    const personal = best === null ? '' : ' · personal best: ' + best +
      (best === 1 ? ' return' : ' returns');
    if (soloCorner) return 'Solo round — you are the whole table.' + personal;
    if (alone) return host
      ? 'Nobody else has joined yet. Start solo, or wait for players.'
      : 'Waiting for another player to join.';
    if (host) return n + ' at the table' + (n < MAX_DOTS ? ' — invite someone, or start' : ' — table full') + '.';
    return 'Waiting for the host to start the round.';
  }

  // ---- input -------------------------------------------------------------
  let sx = 0, sy = 0, tracking = false;

  // A watcher has no dot, so a swipe from them is a no-op the host will deny.
  // Silently doing nothing beats letting someone drag a dead field and wonder
  // whether the game ate it.
  function canSteer() {
    return !!view && view.phase === 'play' && seated();
  }

  field.addEventListener('pointerdown', function (e) {
    if (!canSteer()) return;
    tracking = true;
    sx = e.clientX;
    sy = e.clientY;
    try { field.setPointerCapture(e.pointerId); } catch (err) {}
  });

  field.addEventListener('pointerup', function (e) {
    if (!tracking || !canSteer()) return;
    tracking = false;
    try { field.releasePointerCapture(e.pointerId); } catch (err) {}
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    // Direction only — length is ignored, and a tap is not a swipe.
    if (Math.hypot(dx, dy) > 9) api.send({ a: 'swipe', ang: Math.atan2(dy, dx) });
  });

  field.addEventListener('pointercancel', function () { tracking = false; });
  field.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // The button's enabled state is cosmetic; reduce() is what actually refuses a
  // guest, so a crafted send() gains nothing by skipping this check.
  function askStart() {
    if (!view || view.phase === 'play' || view.phase === 'reveal') return;
    if (!seated()) return;
    api.send({ a: 'start' });
  }

  btn.addEventListener('click', askStart);
  btnSolo.addEventListener('click', askStart);

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
      const prevPhase = view ? view.phase : null;
      view = next;
      if (typeof next.you === 'string' && next.you) myId = next.you;
      measure();
      // A new epoch means a new round: re-anchor the sim from the host's
      // headings rather than correcting into the previous round's positions.
      if (next.epoch !== sim.epoch) {
        stopLoop();
        resetSim();
        if (next.phase === 'reveal') {
          startLoop();
          askedRevealEnd = false;
        } else if (next.phase === 'play') {
          startLoop();
          showToast('Dot is moving');
        }
      } else if (next.phase === 'reveal') {
        startLoop();
      } else if (next.phase === 'play') {
        startLoop();
        if (prevPhase === 'reveal') showToast('Dot is moving');
      } else {
        stopLoop();
      }
      if (next.phase === 'reveal') hudTime.textContent = Math.ceil(next.duration) + 's';
      updateRings();
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
    }
  };
}
