#!/usr/bin/env python3
"""Two-client test for Dot Return: the host and a guest share one table.

tests/dotreturn_play.py drives a single client against a stub `send`. That is
how multiplayer Dot Return shipped broken while green: the stub hand-builds its
own `api` with `isSpectator: false`, so it asserts a guest-at-table situation
the hub could never produce — every guest in a room resolved to
`isSpectator() === true` (only seat 0 was ever claimed), never sent `join`,
and ended up watching a phantom dot drift.

This one stands in for src/main.js the way it actually routes: `send` goes to
the host's `reduce()`, errors come back through the client's `denied()`, and a
success is projected per player and handed to every mounted client. Seat and
spectator state come from the real room/store.js, not a re-implementation.

    pip install playwright && playwright install chromium
    python3 tests/dotreturn_net.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "dotreturn" / "index.js"
STORE = ROOT / "room" / "store.js"

HARNESS = r"""
() => {
  const out = [];
  const ok = (name, cond) => out.push([name, !!cond]);

  // ---- a fake clock shared by every client
  let clock = 0, nextId = 1;
  const cbs = new Map();
  const pump = (ms) => {
    const step = 1000 / 60;
    for (let t = 0; t < ms; t += step) {
      clock += step;
      const running = Array.from(cbs.values());
      cbs.clear();
      running.forEach((fn) => fn(clock));
    }
  };

  // ---- one shared host state, routed the way src/main.js routes it
  const dr = window.__dr;
  let state = dr.init({ seats: [{ id: 'h' }], atTable: [{ id: 'h' }], options: {} });
  const deniedLog = [];
  const clients = [];
  const hubSend = (fromId, action) => {
    const from = clients.filter((c) => c.id === fromId)[0];
    const name = from ? from.name : fromId;
    const next = dr.reduce(state, action, { from: { id: fromId, name: name }, rng: Math.random });
    if (!next || next.error) {
      deniedLog.push([fromId, next && next.error]);
      if (from && from.handle && typeof from.handle.denied === 'function') {
        from.handle.denied(next && next.error);
      }
      return next;
    }
    state = next;
    clients.forEach((c) => c.handle.update(dr.project(state, c.id)));
    return next;
  };
  const mountClient = (id, name, store, isHost) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:relative;width:400px;height:600px';
    document.body.appendChild(el);
    const shadow = el.attachShadow({ mode: 'open' });
    const c = { id: id, name: name, shadow: shadow, handle: null, sent: [], store: store };
    // apiFor() hands the game a snapshot boolean, so this does too: a seat
    // claimed later takes effect through a fresh mount, exactly like the hub.
    const api = {
      me: { id: id, name: name },
      seats: {},
      roster: [],
      atTable: [],
      isSpectator: store.isSpectator(),
      isHost: isHost,
      isInRoom: true,
      send: (a) => { c.sent.push(a); hubSend(id, a); },
      raf: (fn) => { const rid = nextId++; cbs.set(rid, fn); return rid; },
      cancelRaf: (rid) => { cbs.delete(rid); },
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      setInterval: (fn, ms) => window.setInterval(fn, ms)
    };
    c.handle = dr.mount(shadow, api);
    clients.push(c);
    c.handle.update(dr.project(state, id));
    return c;
  };
  const dot = (c) => c.shadow.querySelector('.dr-dot');
  const dotGone = (c) => { const d = dot(c); return !d || d.hidden === true; };
  const dotX = (c) => {
    const d = dot(c);
    if (!d) return NaN;
    return parseFloat(d.style.transform.replace('translate(', '')) || NaN;
  };
  const hudTime = (c) => c.shadow.querySelector('.dr-time').textContent;
  const overlayText = (c) => c.shadow.querySelector('.dr-overlay').textContent;
  const swipe = (c, x0, x1) => {
    const f = c.shadow.querySelector('.dr-field');
    f.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: 300, bubbles: true }));
    f.dispatchEvent(new PointerEvent('pointerup', { clientX: x1, clientY: 300, bubbles: true }));
  };

  const Store = window.__store;
  const newStore = (id, name, isHost) => {
    const st = Store.createStore();
    st.setMe(id, name);
    st.openRoom('room', isHost);
    return st;
  };

  // ---- the store seats everyone, not just seat 0
  const solo = newStore('solo', 'Al', true);
  ok('isSpectator is false outside a room', solo.isSpectator() === false);
  const hs = newStore('h', 'Sam', true);
  ok('a guest with no seat is a spectator', newStore('g', 'Bo', false).isSpectator() === true);
  ok('the first seat claimed is 0', hs.claimFreeSeat('h') === 0);
  ok('a seat stops being a spectator', hs.isSpectator() === false);
  const gs = newStore('g', 'Bo', false);
  gs.claimSeat(0, 'h'); // what the host's roster broadcast carries
  ok('the second seat claimed is 1', gs.claimFreeSeat('g') === 1);
  ok('seat 1 stops being a spectator', gs.isSpectator() === false && gs.mySeat() === 1);
  const skip = newStore('y', 'Cy', false);
  skip.claimSeat(0, 'h'); skip.claimSeat(2, 'x');
  ok('taken seats are skipped', skip.claimFreeSeat('y') === 1);

  // ---- host and guest share one table
  const host = mountClient('h', 'Sam', hs, true);
  const guest = mountClient('g', 'Bo', gs, false);
  ok('the guest joined through the hub', state.players.join(',') === 'h,g');
  ok('the lobby join bumped the epoch once', state.epoch === 1);

  hubSend('h', { a: 'start' });
  ok('the round opens a reveal', state.phase === 'reveal');
  ok('the guest sees a dot in the reveal', dotGone(guest) === false);
  ok('the guest is not shown as observing', hudTime(guest).indexOf('OBSERVING') < 0);
  hubSend('h', { a: 'revealend' });
  ok('the reveal hands over to play', state.phase === 'play');

  // steer the guest dot away from the centre while it is still inside the
  // circle, so no reroll can fire mid-assertion — then watch it leave
  const gx0 = dotX(guest);
  pump(2500);
  ok('the guest dot drifts', dotX(guest) !== gx0);
  const gx = dotX(guest);
  const r0 = state.returns;
  const hBefore = state.dots.h.a;
  if (gx >= 200) swipe(guest, 200, 260); else swipe(guest, 200, 140);
  const gSwipe = guest.sent.filter((a) => a.a === 'swipe').pop();
  ok('a guest swipe leaves the client', !!gSwipe);
  const want = gx >= 200 ? 0 : Math.PI;
  ok('the host accepted the guest swipe', Math.abs(state.dots.g.a - want) < 0.001);
  ok('the swipe never touched the host dot', state.dots.h.a === hBefore);
  const before = dotX(guest);
  pump(1000);
  ok('the guest dot follows the swipe', gx >= 200 ? dotX(guest) > before : dotX(guest) < before);
  const hx0 = dotX(host);
  pump(1500);
  ok('the host dot still moves on its own', dotX(host) !== hx0);

  // ---- the shared tally counts the guest's crossing
  let guard = 0;
  while (state.returns === r0 && guard < 40) { pump(5000); guard++; }
  ok('the guest crossing reached the shared tally', state.returns > r0);
  ok('returns stay hidden mid-round',
    guest.shadow.querySelector('.dr-num').hidden === true);

  // ---- a watcher gets OBSERVING in every phase, and no dot at all
  const ws = newStore('w', 'Cy', false); // no seat: genuinely watching
  const watcher = mountClient('w', 'Cy', ws, false);
  ok('a watcher never asks to join', watcher.sent.every((a) => a.a !== 'join'));
  ok('a watcher has no dot during play', dotGone(watcher));
  ok('a watcher sees OBSERVING during play', hudTime(watcher).indexOf('OBSERVING') >= 0);
  pump(1500);
  ok('the round clock never overwrites OBSERVING', hudTime(watcher) === 'OBSERVING');
  const wSwipes = watcher.sent.filter((a) => a.a === 'swipe').length;
  swipe(watcher, 200, 260);
  ok('a watcher cannot steer', watcher.sent.filter((a) => a.a === 'swipe').length === wSwipes);

  // ---- someone who opens the game mid-round waits for the next one
  const hx = dot(host).style.transform;
  const epochBefore = state.epoch;
  const cs = newStore('c', 'Al', false);
  cs.claimSeat(0, 'h'); cs.claimSeat(1, 'g');
  cs.claimFreeSeat('c');
  const late = mountClient('c', 'Al', cs, false);
  ok('a mid-round join does not re-anchor the table', state.epoch === epochBefore);
  ok('the host dot never teleports', dot(host).style.transform === hx);
  ok('the late joiner is seated', state.players.indexOf('c') >= 0);
  ok('the late joiner is benched', !!(state.dots.c && state.dots.c.benched));
  ok('the benched dot is not painted', dotGone(late));
  ok('the benched player waits, not observes',
    hudTime(late).indexOf('NEXT ROUND') >= 0);
  const lSwipes = late.sent.filter((a) => a.a === 'swipe').length;
  swipe(late, 200, 260);
  ok('a benched dot cannot steer', late.sent.filter((a) => a.a === 'swipe').length === lSwipes);
  hubSend('c', { a: 'swipe', ang: 0 });
  const denied = deniedLog.filter((d) => d[0] === 'c').pop();
  ok('the host refuses a benched swipe', !!denied && /next round/i.test(denied[1]));
  ok('the refusal reaches the player',
    late.shadow.querySelector('.dr-toast').textContent.toLowerCase().indexOf('next round') >= 0);

  // ---- the clock runs out: one tally, both screens
  state.endsAt = Date.now() - 10;
  hubSend('h', { a: 'finish' });
  ok('the round ended', state.phase === 'over');
  const tally = String(state.returns);
  ok('the host reveals the tally', overlayText(host).indexOf(tally) >= 0);
  ok('the guest reveals the same tally', overlayText(guest).indexOf(tally) >= 0);
  ok('a two-player round is not scored as a personal best',
    !/personal best/i.test(guest.shadow.querySelector('.dr-note').textContent));

  // ---- replay unbenches the waiter, and a watcher still gets no dot
  hubSend('h', { a: 'start' });
  ok('the replay opens a reveal', state.phase === 'reveal');
  const ws2 = newStore('w2', 'Dan', false);
  const watcher2 = mountClient('w2', 'Dan', ws2, false);
  ok('a watcher gets no dot in the reveal', dotGone(watcher2));
  ok('a watcher sees OBSERVING in the reveal', hudTime(watcher2).indexOf('OBSERVING') >= 0);
  pump(1000);
  ok('the reveal clock never overwrites OBSERVING', hudTime(watcher2) === 'OBSERVING');
  ok('a reveal watcher never asks to join', watcher2.sent.every((a) => a.a !== 'join'));
  hubSend('h', { a: 'revealend' });
  ok('the replay unbenched the waiter', !!(state.dots.c && !state.dots.c.benched));
  ok('the waiter has a dot in the new round', dotGone(late) === false);

  host.handle.destroy();
  guest.handle.destroy();
  watcher.handle.destroy();
  watcher2.handle.destroy();
  late.handle.destroy();
  ok('teardown leaves no frame loop running', cbs.size === 0);

  return out;
}
"""


def main():
    game_src = GAME.read_text(encoding="utf-8")
    store_src = STORE.read_text(encoding="utf-8")
    # main.js must actually call the seat fix — the test cannot reach openGame's
    # closure, so assert the wiring statically instead of trusting it.
    main_src = (ROOT / "src" / "main.js").read_text(encoding="utf-8")
    static_ok = []
    static_ok.append(("openGame claims a free seat", "claimFreeSeat" in main_src))
    static_ok.append(("seat-0-only claim is gone", "seats[0] === undefined" not in main_src))

    game_src = game_src.replace("export const", "const").replace("export function", "function")
    game_src += "\nwindow.__dr = { meta, init, reduce, project, summarize, mount };\n"
    store_src = store_src.replace("export function", "function")
    store_src += "\nwindow.__store = { createStore, randomAnimalName };\n"

    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.add_script_tag(content=store_src)
        pg.add_script_tag(content=game_src)
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        got = pg.evaluate("(" + HARNESS + ")()")
        br.close()

    results = list(static_ok) + list(got)

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)
    for e in errors:
        bad += 1
        print("  FAIL page error: " + e)

    print()
    print("%d/%d net checks passed" % (len(results) + len(errors) - bad,
                                       len(results) + len(errors)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
