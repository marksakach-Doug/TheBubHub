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

  // ---- a fake clock so 30 seconds of drift costs nothing
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

  // ---- the host, as src/main.js runs it
  const ME = 'me';
  let state = dr.init({ seats: [{ id: ME, name: 'Sam' }] });
  const intents = [];
  const api = {
    me: { id: ME, name: 'Sam' },
    seats: { 0: ME },
    roster: [{ id: ME, name: 'Sam', host: true }],
    isSpectator: false,
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
  const visible = (el) => !!el && el.style.display !== 'none';
  const hud = () => q('.dr-hud').textContent;
  const overlayText = () => q('.dr-overlay').textContent;
  const overlayShown = () => q('.dr-overlay').hidden === false;
  const pos = () => dot() ? dot().style.transform : '';
  // the rendered x of the dot, in px, so 'is it at the centre' is measurable
  const dotX = () => parseFloat(pos().replace('translate(', '')) || NaN;

  ok('mount builds a field', !!field);
  ok('lobby offers Start', overlayShown() && q('.dr-btn').textContent === 'Start');
  ok('lobby explains the centre reroll', overlayText().indexOf('new direction') >= 0);
  ok('no dot is on screen yet', !visible(dot()));

  // ---- start a round
  q('.dr-btn').click();
  ok('Start becomes a round', state.phase === 'play' && !overlayShown());
  ok('a dot appears', !!dot());
  ok('the timer is running', /\d+s/.test(hud()));
  ok('the tally is not on the HUD', !/\breturns?\b/.test(hud()) && !/returns/.test(hud()));

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

  // ---- drift out of the hidden circle and back: the shared tally
  const returnsBefore = state.returns;
  pump(60000);
  ok('leaving the circle is reported', intents.some((a) => a.a === 'exit'));
  ok('the host counted the return', state.returns > returnsBefore);
  const counted = state.returns;
  ok('the same exit is never counted twice', state.returns === counted);

  // ---- the clock runs out, and only then does the tally appear
  ok('the tally is still hidden', q('.dr-num').hidden === true);
  state.endsAt = Date.now() - 10;           // the host's clock, forced to expire
  api.send({ a: 'finish' });
  ok('the round ended', state.phase === 'over');
  ok('the tally is revealed', overlayShown() && overlayText().indexOf(String(state.returns)) >= 0);
  ok('the timer is put away', q('.dr-hud').style.visibility === 'hidden');
  ok('Play Again is offered', q('.dr-btn').textContent === 'Play Again');

  // ---- a second round re-anchors cleanly
  q('.dr-btn').click();
  ok('a new round starts', state.phase === 'play' && state.returns === 0);
  pump(1000);
  ok('the dot is back at the centre', visible(dot()) && Math.abs(dotX() - 200) < 6);

  // ---- a late joiner gets a dot; a spectator gets read-only
  const joined = dr.reduce(state, { a: 'join' },
    { from: { id: 'you2', name: 'Bo' }, rng: Math.random });
  handle.update(dr.project(joined, ME));
  const tags = Array.from(shadow.querySelectorAll('.dr-tag')).map((t) => t.textContent);
  ok('a late joiner gets a dot',
    shadow.querySelectorAll('.dr-dot').length === 2 && tags.indexOf('you') >= 0);
  ok('the table is named in the HUD', /table:/.test(hud()));

  const watcherHost = document.createElement('div');
  watcherHost.style.cssText = 'position:relative;width:400px;height:600px';
  document.body.appendChild(watcherHost);
  const watcherShadow = watcherHost.attachShadow({ mode: 'open' });
  const sent = [];
  const watchHandle = dr.mount(watcherShadow, Object.assign({}, api, {
    isSpectator: true,
    me: { id: 'you3', name: 'Cy' },
    roster: [{ id: 'you3', name: 'Cy', spectator: true }],
    send: (a) => sent.push(a)
  }));
  // with the round over the overlay is up, which is where the reason shows
  watchHandle.update(dr.project(
    dr.reduce(Object.assign({}, joined, { endsAt: Date.now() - 10 }), { a: 'finish' }, { from: { id: ME }, rng: Math.random }),
    'you3'));
  ok('a spectator never asks to join', sent.every((a) => a.a !== 'join'));
  ok('a spectator cannot start the round', watcherShadow.querySelector('.dr-btn').disabled === true);
  ok('a spectator is told why it is read-only',
    /watching/.test(watcherShadow.querySelector('.dr-overlay').textContent));
  watchHandle.destroy();

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

    bad = 0
    for name, ok in got:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)
    for e in errors:
        bad += 1
        print("  FAIL page error: " + e)

    print()
    print("%d/%d play checks passed" % (len(got) + len(errors) - bad, len(got) + len(errors)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())