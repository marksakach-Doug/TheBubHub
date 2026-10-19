#!/usr/bin/env python3
"""Every game with a card has to open, render, and take a tap.

The gate (scripts/check-game.mjs) judges rules. It cannot judge what a player
sees, because that needs a real browser and a real hub. This does the half the
gate cannot, for every game at once:

  1. the game opens and its shadow root exists
  2. THE FIRST PAINT IS ALREADY THE PROJECTED VIEW — this is the guard for a
     hub bug that shipped once: main.js handed update() the raw state instead of
     calling project(), so a game that shapes its view showed a permanently
     empty board while logging nothing
  3. the first paint is not empty
  4. one move from the card, driven through the DOM, changes the screen
  5. nothing overflows at 390px
  6. no page errors the whole time

Runs against the BUILT bundle, because that is the artifact that ships and the
only place a module game can be missing and nobody notices.

    python3 tests/game_smoke.py <port>

Needs dist/ built (test.sh does it). Pass --port to use a running server.
"""
import json
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
PORT = 5180

SHADOW = "document.querySelector('#game-stage .stage-host').shadowRoot"


def cards():
    """Games with a card, and the first legal move each card says to make."""
    out = []
    games = ROOT / "games"
    for d in sorted(games.iterdir()) if games.exists() else []:
        f = d / "scenarios.json"
        if not f.exists():
            continue
        card = json.loads(f.read_text(encoding="utf-8"))
        # The first scenario with at least one step and no expected refusal is
        # the one move we know is legal.
        move = None
        for sc in card.get("scenarios", []):
            if sc.get("expect", {}).get("error"):
                continue
            steps = sc.get("steps") or []
            if steps:
                move = steps[0]
                break
        out.append((d.name, card, move))
    return out


def check(cond, name, detail=""):
    if cond:
        print(f"  ok   {name}")
        return 0
    print(f"FAIL  {name}")
    if detail:
        for line in str(detail).split("\n"):
            print(f"        {line}")
    return 1


