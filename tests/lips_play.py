#!/usr/bin/env python3
"""Play test for I'm Your Lips: the mounted write-phase timer and "call time".

Drives games/lips/index.js mount() inside a real Chromium page with a fake
clock and a fake api (reduce -> project -> update), the way src/main.js runs a
module game. Proves:

  * the friend sees a running timer and a "Call time" button in write phase
  * the friend (host) auto-calls time when the 60s clock runs out
  * the friend can click "Call time" at any point
  * none of that breaks while the friend is fidgeting with the mannequins
    (the `busy` guard that blocks re-renders)

Run: python3 tests/lips_play.py
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Inline the module source (exports stripped) and the WORDS array so there are
# no unresolved imports inside the evaluated harness.
game_src = (ROOT / "games" / "lips" / "index.js").read_text(encoding="utf-8")
game_src = re.sub(r"^export (const|function) ", r"\1 ", game_src, flags=re.M)
m = re.search(r"export const WORDS = (\[[\s\S]*?\]);",
              (ROOT / "games" / "lips" / "words.js").read_text(encoding="utf-8"))
words_literal = m.group(1) if m else "[]"
game_src = game_src.replace(
    "import { WORDS } from './words.js';", "const WORDS = " + words_literal + ";")

HARNESS = r"""
// ---- the module under test -----------------------------------------------
__GAME_SRC__

window.__lips = { meta, init, reduce, project, mount };
const lips = window.__lips;

// ---- fake clock driving Date.now, rAF, setTimeout, setInterval -----------
let clock = 10000;
const t0 = Date.now();
Date.now = () => t0 + clock;
const rAF = new Map();
const timers = new Map();
let nextId = 1;
const pump = (ms) => {
  const target = clock + ms;
  const step = 1000 / 60;
  while (clock < target) {
    clock += step;
    const running = Array.from(rAF.values());
    rAF.clear();
    running.forEach((fn) => fn(clock));
  }
  for (const [id, t] of timers) {
    if (clock >= t.due) {
      if (t.interval) t.due = clock + t.interval;
      else timers.delete(id);
      try { t.fn(clock); } catch (e) { console.error('timer threw', e); }
    }
  }
};
window.__pump = pump;

// pump-driven replacements for the globals mount() uses (setInterval ticker,
// setTimeout doodle save, plus rAF/clear so nothing stalls)
window.setTimeout = (fn, ms) => { const id = nextId++; timers.set(id, { fn, due: clock + ms }); return id; };
window.clearTimeout = (id) => { timers.delete(id); };
window.setInterval = (fn, ms) => { const id = nextId++; timers.set(id, { fn, due: clock + ms, interval: ms }); return id; };
window.clearInterval = (id) => { timers.delete(id); };
window.requestAnimationFrame = (fn) => { const id = nextId++; rAF.set(id, fn); return id; };
window.cancelAnimationFrame = (id) => { rAF.delete(id); };

// ---- fake api, as src/main.js runs it ------------------------------------
const ME = 'friend';
const table = [
  { id: ME, name: 'Sam', host: true, game: 'lips' },
  { id: 'w1', name: 'Bo', game: 'lips' },
  { id: 'w2', name: 'Cy', game: 'lips' },
];
let state = lips.init({ seats: table, atTable: table, options: {} });
const intents = [];
const api = {
  me: { id: ME, name: 'Sam' },
  isHost: true,
  send: (action) => {
    const fid = (action && action.from && action.from.id) || ME;
    intents.push(action);
    const next = lips.reduce(state, action, {
      from: { id: fid, name: 'Sam', host: fid === ME }, rng: () => 0.5
    });
    if (!next || next.error) { intents.push({ denied: String(next && next.error) }); return; }
    state = next;
    handle.update(lips.project(state, ME));
  },
  setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, due: clock + ms }); return id; },
  setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, due: clock + ms, interval: ms }); return id; },
  raf: (fn) => { const id = nextId++; rAF.set(id, fn); return id; },
  cancelRaf: (id) => { rAF.delete(id); }
};

const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log((!!cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : ' :: ' + detail));
};

document.body.innerHTML = '<div id="stage"></div>';
const hostEl = document.getElementById('stage');
hostEl.style.cssText = 'position:relative;width:400px;height:600px';
const shadow = hostEl.attachShadow({ mode: 'open' });
const handle = lips.mount(shadow, api);
handle.update(lips.project(state, ME));

const q = (sel) => shadow.querySelector(sel);
const button = (act) => q(`button[data-act="${act}"]`);
const fbtn = (f) => q(`button[data-f="${f}"]`);

// ---- start a round ------------------------------------------------------
api.send({ a: 'start' });
ok('round starts in write', state.phase === 'write');
ok('friend is the host', state.friend === ME);
ok('writers are the other two', JSON.stringify(state.writers) === JSON.stringify(['w1', 'w2']));
ok('timer rendered', !!q('#tnum'));
  ok('friend sees Call time', !!button('calltime'));
  ok('friend sees fidget panel', !!q('.scene'));

// ---- the friend fidgets: add a lip, drag it, lift (sets busy then releases)
fbtn('add').click();
ok('a lip was added', q('.lipg[data-k]') !== null);
const lipg = q('.lipg[data-k]');
lipg.dispatchEvent(new PointerEvent('pointerdown', {
  clientX: 300, clientY: 300, bubbles: true, pointerId: 7
}));
  lipg.dispatchEvent(new PointerEvent('pointerup', {
    clientX: 305, clientY: 305, bubbles: true, pointerId: 7
  }));
  ok('fidget drag + lift did not throw', true);

  // a writer puts a line in, so calling time now moves to rank (not a redeal)
  api.send({ a: 'line', text: 'w1 line', from: { id: 'w1' } });

  // ---- advance the clock past 60s: the friend (host) auto-calls time ------
  window.__pump(65000);
  ok('timeUp was sent when the clock ran out',
    intents.some((a) => a.a === 'timeUp'),
    'ints=' + JSON.stringify(intents.map((a) => a.a)));
  ok('round moved to rank after timeUp', state.phase === 'rank');

// ---- fresh round: writers write all lines -------------------------------
intents.length = 0;
state = lips.init({ seats: table, atTable: table, options: {} });
handle.update(lips.project(state, ME));
api.send({ a: 'start' });
api.send({ a: 'line', text: 'booo', from: { id: 'w1' } });
api.send({ a: 'line', text: 'cyyyy', from: { id: 'w2' } });
ok('all lines in moves to rank', state.phase === 'rank');

// ---- fresh round: friend clicks Call time -------------------------------
intents.length = 0;
state = lips.init({ seats: table, atTable: table, options: {} });
handle.update(lips.project(state, ME));
api.send({ a: 'start' });
button('calltime').click();
ok('clicking Call time sends timeUp', intents.some((a) => a.a === 'timeUp'));

window.__lipsResults = results;
"""

def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL  playwright not installed")
        return 1

    harness = HARNESS.replace("__GAME_SRC__", game_src)
    results = []
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: None)
        page.evaluate(harness)
        page.wait_for_timeout(200)
        res = page.evaluate("window.__lipsResults")
        browser.close()

    if res is None:
        print("FAIL  harness did not produce results (see page errors above)")
        return 1

    failed = [r for r in res if not r["pass"]]
    for r in res:
        if not r["pass"]:
            print(f"FAIL  {r['name']} :: {r['detail']}")
    if errors:
        print("PAGE ERRORS:")
        for e in errors:
            print("  ", e)
    print(f"\n{len(res) - len(failed)}/{len(res)} passed")
    return 1 if failed or errors else 0


if __name__ == "__main__":
    sys.exit(main())
