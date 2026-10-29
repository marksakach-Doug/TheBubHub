// Focus — a module game.
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

// The menu says 2-8, because that is the table size Focus is for — a dot is
// one person, and one person is a solo game, which the Solo Corner already
// lists. Nothing here REFUSES a ninth or tenth dot: it is one more entry in an
// array and one more circle on screen. So the number people read and the number
// the game accepts are deliberately allowed to disagree in the generous
// direction. MAX_DOTS below is the real ceiling.
const MENU_SEATS = 8;

export const meta = {
  id: 'dotreturn',
  title: 'Focus',
  players: { min: 2, max: MENU_SEATS },
  color: '#e9e4d8',
  icon: '⚪',
  desc: 'Swipe to steer a slow dot around a centre you cannot see — every time it drifts home it picks a new direction.',
  soloable: true
};

// Geometry is in fractions of the shorter side of the field, which is what the
// original full-screen prototype meant by vmin.
// Tuning: R/V = 3.0s for dot to leave circle with no input (V = R/3).
// R=0.02484 gives ~9.69px radius on 390px viewport; V=0.00828 gives ~3.23px/s.
// Wind pushes every dot at WIND*V on top of its heading, so the still-dot
// exit time breathes around 3s instead of landing on it.
const R = 0.02484;          // radius of the hidden circle the dot must stay inside
const V = 0.00828;        // drift speed, per second (kept consistent with R/V=3.0)
const WIND = 0.50;        // wind push as a fraction of V; re-rolled every 15-25s
const DURATION = 70;    // round length, seconds
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
const FINISH_RETRY = 1500; // client-side re-ask floor between two `finish` intents
const SHOW_CIRCLE_KEY = 'dotreturn.showCircle';
let showCircle = true;     // show the circle; on by default
try { const raw = localStorage.getItem(SHOW_CIRCLE_KEY); if (raw !== null) showCircle = raw !== '0'; } catch (e) {}
const REVEAL_TIME = 3000;  // 3s reveal before clock starts

// One dot is on screen and it is always yours, so there is nothing to
// colour-match against. The palette went when the other dots did.
const BEST_KEY = 'dotreturn.best.v3';
const MAX_DOTS = 10;

// ---------------------------------------------------------------- state ----

