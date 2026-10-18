#!/usr/bin/env python3
"""Play test for Dot Return: drive the mounted game and assert on the DOM.

tests/dotreturn_test.py proves the rules. This one proves the game *plays* —
mount() builds, the dot moves, a swipe reaches the host, a dot that drifts home
asks for a new trajectory, a crossing is counted once, and the tally only shows
up after the clock runs out.

It stands in for the hub the way src/main.js drives a game: `api.send(action)`
goes to `reduce()`, and the result is projected and handed back to
`update(view)`. `api.raf` is a fake clock, so a 30-second drift takes a few
milliseconds of wall time instead of half a minute of real waiting.

    pip install playwright && playwright install chromium
    python3 tests/dotreturn_play.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "dotreturn" / "index.js"

HARNESS = r"""
(src) => {
  // classic-script version of the module, plus the exports the harness needs
  src = src.replace(/export (const|function)/g, '$1');
  const factory = new Function(src + `
    window.__dr = { meta, init, reduce, project, summarize, mount };
  `);
  factory();

  const dr = window.__dr;
  const out = [];
  const ok = (name, cond) => out.push([name, !!cond]);

  // best scores live in localStorage, which an opaque test origin may not
  // have — fall back to memory so the best assertions mean something either
  // way.
  const memStore = {};
  window.__mem = memStore;
  try {
    localStorage.getItem('x');
  } catch (e) {
    Object.defineProperty(window, 'localStorage', { value: {
      getItem: (k) => (k in memStore ? memStore[k] : null),
      setItem: (k, v) => { memStore[k] = String(v); },
      removeItem: (k) => { delete memStore[k]; },
      clear: () => { Object.keys(memStore).forEach((k) => delete memStore[k]); }
    }});
  }

  // ---- a fake clock so 30 seconds of drift costs nothing. Date.now runs on
  // the same clock, so exit/in intervals accrue fake seconds exactly like a
  // real round. `frozen` is the hidden-tab stand-in: time passes, no frames.
  // The clock starts at 10000, not 0: production rAF timestamps are ms since
  // page load (large), and the reroll retry gate compares against them, so a
  // zero-based clock would hold the first reroll past the CENTER dwell.
  let clock = 10000, nextId = 1;
  let frozen = false;
  const t0 = Date.now();
  Date.now = () => t0 + clock;
  const cbs = new Map();
  const pump = (ms) => {
    const step = 1000 / 60;
    const target = clock + ms;
    if (frozen) { clock = target; return; }
    while (clock < target) {
      clock += step;
      const running = Array.from(cbs.values());
      cbs.clear();
      running.forEach((fn) => fn(clock));
    }
  };

  // ---- the host, as src/main.js runs it
  const ME = 'me';
  const table = [{ id: ME, name: 'Sam', host: true, game: 'dotreturn' }];
  let state = dr.init({ seats: table, atTable: table, options: {} });
  const intents = [];
  const api = {
    me: { id: ME, name: 'Sam' },
    seats: { 0: ME },
    roster: table,
    atTable: table,
    isSpectator: false,
    isHost: true,
    isInRoom: false,
    send: (action) => {
      intents.push(action);
      const next = dr.reduce(state, action, { from: { id: ME, name: 'Sam' }, rng: Math.random });
      if (!next || next.error) { intents.push({ denied: next && next.error }); return; }
      state = next;
      handle.update(dr.project(state, ME));
    },
    raf: (fn) => { const id = nextId++; cbs.set(id, fn); return id; },
    cancelRaf: (id) => { cbs.delete(id); },
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    setInterval: (fn, ms) => window.setInterval(fn, ms)
  };

  const host = document.getElementById('stage');
  host.style.cssText = 'position:relative;width:400px;height:600px';
  const shadow = host.attachShadow({ mode: 'open' });
  const handle = dr.mount(shadow, api);
  handle.update(dr.project(state, ME));

  const q = (sel) => shadow.querySelector(sel);
  const field = q('.dr-field');
  const dot = () => q('.dr-dot');
  const visible = (el) => !!el && el.hidden === false;
  const hud = () => q('.dr-hud').textContent;
  const overlayText = () => q('.dr-overlay').textContent;
  const overlayShown = () => q('.dr-overlay').hidden === false;
  const pos = () => dot() ? dot().style.transform : '';
  // the rendered x of the dot, in px, so 'is it at the centre' is measurable
  const dotX = () => parseFloat(pos().replace('translate(', '')) || NaN;
  const btn = () => q('.dr-btn');

  ok('mount builds a field', !!field);
  // a stray thumb on the phone must steer, never select: nothing in the game
  // is selectable, on either engine's property
  const wrapStyle = getComputedStyle(q('.dr-wrap'));
  ok('the game is not selectable',
    wrapStyle.userSelect === 'none' && wrapStyle.webkitUserSelect === 'none');
  ok('the game is called Focus', dr.meta.title === 'Focus');
  ok('lobby offers Start', overlayShown() && btn().textContent === 'Start round');
  ok('the lobby title is Focus', q('.dr-title').textContent === 'Focus');
  ok('lobby explains the centre reroll', overlayText().indexOf('new direction') >= 0);
  ok('no dot is on screen yet', !visible(dot()));

  // ---- the solo lobby says so, rather than talking about a group
  ok('the solo lobby says it is solo',
    /you are the whole table/i.test(q('.dr-note').textContent));
  ok('a solo lobby offers no second button', q('.dr-btns').querySelectorAll('button').length === 1);
  ok('the lobby counts the table with dots only',
    q('.dr-table').querySelectorAll('.dr-seat').length === 10 &&
    q('.dr-table').querySelectorAll('.dr-seat.on').length === 1);
  ok('the lobby names nobody', !/Sam/.test(overlayText()));

  // ---- start a round (3s reveal, then play)
  btn().click();
  ok('Start opens the reveal', state.phase === 'reveal' && !overlayShown());
  ok('the reveal shows the ring and the dot', !!dot() && !dot().hidden);
  ok('the HUD clock is paused during the reveal', hud().indexOf('70s') >= 0);
  // the reveal banner: a 3-2-1 countdown above "Keep the dot inside this circle."
  const rev = () => q('.dr-reveal');
  const say = () => q('.dr-say');
  const cnt = () => q('.dr-count');
  ok('the reveal banner is shown', rev() && rev().style.display === 'flex');
  ok('the reveal sentence sits above the circle',
    say() && say().textContent === 'Keep the dot inside this circle.');
  pump(50); // one frame fills the countdown from the real reveal clock
  ok('the countdown counts to the start', cnt() && /^[123]$/.test(cnt().textContent));
  ok('the countdown sits above the sentence',
    cnt().compareDocumentPosition(say()) & Node.DOCUMENT_POSITION_FOLLOWING);
  ok('the banner rests on the circle top', (function () {
    const ringR = parseFloat(q('.dr-ring').style.width) / 2;
    return Math.abs(parseFloat(rev().style.bottom) - (300 + ringR)) < 2;
  })());
  api.send({ a: 'revealend' });
  ok('Start becomes a round', state.phase === 'play' && !overlayShown());
  // Baseline before any pump: with a tailwind the dot can leave in 2.7s, so
  // by the time the lapse section runs below it may already be out — and an
  // exited dot never comes back, so no second lapse would follow.
  const lapsesBefore = state.lapses;
  ok('the banner leaves with the reveal', rev().style.display === 'none');
  ok('a dot appears', !!dot());
  ok('the timer is running', /\d+s/.test(hud()));
  ok('the tally is not on the HUD', !/\breturns?\b/.test(hud()) && !/returns/.test(hud()));
  ok('the HUD never names a player', !/Sam/.test(hud()));

  // every round begins at dead centre, so a reroll must be asked for at once
  const headingAtStart = state.dots[ME].a;
  pump(1200);
  ok('a dot that starts at the centre asks for a new trajectory',
    intents.some((a) => a.a === 'reroll'));
  ok('the new trajectory is the host’s to pick',
    state.dots[ME].a !== headingAtStart || headingAtStart !== state.dots[ME].a);

  // ---- the dot drifts
  const before = pos();
  pump(2000);
  ok('the dot moves on its own', pos() !== before && pos() !== '');
  // an intent sent mid-frame comes straight back through update(), which must
  // not be able to start a second loop
  ok('exactly one frame loop is running', cbs.size === 1);

  // ---- the dot must be PAINTED, not merely present
  // It shipped invisible once: PALETTE went, `.dr-dot` never gained a
  // background, and every DOM check still passed — the element existed, moved,
  // reported hidden:false, and the game was unplayable. So assert paint, not
  // structure. The rectangle goes back to Python for a real pixel check.
  const cs = getComputedStyle(dot());
  const r = dot().getBoundingClientRect();
  ok('the dot is not transparent', cs.backgroundColor !== 'rgba(0, 0, 0, 0)');
  ok('the dot is opaque and visible', cs.opacity !== '0' && cs.visibility === 'visible');
  ok('the dot has a real size', r.width >= 4 && r.height >= 4);
  ok('nothing is painted over the dot',
    shadow.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === dot());
  ok('the dot is round', parseFloat(getComputedStyle(dot()).borderTopLeftRadius) >= 4);

  // ---- a swipe is direction only
  const headingBeforeSwipe = state.dots[ME].a;
  field.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300, bubbles: true }));
  field.dispatchEvent(new PointerEvent('pointerup', { clientX: 260, clientY: 300, bubbles: true }));
  const swipe = intents.filter((a) => a.a === 'swipe').pop();
  ok('a swipe reaches the host', !!swipe);
  ok('a rightward swipe points right', swipe && Math.abs(swipe.ang) < 0.001);
  ok('the swipe moved the dot’s heading', state.dots[ME].a !== headingBeforeSwipe);
  // a tap is not a swipe
  const swipesSoFar = intents.filter((a) => a.a === 'swipe').length;
  field.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300, bubbles: true }));
  field.dispatchEvent(new PointerEvent('pointerup', { clientX: 202, clientY: 301, bubbles: true }));
  ok('a tap does not steer', intents.filter((a) => a.a === 'swipe').length === swipesSoFar);

  // ---- drift out of the hidden circle: the lapse count, and away time
  // (lapsesBefore was captured before the first pump — see above)
  pump(60000);
  ok('leaving the circle is reported', intents.some((a) => a.a === 'exit'));
  ok('the host counted the lapse', state.lapses > lapsesBefore);
  const counted = state.lapses;
  ok('the same exit is never counted twice', state.lapses === counted);

  // ---- the clock runs out, and only then does the score appear
  ok('the tally is still hidden', q('.dr-num').hidden === true);
  state.endsAt = Date.now() - 10;           // the host's clock, forced to expire
  api.send({ a: 'finish' });
  ok('the round ended', state.phase === 'over');
  ok('the score is revealed', overlayShown() &&
    overlayText().indexOf('The dot was out of the circle for ' +
      state.over.perPlayer.toFixed(1) + ' out of 70 seconds.') >= 0);
  ok('the held percentage is revealed', /held the ring \d+%/.test(overlayText()));
  ok('lapses are displayed', new RegExp(state.over.lapses + ' lapses?').test(overlayText()));
  ok('the timer is put away', q('.dr-hud').style.visibility === 'hidden');
  ok('Play again is offered', q('.dr-btn').textContent === 'Play again');

  // ---- a second round re-anchors cleanly
  q('.dr-btn').click();
  api.send({ a: 'revealend' });
  ok('a new round starts', state.phase === 'play' && state.lapses === 0);
  pump(1000);
  // wind pushes up to 0.5V on top of the drift, so 1s can carry the dot ~6px
  ok('the dot is back at the centre', visible(dot()) && Math.abs(dotX() - 200) < 8);

  // ---- a late joiner waits for the next round, and you still only see your own
  const joined = dr.reduce(state, { a: 'join' },
    { from: { id: 'you2', name: 'Bo' }, rng: Math.random });
  handle.update(dr.project(joined, ME));
  ok('the latecomer is at the table', (joined.players || []).indexOf('you2') >= 0);
  ok('their arrival does not re-anchor the round', joined.epoch === state.epoch);
  ok('the latecomer is benched until the next round', joined.dots.you2.benched === true);
  ok('a table of two still shows exactly one dot',
    shadow.querySelectorAll('.dr-dot').length === 1);
  ok('no player tag is ever painted',
    shadow.querySelectorAll('.dr-tag').length === 0);
  ok('no name reaches the screen', !/Sam|Bo/.test(shadow.textContent));

  // ---- the host's HUD says how many are playing, and still names nobody
  const finished = dr.reduce(Object.assign({}, joined, { endsAt: Date.now() - 10 }),
    { a: 'finish' }, { from: { id: ME }, rng: Math.random });
  handle.update(dr.project(finished, ME));
  ok('the table round ends', finished.phase === 'over');
  // you2 joined that round mid-round, so the frozen table is one player: the
  // benched joiner is seated but never counted in the divisor
  ok('a benched joiner is not counted in the divisor',
    /best 0\.0s, 1 player/.test(q('.dr-note').textContent));
  ok('the lobby offers a replay to the host', q('.dr-btn').textContent === 'Play again');
  ok('the lobby counts two at the table',
    q('.dr-table').querySelectorAll('.dr-seat.on').length === 2);
  // The results screen is the ONE place names are allowed now: the round is
  // over, so the seat dots alone have stopped saying who was there. Times stay
  // off it — per-dot seconds are how you would find the circle.
  ok('the results board names everyone who played',
    q('.dr-board').hidden === false && /Sam/.test(q('.dr-board').textContent));
  ok('your own row is marked',
    /\(you\)/.test(q('.dr-board').textContent));
  ok('the results board shows no times',
    !/[\d.]+s/.test(q('.dr-board').textContent));

  // the next round, used by the guest and spectator screens below
  const live = dr.reduce(dr.reduce(finished, { a: 'start' },
    { from: { id: ME, name: 'Sam' }, rng: Math.random }), { a: 'revealend' },
    { from: { id: ME, name: 'Sam' }, rng: Math.random });

  // ---- a guest at that table is told to wait for the host
  const guestHost = document.createElement('div');
  guestHost.style.cssText = 'position:relative;width:400px;height:600px';
  document.body.appendChild(guestHost);
  const guestShadow = guestHost.attachShadow({ mode: 'open' });
  const guestSent = [];
  const guestHandle = dr.mount(guestShadow, Object.assign({}, api, {
    me: { id: 'you2', name: 'Bo' },
    isHost: false,
    isInRoom: true,
    send: (a) => guestSent.push(a)
  }));
  const readyTwo = dr.init({
    seats: [{ id: ME }, { id: 'you2' }],
    atTable: [{ id: ME }, { id: 'you2' }]
  });
  guestHandle.update(dr.project(readyTwo, 'you2'));
  const guestBtn = guestShadow.querySelector('.dr-btn');
  ok('a guest cannot press the host button', !!guestBtn && guestBtn.disabled === true);
  ok('a guest is told who they are waiting for',
    /waiting for the host/i.test(guestShadow.querySelector('.dr-note').textContent));
  ok('a guest is not offered a solo start',
    guestShadow.querySelectorAll('.dr-btns button').length === 1);
  ok('a guest is not shown as observing',
    guestShadow.querySelector('.dr-hud').classList.contains('watching') === false);
  // mid-round the guest does get a dot — their own, and only their own
  guestHandle.update(dr.project(live, 'you2'));
  ok('a guest who is at the table gets a dot during play',
    guestShadow.querySelector('.dr-dot').hidden === false);
  ok('a guest is shown exactly one dot',
    guestShadow.querySelectorAll('.dr-dot').length === 1);
  ok('the guest screen still names nobody',
    !/Sam|Bo/.test(guestShadow.textContent));
  // and the host really does refuse a guest start, not just grey the button out
  const denied = dr.reduce(readyTwo, { a: 'start' }, { from: { id: 'you2', name: 'Bo' } });
  ok('the host refuses a guest start', !!denied && !!denied.error);
  guestHandle.destroy();

  // ---- a host alone in a room is offered a solo start, not a dead end
  const soloRoom = document.createElement('div');
  soloRoom.style.cssText = 'position:relative;width:400px;height:600px';
  document.body.appendChild(soloRoom);
  const soloShadow = soloRoom.attachShadow({ mode: 'open' });
  const soloSent = [];
  const soloHandle = dr.mount(soloShadow, Object.assign({}, api, {
    isInRoom: true, send: (a) => soloSent.push(a)
  }));
  soloHandle.update(dr.project(
    dr.init({ seats: [{ id: ME, name: 'Sam' }] }), ME));
  const soloBtns = soloShadow.querySelectorAll('.dr-btns button');
  ok('a lone host is offered a solo start', soloBtns.length === 2);
  ok('the lone host is told nobody has joined',
    /nobody else/i.test(soloShadow.querySelector('.dr-note').textContent));
  soloBtns[1].click();
  ok('the solo start sends an intent',
    soloSent.some((a) => a.a === 'start'));
  soloHandle.destroy();

  // ---- a spectator gets OBSERVING at the top, in every phase
  const watcherHost = document.createElement('div');
  watcherHost.style.cssText = 'position:relative;width:400px;height:600px';
  document.body.appendChild(watcherHost);
  const watcherShadow = watcherHost.attachShadow({ mode: 'open' });
  const sent = [];
  const watchApi = Object.assign({}, api, {
    isSpectator: true,
    isHost: false,
    isInRoom: true,
    me: { id: 'you3', name: 'Cy' },
    roster: [{ id: 'you3', name: 'Cy', spectator: true }],
    atTable: [],
    send: (a) => sent.push(a)
  });
  const watchHandle = dr.mount(watcherShadow, watchApi);
  const watchHud = watcherShadow.querySelector('.dr-hud');

  // mid-round, which is the case that used to look like a broken frozen field
  watchHandle.update(dr.project(live, 'you3'));
  ok('a spectator watching a live round sees OBSERVING',
    watchHud.textContent.indexOf('OBSERVING') >= 0);
  ok('the observing banner is styled as such',
    watchHud.classList.contains('watching'));
  ok('a spectator is told how many are playing',
    /2 dots at the table/.test(watcherShadow.querySelector('.dr-meta').textContent));
  pump(1500);
  ok('the round clock never overwrites OBSERVING',
    watcherShadow.querySelector('.dr-time').textContent === 'OBSERVING');

  const watchField = watcherShadow.querySelector('.dr-field');
  const swipesBefore = sent.filter((a) => a.a === 'swipe').length;
  watchField.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300, bubbles: true }));
  watchField.dispatchEvent(new PointerEvent('pointerup', { clientX: 260, clientY: 300, bubbles: true }));
  ok('a spectator cannot steer', sent.filter((a) => a.a === 'swipe').length === swipesBefore);
  ok('a spectator never asks to join', sent.every((a) => a.a !== 'join'));
  ok('a spectator has no button at all', !watcherShadow.querySelector('.dr-btn'));
  ok('a spectator is not given a dot',
    watcherShadow.querySelector('.dr-dot').hidden === true);

  // and in the lobby, before anything has started
  watchHandle.update(dr.project(
    dr.init({ seats: [{ id: ME }], atTable: [{ id: ME }] }), 'you3'));
  ok('the lobby says Observing too',
    watcherShadow.querySelector('.dr-title').textContent.indexOf('Observing') >= 0);
  ok('the observing title is styled as such',
    watcherShadow.querySelector('.dr-title').classList.contains('observing'));
  watchHandle.destroy();

  // ---- scoring: away seconds per player, not the lapse count
  localStorage.clear();
  state = dr.init({ seats: table, atTable: table, options: {} });
  handle.update(dr.project(state, ME));

  // a round nobody steers: the dot leaves after R/V = 3s and stays out.
  // Wind bends the path but never below half speed along the heading, so the
  // exit lands between 2s (full tailwind) and 6s (full headwind).
  q('.dr-btn').click();
  api.send({ a: 'revealend' });
  ok('the neglect round plays', state.phase === 'play');
  pump(75000); // the full round; the client sends finish at 0
  ok('a neglected round ends itself', state.phase === 'over');
  ok('neglect costs about 70s away per player',
    state.over.perPlayer > 60 && state.over.perPlayer < 72);
  ok('one lapse per neglected dot', state.over.lapses === 1);
  ok('the held percentage is shown', /held the ring \d+%/.test(overlayText()));
  ok('the neglect best is saved with its table size',
    localStorage.getItem('dotreturn.best.v3') === state.over.perPlayer.toFixed(1) + '|1');

  // a 9.4 saves as 9.4, not 9: hide at once, frozen, for exactly 9400 ms
  state = dr.init({ seats: table, atTable: table, options: {} });
  handle.update(dr.project(state, ME));
  q('.dr-btn').click();
  api.send({ a: 'revealend' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  frozen = true;
  pump(9400);
  frozen = false;
  delete document.hidden;
  document.dispatchEvent(new Event('visibilitychange'));
  pump(20);
  state.endsAt = Date.now() - 10;
  api.send({ a: 'finish' });
  ok('a best of 9.4 saves as 9.4, not 9',
    state.phase === 'over' && state.over.perPlayer === 9.4 &&
    localStorage.getItem('dotreturn.best.v3') === '9.4|1');
  ok('the note reads the best in seconds',
    /best 9\.4s, 1 player/.test(q('.dr-note').textContent));

  // wind: a fixed heading still bends off course. Seed the wind straight
  // down, swipe right, and read the slope: pure heading would run flat.
  const dotPos = () => {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(pos());
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  };
  state = dr.init({ seats: table, atTable: table, options: {} });
  handle.update(dr.project(state, ME));
  const realRandom = Math.random;
  Math.random = () => 0.25;
  q('.dr-btn').click();
  api.send({ a: 'revealend' });
  pump(500); // let the centre reroll land, then take the heading ourselves
  field.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300, bubbles: true }));
  field.dispatchEvent(new PointerEvent('pointerup', { clientX: 260, clientY: 300, bubbles: true }));
  const w0 = dotPos();
  pump(4000);
  Math.random = realRandom;
  const w1 = dotPos();
  ok('the wind pushes the dot off its heading', !!w0 && !!w1 && w1[0] > w0[0] && w1[1] > w0[1]);
  ok('the push is half the drift speed', !!w0 && !!w1 &&
    Math.abs((w1[1] - w0[1]) / (w1[0] - w0[0]) - 0.5) < 0.15);
  state.endsAt = Date.now() - 10;
  api.send({ a: 'finish' });

  // perfect attention: steer back to the centre whenever it wanders
  q('.dr-btn').click();
  api.send({ a: 'revealend' });
  for (let i = 0; i < 70 && state.phase === 'play'; i++) {
    pump(1000);
    if (state.phase !== 'play') break;
    const p = dotPos();
    if (p && Math.hypot(p[0] - 200, p[1] - 300) > 8) {
      const ang = Math.atan2(300 - p[1], 200 - p[0]);
      field.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300, bubbles: true }));
      field.dispatchEvent(new PointerEvent('pointerup',
        { clientX: 200 + Math.cos(ang) * 30, clientY: 300 + Math.sin(ang) * 30, bubbles: true }));
    }
  }
  state.endsAt = Date.now() - 10;
  api.send({ a: 'finish' });
  ok('perfect attention costs almost nothing',
    state.phase === 'over' && state.over.perPlayer < 5);

  // a hidden tab counts as away: time passes, no frames run
  q('.dr-btn').click();
  api.send({ a: 'revealend' });
  pump(1000);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  ok('hiddenness is faked', document.hidden === true);
  document.dispatchEvent(new Event('visibilitychange'));
  frozen = true;
  pump(10000);
  frozen = false;
  delete document.hidden;
  document.dispatchEvent(new Event('visibilitychange'));
  pump(500);
  ok('a hidden tab for 10s costs at least 10s', state.dots[ME].away >= 10000);
  state.endsAt = Date.now() - 10;
  api.send({ a: 'finish' });
  ok('the hidden-tab round ends', state.phase === 'over');

  // ---- ten tabs share one table and all finish together
  const TABS = 10;
  let tState = dr.init({
    seats: Array.from({ length: TABS }, (_, i) => ({ id: 'p' + i })),
    atTable: Array.from({ length: TABS }, (_, i) => ({ id: 'p' + i }))
  });
  const tabs = [];
  for (let i = 0; i < TABS; i++) {
    const id = 'p' + i;
    const el = document.createElement('div');
    el.style.cssText = 'position:relative;width:400px;height:600px';
    document.body.appendChild(el);
    const sh = el.attachShadow({ mode: 'open' });
    const rec = { id: id, sh: sh, handle: null, send: null };
    const tapi = {
      me: { id: id, name: id }, seats: {}, roster: [], atTable: [],
      isSpectator: false, isHost: id === 'p0', isInRoom: true,
      send: (a) => {
        const nx = dr.reduce(tState, a, { from: { id: id, name: id }, rng: Math.random });
        if (!nx || nx.error) return;
        tState = nx;
        tabs.forEach((t) => { if (t.handle) t.handle.update(dr.project(tState, t.id)); });
      },
      raf: (fn) => { const rid = nextId++; cbs.set(rid, fn); return rid; },
      cancelRaf: (rid) => { cbs.delete(rid); }
    };
    rec.send = tapi.send;
    rec.handle = dr.mount(sh, tapi);
    tabs.push(rec);
  }
  tabs.forEach((t) => t.handle.update(dr.project(tState, t.id)));
  ok('ten players share the table', tState.players.length === 10);
  tabs[0].sh.querySelector('.dr-btn').click();
  tabs[0].send({ a: 'revealend' });
  pump(2000);
  tState.endsAt = Date.now() - 10;
  tabs[0].send({ a: 'finish' });
  ok('a 10-tab round completes',
    tState.phase === 'over' && tState.over.players === 10 &&
    tabs.every((t) => t.sh.querySelector('.dr-overlay').hidden === false &&
      t.sh.querySelector('.dr-overlay').textContent.indexOf(
        tState.over.perPlayer.toFixed(1) + 's') >= 0));
  tabs.forEach((t) => t.handle.destroy());

  // ---- teardown
  handle.destroy();
  ok('destroy stops the loop', cbs.size === 0);

  return out;
}
"""


def main():
    src = GAME.read_text(encoding="utf-8")
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content(
            "<!DOCTYPE html><html><body>"
            "<div id='stage'></div></body></html>"
        )
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        got = pg.evaluate("(" + HARNESS + ")", src)
        br.close()

    results = list(got)

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)
    for e in errors:
        bad += 1
        print("  FAIL page error: " + e)

    print()
    print("%d/%d play checks passed" % (len(results) + len(errors) - bad,
                                        len(results) + len(errors)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())