#!/usr/bin/env python3
"""Play test for What's the Hook?: drive the mounted game and assert on the DOM.

tests/hook_test.py proves the rules. This one proves the game *plays* —
mount() builds, the keys fill a draft, lock reaches the host, the vote opens,
a vote tallies a point, spectators stay read-only, and teardown stops the
clock.

It stands in for the hub the way src/main.js drives a game: `api.send(action)`
goes to `reduce()`, and the result is projected and handed back to
`update(view)`.

    pip install playwright && playwright install chromium
    python3 tests/hook_play.py
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "hook" / "index.js"
LIB = ROOT / "games" / "hook" / "library.js"

HARNESS = r"""
(src) => {
  const parts = src.split('__LIB__');
  let lib = parts[0], mod = parts[1];
  lib = lib.replace(/export (const|function)/g, '$1');
  mod = mod.replace(/export (const|function)/g, '$1')
           .replace(/import\s+\{[^}]*\}\s+from\s+['"]\.\/library\.js['"];?/, '');
  const factory = new Function(lib + '\n' + mod + `
    window.__hook = { meta, init, reduce, project, summarize, mount, fillCount, SIZE };
  `);
  factory();

  const hk = window.__hook;
  const out = [];
  const ok = (name, cond) => out.push([name, !!cond]);

  const ME = 'me';
  const table = [{ id: ME, name: 'Sam', host: true, game: 'hook' }];
  let state = hk.init({ seats: table, atTable: table, options: {} });
  const intents = [];
  const denied = [];
  let intervals = new Map(), nextTimer = 1;
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
      const next = hk.reduce(state, action, { from: { id: ME, name: 'Sam' }, rng: Math.random });
      if (!next || next.error) {
        denied.push(next && next.error);
        handle.denied(next && next.error);
        return;
      }
      state = next;
      handle.update(hk.project(state, ME));
    },
    raf: (fn) => requestAnimationFrame(fn),
    cancelRaf: (id) => cancelAnimationFrame(id),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    setInterval: (fn, ms) => { const id = nextTimer++; intervals.set(id, { fn, ms }); return id; }
  };
  const realClearInterval = window.clearInterval.bind(window);
  window.clearInterval = (id) => { intervals.delete(id); try { realClearInterval(id); } catch (e) {} };

  const host = document.getElementById('stage');
  host.style.cssText = 'position:relative;width:400px;height:600px';
  const shadow = host.attachShadow({ mode: 'open' });
  const handle = hk.mount(shadow, api);
  handle.update(hk.project(state, ME));

  const q = (sel) => shadow.querySelector(sel);
  const qa = (sel) => Array.from(shadow.querySelectorAll(sel));

  ok('mount builds the Hook title', !!q('h1') && q('h1').textContent === "What's the Hook?");
  ok('the game is called Hook', hk.meta.id === 'hook');
  ok('the bubble and clock render', !!q('#bubble') && !!q('#clock'));
  ok('first update asks to join', intents.some((a) => a.a === 'join'));
  ok('grid renders slots x scale degrees', qa('#grid button').length === hk.fillCount(state.pair) * hk.SIZE);

  // ---- compose a hook: tap one cell per column, then lock
  const n = hk.fillCount(state.pair);
  ok('the bridge needs notes', n > 0);
  for (let c = 0; c < n; c++) q('#grid [data-col="' + c + '"][data-row="0"]').click();
  ok('lock reaches the host', (() => {
    q('[data-a="lock"]').click();
    return intents.some((a) => a.a === 'lock') && state.locked[ME];
  })());
  ok('solo lock opens the vote', state.phase === 'vote');
  ok('the vote lists your hook', shadow.textContent.indexOf('Vote') >= 0);
  const voteBtn = q('[data-a="vote"]');
  ok('a vote button is offered', !!voteBtn);
  voteBtn.click();
  ok('voting tallies a point and deals again',
    state.phase === 'play' && state.round === 2 && state.scores[ME] === 1);
  ok('the win is named', /won with/.test(q('#game').textContent));
  const line = hk.summarize(state, (id) => id === ME ? 'Sam' : id);
  ok('the record names the winner',
    typeof line === 'string' && line.indexOf("What's the Hook?:") === 0 && line.indexOf('Sam') >= 0);

  // ---- locking with an empty draft never leaves the client
  const sentBefore = intents.length;
  const lockBtn = q('[data-a="lock"]');
  if (lockBtn) lockBtn.click();
  ok('an empty draft is stopped locally',
    intents.length === sentBefore && /Choose .* notes first/.test(q('#bubble').textContent));

  // ---- a spectator watches read-only and never joins
  const watchHost = document.createElement('div');
  document.body.appendChild(watchHost);
  const watchShadow = watchHost.attachShadow({ mode: 'open' });
  const sent = [];
  const watchApi = Object.assign({}, api, {
    isSpectator: true, isHost: false, isInRoom: true,
    me: { id: 'ghost', name: 'Cy' },
    send: (a) => sent.push(a),
    setInterval: (fn, ms) => window.setInterval(fn, ms)
  });
  const watchHandle = hk.mount(watchShadow, watchApi);
  watchHandle.update(hk.project(state, 'ghost'));
  ok('a spectator is told they are watching',
    watchShadow.textContent.indexOf('watching') >= 0);
  ok('a spectator gets no grid', !watchShadow.querySelector('#grid'));
  ok('a spectator never asks to join', sent.every((a) => a.a !== 'join'));

  // ---- teardown stops the clock
  handle.destroy();
  watchHandle.destroy();
  ok('destroy stops the clock', intervals.size === 0);

  return out;
}
"""


def main():
    lib = LIB.read_text(encoding="utf-8")
    mod = GAME.read_text(encoding="utf-8")
    payload = lib + "__LIB__" + mod
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content(
            "<!DOCTYPE html><html><body>"
            "<div id='stage'></div></body></html>"
        )
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        got = pg.evaluate("(" + HARNESS + ")", payload)
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
    print("%d/%d hook play checks passed" % (len(results) + len(errors) - bad,
                                             len(results) + len(errors)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
