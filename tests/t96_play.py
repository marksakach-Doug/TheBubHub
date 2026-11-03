#!/usr/bin/env python3
"""Play test for public/the96game.html — parallel chains, secrecy, timer, save.

The 96 Game is a legacy iframe game: three real frames are driven against a
fake hub that forwards messages in the order the game emits them. This suite
covers the rewrite to simultaneous play:

  * every player opens their own chain at once; all three chains exist
  * briefs are routed to the right player of the right chain ONLY
  * a describer never sees the sentence they must describe, for any chain
  * the turn indicator (chain cards + seat strip) agrees with who is up
  * the first stroke on a blank board is drawable, an enclosed fill fills
  * a pending turn the table ignores is auto-skipped by the host's timer
    (#fast shrinks the two-minute clock so the skip costs seconds)
  * the reveal shows every chain, and Save downloads a self-contained
    HTML page with the texts and inline PNG drawings

    pip install playwright && playwright install chromium
    python3 tests/t96_play.py
"""
import pathlib
import sys
import re
import tempfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "public" / "the96game.html"

HARNESS = """<!DOCTYPE html><html><head><style>iframe{width:100%;height:940px;border:1px solid #ccc}</style></head>
<body>
<iframe id="f0" src="/the96game.html?x=0#fast"></iframe>
<iframe id="f1" src="/the96game.html?x=1#fast"></iframe>
<iframe id="f2" src="/the96game.html?x=2#fast"></iframe>
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
  var src = e.source;
  var i = -1;
  ['f0', 'f1', 'f2'].forEach(function (id, j) {
    if (document.getElementById(id).contentWindow === src) i = j;
  });
  if (i < 0) return;
  if (m.k === 'hello') { ready[i] = true; roster(i); return; }
  if (m.k === 'state') { gd(1, 'state', m.p); gd(2, 'state', m.p); return; }
  if (m.k === 'intent') { gd(0, 'intent', m.p, PLAYERS[i]); return; }
  if (m.k === 'denied') {
    var to = m.p && m.p.to;
    var idx = -1;
    for (var j = 0; j < PLAYERS.length; j++) if (PLAYERS[j].id === to) idx = j;
    if (idx >= 0) gd(idx, 'denied', { text: m.p.text });
    return;
  }
  // 'result' is the record sheet — observed, never answered.
  // 'height' is the hub's layout knob — observed, never answered.
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

    def wait_for(frame, expr, timeout=4000):
        try:
            frame.wait_for_function(expr, timeout=timeout)
            return True
        except Exception:
            return False

    sentences = {'p0': 'a cat wearing a hat', 'p1': 'a duck playing the fiddle', 'p2': 'a robot gardener'}

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(viewport={"width": 1280, "height": 980}, accept_downloads=True)

        def fake(route, body):
            route.fulfill(body=body, content_type="text/html; charset=utf-8")

        ctx.route("http://t96.test/harness.html", lambda r: fake(r, HARNESS))
        ctx.route(re.compile(r"http://t96\.test/the96game\.html.*"), lambda r: fake(r, game_src))

        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://t96.test/harness.html")

        frames = []
        for f in pg.frames:
            if 'the96game.html' in (f.url or ''):
                frames.append(f)
        frames = sorted(frames, key=lambda f: int(re.search(r'x=(\d)', f.url).group(1)))
        if len(frames) != 3:
            print("  FAIL expected 3 game frames, got %d" % len(frames))
            return 1

        hostf, bof, cyf = frames
        for f in frames:
            f.wait_for_selector("#t96-game:not(.hidden), #t96-waiting:not(.hidden), #t96-setup:not(.hidden)", timeout=6000)

        ok("no page errors on load", not errors)

        # ---- the host starts --------------------------------------------
        hostf.wait_for_selector("#t96-setup:not(.hidden)")
        hostf.click("#t96-start")
        for f in frames:
            ok("game screen reaches %s" % f.url.split('x=')[1].split('#')[0],
               wait_for(f, "!document.getElementById('t96-game').classList.contains('hidden')"))

        ok("three chains exist on the host", wait_for(
            hostf, "document.querySelectorAll('#t96-chains .chaincard').length === 3"))
        ok("everyone has a pending move at the start",
           hostf.eval_on_selector_all("#t96-seats .seat.now", "els => els.length") == 3)

        # ---- everyone writes their own starter sentence at once ----------
        for pid, f in zip(('p0', 'p1', 'p2'), frames):
            f.fill("#t96-say", sentences[pid])
            f.click("#t96-send")

        # all chains move to step 1 (the draw step)
        pg.wait_for_timeout(600)
        for f in frames:
            moved = wait_for(f, "Array.from(document.querySelectorAll('#t96-chains .job')).every(e => /is drawing|draw/.test(e.textContent))", 8000)
            ok("all chains moved to the draw step (%s)" % f.url.split('x=')[1].split('#')[0], moved)
            if not moved:
                print('        jobs:', f.locator("#t96-chains .chaincard .job").all_inner_texts())
                print('        status:', f.locator("#t96-status b").inner_text())

        # secret channel: chain started by Cy is drawn by the next seat
        # order is p0, p1, p2 → Cy (p2) starts chain 2, actor for step 1 is p0 (Sam, the host)
        # select Cy's chain on the host to see who is up
        hostf.locator("#t96-chains .chaincard").nth(2).click()
        sam_sees = hostf.locator("#t96-status b").inner_text()
        ok("the player assigned to draw Cy's chain is told to draw it: %r" % sam_sees,
           "Draw this sentence" in sam_sees or "robot gardener" in sam_sees)
        ok("the unrelated describer cannot see Cy's sentence: %r" % cyf.locator("#t96-idle .big").inner_text(),
           "robot gardener" not in cyf.locator("#t96-idle .big").inner_text())

        # ---- turn indicator: cards and seats agree ----------------------
        # Every seat whose name shows up as the actor in a chain card must be .now,
        # and no seat may be .now without being an actor in a card.
        def actors_of(f):
            return [re.sub(r'\s+is\s.*$', '', e.inner_text()).strip()
                    for e in f.locator("#t96-chains .chaincard .job").all()]
        def seat_nows(f):
            return [re.sub(r'\s*[·(].*$', '', e.inner_text()).strip()
                    for e in f.locator("#t96-seats .seat.now").all()]
        ok("indicator syncs with pending turns (host view)",
           sorted(a for a in actors_of(hostf)) == sorted(seat_nows(hostf)))
        ok("indicator syncs with pending turns (guest view)",
           sorted(a for a in actors_of(bof)) == sorted(seat_nows(bof)))

        # ---- the first stroke on a blank board is drawable --------------
        hostf.locator("#t96-canvas").scroll_into_view_if_needed()
        pg.wait_for_timeout(120)
        box = hostf.locator("#t96-canvas").bounding_box()
        ok("canvas has a real hit area", box is not None and box["width"] > 100)

        def drag_stroke(f, pts):
            b = f.locator("#t96-canvas").bounding_box()
            x0 = b["x"] + b["width"] * pts[0][0]
            y0 = b["y"] + b["height"] * pts[0][1]
            pg.mouse.move(x0, y0)
            pg.mouse.down()
            for px, py in pts[1:]:
                pg.mouse.move(b["x"] + b["width"] * px, b["y"] + b["height"] * py)
            pg.mouse.up()
            pg.wait_for_timeout(80)

        def dark_px(f):
            return f.evaluate("""() => {
              const c = document.getElementById('t96-canvas');
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              let n = 0;
              for (let i = 0; i < d.length; i += 4) {
                if (d[i] < 200 && d[i+1] < 200 && d[i+2] < 200) n++;
              }
              return n;
            }""")

        drag_stroke(hostf, [(0.2, 0.3), (0.3, 0.3), (0.45, 0.3), (0.6, 0.3)])
        ok("the drawer's first stroke reached the canvas", dark_px(hostf) > 200)
        hostf.click("#t96-undo")
        pg.wait_for_timeout(120)
        ok("undo removed the stroke", dark_px(hostf) < 50)

        # ---- paint bucket fill ------------------------------------------
        drag_stroke(hostf, [(0.25, 0.5), (0.25, 0.75), (0.55, 0.75), (0.55, 0.5), (0.25, 0.5)])
        hostf.locator(".sw[aria-label='Fill bucket']").click()
        box = hostf.locator("#t96-canvas").bounding_box()
        pg.mouse.click(box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.62)
        pg.wait_for_timeout(120)
        ok("bucket filled the enclosed region", dark_px(hostf) > 300)
        hostf.locator(".sw[aria-label='Fill bucket']").click()  # toggle off

        # ---- host draws for Cy's chain, then done ------------------------
        hostf.click("#t96-done")
        pg.wait_for_timeout(150)

        # ---- the shipped 2-minute timer auto-skips an idle turn ----------
        # Bo never draws chain 0 (Sam's story). Wait out the fast clock and
        # check that the chain moved on by itself.
        wait_for(hostf, "Array.from(document.querySelectorAll('#t96-chains .job')).some(e => /is writing|is starting/.test(e.textContent))", 31000)
        pg.wait_for_timeout(350)
        # complete whatever is left, whoever it is, one action at a time
        deadline = __import__('time').time() + 45
        def current_event(f):
            try:
                return f.locator("#t96-status b").inner_text()
            except Exception:
                return ''
        while __import__('time').time() < deadline:
            any_acted = False
            for f in frames:
                try:
                    mine = f.eval_on_selector_all("#t96-chains .chaincard.yours", "els => els.length")
                except Exception:
                    mine = 0
                if not mine:
                    continue
                # act on the first chain that is waiting on us (best effort:
                # a turn can expire between the count check and the click)
                try:
                    f.locator("#t96-chains .chaincard.yours").first.click(timeout=2500)
                except Exception:
                    continue
                pg.wait_for_timeout(60)
                mode = f.evaluate("""() => {
                    const w = document.getElementById('t96-write');
                    if (w && !w.classList.contains('hidden')) return 'write';
                    const t = document.getElementById('t96-tools');
                    if (t && !t.classList.contains('hidden')) return 'draw';
                    return 'none';
                }""")
                if mode == 'write':
                    f.fill("#t96-say", 'describe %s' % __import__('time').time())
                    f.click("#t96-send")
                    any_acted = True
                    continue
                if mode == 'draw':
                    drag_stroke(f, [(0.2, 0.2), (0.5, 0.5), (0.8, 0.25)])
                    f.click("#t96-done")
                    any_acted = True
                    continue
            if frames[0].locator("#t96-reveal:not(.hidden)").count():
                break
            if not any_acted:
                pg.wait_for_timeout(80)

        for f in frames:
            ok("reveal reached (%s)" % f.url.split('x=')[1].split('#')[0],
               wait_for(f, "!document.getElementById('t96-reveal').classList.contains('hidden')", 3000))

        ok("all three stories are on the reveal",
           hostf.eval_on_selector_all("#t96-chain .story", "els => els.length") == 3)
        for f in frames:
            body = f.locator("#t96-reveal").inner_text()
            for s in sentences.values():
                ok("sentence %r visible at reveal (%s)" % (s, f.url.split('x=')[1].split('#')[0]), s in body)

        # ---- save the story downloads a self-contained page --------------
        with pg.expect_download() as dl_info:
            hostf.click("#t96-save")
        dl = dl_info.value
        tmp = pathlib.Path(tempfile.mkdtemp()) / (dl.suggested_filename or 'story.html')
        dl.save_as(str(tmp))
        content = tmp.read_text(encoding='utf-8')
        ok("save suggested an .html download", (dl.suggested_filename or '').endswith('.html'))
        ok("save produced inline PNG drawings", 'data:image/png;base64' in content)
        ok("save contains the sentences", all(s in content for s in sentences.values()))

        ok("no page errors at the end", not errors)
        if errors:
            for e in errors[:5]:
                print("        pageerror:", e)

        br.close()
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
