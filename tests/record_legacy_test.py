#!/usr/bin/env python3
"""Tests for the LIVE legacy-record path in plugins/record.js.

`tests/record_test.py` exercises bub-record.js, which the v10 shell no longer
loads — it only proves the old sentence composer still works. This file
exercises the code path that actually runs when a legacy iframe game posts a
result: `describeLegacy()`, which reconstructs a sentence from the game's own
payload and resolves ids against the hub roster.

Without this, a legacy game that posts `{players, laps}` rather than a
pre-formatted `text` records nothing at all, silently. The rules here are a
port of bub-record.js's `sentence()`, so most expectations match
record_test.py's CASES exactly; where they differ, the comment says why.

    pip install playwright && playwright install chromium
    python3 tests/record_legacy_test.py
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
RECORD_JS = ROOT / "plugins" / "record.js"

NAMES = {"w1": "Sam", "b1": "Zaphod", "c1": "Trillian", "c2": "Marvin", "me": "Me"}

# meta, payload, expected line
CASES = [
    # ---- chess: players are [whiteId, blackId?], `bot` means black wasn't a
    # person, `won` is which colour won ('w'/'b'/'draw')
    ({"id": "chess", "title": "Chess"}, {"players": ["w1", "b1"], "won": "w"},
     "Sam beat Zaphod at Chess"),
    ({"id": "chess", "title": "Chess"}, {"players": ["w1", "b1"], "won": "b"},
     "Zaphod beat Sam at Chess"),
    ({"id": "chess", "title": "Chess"}, {"players": ["w1", "b1"], "won": "draw"},
     "Sam drew with Zaphod at Chess"),
    ({"id": "chess", "title": "Chess"}, {"players": ["w1"], "bot": True, "won": "w"},
     "Sam beat the bot at Chess"),
    ({"id": "chess", "title": "Chess"}, {"players": ["w1"], "bot": True, "won": "b"},
     "the bot beat Sam at Chess"),
    ({"id": "chess", "title": "Chess"}, {"players": ["w1"], "bot": True, "won": "draw"},
     "Sam drew with the bot at Chess"),
    # unresolvable ids fall back to the local name, and the missing second
    # player degrades to "an opponent" rather than printing undefined
    ({"id": "chess", "title": "Chess"}, {"players": ["ghost1", "ghost2"], "won": "w"},
     "Sam beat an opponent at Chess"),

    # ---- lotr: `win` is the winner's id; everyone else is listed as beaten
    ({"id": "lotr", "title": "LOTR Cards"}, {"players": ["w1", "b1", "c1"], "win": "w1"},
     "Sam beat Zaphod and Trillian at LOTR Cards"),
    ({"id": "lotr", "title": "LOTR Cards"}, {"players": ["w1", "b1"], "win": "b1"},
     "Zaphod beat Sam at LOTR Cards"),
    # a solo win has nobody to beat — must not say "beat " with nothing after it
    ({"id": "lotr", "title": "LOTR Cards"}, {"players": ["w1"], "win": "w1"},
     "Sam played at LOTR Cards"),

    # ---- warp: win is a boolean, ps/bs are the two scores
    ({"id": "warp", "title": "Warp Front"},
     {"players": ["w1", "b1"], "win": True, "ps": 5, "bs": 3},
     "Sam and Zaphod beat the Borg 5–3 at Warp Front"),
    ({"id": "warp", "title": "Warp Front"},
     {"players": ["w1", "b1"], "win": False, "ps": 3, "bs": 5},
     "Sam and Zaphod lost to the Borg 5–3 at Warp Front"),

    # ---- blastoff: `win` is the winning pilot, `score` the red cards taken
    ({"id": "blastoff", "title": "Blast Off!"},
     {"players": ["w1", "b1"], "win": "w1", "score": 9},
     "Sam won Blast Off! with 9 red cards"),
    # singular, and a missing score must not print "undefined"
    ({"id": "blastoff", "title": "Blast Off!"},
     {"players": ["w1", "b1"], "win": "b1", "score": 1},
     "Zaphod won Blast Off! with 1 red card"),
    ({"id": "blastoff", "title": "Blast Off!"}, {"players": ["w1", "b1"], "win": "w1"},
     "Sam won Blast Off!"),

    # ---- grammar: a loss, no score
    ({"id": "grammar", "title": "Discover the Grammar"},
     {"players": ["w1", "b1"], "lost": True},
     "Sam and Zaphod lost at Discover the Grammar"),

    # ---- wordbridge: round-based, the line records how far the table got
    ({"id": "wordbridge", "title": "Word Bridge"}, {"players": ["w1", "b1"], "rounds": 12},
     "Sam and Zaphod played 12 rounds at Word Bridge"),
    ({"id": "wordbridge", "title": "Word Bridge"}, {"players": ["w1", "b1"]},
     "Sam and Zaphod played Word Bridge"),
    ({"id": "wordbridge", "title": "Word Bridge"}, {"players": ["w1", "b1"], "rounds": 1},
     "Sam and Zaphod played 1 round at Word Bridge"),

    # ---- the96game: lap-based, and the name joiner has to handle 3+
    ({"id": "the96game", "title": "The 96 Game"}, {"players": ["w1", "b1"], "laps": 4},
     "Sam and Zaphod played 4 laps at The 96 Game"),
    ({"id": "the96game", "title": "The 96 Game"}, {"players": ["w1", "b1", "c1"], "laps": 2},
     "Sam, Zaphod and Trillian played 2 laps at The 96 Game"),
    ({"id": "the96game", "title": "The 96 Game"}, {"players": ["w1", "b1"]},
     "Sam and Zaphod played The 96 Game"),
    # zero laps must not print "undefined laps"
    ({"id": "the96game", "title": "The 96 Game"}, {"players": ["w1", "b1"], "laps": 0},
     "Sam and Zaphod played The 96 Game"),
    # a repeated id must not double the name
    ({"id": "the96game", "title": "The 96 Game"}, {"players": ["w1", "w1"], "laps": 1},
     "Sam played 1 lap at The 96 Game"),

    # ---- daltadka + waltz are solo and send no `players` at all; the line has
    # to come from the local player's own name
    ({"id": "daltadka", "title": "Dal Tadka"}, {"dish": "Moong", "score": 8420},
     "Sam cooked Moong scoring 8420 at Dal Tadka"),
    ({"id": "daltadka", "title": "Dal Tadka"}, {}, "Sam played Dal Tadka"),
    ({"id": "waltz", "title": "Waltz Engine"}, {"score": 7}, "Sam scored 7 at Waltz Engine"),
    ({"id": "waltz", "title": "Waltz Engine"}, {}, "Sam scored 0 at Waltz Engine"),

    # ---- an unknown legacy game still leaves a line rather than vanishing
    ({"id": "brandnew", "title": "Brand New"}, {"players": ["w1", "b1"]},
     "Sam and Zaphod played Brand New"),
    # a payload with no players falls back to the whole room (same as
    # bub-record.js did) rather than to nobody at all
    ({"id": "lonely", "title": "Lonely"}, {},
     "Sam, Zaphod, Trillian, Marvin and Me played Lonely"),
]


def main():
    src = RECORD_JS.read_text(encoding="utf-8")
    # plugins/record.js is an ES module; strip the export keyword so the
    # classic-script injector can expose it without a module loader.
    src = src.replace("export function", "function")
    src += "\nwindow.__rec = createRecord;\n"

    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.add_script_tag(content=src)

        got = pg.evaluate(
            """(arg) => {
              const NAMES = arg.names;
              const store = {
                state: {
                  me: { id: 'w1', name: 'Sam' },
                  roster: Object.keys(NAMES).map(id => ({ id, name: NAMES[id] })),
                  inRoom: true,
                  isHost: true
                }
              };
              const rec = window.__rec({ store, getNet: () => null });
              return arg.cases.map(c => rec.describeLegacy(c[0], c[1]));
            }""",
            {"names": NAMES, "cases": [[m, p] for m, p, _ in CASES]},
        )
        br.close()

    bad = 0
    for (meta, payload, want), have in zip(CASES, got):
        ok = have == want
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + meta["id"] + ": " + json.dumps(have))
        if not ok:
            print("         want: " + json.dumps(want))

    print()
    print("%d/%d legacy sentences matched" % (len(CASES) - bad, len(CASES)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())