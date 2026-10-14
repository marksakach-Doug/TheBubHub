#!/usr/bin/env python3
"""Play test for public/the96game.html — the last game with no DOM test.

The 96 Game is a legacy iframe game, and every bug that made it unplayable was
invisible to `jscheck.py`, because none of them were syntax errors. All of them
were things that only happen at runtime, across two frames:

  * The host hands each player a private brief — the sentence the drawer draws,
    the drawing the describer describes — over the `denied` channel, because
    that is the only per-player pipe the hub offers. `beginStep()` used to emit
    that brief BEFORE the state snapshot, so a guest was still sitting on the
    previous step when it arrived. The brief was then either rejected outright
    or accepted and wiped a render later, and the drawer sat on "Waiting for
    the words..." forever. The host never saw this, because it short-circuits
    delivery to itself *after* it has already advanced its own state — which is
    exactly why this read as "works on the host, broken for everyone else".
  * The board was hidden with `visibility:hidden` whenever it had no strokes,
    i.e. exactly when you need to put the first one down. Hidden elements take
    no pointer events, so nothing was drawable at all.
  * `S.names` was snapshotted at start and never refreshed, so a rename left a
    stale name in the seat strip for the rest of the session.
  * A player who left mid-lap stayed in the running order unless it happened to
    be their turn, so the lap could stall on a ghost.

This drives three real frames against a fake hub that forwards messages in the
order the game emits them — including the brief-before-state ordering — and
asserts on the DOM of the guest frames, because a guest is where all of this
goes wrong. The hub itself is exercised by `tests/t96_play.py`'s sibling, the
`denied` routing in `src/main.js`.

    pip install playwright && playwright install chromium
    python3 tests/t96_play.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "public" / "the96game.html"

# The fake hub. It is deliberately dumb: it forwards whatever the game posts,
# in whatever order the game posts it, because that ordering is the bug.
HARNESS = """<!DOCTYPE html><html><body>
<iframe id="f0" src="/the96game.html"></iframe>
<iframe id="f1" src="/the96game.html"></iframe>
<iframe id="f2" src="/the96game.html"></iframe>
<script>
var PLAYERS = [
  { id: 'p0', name: 'Sam', host: true },
  { id: 'p1', name: 'Bo',  host: false },
  { id: 'p2', name: 'Cy',  host: false }
];
var ROSTER = PLAYERS.map(function (p) { return { id: p.id, name: p.name, host: p.host }; });
var ready = [false, false, false];