function freshState() {
  return {
    epoch: 0,               // bumped per round; clients re-anchor their sim on it
    phase: 'ready',         // 'ready' | 'reveal' | 'play' | 'running' | 'over'
    endsAt: 0,
    revealEndsAt: 0,
    duration: DURATION,
    lapses: 0,              // crossings out of the circle, displayed never scored
    players: [],
    hostId: '',             // owns starting a round; you in the solo corner
    solo: false,            // was the round just played one player? frozen at start
    table: [],              // who was actually at the table when it started
    dots: {},               // id -> { a, out, outSince, away, lastReroll, benched }
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

  // Someone opened the table while a round was already running. They are
  // seated, but their dot waits for the next round: handing them a heading
  // now would bump the epoch and re-anchor every running dot back to dead
  // centre, which is the teleport a mid-round join used to cause.
  if (kind === 'join') {
    if (players.indexOf(id) >= 0) return same({ dots: dots });
    if (players.length >= MAX_DOTS) return { error: 'Focus holds ' + MAX_DOTS + ' dots.' };
    players.push(id);
    const live = state.phase === 'play' || state.phase === 'reveal';
    dots[id] = live
      ? { a: 0, out: false, outSince: null, away: 0, lastReroll: 0, benched: true }
      : { a: rng() * Math.PI * 2, out: false, outSince: null, away: 0, lastReroll: 0, benched: false };
    return same({
      epoch: live ? state.epoch : state.epoch + 1,
      players: players,
      dots: dots
    });
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
      // A new round unbenches everyone: anyone who waited out the last one
      // joins the motion from dead centre with the rest of the table. Away
      // time and lapses reset with it — the score belongs to one round.
      dots[pid] = { a: rng() * Math.PI * 2, out: false, outSince: null, away: 0, lastReroll: 0, benched: false };
    });
    return same({
      epoch: state.epoch + 1,
      phase: 'reveal',
      revealEndsAt: now + REVEAL_TIME,
      endsAt: now + REVEAL_TIME + state.duration * 1000,
      lapses: 0,
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
    // Close any interval still open at the clock, not at now: a dot that was
    // out when time expired was away until then, however late finish arrives.
    // A dropped player's dot freezes where it was, and this is what settles
    // it — out means away until the end, in means nothing more accrues.
    const end = Math.min(now, state.endsAt);
    Object.keys(dots).forEach(function (pid) {
      const d = dots[pid];
      if (d && d.out && d.outSince !== null && d.outSince !== undefined) {
        dots[pid] = Object.assign({}, d, {
          away: d.away + Math.max(0, end - d.outSince),
          out: false,
          outSince: null
        });
      }
    });
    let away = 0;
    Object.keys(dots).forEach(function (pid) {
      away += (dots[pid] && dots[pid].away) || 0;
    });
    const table = (state.table && state.table.length) ? state.table : players;
    const n = table.length || 1;
    // perPlayer is seconds to one decimal: the headline number, and the saved
    // best. Divided by the frozen table, not the live roster, so a benched
    // mid-round joiner is never counted.
    const perPlayer = Math.round((away / 1000 / n) * 10) / 10;
    // Who played, in seat order, for the results screen. This is a ROSTER, not
    // a ranking: Focus has one shared team score and the per-dot times stay
    // hidden even now that the round is over, because the times would reveal
    // where the circle was. So nobody's own number is on the board.
    const rows = table.map(function (id) {
      return { id: id, away: Math.round(((dots[id] && dots[id].away) || 0) / 100) / 10 };
    });
    return same({
      phase: 'over',
      over: {
        away: away, lapses: state.lapses, players: table.length,
        perPlayer: perPlayer, duration: state.duration, rows: rows
      },
      dots: dots
    });
  }

  if (kind === 'revealend') {
    if (state.phase !== 'reveal') return same({});
    return same({ phase: 'play' });
  }

  // A benched dot joined mid-round and waits for the next one. It must not
  // steer, reroll, or touch the tally in this one — start/finish above still
  // apply, so the table is never stuck waiting on someone who cannot act.
  if (mine.benched) return { error: 'Your dot starts with the next round.' };

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
    // Latched, so a client that re-reports a crossing cannot inflate the
    // count. Lapses are displayed, never scored — the score is away time.
    if (mine.out) return same({ dots: dots });
    dots[id] = Object.assign({}, mine, { out: true, outSince: Math.min(now, state.endsAt) });
    return same({ dots: dots, lapses: state.lapses + 1 });
  }

  if (kind === 'in') {
    if (!mine.out) return same({ dots: dots });
    const since = (mine.outSince !== null && mine.outSince !== undefined) ? mine.outSince : now;
    dots[id] = Object.assign({}, mine, {
      out: false,
      outSince: null,
      away: (mine.away || 0) + Math.max(0, Math.min(now, state.endsAt) - since)
    });
    return same({ dots: dots });
  }

  return { error: 'Unknown action: ' + kind };
}

// -------------------------------------------------------------- project ----

export function project(state, playerId, api) {
  // The whole point of the round is the reveal, so the score simply is not in
  // the snapshot until the clock runs out. Dots are stripped to heading and
  // bench flag: everyone's `out` flag, and now `away`, would otherwise leak
  // the shape of the hidden circle to the whole table mid-round.
  const hidden = state.phase !== 'over';
  const dots = {};
  Object.keys(state.dots || {}).forEach(function (id) {
    const d = state.dots[id] || {};
    dots[id] = { a: d.a, benched: !!d.benched };
  });
  return Object.assign({}, state, {
    you: playerId || '',
    dots: dots,
    lapses: hidden ? null : state.lapses,
    over: hidden ? null : state.over,
    // The results screen needs names, and the hub's roster is the only place
    // they live — so the client resolves them through api.roster. Mid-round
    // the ids below are already in state.players and get projected as-is, so
    // this leaks nothing the table did not already know.
    roster: (api && api.roster) || null
  });
}

