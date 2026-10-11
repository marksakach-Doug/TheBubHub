#!/usr/bin/env python3
"""Chess live-flow tests in a real browser.

Covers the things a rules test can't see: solo vs the bot, takeback, phone
layout, Black-seat claiming, spectators, and "keep the solo game running when a
room appears".

PeerJS can't reach a real second peer in a sandbox, so the two-player half
injects the same roster/state/intent messages the hub would deliver. That still
exercises the host's seat enforcement and each client's read-only UI.

    pip install playwright && playwright install chromium
    python3 tests/chess_play.py
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = (ROOT / "index.html").resolve().as_uri()
START = "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR"
HOST, G1, G2 = "p-host", "p-g1", "p-g2"
OUT = {}

POST = "(msg) => window.postMessage(msg, '*')"
NAMES = {HOST: "Host", G1: "Guest", G2: "Guest2"}

# every page records the `result` messages its game frames send up, so a test
# can assert on what lands in BubHub Record.
RESULTS = [[]]


def spy_results(pg):
    pg.expose_function("__result", lambda s: RESULTS[0].append(json.loads(s)))
    pg.evaluate(
        """() => window.addEventListener('message', e => {
             const m = e.data;
             if (m && m.t === 'gu' && m.k === 'result') window.__result(JSON.stringify(m.p));
           })""")


def roster(you, is_host, room="rtest"):
    members = [{"id": i, "name": n, "host": (i == HOST)} for i, n in NAMES.items()]
    if you not in NAMES:                       # the page's own (pre-room) id
        members = [{"id": you, "name": "Tester", "host": True}] + members
    return {"t": "gd", "game": "chess", "k": "roster", "p": {
        "you": {"id": you, "name": NAMES.get(you, "Tester"), "isHost": is_host},
        "roster": members, "room": room}}


def state(seats, solo_origin=False, turn="b"):
    return {"t": "gd", "game": "chess", "k": "state", "p": {
        "b": list(START), "turn": turn, "cw": {"w": [True, True], "b": [True, True]},
        "ep": -1, "half": 0, "full": 1, "over": None, "lastMove": None,
        "offer": None, "seats": seats, "soloOrigin": solo_origin}}


def intent(who, payload, name="Guest"):
    return {"t": "gd", "game": "chess", "k": "intent", "p": payload,
            "from": {"id": who, "name": name}}


def boot(br, width=1180, height=1050, mobile=False):
    ctx = br.new_context(viewport={"width": width, "height": height},
                         **({"is_mobile": True, "has_touch": True} if mobile else {}))
    pg = ctx.new_page()
    pg.goto(BASE)
    pg.wait_for_timeout(800)
    spy_results(pg)
    pg.fill("#welcome-name", "Tester")
    pg.click("#btn-welcome-go")
    pg.wait_for_timeout(300)
    return ctx, pg


def open_chess(pg):
    pg.click("#btn-lobby-chess")
    pg.wait_for_timeout(2400)
    return pg.query_selector("#frame-chess").content_frame()


def main():
    with sync_playwright() as p:
        br = p.chromium.launch()
        errs = []

        # ---------- solo: bot replies, takeback, resign ----------
        _, pg = boot(br)
        pg.on("pageerror", lambda e: errs.append("solo: " + str(e)))
        f = open_chess(pg)
        f.click("#btn-solo")
        pg.wait_for_timeout(600)
        OUT["solo_pieces"] = f.evaluate("()=>document.querySelectorAll('#board .pc').length")

        f.click("#board .sq[data-sq='52']")
        pg.wait_for_timeout(250)
        OUT["dots_on_select"] = f.evaluate("()=>document.querySelectorAll('#board .dot').length")
        f.click("#board .sq[data-sq='36']")          # e4
        pg.wait_for_timeout(1600)
        OUT["bot_replied"] = f.evaluate(
            "()=>document.getElementById('status').textContent") == "White to move"

        # drag d2 -> d4 with real mouse events
        src = f.query_selector("#board .sq[data-sq='51']").bounding_box()
        dst = f.query_selector("#board .sq[data-sq='35']").bounding_box()
        pg.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
        pg.mouse.down()
        pg.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] / 2, steps=8)
        pg.wait_for_timeout(120)
        OUT["drag_ghost"] = f.evaluate("()=>!!document.querySelector('.pc.ghost')")
        pg.mouse.up()
        pg.wait_for_timeout(1500)
        OUT["drag_moved"] = f.evaluate(
            "()=>!!document.querySelector(\"#board .sq[data-sq='35'] .pc\")")

        def sig():
            return f.evaluate(
                "()=>[...document.querySelectorAll('#board .sq')]"
                ".map(e=>e.dataset.sq+':'+((e.querySelector('.pc')||{textContent:'.'}).textContent)).join(',')"
            )

        start = sig()
        f.click("#btn-takeback")
        pg.wait_for_timeout(1400)
        OUT["takeback_changes_board"] = sig() != start
        # a takeback must not un-seat anyone (the snapshot carries the seats)
        OUT["takeback_keeps_you_seated"] = f.evaluate(
            "()=>document.getElementById('pn1').textContent").startswith("You (White)")

        f.click("#btn-resign")
        pg.wait_for_timeout(400)
        OUT["resign"] = f.evaluate("()=>document.getElementById('status').textContent")

        # BubHub Record: a finished game leaves one line. The payload is ids +
        # which colour won; the hub composes the sentence (see record_test.py).
        OUT["result_sent_once"] = len(RESULTS[0]) == 1
        OUT["result_payload"] = RESULTS[0][0] if RESULTS[0] else None
        pg.close()

        # ---------- keep the solo game running when a room appears ----------
        _, pg = boot(br)
        pg.on("pageerror", lambda e: errs.append("keepsolo: " + str(e)))
        f = open_chess(pg)
        myid = pg.evaluate("()=>myId")
        f.click("#btn-solo")
        pg.wait_for_timeout(700)
        OUT["solo_running_before_room"] = f.evaluate(
            "()=>document.getElementById('pn2').textContent")
        # a room shows up underneath (this is what the Invite button does)
        f.evaluate(POST, roster(myid, True))
        pg.wait_for_timeout(400)
        OUT["solo_table_survived_room"] = f.evaluate(
            "()=>document.querySelectorAll('#board .pc').length") == 32
        OUT["host_still_white"] = f.evaluate(
            "()=>document.getElementById('status').textContent")
        # host hands over to the bot; the bot must still fly with the room present
        f.click("#board .sq[data-sq='52']"); pg.wait_for_timeout(200)
        f.click("#board .sq[data-sq='36']"); pg.wait_for_timeout(3000)
        OUT["bot_still_moves_in_room"] = f.evaluate(
            "()=>document.getElementById('status').textContent") != "Black to move"
        OUT["feed_after_room"] = f.evaluate("()=>!!document.querySelector('#board .sq.last')")

        # a guest who arrives now is a read-only watcher of the solo game — and
        # stays one even after the host takes a move back (the takeback must
        # carry soloOrigin along, or Take Black would quietly reappear)
        wctx, wpg = boot(br)
        wpg.on("pageerror", lambda e: errs.append("watcher: " + str(e)))
        wf = open_chess(wpg)
        wf.evaluate(POST, roster(G1, False))
        wf.evaluate(POST, state({"w": myid, "b": None}, True, "w"))
        wpg.wait_for_timeout(500)
        OUT["watcher_of_solo_before_takeback"] = wf.evaluate(
            "()=>document.getElementById('btn-claim').classList.contains('hidden')")
        f.click("#btn-takeback")
        pg.wait_for_timeout(1400)
        OUT["watcher_of_solo_after_takeback"] = wf.evaluate(
            "()=>document.getElementById('btn-claim').classList.contains('hidden')")
        OUT["watcher_readonly_after_takeback"] = wf.evaluate(
            "()=>document.getElementById('btn-resign').disabled")
        wctx.close()
        pg.close()

        # ---------- seats, claims, spectators ----------
        _, hp = boot(br)
        gp_ctx, gp = boot(br)
        hp.on("pageerror", lambda e: errs.append("host: " + str(e)))
        gp.on("pageerror", lambda e: errs.append("guest: " + str(e)))
        fh = open_chess(hp)
        fg = open_chess(gp)

        fh.evaluate(POST, roster(HOST, True))
        hp.wait_for_timeout(400)
        fh.click("#btn-two")
        hp.wait_for_timeout(400)
        OUT["host_black_open"] = fh.evaluate("()=>document.getElementById('pn2').textContent")

        fg.evaluate(POST, roster(G1, False))
        fg.evaluate(POST, state({"w": HOST, "b": None}, False, "w"))
        gp.wait_for_timeout(500)
        OUT["guest_offers_take_black"] = not fg.evaluate(
            "()=>document.getElementById('btn-claim').classList.contains('hidden')")
        OUT["guest_status_seated_none"] = fg.evaluate("()=>document.getElementById('status').textContent")

        fh.evaluate(POST, intent(G1, {"a": "claim"}))
        hp.wait_for_timeout(400)
        OUT["seat_bound_to_guest1"] = fh.evaluate("()=>document.getElementById('pn2').textContent")

        fh.evaluate(POST, intent(G2, {"a": "claim"}, "Guest2"))
        hp.wait_for_timeout(300)
        OUT["seat_not_stolen"] = fh.evaluate("()=>document.getElementById('pn2').textContent") == "Guest"

        fg.evaluate(POST, intent(G2, {"a": "move", "from": 50, "to": 34}, "Guest2"))
        hp.wait_for_timeout(300)
        OUT["other_guest_move_ignored"] = fh.evaluate(
            "()=>!document.querySelector(\"#board .sq[data-sq='34'] .pc\")")

        # a watcher can't end the game with a crafted message: the buttons are
        # disabled, but the host must re-check the seat rather than trust them
        for a in ("draw", "accept", "resign", "decline"):
            fh.evaluate(POST, state({"w": HOST, "b": G1}, False, "w"))
            hp.wait_for_timeout(200)
            before = fh.evaluate("()=>document.getElementById('status').textContent")
            fh.evaluate(POST, intent(G2, {"a": a}, "Guest2"))
            hp.wait_for_timeout(300)
            OUT["watcher_cannot_" + a] = (
                fh.evaluate("()=>document.getElementById('status').textContent") == before
                and not fh.evaluate("()=>document.getElementById('status').textContent")
                             .endswith("wins"))

        # the seated Black player still can
        fh.evaluate(POST, intent(G1, {"a": "resign"}, "Guest"))
        hp.wait_for_timeout(400)
        OUT["black_can_resign"] = "resigned" in fh.evaluate(
            "()=>document.getElementById('status').textContent")

        fg.evaluate(POST, state({"w": HOST, "b": G1}, False, "b"))
        gp.wait_for_timeout(400)
        OUT["guest_is_black"] = fg.evaluate("()=>document.getElementById('pn2').textContent")
        fg.click("#board .sq[data-sq='10']")          # c7
        gp.wait_for_timeout(300)
        OUT["black_guest_can_move"] = fg.evaluate(
            "()=>document.querySelectorAll('#board .dot').length") == 2

        # spectator of a solo-origin table
        fg.evaluate(POST, roster(G2, False))
        fg.evaluate(POST, state({"w": HOST, "b": None}, True))
        gp.wait_for_timeout(500)
        OUT["spectator_no_claim"] = fg.evaluate(
            "()=>document.getElementById('btn-claim').classList.contains('hidden')")
        OUT["spectator_label"] = fg.evaluate("()=>document.getElementById('status').textContent")
        OUT["spectator_cannot_resign"] = fg.evaluate(
            "()=>document.getElementById('btn-resign').disabled")
        OUT["spectator_cannot_draw"] = fg.evaluate(
            "()=>document.getElementById('btn-draw').disabled")
        hp.close(); gp_ctx.close()

        # ---------- phone ----------
        _, pg = boot(br, width=390, height=780, mobile=True)
        pg.on("pageerror", lambda e: errs.append("phone: " + str(e)))
        f = open_chess(pg)
        f.click("#btn-solo")
        pg.wait_for_timeout(700)
        OUT["phone"] = f.evaluate(
            """() => { const b=document.getElementById('board').getBoundingClientRect();
                 return { fits: b.width <= window.innerWidth,
                          no_h_scroll: document.documentElement.scrollWidth <= window.innerWidth,
                          square_px: Math.round(b.width/8) }; }""")
        f.tap("#board .sq[data-sq='52']")
        pg.wait_for_timeout(350)
        OUT["phone_tap_selects"] = f.evaluate("()=>document.querySelectorAll('#board .dot').length")
        pg.close()

        print(json.dumps(OUT, indent=2))
        if errs:
            print("PAGE ERRORS:", json.dumps(errs), file=sys.stderr)
        br.close()
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
