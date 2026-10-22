#!/usr/bin/env python3
"""Drive the built VietGames site the way a child would.

This is the only check that proves the standalone port survived Vite:
  * /vietgames resolves to the landing page
  * the card opens /vietgames/chem-tu/
  * the game paints, starts, and reacts to a word tap
  * the sound asset is in the built bundle
  * the old Blade & Word button is gone from the hub menu

    python3 tests/vietgames_play.py <port>

Needs dist/ built (test.sh does it). Pass a port to reuse a running server.
"""
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
PORT = 5180


def check(cond, name, detail=""):
    if cond:
        print(f"  ok   {name}")
        return 0
    print(f"FAIL  {name}")
    if detail:
        for line in str(detail).split("\n"):
            print(f"        {line}")
    return 1


def serve(port):
    p = subprocess.Popen([sys.executable, "-m", "http.server", str(port)],
                         cwd=DIST, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    return p


def main():
    global PORT
    for arg in sys.argv[1:]:
        if arg.isdigit():
            PORT = int(arg)

    if not (DIST / "index.html").exists():
        print("FAIL  dist/ is missing — run bun run build first")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL  playwright is not installed — pip install playwright && playwright install chromium")
        return 1

    server = serve(PORT)
    base = f"http://127.0.0.1:{PORT}"
    results = []
    errors = []

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.on("pageerror", lambda exc: errors.append(str(exc)))

            # ---- landing page, including the no-trailing-slash URL ----
            response = page.goto(base + "/vietgames", wait_until="load")
            page.wait_for_timeout(300)
            results.append(check(response is not None and response.ok,
                                 "/vietgames serves a page",
                                 f"status {response.status if response else 'none'}"))
            results.append(check(page.url.rstrip("/").endswith("/vietgames"),
                                 "/vietgames resolves to the landing page",
                                 page.url))
            results.append(check(page.locator("h1.vg-title").count() == 1,
                                 "the landing page has its Vietnamese heading"))
            if page.locator("h1.vg-title").count():
                title = page.locator("h1.vg-title").inner_text()
                results.append(check(title == "Trò chơi tiếng Việt",
                                     "the heading is Vietnamese", title))

            results.append(check(page.locator("a.vg-card[href='./chem-tu/']").count() == 1,
                                 "the Chém Từ card links into the game folder"))

            # No horizontal scroll on a phone.
            overflow = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 2")
            results.append(check(not overflow, "the landing page fits a 390px phone"))

            # ---- the game ----
            page.locator("a.vg-card").first.click()
            page.wait_for_timeout(900)
            results.append(check(page.url.rstrip("/").endswith("/vietgames/chem-tu"),
                                 "the card opens /vietgames/chem-tu/", page.url))
            results.append(check(page.locator("#vietgames-game .bs-wrap").count() == 1,
                                 "the game mounts its board"))

            body = page.locator("body").inner_text()
            results.append(check("Chém Từ" in body, "the game is titled in Vietnamese"))
            results.append(check("Bắt đầu" in body, "the start button is in Vietnamese"))

            start = page.locator('.bs-btn[data-act="start"]')
            results.append(check(start.count() == 1, "the start button rendered"))
            if start.count():
                start.click()
                page.wait_for_timeout(400)
                hidden = page.evaluate(
                    "() => document.querySelector('.bs-overlay')?.hidden === true")
                results.append(check(hidden, "starting the round hides the intro overlay"))

                left = page.locator('.bs-word[data-side="left"]')
                results.append(check(left.count() == 1, "a swipe target is on screen"))
                if left.count():
                    left.click()
                    page.wait_for_timeout(400)
                    score = int(page.locator(".bs-score").inner_text() or "0")
                    lost = page.locator(".bs-life.lost").count()
                    results.append(check(score > 0 or lost > 0,
                                         "tapping a word changes score or lives",
                                         f"score={score}, lost lives={lost}"))

            # The sound has to be copied into the built site, not just public/.
            sound = page.request.get(base + "/vietgames/assets/hyah.mp3")
            results.append(check(sound.status == 200,
                                 "the slash sound ships in dist/",
                                 f"status {sound.status}"))

            # ---- the hub must not still offer the moved game ----
            page.goto(base + "/index.html", wait_until="load")
            page.wait_for_timeout(1200)
            if page.locator("#welcome-landing:not(.hidden)").count():
                page.click("#btn-welcome-go")
                page.wait_for_timeout(300)
            results.append(check(page.locator("#btn-lobby-bladeslash").count() == 0,
                                 "the hub no longer lists Blade & Word"))

            results.append(check(not errors, "no page errors",
                                 "\n".join(errors[:3])))
            browser.close()
    finally:
        server.terminate()

    failed = sum(results)
    print()
    if failed:
        print(f"{failed} check(s) failed")
        return 1
    print(f"all green ({len(results)} checks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
