#!/usr/bin/env python3
"""Drive the BUILT bundle (dist/) to check the hub shell after a rebuild.

`python3 -m http.server` does not serve the hub — no import.meta.glob, and
public/ is not at the root — but the BUILT bundle does, because Vite has
already replaced the glob. So this is the only way to check that the four
module games really are in a production build, and that the menu is
grouped and ordered the way the source says it is.

    bun run build && python3 tests/hub_switch_test.py [port]
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 5180
URL = "http://127.0.0.1:%d/index.html" % PORT


def main():
    fails = []
    oks = []

    def check(name, got, want):
        ok = got == want
        (oks if ok else fails).append(name)
        print(("  ok   " if ok else "  FAIL ") + "%s: got=%r want=%r" % (name, got, want))

    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 900, "height": 900})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(URL)
        # First visit shows a blocking name modal; nothing else is clickable.
        pg.wait_for_selector("#welcome-landing:not(.hidden)", timeout=10000)
        pg.fill("#welcome-name", "Tester")
        pg.click("#btn-welcome-go")
        pg.wait_for_timeout(600)

        # ---- the module games survived the build.
        # Enumerated off the real games/ directory rather than a hardcoded list:
        # a fixed list silently stops checking the fifth game onward, so the
        # exact bug this file exists to catch (module games vanishing from the
        # production bundle) would return unnoticed.
        module_ids = sorted(g.parent.name for g in (ROOT / "games").glob("*/index.js"))
        ids = pg.evaluate("() => window.BubHub ? BubHub.registry.map(g => g.meta.id) : null")
        check("the built bundle registers every module game (%d)" % len(module_ids),
              sorted(i for i in ids if i in module_ids), module_ids)

        # ---- the multiplayer menu is grouped and ordered.
        # #game-buttons lives inside #room-ui, which is display:none until you
        # are in a room, so read the markup with the drawer forced open rather
        # than hosting a room: this is about the buttons, not the network.
        pg.evaluate("() => { document.getElementById('room-ui').classList.remove('hidden'); }")
        groups = pg.evaluate("""() => {
            const box = document.getElementById('game-buttons');
            if (!box) return null;
            return Array.from(box.children).map((sec) => ({
              title: sec.querySelector('h3').textContent,
              ids: Array.from(sec.querySelectorAll('button'))
                    .map((b) => (b.id || '').replace('btn-room-', ''))
            }));
        }""")
        titles = [g["title"] for g in groups] if groups else []
        check("the small tables are their own group",
              titles[:1], ["Two or three players"])
        check("the 2-8 crowd is the next group",
              titles[1:2], ["Two to eight players"])
        if groups and len(groups) > 0:
            check("chess, minigo, goldberg and warp lead the small group",
                  groups[0]["ids"][:4], ["chess", "minigo", "goldberg", "warp"])
        if groups and len(groups) > 1:
            check("the 2-8 group is in the asked-for order",
                  groups[1]["ids"][:5],
                  ["mucking", "eggs", "hook", "dotreturn", "the96game"])

        # ---- every button says how many players it takes
        counts = pg.evaluate("""() => {
            const out = {};
            document.querySelectorAll('#game-buttons button').forEach((b) => {
              const id = (b.id || '').replace('btn-room-', '');
              const s = b.querySelector('small');
              if (id && s) out[id] = s.textContent;
            });
            return out;
        }""")
        check("Goldberg says 2-3", counts.get("goldberg"), "2-3 players")
        check("Chess says 2", counts.get("chess"), "2 players")
        check("Focus says 2-8", counts.get("dotreturn"), "2-8 players")
        check("LOTR says 2-8", counts.get("lotr"), "2-8 players")

        # ---- open a module game, leave it, open a LEGACY game, come back.
        # This is the regression: stage.clear() used to wipe the iframes out of
        # the DOM while compat.frames kept the cache, so the second visit to
        # any legacy game opened a blank stage with no error anywhere.
        pg.click("#btn-room-hook")
        pg.wait_for_selector("#game-stage .stage-host", timeout=5000)
        check("the hook shadow root mounts",
              pg.evaluate("() => !!document.querySelector('#game-stage .stage-host').shadowRoot"), True)
        check("hook draws its title",
              pg.evaluate("""() => {
                  const s = document.querySelector('#game-stage .stage-host').shadowRoot;
                  const h = s && s.querySelector('h1');
                  return h ? h.textContent : null; }"""),
              "What's the Hook?")

        pg.click("#btn-focus-exit")
        pg.wait_for_timeout(300)
        check("leaving the game unmounts the shadow root",
              pg.evaluate("() => !document.querySelector('#game-stage .stage-host')"), True)

        pg.click("#btn-room-chess")
        pg.wait_for_selector("#frame-chess", timeout=5000)
        pg.wait_for_timeout(1500)
        check("a legacy game opens a frame",
              pg.evaluate("() => { const f = document.getElementById('frame-chess');"
                          " return !!f && f.isConnected && !f.classList.contains('hidden'); }"), True)

        # away to a module game and back: the frame must still be alive
        pg.click("#btn-focus-exit")
        pg.wait_for_timeout(200)
        pg.click("#btn-room-dOTRETURN") if False else None
        pg.evaluate("() => BubHub.openGame('eggs')")
        pg.wait_for_selector("#game-stage .stage-host", timeout=5000)
        pg.wait_for_timeout(400)
        check("switching to a module game hides the legacy frame",
              pg.evaluate("() => document.getElementById('frame-chess').classList.contains('hidden')"), True)

        pg.click("#btn-focus-exit")
        pg.wait_for_timeout(200)
        pg.evaluate("() => BubHub.openGame('chess')")
        pg.wait_for_timeout(1500)
        check("coming back, the legacy frame is still in the document",
              pg.evaluate("() => { const f = document.getElementById('frame-chess');"
                          " return !!f && f.isConnected && !f.classList.contains('hidden'); }"), True)
        check("coming back, the legacy frame is a real browsing context",
              pg.evaluate("() => { try { return !!document.getElementById('frame-chess').contentWindow;"
                          " } catch (e) { return false; } }"), True)

        # ---- a New room button exists and is reachable from the drawer
        check("there is a New room button", pg.evaluate("() => !!document.getElementById('btn-new-room')"), True)
        check("the menu button says where it goes",
              pg.evaluate("() => document.getElementById('btn-focus-exit').textContent.trim()"),
              "← Games")

        # ---- the wire log is reachable
        check("BubHub.log() is callable",
              pg.evaluate("() => Array.isArray(BubHub.log())"), True)
        # modState is a Map, not a function: it is the table map, and reading
        # it is how you see whether a room change actually cleared it.
        check("BubHub exposes the switch helpers",
              pg.evaluate("() => ['leaveOpenGame','newRoom','hostRoom','joinRoom','getNet']"
                          ".every(k => typeof BubHub[k] === 'function')"), True)
        check("BubHub exposes the table map", pg.evaluate("() => BubHub.modState instanceof Map"), True)

        if errors:
            print("PAGE ERRORS:", errors, file=sys.stderr)
        br.close()

    bad = len(fails) + len(errors)
    print()
    print("%d/%d built-hub checks passed" % (len(oks) + len(errors) - bad,
                                             len(oks) + len(errors)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())