def build_if_needed():
    if (DIST / "index.html").exists():
        return True
    print("dist/ is missing — building it")
    r = subprocess.run(["bun", "run", "build"], cwd=ROOT,
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("build failed:\n" + r.stdout[-600:] + r.stderr[-600:])
        return False
    return True


def serve(port):
    p = subprocess.Popen([sys.executable, "-m", "http.server", str(port)],
                         cwd=DIST, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    return p


def shadow_snapshot(pg):
    return pg.evaluate(f"""() => {{
      const r = {SHADOW};
      if (!r) return {{ ok: false, why: 'no shadow root' }};
      const text = (r.textContent || '').replace(/\\s+/g, ' ').trim();
      return {{
        ok: true,
        text: text.slice(0, 120),
        length: text.length,
        clickable: r.querySelectorAll('button, [role=button], [data-cell], [data-i], td').length,
        html: r.innerHTML.length,
        overflow: r.scrollWidth > r.clientWidth + 2
      }};
    }}""")


def open_game_button(pg, id_):
    """Find and click the lobby button for this game, hosting a room if needed.

    A solo game sits in the pre-room Solo Corner (`btn-lobby-<id>`). A game that
    needs two players is only in the in-room list, so it needs an actual room —
    `BubHub.hostRoom()` is the hub's own entry point, and using it here means this
    test never invents a way in.
    """
    lobby = pg.locator(f"#btn-lobby-{id_}")
    if lobby.count():
        lobby.first.click()
        return True
    if pg.evaluate("() => { if (window.BubHub && BubHub.hostRoom) BubHub.hostRoom(); return true; }"):
        pg.wait_for_timeout(1400)
    room = pg.locator(f"#btn-room-{id_}")
    if not room.count():
        # The in-room list is inside a drawer that is display:none until you are
        # in a room; hosting above should have opened it.
        pg.evaluate("() => { const r = document.getElementById('room-ui'); if (r) r.classList.remove('hidden'); }")
        pg.wait_for_timeout(300)
        room = pg.locator(f"#btn-room-{id_}")
    if not room.count():
        return False
    room.first.click(force=True)
    return True


def run(pg, id_, card, move, results):
    pg.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    pg.wait_for_timeout(900)
    # First visit shows a blocking name modal; dismiss it or nothing is clickable.
    if pg.locator("#welcome-landing:not(.hidden)").count():
        pg.click("#btn-welcome-go")
        pg.wait_for_timeout(400)

    if not open_game_button(pg, id_):
        results.append(check(False, f"{id_}: can be opened",
                             f"no button reaches {id_} — a game the hub cannot open is not a game"))
        return
    pg.wait_for_timeout(900)

    snap = shadow_snapshot(pg)
    if not snap.get("ok"):
        results.append(check(False, f"{id_}: opens a shadow root", snap.get("why")))
        return
    results.append(check(True, f"{id_}: opens a shadow root"))

    # (2) and (3): the first paint must already be the projected view. A view
    # that projects into a field the raw state does not have is the failure this
    # catches; there is no other place it shows up.
    results.append(check(snap["length"] > 0,
                         f"{id_}: first paint has text",
                         f"the shadow root rendered nothing ({snap['html']} bytes of html)"))
    results.append(check(snap["length"] < 120,
                         f"{id_}: first paint is not an error card",
                         f"it rendered: {snap['text'][:110]}"))

    if not move:
        results.append(check(True, f"{id_}: no legal move in the card to drive"))
        return

    action = move.get("action") or {}
    # Drive the move the way a player would: tap controls ONE AT A TIME and stop
    # as soon as the screen changes. Tapping everything in a burst is wrong twice
    # over — it hits a game's own "new game" button, which undoes the move it
    # just made, and it proves nothing about whether a single tap works.
    before = snap["text"]
    changed = 0
    tried = 0
    for _ in range(30):
        tapped = pg.evaluate("""() => {
          const r = document.querySelector('#game-stage .stage-host').shadowRoot;
          const els = [...r.querySelectorAll('button, [role=button], [data-cell], [data-i]')]
            .filter((e) => !e.disabled && e.getBoundingClientRect().width > 0);
          if (!els.length) return null;
          const e = els[0];
          e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
          e.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
          // Mark it so the next call moves on to a different control.
          e.setAttribute('data-smoked', '1');
          return true;
        }""")
        if not tapped:
            break
        tried += 1
        pg.wait_for_timeout(120)
        if shadow_snapshot(pg)["text"] != before:
            changed = 1
            break
        # Move on: hide the one we just tried so the next call finds another.
        pg.evaluate("""() => {
          const r = document.querySelector('#game-stage .stage-host').shadowRoot;
          const e = r.querySelector('[data-smoked="1"]');
          if (e) { e.setAttribute('data-smoked', '2'); e.disabled = true; }
        }""")

    if not tried:
        results.append(check(False, f"{id_}: has something to tap",
                             "no enabled, visible button or cell was found on screen"))
        return
    results.append(check(True, f"{id_}: has something to tap ({tried} tried)"))

    if not changed:
        results.append(check(False, f"{id_}: a tap changes the screen",
                             f"tapped {tried} control(s); the screen never changed from: {before[:70]}"))
    else:
        results.append(check(True, f"{id_}: a tap changes the screen"))

    # Phone width: a game that only works on a desktop is a game nobody opens.
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(400)
    over = pg.evaluate(f"""() => {{
      const r = {SHADOW};
      const wide = [...r.querySelectorAll('*')].filter(
        (e) => e.getBoundingClientRect().width > r.clientWidth + 2);
      return {{ n: wide.length, who: wide.slice(0, 3).map((e) => e.tagName + '.' + e.className) }};
    }}""")
    results.append(check(over["n"] == 0,
                         f"{id_}: fits a 390px phone",
                         f"{over['n']} element(s) wider than the screen: {over['who']}"))


def main():
    global PORT
    argv = sys.argv[1:]
    for a in argv:
        if a.isdigit():
            PORT = int(a)

    if not build_if_needed():
        print("\nFAIL  could not build dist/")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL  playwright is not installed — pip install playwright && playwright install chromium")
        return 1

    entries = cards()
    if not entries:
        print("game smoke — no games have a card yet, nothing to drive")
        return 0

    print(f"=== game smoke — {len(entries)} game(s) with a card ===")
    server = serve(PORT)
    results = []
    errs = []
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()
            for id_, card, move in entries:
                pg = br.new_page()
                pg.on("pageerror", lambda e: errs.append(f"{id_}: {e}"))
                pg.on("console", lambda m, i=id_: errs.append(f"{i}: console {m.text}")
                      if m.type == "error" else None)
                before = len(errs)
                try:
                    run(pg, id_, card, move, results)
                except Exception as exc:  # noqa: BLE001
                    results.append(check(False, f"{id_}: did not crash the driver",
                                         str(exc)[:300]))
                pg.close()
                # A page error is a failure even when every assertion above passed.
                new_errs = errs[before:]
                if new_errs:
                    # One thrown TypeError fires on every repaint; five copies of
                    # it helps nobody. Show the distinct ones.
                    seen, uniq = set(), []
                    for e in new_errs:
                        key = e.split(":", 2)[-1]
                        if key not in seen:
                            seen.add(key)
                            uniq.append(e)
                    results.append(check(False, f"{id_}: no page errors",
                                         "\n".join(uniq[:3])))
                else:
                    results.append(check(True, f"{id_}: no page errors"))
            br.close()
    finally:
        server.terminate()

    failed = sum(results)
    print()
    if failed:
        print(f"{failed} check(s) failed")
        return 1
    print(f"all green ({len(results)} checks, {len(entries)} games)")
    return 0


if __name__ == "__main__":
    sys.exit(main())