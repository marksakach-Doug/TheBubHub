#!/usr/bin/env python3
"""BubHub Record: durability and dedupe.

Covers the two ways the record used to lose or corrupt a line, both of which
looked identical from the outside — "it didn't record anything":

  * **Wrong dedupe key.** The 30-second throttle keyed on the *sentence*, so
    two genuine games that produced the same line inside 30 seconds wrote once
    (a real result dropped), while a summarize() that keeps re-succeeding on
    every reduce() wrote over and over (the sheet filled with duplicates the
    list on screen never showed). Rounds are now keyed on the round id the game
    reports, so both are distinguishable.

  * **Fire-and-forget writes.** A failed write was displayed optimistically and
    then silently gone on the next load. Lines now go through a localStorage
    outbox that survives a reload and retries.

Runs the real `plugins/record.js` in a real page with a stubbed `fetch`, on a
real http origin so localStorage works.

    pip install playwright && playwright install chromium
    python3 tests/record_durability_test.py
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
RECORD_JS = ROOT / "plugins" / "record.js"
OUTBOX_KEY = "bubhub.record.outbox.v1"

PAGE = """<!DOCTYPE html><html><body>
<ul id="record-list-lobby"></ul><button id="record-more-lobby"></button>
<span id="record-status-lobby"></span>
</body></html>"""


def serve():
    """A real origin, so localStorage is a real (durable) store."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=str(ROOT))
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d/README.md" % httpd.server_address[1]


# Each case: (label, script-body, expected)
# `m` is the stub module the hub hands recordModule via getModule.
CASES = [
    # ---- the round is recorded once, however many times reduce() reports it
    (
        "same round reported twice writes one line",
        """
          mod = { summarize: () => 'Sam let the dot get away for 6.2 seconds',
                        roundId: (s) => 'e' + s.epoch };
          rec.recordModule(meta, { epoch: 3 });
          rec.recordModule(meta, { epoch: 3 });
          rec.recordModule(meta, { epoch: 3 });
          await settle();
          return { listed: rec.listed().length, posts: writes.length };
        """,
        {"listed": 1, "posts": 1},
    ),
    # ---- the regression that mattered: two equal scores are two real games
    (
        "two rounds with the same score are both recorded",
        """
          mod = { summarize: () => 'Sam let the dot get away for 6.2 seconds',
                        roundId: (s) => 'e' + s.epoch };
          rec.recordModule(meta, { epoch: 3 });
          rec.recordModule(meta, { epoch: 4 });   // same score, seconds later
          await settle();
          return { listed: rec.listed().length, posts: writes.length };
        """,
        {"listed": 2, "posts": 2},
    ),
    # ---- legacy games: two identical results from two different instances
    (
        "two legacy results with different inst ids are both recorded",
        """
          rec.recordLegacy(meta, { inst: 'waltz-1', text: 'Sam scored 7 at Waltz Engine' });
          rec.recordLegacy(meta, { inst: 'waltz-2', text: 'Sam scored 7 at Waltz Engine' });
          await settle();
          return { listed: rec.listed().length, posts: writes.length };
        """,
        {"listed": 2, "posts": 2},
    ),
    # ---- no round id to go on: the old sentence throttle still applies, or a
    # game that re-reports its result would write it forever
    (
        "a game that reports no round id is still deduped",
        """
          mod = { summarize: () => 'Sam played a mystery game' };
          rec.recordModule(meta, {});
          rec.recordModule(meta, {});
          await settle();
          return { listed: rec.listed().length, posts: writes.length };
        """,
        {"listed": 1, "posts": 1},
    ),
    # ---- a refused action must never leave a line
    (
        "no summarize text means nothing recorded",
        """
          mod = { summarize: () => null, roundId: (s) => 'e' + s.epoch };
          rec.recordModule(meta, { epoch: 1 });
          await settle();
          return { listed: rec.listed().length, posts: writes.length };
        """,
        {"listed": 0, "posts": 0},
    ),
    # ---- the sheet echoing our own write back must not double the list
    (
        "our own write echoed back by the sheet is not shown twice",
        """
          mod = { summarize: () => 'Sam scored 7 at Waltz Engine',
                        roundId: () => 'w1' };
          rec.recordModule(meta, {});
          rec.ingest([{ kind: 'bub', game: 'waltz', text: 'Sam scored 7 at Waltz Engine',
                        date: today() }]);
          await settle();
          return { listed: rec.listed().length };
        """,
        {"listed": 1},
    ),
    # ---- durability: a line written offline survives, and drains on retry
    (
        "a failed write is queued and survives a reload",
        """
          fail = true;
          mod = { summarize: () => 'Sam let the dot get away for 6.2 seconds',
                        roundId: () => 'e1' };
          rec.recordModule(meta, {});
          await settle();
          return {
            listed: rec.listed().length,
            pending: rec.pending().length,
            stored: JSON.parse(localStorage.getItem('bubhub.record.outbox.v1') || '[]').length
          };
        """,
        {"listed": 1, "pending": 1, "stored": 1},
    ),
    (
        "the queue drains once the connection returns",
        """
          fail = true;
          mod = { summarize: () => 'Sam let the dot get away for 6.2 seconds',
                        roundId: () => 'e1' };
          rec.recordModule(meta, {});
          await settle();
          fail = false;
          rec.flush();
          await settle();
          return {
            pending: rec.pending().length,
            stored: localStorage.getItem('bubhub.record.outbox.v1'),
            listed: rec.listed().length
          };
        """,
        {"pending": 0, "stored": None, "listed": 1},
    ),
    # ---- a queue left by an earlier session is flushed on load
    (
        "a queue left by a previous session is written on the next load",
        """
          // already in localStorage from the setup above; a fresh plugin instance
          // picks it up and drains it
          fail = true;
          rec2.recordLine('waltz', 'Zaphod scored 4 at Waltz Engine');
          await settle();
          const queued = rec2.pending().length;
          fail = false;
          rec2.load();
          await settle();
          return { queued: queued, pending: rec2.pending().length,
                   listed: rec2.listed().length };
        """,
        {"queued": 1, "pending": 0, "listed": 1},
    ),
]