function gd(i, k, p, from) {
  if (!ready[i]) return;
  var m = { t: 'gd', game: 'the96game', k: k, p: p };
  if (from) m.from = from;
  document.getElementById('f' + i).contentWindow.postMessage(m, '*');
}
function roster(i) {
  gd(i, 'roster', {
    you: { id: PLAYERS[i].id, name: PLAYERS[i].name, isHost: PLAYERS[i].host },
    room: 'test',
    roster: ROSTER
  });
}
window.addEventListener('message', function (e) {
  var m = e.data;
  if (!m || m.t !== 'gu' || m.game !== 'the96game') return;
  var i = ['f0', 'f1', 'f2'].indexOf(e.source === document.getElementById('f0').contentWindow ? 'f0'
    : e.source === document.getElementById('f1').contentWindow ? 'f1'
    : e.source === document.getElementById('f2').contentWindow ? 'f2' : -1);
  if (i < 0) return;
  if (m.k === 'hello') { ready[i] = true; roster(i); return; }
  // Host broadcasts the authoritative snapshot to everybody else.
  if (m.k === 'state') { gd(1, 'state', m.p); gd(2, 'state', m.p); return; }
  // A guest intent is routed to the host, which validates and replies.
  if (m.k === 'intent') { gd(0, 'intent', m.p, PLAYERS[i]); return; }
  // Per-player channel: the brief, or a refusal. Routed to one frame only.
  if (m.k === 'denied') {
    var to = m.p && m.p.to;
    var idx = -1;
    for (var j = 0; j < PLAYERS.length; j++) if (PLAYERS[j].id === to) idx = j;
    if (idx >= 0) gd(idx, 'denied', { text: m.p.text });
    return;
  }
});
</script></body></html>"""


def main():
    if not GAME.exists():
        print("missing %s" % GAME)
        return 1

    game_src = GAME.read_text(encoding="utf-8")
    bad = 0

    def ok(label, cond):
        nonlocal bad
        print(("  ok   " if cond else "  FAIL ") + label)
        if not cond:
            bad += 1

    def wait_for(frame, expr, timeout=3000):
        """A wait that reports rather than raises.

        The whole point of this file is to diagnose a game that is stuck, so a
        bare Playwright timeout on the first missing sentence would abort the
        run before it could tell us anything about the rest of the lap.
        """
        try:
            frame.wait_for_function(expr, timeout=timeout)
            return True
        except Exception:
            return False

    with sync_playwright() as pw:
        br = pw.chromium.launch()

        # Route both URLs from memory: the harness is synthetic and the game is
        # the real shipped file, so this needs no server and no temp files.
        ctx = br.new_context(viewport={"width": 1280, "height": 900})

        def fake(route, body):
            route.fulfill(body=body, content_type="text/html; charset=utf-8")

        ctx.route("http://t96.test/harness.html",
                  lambda r: fake(r, HARNESS))
        ctx.route("http://t96.test/the96game.html",
                  lambda r: fake(r, game_src))

        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://t96.test/harness.html")

        # The game announces itself with `hello`; the harness only answers then.
        pg.wait_for_function("document.querySelectorAll('iframe').length === 3")
        frames = [f for f in pg.frames if f != pg.main_frame]
        if len(frames) != 3:
            print("  FAIL expected 3 game frames, got %d" % len(frames))
            return 1
        for f in frames:
            f.wait_for_function("!!document.getElementById('t96-game')")

        host, drawer, describer = frames[0], frames[1], frames[2]

        ok("no page errors on load", not errors)

        # ---- the host starts the game ------------------------------------
        host.wait_for_selector("#t96-setup:not(.hidden)")
        host.click("#t96-start")

        for f in frames:
            f.wait_for_selector("#t96-game:not(.hidden)")
        ok("the host is told it is their turn to write", wait_for(
            host,
            "document.querySelector('#t96-status b').textContent.indexOf('start it off') !== -1"))

        # ---- step 0: the host writes the sentence -------------------------
        host.fill("#t96-say", "a cat wearing a hat")
        host.click("#t96-send")
        pg.wait_for_timeout(120)

        # ---- step 1: Bo draws. This is the regression. -------------------
        drawer.wait_for_selector("#t96-game:not(.hidden)")
        got = wait_for(
            drawer,
            "document.querySelector('#t96-status b').textContent.indexOf('cat wearing a hat') !== -1")
        status = drawer.locator("#t96-status b").inner_text()
        ok("the DRAWER sees the sentence: %r" % status, got and "a cat wearing a hat" in status)
        ok("the drawer is told to draw it",
           got and "Draw this sentence" in drawer.locator("#t96-status small").inner_text())

        # The describer must NOT be able to see the original sentence.
        dstat = describer.locator("#t96-status b").inner_text()
        ok("the describer cannot see the sentence: %r" % dstat,
           "cat wearing a hat" not in dstat and "Waiting for Bo" in dstat)

        # ---- the board has to be drawable while it is still blank ---------
        vis = drawer.evaluate(
            "getComputedStyle(document.getElementById('t96-canvas')).visibility")
        ok("a blank board is visible to the drawer (was visibility:hidden)", vis != "hidden")

        # The three frames are stacked full-height, so the drawer's canvas is
        # normally scrolled out of the viewport and raw page.mouse coordinates
        # would land on a different frame entirely. Bring it into view first.
        drawer.locator("#t96-canvas").scroll_into_view_if_needed()
        pg.wait_for_timeout(100)
        box = drawer.locator("#t96-canvas").bounding_box()
        ok("the canvas has a real hit area", box is not None and box["width"] > 100)
        if box:
            # A single drag: down, several moves, up. The first stroke is the
            # one that used to be impossible.
            pg.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.30)
            pg.mouse.down()
            for f in (0.35, 0.45, 0.55, 0.65):
                pg.mouse.move(box["x"] + box["width"] * f, box["y"] + box["height"] * 0.45)
            pg.mouse.up()
            pg.wait_for_timeout(200)

            painted = drawer.evaluate("""() => {
              const c = document.getElementById('t96-canvas');
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              // Paper is #fffdf7; anything meaningfully darker is a real stroke.
              let n = 0;
              for (let i = 0; i < d.length; i += 4) {
                if (d[i] < 200 && d[i + 1] < 200 && d[i + 2] < 200) n++;
              }
              return n;
            }""")
            ok("the drawer's first stroke reached the canvas (%d dark px)" % painted, painted > 200)

        # ---- the describer gets the drawing, not the sentence -------------
        drawer.click("#t96-done")
        pg.wait_for_timeout(200)

        ok("the describer is told to describe", wait_for(
            describer,
            "document.querySelector('#t96-status b').textContent.indexOf('Describe') !== -1"))

        dpaint = describer.evaluate("""() => {
          const c = document.getElementById('t96-canvas');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] < 200 && d[i + 1] < 200 && d[i + 2] < 200) n++;
          }
          return n;
        }""")
        ok("the describer can see the drawing (%d dark px)" % dpaint, dpaint > 200)
        dtext = describer.locator("#t96-write").inner_text()
        ok("the describer is not shown the original sentence", "cat wearing a hat" not in dtext)

        # ---- step 2: the describer writes, and the lap reveals ----------
        describer.fill("#t96-say", "an animal with a hat on it")
        describer.click("#t96-send")
        pg.wait_for_timeout(250)

        for name, f in (("host", host), ("drawer", drawer), ("describer", describer)):
            shown = wait_for(f, "!document.getElementById('t96-reveal').classList.contains('hidden')")
            steps = f.locator("#t96-chain .step").count()
            ok("the %s sees the reveal chain (%d steps)" % (name, steps), shown and steps == 3)

        chain = drawer.locator("#t96-chain").inner_text()
        ok("the guest reveal shows the original sentence", "a cat wearing a hat" in chain)
        ok("the guest reveal shows the final description", "an animal with a hat on it" in chain)

        # Each reveal step with a drawing must actually have pixels on it.
        step_paint = drawer.evaluate("""() => {
          const cs = document.querySelectorAll('#t96-chain .step canvas');
          let painted = 0;
          for (const c of cs) {
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] < 200 && d[i + 1] < 200 && d[i + 2] < 200) { painted++; break; }
            }
          }
          return { canvases: cs.length, painted: painted };
        }""")
        ok("the guest reveal renders the drawing (%d/%d canvases painted)"
           % (step_paint["painted"], step_paint["canvases"]),
           step_paint["canvases"] >= 1 and step_paint["painted"] >= 1)

        ok("no page errors during play", not errors)
        br.close()

    print()
    print("%d checks failed" % bad if bad else "all checks passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())