// ---------------------------------------------------------------- summarize ----

// A stable id for the round `state` is currently in. The hub uses this as the
// record's dedupe key instead of the sentence: summarize() re-succeeds on every
// reduce() once the phase is `over`, so keying on the text either needs a
// throttle that throws away genuinely distinct identical rounds, or writes the
// same round to the sheet over and over.
export function roundId(state) {
  return 'e' + ((state && state.epoch) || 0);
}

export function summarize(state, nameOf) {
  if (state.phase !== 'over' || !state.over) return null;
  // `table`, not `players`: the roster carries everyone in the room, and a
  // record line that thanks the whole lobby for a two-person game is a lie.
  const ids = (state.table && state.table.length) ? state.table : state.players;
  const who = (ids || []).map(function (id) { return nameOf(id); })
    .filter(function (w) { return !!w; });
  // Same 'A and B' / 'A, B and C' join the record sheet uses elsewhere.
  const names = who.length === 2 ? who[0] + ' and ' + who[1]
    : (who.length > 2 ? who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1]
      : (who[0] || 'Someone'));
  const n = Number(state.over.perPlayer || 0).toFixed(1);
  // One player simply let it get away; two or more share the average.
  // "let" is past tense for every subject, so no singular branch is needed.
  return who.length < 2
    ? names + ' let the dot get away for ' + n + ' seconds'
    : names + ' let the dot get away for an average of ' + n + ' seconds';
}

// ----------------------------------------------------------------- mount ----

const CSS = [
  '.dr-wrap{position:absolute;inset:0;display:flex;flex-direction:column;',
  'overflow:hidden;background:#15181d;color:#8b8f98;',
  // A stray thumb on the phone selects text instead of steering. Each line
  // below kills a different failure: standard selection, the iOS prefixed
  // form, the long-press callout popup, and the grey tap flash.
  'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;',
  '-webkit-tap-highlight-color:transparent;',
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
  // The reveal banner sits directly above the circle: the round countdown on
  // top, the one instruction beneath it. Shown to everyone, like the ring.
  '.dr-reveal{position:absolute;left:50%;transform:translateX(-50%);display:none;',
  'flex-direction:column;align-items:center;gap:6px;text-align:center;',
  'pointer-events:none;z-index:2}',
  '.dr-count{font-size:1.6rem;font-weight:700;color:#e9e4d8}',
  '.dr-say{font-size:.95rem;color:#e9e4d8}',
  '.dr-overlay{position:absolute;inset:0;display:flex;flex-direction:column;',
  'align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;',
  'background:rgba(21,24,29,.94)}',
  '.dr-overlay[hidden]{display:none}',
  '.dr-title{margin:0;font-size:1.7rem;font-weight:600;color:#e9e4d8}',
  '.dr-title.observing{color:#fbbf24;letter-spacing:.18em;font-size:1.3rem}',
  '.dr-body{max-width:23rem;margin:0}',
  '.dr-num{font-size:2.4rem;font-weight:700;color:#e9e4d8}',
  // The results screen reads a full sentence, not a bare number, so it drops
  // to body size with only the seconds emphasized.
  '.dr-num.long{font-size:1.15rem;font-weight:400;line-height:1.5;max-width:24rem}',
  '.dr-num.long .dr-hi{font-size:2rem;font-weight:700}',
  '.dr-btns{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}',
  '.dr-btn{font:inherit;font-weight:600;font-size:1rem;padding:12px 34px;min-height:44px;',
  'border:0;border-radius:8px;background:#e9e4d8;color:#15181d;cursor:pointer}',
  '.dr-btn.alt{background:transparent;color:#e9e4d8;box-shadow:inset 0 0 0 1px #3a4048}',
  '.dr-btn:disabled{opacity:.4;cursor:default}',
  // Dots only DURING a round: the table size is public, but who is sitting in
  // it is not our business to paint mid-round. Once the clock has run out there
  // is nothing left to protect, so the results screen names everyone (dr-board).
  '.dr-table{display:flex;gap:9px;justify-content:center;align-items:center;min-height:16px}',
  '.dr-seat{width:9px;height:9px;border-radius:50%;background:#3a4048}',
  '.dr-seat.on{background:#e9e4d8}',
  '.dr-seat.self{box-shadow:0 0 0 2px #15181d,0 0 0 3px #7dd3fc}',
  // The results board: who was at the table, in seat order. No times — Focus
  // has one team score and the per-dot seconds would give the circle away.
  '.dr-board{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center;',
  'max-width:26rem;margin:0 auto;font-size:.95rem;color:#c3c8cf}',
  '.dr-board b{color:#e9e4d8;font-weight:600}',
  '.dr-board .you{color:#7dd3fc}',
  '.dr-note{font-size:.9rem;color:#a3a8b0;margin:0}',
  '.dr-hi{color:#e9e4d8;font-weight:600}'
].join('');

 // Best is per-player away seconds with the table size it was set at, so the
