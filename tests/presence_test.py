#!/usr/bin/env python3
"""Presence has to reach the host, or a guest's table is empty to the game.

`T.PRESENCE` was declared in net/protocol.js and handled on arrival
(src/main.js), but nothing ever sent it. So a guest who opened a game told
only their own machine; the host still held an empty `atTable`, handed the
game an empty table, and Hook answered by inventing a "Player 0" seat that
nobody could ever lock in. Leaving a game had the mirror problem: the seat
was never released, so the table list said people were playing forever.

Half of this test is behaviour (the store really does clear a seat on
presence). The other half is a wiring guard on src/main.js: these are the
lines that decide whether a guest's presence ever leaves their machine, and
they are exactly the kind of thing that gets deleted in a refactor without
anyone noticing, because nothing crashes when they go.

    pip install playwright && playwright install chromium
    python3 tests/presence_test.py
"""
import functools
import http.server
import json
import pathlib
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE_JS = ROOT / "room" / "store.js"
PROTOCOL_JS = ROOT / "net" / "protocol.js"
MAIN_JS = ROOT / "src" / "main.js"

# (label, expression, expected) — the store's own behaviour.
STORE_CASES = [
    ("presence marks the table a member is at",
     "store.openRoom('abc', false); store.upsertMember({ id: 'g1', name: 'Zoe' });"
     " store.setPresence('g1', 'hook');"
     " return s.roster.filter(function (m) { return m.game === 'hook'; }).length;",
     1),

    ("clearing presence empties that table",
     "store.openRoom('abc', false); store.upsertMember({ id: 'g1', name: 'Zoe' });"
     " store.setPresence('g1', 'hook'); store.setPresence('g1', null);"
     " return s.roster.filter(function (m) { return m.game === 'hook'; }).length;",
     0),

    ("moving to another table leaves the old one",
     "store.openRoom('abc', false); store.upsertMember({ id: 'g1', name: 'Zoe' });"
     " store.setPresence('g1', 'hook'); store.setPresence('g1', 'dotreturn');"
     " return s.roster.filter(function (m) { return m.id === 'g1'; })[0].game;",
     "dotreturn"),

    ("another member at the table is untouched",
     "store.openRoom('abc', false); store.upsertMember({ id: 'g1', name: 'Zoe' });"
     " store.upsertMember({ id: 'g2', name: 'Sam' });"
     " store.setPresence('g1', null); store.setPresence('g2', 'hook');"
     " return s.roster.filter(function (m) { return m.game === 'hook'; }).length;",
     1),
]

# (label, needle) — the wiring in src/main.js that makes presence reach the host.
WIRING = [
    ("opening a game tells the host which table you are at",
     "msg(T.PRESENCE, { id: s.me.id, game: id })"),
    ("only a guest sends it — the host owns the roster already",
     "if (!s.isHost && net)"),
    ("leaving a game releases the seat",
     "msg(T.PRESENCE, { id: s.me.id, game: null })"),
    ("leaving a game goes through one helper, used by the button and by Esc",
     "function leaveOpenGame()"),
    ("a departed player is taken out of the game they left",
     "pruneOneGame(was, m.p.id)"),
    ("a game's own prune wins over the shared one",
     "typeof st.mod.prune === 'function'"),
    ("intents say who the host is, so a game can gate on it",
     "host: !!s.isHost"),
]


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d/README.md" % httpd.server_address[1]


def load_js(path, extra=""):
    src = path.read_text(encoding="utf-8")
    src = src.replace("export function", "function")
    src = src.replace("export { T };", "")
    src = src.replace("export const T = {", "const T = {")
    src = "\n".join(l for l in src.splitlines() if not l.startswith("import "))
    assert "export " not in src, path
    return src + extra


def main():
    store = load_js(STORE_JS, "\nwindow.__store = createStore;\n")
    store += load_js(PROTOCOL_JS)
    httpd, url = serve()
    bad = total = 0
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()
            pg = br.new_page()
            pg.goto(url)
            pg.add_script_tag(content=store)
            for label, body, want in STORE_CASES:
                got = pg.evaluate(
                    "() => { const store = window.__store(); const s = store.state;"
                    " s.me = { id: 'me', name: 'Sam' };" + body + " }"
                )
                total += 1
                ok = got == want
                bad += not ok
                print(("  ok   " if ok else "  FAIL ") + label)
                if not ok:
                    print("         got:  " + json.dumps(got))
                    print("         want: " + json.dumps(want))
            br.close()
    finally:
        httpd.shutdown()

    main_src = MAIN_JS.read_text(encoding="utf-8")
    for label, needle in WIRING:
        total += 1
        ok = needle in main_src
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + label)
        if not ok:
            print("         src/main.js does not contain: " + needle)

    print()
    print("%d/%d presence checks passed" % (total - bad, total))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())