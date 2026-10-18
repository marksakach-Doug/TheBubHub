#!/usr/bin/env python3
"""Chess click-capture tests in a real browser.

Drives the actual board UI in public/chess.html: select a piece, check the
capture marker (ring) appears on an enemy-occupied square, click it, and
check the capture lands. Positions are injected through the same
postMessage state sync a guest would receive, then completed with real
mouse clicks (plus one drag-capture) — so this exercises selection,
rendering markers, and the humanMove click path, not just the rules.

Knight captures are the regression (they were silently illegal, so clicks
did nothing); king/queen captures and a short solo opening lock the rest.

    pip install playwright && playwright install chromium
    python3 tests/chess_capture_play.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "public" / "chess.html").resolve().as_uri()

EMPTY = "." * 64


def board_of(placements):
    """placements: dict square-name -> piece char. Kings added if missing."""
    files = "abcdefgh"
    b = ["."] * 64
    for sq, piece in placements.items():
        b[files.index(sq[0]) + (8 - int(sq[1])) * 8] = piece
    # both kings must exist or legal() filters everything via check logic
    if "K" not in b:
        b[files.index("h") + (8 - 1) * 8] = "K"  # h1
    if "k" not in b:
        b[files.index("a") + (8 - 8) * 8] = "k"  # a8
    return b


def inject(frame, placements, turn="w"):
    state = {
        "b": board_of(placements),
        "turn": turn,
        "cw": {"w": [False, False], "b": [False, False]},
        "ep": -1, "half": 0, "full": 1,
        "over": None, "lastMove": None, "offer": None,
        "seats": {"w": "tester", "b": None}, "soloOrigin": True,
    }
    frame.evaluate(
        """(st) => window.postMessage(
             { t: 'gd', game: 'chess', k: 'state', p: st }, '*')""",
        state,
    )


def glyph(frame, sq):
    el = frame.query_selector(f"#board .sq[data-sq='{sq}'] .pc")
    return el.inner_text() if el else None


def main():
    fails = []
    oks = []

    def check(name, got, want):
        ok = got == want
        (oks if ok else fails).append(name)
        print(("PASS  " if ok else "FAIL  ") + f"{name}: got={got!r} want={want!r}")

    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 900, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL)
        pg.wait_for_timeout(1600)  # localSolo fallback claims the White seat
        pg.click("#btn-solo")
        pg.wait_for_timeout(400)

        sq_index = lambda nm: "abcdefgh".index(nm[0]) + (8 - int(nm[1])) * 8
        E4, D6 = sq_index("e4"), sq_index("d6")

        # ---- knight click-capture (the reported bug) ----
        inject(pg, {"e4": "N", "d6": "p", "f6": "p"})
        pg.wait_for_timeout(300)
        pg.click(f"#board .sq[data-sq='{E4}']")
        pg.wait_for_timeout(300)
        check("knight_select_shows_ring_on_d6",
              pg.evaluate(f"()=>!!document.querySelector(\"#board .sq[data-sq='{D6}'] .ring\")"), True)
        pg.click(f"#board .sq[data-sq='{D6}']")
        pg.wait_for_timeout(300)
        check("knight_click_capture_lands", glyph(pg, str(D6)), "N")
        check("knight_origin_empty", glyph(pg, str(E4)), None)

        # ---- king click-capture ----
        E5, D5 = sq_index("e5"), sq_index("d5")
        inject(pg, {"e5": "K", "d5": "p"})
        pg.wait_for_timeout(300)
        pg.click(f"#board .sq[data-sq='{E5}']")
        pg.wait_for_timeout(300)
        check("king_select_shows_ring_on_d5",
              pg.evaluate(f"()=>!!document.querySelector(\"#board .sq[data-sq='{D5}'] .ring\")"), True)
        pg.click(f"#board .sq[data-sq='{D5}']")
        pg.wait_for_timeout(300)
        check("king_click_capture_lands", glyph(pg, str(D5)), "K")

        # ---- queen drag-capture ----
        D1, D7 = sq_index("d1"), sq_index("d7")
        inject(pg, {"d1": "Q", "d7": "p"})
        pg.wait_for_timeout(300)
        src = pg.query_selector(f"#board .sq[data-sq='{D1}']").bounding_box()
        dst = pg.query_selector(f"#board .sq[data-sq='{D7}']").bounding_box()
        pg.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
        pg.mouse.down()
        pg.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] / 2, steps=8)
        pg.mouse.up()
        pg.wait_for_timeout(300)
        check("queen_drag_capture_lands", glyph(pg, str(D7)), "Q")

        # ---- en passant via clicks (white e5 takes d6, victim off d5) ----
        E5B, D6B = sq_index("e5"), sq_index("d6")
        pg.evaluate(
            """() => window.postMessage({ t: 'gd', game: 'chess', k: 'state', p: {
                 b: (() => { const b = Array(64).fill('.');
                   b[27] = 'p'; b[28] = 'P'; b[60] = 'K'; b[0] = 'k'; return b; })(),
                 turn: 'w', cw: { w: [false,false], b: [false,false] },
                 ep: 19, half: 0, full: 1, over: null, lastMove: null,
                 offer: null, seats: { w: 'tester', b: null }, soloOrigin: true } }, '*')""")
        pg.wait_for_timeout(300)
        pg.click(f"#board .sq[data-sq='{E5B}']")
        pg.wait_for_timeout(300)
        check("ep_select_shows_ring_on_d6",
              pg.evaluate(f"()=>!!document.querySelector(\"#board .sq[data-sq='{D6B}'] .ring\")"), True)
        pg.click(f"#board .sq[data-sq='{D6B}']")
        pg.wait_for_timeout(300)
        check("ep_click_capture_lands", glyph(pg, str(D6B)), "P")
        check("ep_victim_removed",
              pg.evaluate("()=>!document.querySelector(\"#board .sq[data-sq='27'] .pc\")"), True)

        # ---- fresh solo game: opening moves still flow (bot replies) ----
        pg.click("#btn-new")
        pg.wait_for_timeout(400)
        check("new_game_has_32_pieces",
              pg.evaluate("()=>document.querySelectorAll('#board .pc').length"), 32)
        pg.click(f"#board .sq[data-sq='{sq_index('e2')}']")
        pg.wait_for_timeout(250)
        check("pawn_select_shows_two_dots",
              pg.evaluate("()=>document.querySelectorAll('#board .dot').length"), 2)
        pg.click(f"#board .sq[data-sq='{sq_index('e4')}']")
        pg.wait_for_timeout(1500)  # bot reply lands
        check("bot_replied_after_e4",
              pg.evaluate("()=>document.getElementById('status').textContent"), "White to move")
        pg.click(f"#board .sq[data-sq='{sq_index('g1')}']")
        pg.wait_for_timeout(300)
        # e2 is empty after 1.e4, so Ng1 has three destinations: f3, h3, e2.
        check("knight_select_shows_three_dots",
              pg.evaluate("()=>document.querySelectorAll('#board .dot').length"), 3)

        # ---- one piece set for both sides ----
        # White used to be hollow chess glyphs (U+2654-5) and Black solid ones
        # (U+2656-7). A phone whose font lacks that block fell back to emoji for
        # one side and not the other, so Black's pieces looked like a different
        # game. Letters render the same everywhere, so both sides must now use
        # the same character and differ only by colour.
        distinct = pg.evaluate("""() => {
            const cells = [...document.querySelectorAll('#board .sq')];
            const letter = (c) => (c ? c.textContent : '');
            const kinds = new Set();
            cells.forEach((sq) => {
              const pc = sq.querySelector('.pc');
              if (pc) kinds.add(pc.className.replace(/\\s+/g,'') + ':' + pc.textContent);
            });
            return [...kinds].sort();
        }""")
        check("white and black share one letter per piece kind",
              all(len(k.split(':')[1]) == 1 for k in distinct), True)
        check("no chess-block glyphs are left on the board",
              pg.evaluate("""() => [...document.querySelectorAll('#board .pc')]
                  .some((p) => /[\\u2654-\\u265F]/.test(p.textContent))"""), False)
        # The white pawn on e2 and a black pawn must be the same character.
        check("white and black pawns are the same character",
              pg.evaluate(f"""() => {{
                  const w = document.querySelector("#board .sq[data-sq='{sq_index('d2')}'] .pc");
                  return w ? w.textContent : null; }}"""), "P")

        if errs:
            print("PAGE ERRORS:", errs, file=sys.stderr)
        br.close()

    print(f"\n{len(oks)}/{len(oks) + len(fails)} ui assertions passed")
    return 1 if fails or errs else 0


if __name__ == "__main__":
    sys.exit(main())
