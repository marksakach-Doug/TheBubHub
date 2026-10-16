#!/usr/bin/env python3
"""Solo is a room of one, and it has a host.

The solo branch of `openGame()` in src/main.js used to leave `isHost` false. The
comment right above it said the opposite — "Solo Corner is a room of one: inRoom
false, isHost true" — but nothing set it, so every legacy iframe was handed
`you.isHost: false` by compat.js's legacyRoster().

That flag is how a solo iframe decides its whole table. Chess and Word Bridge
read it directly (`const isHost = () => localSolo || !!Hub.me.isHost`), so a
solo player got: no bot moves, no rematch button, and reportResult() returning
early. Nothing was ever recorded. The games that work in solo all derive it
from `!Hub.room` instead; these tests pin the flag so that stops depending on
which style each game happens to use.

    pip install playwright && playwright install chromium
    python3 tests/solo_host_test.py
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
COMPAT_JS = ROOT / "src" / "compat.js"
PROTOCOL_JS = ROOT / "net" / "protocol.js"


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=str(ROOT))
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d/README.md" % httpd.server_address[1]


def load_js(path, extra=""):
    src = path.read_text(encoding="utf-8")
    # These are ES modules; the classic-script injector has no loader. Strip
    # both export forms and the import lines — nothing here actually needs a
    # cross-module binding, and one leftover `export` aborts the whole script.
    src = src.replace("export function", "function")
    src = src.replace("export { T };", "")
    src = src.replace("export const T = {", "const T = {")
    src = "\n".join(l for l in src.splitlines()
                    if not l.startswith("import "))
    assert "export " not in src, path
    return src + extra


CASES = [
    # (label, expression run in the page, expected value)
    ("openSolo makes you host with no room",
     "store.openSolo(); return { isHost: s.isHost, inRoom: s.inRoom, host: s.hostId };",
     {"isHost": True, "inRoom": False, "host": "me"}),

    ("solo Corner starts with no host",
     "return { isHost: s.isHost, inRoom: s.inRoom };",
     {"isHost": False, "inRoom": False}),

    # A spectator check that keys off !inRoom must not start refusing seats
    # because a solo player is now the host.
    ("a solo host is never a spectator",
     "store.openSolo(); store.setOpenGame('dotreturn'); return store.isSpectator();",
     False),

    # Hosting a real room afterwards still works, and leaving it drops the
    # flag again rather than leaving a stale host behind.
    ("hosting a real room after solo still works",
     "store.openSolo(); store.openRoom('abc', true); return { isHost: s.isHost, inRoom: s.inRoom, room: s.roomId };",
     {"isHost": True, "inRoom": True, "room": "abc"}),

    ("leaving a room clears the host flag",
     "store.openRoom('abc', true); store.closeRoom(); return { isHost: s.isHost, inRoom: s.inRoom };",
     {"isHost": False, "inRoom": False}),

    # The whole point: what an iframe is told. This is the value chess.html and
    # wordbridge.html branch on.
    ("a solo iframe is told it is the host",
     "store.openSolo(); store.upsertMember({ id: 'me', name: 'Sam' });"
     " return window.__roster(store).you.isHost;",
     True),

    ("a room guest is still told it is not the host",
     "store.openRoom('abc', false); store.upsertMember({ id: 'g1', name: 'Zaphod' });"
     " store.setMe('g1', 'Zaphod'); return window.__roster(store).you.isHost;",
     False),
]


def main():
    src = (load_js(STORE_JS, "\nwindow.__store = createStore;\n")
           + load_js(COMPAT_JS, "\nwindow.__roster = legacyRoster;\n")
           + load_js(PROTOCOL_JS))
    httpd, url = serve()
    bad = 0
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()
            pg = br.new_page()
            pg.goto(url)
            pg.add_script_tag(content=src)
            for label, body, want in CASES:
                got = pg.evaluate(
                    "() => { const store = window.__store(); const s = store.state;"
                    " s.me = { id: 'me', name: 'Sam' };" + body + " }"
                )
                ok = got == want
                bad += not ok
                print(("  ok   " if ok else "  FAIL ") + label)
                if not ok:
                    print("         got:  " + json.dumps(got))
                    print("         want: " + json.dumps(want))
            br.close()
    finally:
        httpd.shutdown()

    print()
    print("%d/%d solo-host checks passed" % (len(CASES) - bad, len(CASES)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())