// record reads "best 6.2s, 4 players". Stored as "6.2|4"; parseFloat reads
// the score and ignores the tail, which is why 9.4 survives where parseInt
// truncated it to 9.
function readBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw === null) return null;
    const score = parseFloat(raw);
    if (!isFinite(score)) return null;
    const at = raw.indexOf('|');
    const players = at >= 0 ? parseInt(raw.slice(at + 1), 10) : 1;
    return { score: score, players: players };
  } catch (e) {
    return null;
  }
}

function saveBest(score, players) {
  try {
    const b = readBest();
    if (b === null || score < b.score) {
      localStorage.setItem(BEST_KEY, score.toFixed(1) + '|' + players);
    }
  } catch (e) { /* incognito */ }
}

function bestLine(best) {
  if (!best) return 'your best is still unwritten';
  return 'best ' + best.score.toFixed(1) + 's, ' + best.players +
    (best.players === 1 ? ' player' : ' players');
}

export function mount(root, api) {
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'dr-wrap';
  wrap.innerHTML =
    '<div class="dr-field"><div class="dr-ring"></div><div class="dr-centre"></div>' +
    '<div class="dr-reveal"><div class="dr-count"></div><div class="dr-say">Keep the dot inside this circle.</div></div>' +
    '<div class="dr-dot" hidden></div></div>' +
    '<div class="dr-hud"><div class="dr-time">70s</div><div class="dr-meta"></div></div><div class="dr-toast"></div>' +
    '<div class="dr-overlay"><h1 class="dr-title">Focus</h1>' +
    '<p class="dr-body"></p><p class="dr-num" hidden></p>' +
    '<div class="dr-table" hidden></div>' +
    '<div class="dr-board" hidden></div>' +
    '<div class="dr-btns"><button class="dr-btn" type="button">Start</button></div>' +
    '<label class="dr-showcircle"><input type="checkbox" class="dr-showcircle-box"> show circle</label>' +
    '<p class="dr-note"></p></div>';
  root.appendChild(wrap);

  const field = wrap.querySelector('.dr-field');
  const ring = wrap.querySelector('.dr-ring');
  const centre = wrap.querySelector('.dr-centre');
  const rev = wrap.querySelector('.dr-reveal');
  const count = wrap.querySelector('.dr-count');
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
  const ovBoard = wrap.querySelector('.dr-board');
  const ovNote = wrap.querySelector('.dr-note');
const btns = wrap.querySelector('.dr-btns');
const btn = wrap.querySelector('.dr-btn');
const showCircleBox = wrap.querySelector('.dr-showcircle-box');
if (showCircleBox) {
  showCircleBox.checked = showCircle;
  showCircleBox.addEventListener('change', function () {
    showCircle = !!showCircleBox.checked;
    try { localStorage.setItem(SHOW_CIRCLE_KEY, showCircle ? '1' : '0'); } catch (e) {}
    updateRings();
    render();
  });
}

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
  const sim = { epoch: -1, last: 0, acc: 0, dots: {}, windA: 0, windAt: 0 };
  let rafId = null;
  let running = false;
  let lastFinishReq = 0;
  let endTimer = null;
  let askedRevealEnd = false;
  let pendingReroll = false;
  let lastRerollReq = 0;
  let latched = false;
  let localOut = false;
  let joined = false;
  let toastTimer = null;
  let lastDenied = '';
  let lastDeniedAt = 0;
  let dead = false; // set by destroy(): a dead handle ignores updates and
  // starts no loops, so an intent sent from destroy() cannot re-animate it
  // — or any other dead handle — through the host's broadcast.

  const soloCorner = !api.isInRoom;

  function updateRings() {
    if (!view) return;
    if (view.phase === 'reveal') {
      ring.style.display = 'block';
      centre.style.display = 'block';
      rev.style.display = 'flex';
    } else if (view.phase === 'play') {
      ring.style.display = showCircle ? 'block' : 'none';
      centre.style.display = 'none';
      rev.style.display = 'none';
    } else {
      ring.style.display = showCircle ? 'block' : 'none';
      centre.style.display = 'none';
      rev.style.display = 'none';
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
    // The banner's bottom edge rests on the circle's top edge, at any size.
    rev.style.bottom = (h / 2 + R * unit) + 'px';
  }

  function resetSim() {
    sim.epoch = view.epoch;
    sim.acc = 0;
    sim.dots = {};
    // Every round starts with a fresh hidden wind. It is client-local on
    // purpose: each dot's position is only ever read for its owner's dot
    // (painting and exit/in reporting), so per-client weather can never
    // desync the table — and the host never sees a position at all.
    sim.windA = Math.random() * Math.PI * 2;
    sim.windAt = Date.now() + 15000 + Math.random() * 10000;
    // Benched dots joined mid-round and own no motion in this one: they start
    // with the next round, so they get no entry here and no dot on screen.
    (view.players || []).forEach(function (id) {
      const d = view.dots[id] || {};
      if (d.benched) return;
      sim.dots[id] = { x: 0, y: 0, a: d.a || 0 };
    });
    lastFinishReq = 0;
    askedRevealEnd = false;
    pendingReroll = false;
    latched = false;
    localOut = false;
  }

  function startLoop() {
    if (dead || running) return;
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

  // ---- ending the round ----
  //
  // This used to be a one-shot latch: the first frame past the clock set
  // askedFinish and sent `finish` exactly once. reduce() rejects that intent
  // with 'The clock is still running.' when this client's clock is more than
  // FINISH_GRACE ahead of the host's, and nothing ever asked again — so the
  // round sat in `play` forever and summarize() returned null, meaning the
  // score was never recorded. Ask on a floor instead, and let a refusal reset
  // it (see denied() below), so a denial costs a retry and not the round.

  function askFinish() {
    if (dead || !view || view.phase !== 'play') return;
    if (Date.now() < (view.endsAt || 0)) return;
    const now = Date.now();
    if (now - lastFinishReq < FINISH_RETRY) return;
    lastFinishReq = now;
    api.send({ a: 'finish' });
  }

  // A second safety net under askFinish(): the host's own deadline, armed on
  // the clock rather than on a frame. A hidden tab stops painting, so its
  // requestAnimationFrame loop stops asking entirely — a backgrounded tab is
  // throttled far harder than a timeout, but a timeout still fires. This is
  // what lets a solo round (or one whose only player looked away) still reach
  // `over` and get written down.
  //
  // api.setTimeout is what the hub's stage injects so it can cancel the timer
  // on teardown; fall back to the global for a host page that only supplies
  // raf/cancelRaf. clearTimeout cancels either one.
  const setT = api.setTimeout || setTimeout;

  function armEndTimer() {
    if (endTimer !== null) { clearTimeout(endTimer); endTimer = null; }
    if (dead || !view || view.phase !== 'play' || !iAmHost()) return;
    const ms = Math.max(0, (view.endsAt || 0) - Date.now()) + FINISH_GRACE;
    endTimer = setT(function () {
      endTimer = null;
      // askFinish()'s floor would swallow this, since the loop probably already
      // sent one: rearm straight to 0 so the timer is a real second chance.
      lastFinishReq = 0;
      askFinish();
    }, ms);
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
      // No dot is invented here. resetSim() already built one for everyone at
      // the table, and creating one for `myId` unconditionally gave anyone
      // watching a dot of their own: it drifted, could not be steered, and its
      // exit/in intents were refused host-side.
      // The countdown belongs to everyone, watcher or not, so it updates
      // outside the myDot() guard below — unlike the paused round clock.
      if (view.revealEndsAt) {
        count.textContent = Math.max(1, Math.ceil((view.revealEndsAt - Date.now()) / 1000));
      }
      if (myDot() && view.revealEndsAt) {
        hudTime.textContent = Math.ceil(view.duration) + 's';
      }
      return;
    }
    if (view.phase !== 'play') return;

    const dt = sim.last ? Math.min(0.25, (now - sim.last) / 1000) : 0;
    sim.last = now;

    // A dot that appears mid-round (someone opened the table late) starts at
    // the centre with whatever heading the host gave it. Benched dots joined
    // mid-round and own no motion in this one — they are never added here.
    (view.players || []).forEach(function (id) {
      if (sim.dots[id]) return;
      const d = view.dots[id] || {};
      if (d.benched) return;
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
    // The wind re-rolls on its own 15-25s clock, checked once per frame
    // against wall time so a backgrounded tab picks up where it should.
    if (Date.now() >= sim.windAt) {
      sim.windA = Math.random() * Math.PI * 2;
      sim.windAt = Date.now() + 15000 + Math.random() * 10000;
    }
    const wx = Math.cos(sim.windA) * WIND * V * DT;
    const wy = Math.sin(sim.windA) * WIND * V * DT;
    while (sim.acc >= DT && steps < MAX_STEPS) {
      sim.acc -= DT;
      steps++;
      Object.keys(sim.dots).forEach(function (id) {
        const s = sim.dots[id];
        s.x += Math.cos(s.a) * V * DT + wx;
        s.y += Math.sin(s.a) * V * DT + wy;
      });
    }
    if (steps >= MAX_STEPS) sim.acc = 0;

    // Only your own dot reports. Only your own dot is painted too, but the
    // other dots still have to be integrated or the group tally drifts.
    // A watcher — or a dot benched until the next round — has no mine, so
    // nothing below reports, rerolls, or overwrites the HUD.
    const mine = myDot();
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
      askFinish();
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
    const mine = myDot();
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

  // Your dot joined a round already in progress. You are at the table, but
  // you own no motion in this round — it starts with the next one.
  function benched() {
    if (!view || !seated()) return false;
    const d = (view.dots || {})[myId] || {};
    return !!d.benched;
  }

  // Your integrated dot, and only when you are meant to have one: seated and
  // not benched. A watcher must never be handed a dot — one that drifts and
  // cannot be steered reads as a broken game, which is exactly what shipped.
  function myDot() {
    if (!seated() || benched()) return null;
    return sim.dots[myId] || null;
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

  // The results board: everyone who played, in seat order, with "you" marked.
// Names come from the hub roster (project() hands it through as view.roster);
// there are no times beside them, because the times are how you would find the
// circle. Same list every round — only the count changes — so it is a record
// of who sat in, not a ranking.
  function nameOfRoster(id) {
    const r = (view && view.roster) || [];
    for (let i = 0; i < r.length; i++) if (r[i] && r[i].id === id) return r[i].name;
    if (id === myId) return (api.me && api.me.name) || 'You';
    return 'A player';
  }
  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function renderBoard(o) {
    const rows = (o && o.rows) || [];
    const ids = rows.length ? rows.map(function (r) { return r.id; }) : (view.table || view.players || []);
    if (!ids.length) { ovBoard.hidden = true; return; }
    ovBoard.hidden = false;
    ovBoard.innerHTML = ids.map(function (id) {
      const nm = nameOfRoster(id);
      const you = id === myId;
      return '<span' + (you ? ' class="you"' : '') + '>' + escHtml(nm) + (you ? ' <b>(you)</b>' : '') + '</span>';
    }).join('');
  }

  function renderChrome() {
    if (!view) return;
    const playing = view.phase === 'play' || view.phase === 'reveal';
    const inPlay = view.phase === 'play';
    const list = view.players || [];
    const atTable = seated();
    const waiting = benched();
    const watching = !atTable;
    const host = iAmHost();
    const n = list.length;
    const alone = n < 2;

    overlay.hidden = playing;

    // OBSERVING is a top-of-screen state in every phase, including mid-round.
    // A watcher who opens a live game previously got no signal at all, and the
    // frozen field just reads as a broken one. A benched player is at the
    // table but owns no dot in this round, so they get their own waiting line
    // rather than OBSERVING or a countdown that belongs to someone else.
    hud.classList.toggle('watching', watching || waiting);
    hud.style.visibility = (playing || watching) ? 'visible' : 'hidden';
    if (watching) {
      hudTime.textContent = 'OBSERVING';
      hudMeta.textContent = n + (n === 1 ? ' dot at the table' : ' dots at the table');
    } else if (waiting) {
      hudTime.textContent = 'NEXT ROUND';
      hudMeta.textContent = 'your dot starts with the next one';
    } else {
      hudMeta.textContent = inPlay ? 'keep it inside' : '';
    }

    ovTitle.classList.toggle('observing', watching || waiting);
    renderSeats(list, !playing && !watching);
    // The board only belongs on the results screen; during a round the seat dots
    // alone are the honest amount of information. Empty it rather than just
    // hiding it: `hidden` leaves the names in the DOM, where they are one
    // textContent away from anyone reading the page.
    if (!playing && !watching) renderBoard(view.over);
    else { ovBoard.hidden = true; ovBoard.innerHTML = ''; }

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
      ovNum.className = 'dr-num';
      ovNote.textContent = n + (n === 1 ? ' player is at' : ' players are at') + ' this table.';
      return;
    }

    if (view.phase === 'over') {
      const o = view.over || {};
      const per = Number(o.perPlayer || 0);
      const laps = o.lapses || 0;
      const held = Math.max(0, Math.min(100,
        Math.round(100 * (1 - per / view.duration))));
      ovTitle.textContent = alone ? 'Round Over' : 'Table Round Over';
      ovNum.hidden = false;
      ovNum.className = 'dr-num long';
      ovNum.innerHTML = alone
        ? 'The dot was out of the circle for <span class="dr-hi">' + per.toFixed(1) +
          '</span> out of ' + view.duration + ' seconds.'
        : 'Each dot averaged <span class="dr-hi">' + per.toFixed(1) +
          '</span> out of ' + view.duration + ' seconds outside.';
      ovBody.innerHTML = 'Average time away from the centre, per dot.<br>' +
        'The table held the ring <span class="dr-hi">' + held + '%</span> of the round.<br>' +
        laps + (laps === 1 ? ' lapse' : ' lapses') + ' along the way.';
      // Every table saves, not only solo ones: the score is per-player, so
      // games of any size compare and share one best. saveBest only writes
      // when strictly better, so calling it on every over-render is safe —
      // a stale epoch guard skipped the save whenever epochs restarted.
      saveBest(per, o.players || n || 1);
      ovNote.textContent = bestLine(readBest());
      return;
    }

    ovTitle.textContent = 'Focus';
    // Solo drops the team lines and says "your score": the average is over
    // one dot, but it still compares with every table size.
    if (alone) {
      ovBody.innerHTML = 'Keep your dot inside an invisible circle. ' +
        'Swipe anywhere to steer it; the dot never stops drifting.<br>' +
        'A hidden wind pushes the dot, and it changes every 15-25 seconds.<br>' +
        'Your score is the time your dot spent away from the center.<br>' +
        'It is revealed when the ' + view.duration + 's clock ends.<br>' +
        'Less is better.<br>' +
        'Each time a dot reaches dead center it picks a <span class="dr-hi">new direction</span>.';
    } else {
      ovBody.innerHTML = 'One table, one team.<br>' +
        'Each of you keeps your own dot inside an invisible circle. ' +
        'Swipe anywhere to steer it; the dot never stops drifting.<br>' +
        'A hidden wind pushes the dot, and it changes every 15-25 seconds.<br>' +
        'The table shares a single score: the average time your dots spent away from the center.<br>' +
        'It is revealed when the ' + view.duration + 's clock ends.<br>' +
        'Less is better.<br>' +
        'Each time a dot reaches dead center it picks a <span class="dr-hi">new direction</span>.';
    }
    ovNum.hidden = true;
    ovNum.className = 'dr-num';
    const best = readBest();
    ovNote.textContent = lobbyNote(host, alone, n, best);
  }

  // The status line wordbridge's statusText() would print: who has to act, and
  // what they are waiting on. Before this, the screen said the same thing to
  // the host of a full table and to a guest who could not press the button.
  function lobbyNote(host, alone, n, best) {
    const personal = best === null ? '' : ' · ' + bestLine(best);
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
  // whether the game ate it. A benched dot steers with the next round, not this
  // one, so it is refused here and in reduce().
  function canSteer() {
    return !!view && view.phase === 'play' && seated() && !benched();
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

  // A hidden tab freezes the sim — the step cap stops the spiral — which would
  // freeze the penalty too. Report the exit on hide; the first frame back
  // sends `in` if the dot is inside, so the hidden seconds count as away.
  // A closed tab sends nothing, so a dropped player's dot freezes where it
  // was; finish() settles it — out at the drop means away until the clock, in
  // means nothing more accrues. Accepted: presence is the hub's job, not this
  // game's.
  function onVis() {
    if (document.hidden && view && view.phase === 'play' && myDot() && !localOut) {
      localOut = true;
      api.send({ a: 'exit' });
      return;
    }
    // Coming back: the first frame is enough to notice an expired clock, but a
    // tab restored from a discard sometimes resumes without painting for a
    // moment. Ask here as well, so a round nobody was watching still closes.
    if (!document.hidden && view && view.phase === 'play') {
      lastFinishReq = 0;
      askFinish();
    }
  }
  document.addEventListener('visibilitychange', onVis);

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
      if (dead || !next) return;
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
      armEndTimer();
      updateRings();
      renderChrome();
      render();
      // init() seats whoever was in the room when the table was created, so
      // this is how somebody who opened it later gets seated. During a live
      // round that means benched until the next one, not a dot mid-round.
      // It waits for the first update() because a send from inside mount()
      // comes back before the hub has even assigned the handle to route it.
      // A spectator must not ask — read-only has to mean read-only — and the
      // hub hands reduce() no seat map, so this guard is all there is.
      if (!joined && !api.isSpectator) {
        joined = true;
        api.send({ a: 'join' });
      }
    },
    // The hub calls this when the host refuses one of our intents. It used to
    // vanish, which is why a refused action looked like nothing happening.
    // Same-text repeats are throttled: a refusal that fires every frame would
    // otherwise pin the toast on screen.
    denied: function (text) {
      if (dead) return;
      const msg = String(text || 'The host refused that.');
      // A refused `finish` means our clock ran ahead of the host's. Drop the
      // retry floor so the next frame asks again immediately rather than
      // waiting out FINISH_RETRY — and, more importantly, so the ask is never
      // left as a single latched attempt that a denial can kill for good.
      if (/clock is still running/i.test(msg)) lastFinishReq = 0;
      const now = Date.now();
      if (msg === lastDenied && now - lastDeniedAt < 1500) return;
      lastDenied = msg;
      lastDeniedAt = now;
      showToast(msg);
    },
    destroy: function () {
      // Best effort: leaving mid-round reports the exit so the table is not
      // scored as if the dot sat inside. A closed tab cannot be caught.
      try {
        if (view && view.phase === 'play' && myDot() && !localOut) api.send({ a: 'exit' });
      } catch (e) {}
      dead = true;
      if (endTimer !== null) { clearTimeout(endTimer); endTimer = null; }
      document.removeEventListener('visibilitychange', onVis);
      stopLoop();
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onResize);
    }
  };
}