HARNESS = """
  const writes = [];
  let fail = false;
  window.fetch = function (url) {
    writes.push(String(url));
    if (fail) return Promise.reject(new Error('offline'));
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve({ entries: [] }); }
    });
  };
  function today() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function settle() {
    return new Promise(r => setTimeout(r, 400));
  }
  const store = {
    state: { me: { id: 'w1', name: 'Sam' }, roster: [], inRoom: false, isHost: true }
  };
  // `mod` is the game module the hub would have loaded; each case swaps in its
  // own so recordModule() gets something real to summarize.
  let mod = null;
  const rec = window.__rec({ store, getNet: () => null, getModule: () => mod });
  const rec2 = window.__rec({ store, getNet: () => null, getModule: () => mod });
  const meta = { id: 'waltz', title: 'Waltz Engine' };
"""


def main():
    src = RECORD_JS.read_text(encoding="utf-8")
    # plugins/record.js is an ES module; strip the export keyword so the
    # classic-script injector can expose it without a module loader.
    src = src.replace("export function", "function")
    src += "\nwindow.__rec = createRecord;\n"

    httpd, url = serve()
    bad = 0
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()
            # Seed a pending line from a "previous session" before boot.
            pg = br.new_page()
            pg.goto(url)
            pg.set_content(PAGE)
            pg.evaluate(
                "k => localStorage.setItem(k, JSON.stringify(["
                "{game:'waltz',text:'Sam cooked Moong scoring 8420 at Dal Tadka',date:'2026-01-01'}]))",
                OUTBOX_KEY,
            )

            for label, body, want in CASES:
                pg2 = br.new_page()
                pg2.goto(url)
                pg2.set_content(PAGE)
                pg2.add_script_tag(content=src)
                try:
                    got = pg2.evaluate(
                        "async () => {" + HARNESS + body + "}"
                    )
                except Exception as exc:  # noqa: BLE001
                    print("  FAIL " + label + ": threw " + str(exc))
                    bad += 1
                    pg2.close()
                    continue
                ok = got == want
                bad += not ok
                print(("  ok   " if ok else "  FAIL ") + label)
                if not ok:
                    print("         got:  " + json.dumps(got, sort_keys=True))
                    print("         want: " + json.dumps(want, sort_keys=True))
                pg2.close()
            br.close()
    finally:
        httpd.shutdown()

    print()
    print("%d/%d durability checks passed" % (len(CASES) - bad, len(CASES)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())