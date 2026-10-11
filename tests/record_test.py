#!/usr/bin/env python3
"""BubHub Record sentence tests.

`bub-record.js` builds the human-readable line ("Sam beat Zaphod at Chess")
from a small payload a game sends. Names are the *hub's* job — it knows the
local player's name and numbers duplicates — so games send ids, not text.

These run the real shipped `BubRecord.create()` in a blank page with stub
dependencies, so they test the sentences players actually see.

    pip install playwright && playwright install chromium
    python3 tests/record_test.py
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
RECORD_JS = ROOT / "bub-record.js"

# game, payload, expected line
CASES = [
    # chess: players are [whiteId, blackId?], `bot` means black wasn't a person
    ("chess", {"players": ["w1", "b1"], "won": "w"},
     "Sam beat Zaphod at Chess"),
    ("chess", {"players": ["w1", "b1"], "won": "b"},
     "Zaphod beat Sam at Chess"),
    ("chess", {"players": ["w1", "b1"], "won": "draw"},
     "Sam drew with Zaphod at Chess"),
    ("chess", {"players": ["w1"], "bot": True, "won": "w"},
     "Sam beat the bot at Chess"),
    ("chess", {"players": ["w1"], "bot": True, "won": "b"},
     "the bot beat Sam at Chess"),
    ("chess", {"players": ["w1"], "bot": True, "won": "draw"},
     "Sam drew with the bot at Chess"),

    # lotr: `win` is an id; everyone else gets listed
    ("lotr", {"players": ["w1", "b1", "c1"], "win": "w1"},
     "Sam beat Zaphod and Trillian at LOTR Cards"),
    ("lotr", {"players": ["w1", "b1"], "win": "b1"},
     "Zaphod beat Sam at LOTR Cards"),

    # waltz: score
    ("waltz", {"players": ["w1"], "score": 7}, "Sam scored 7 at Waltz Engine"),

    # goldberg
    ("goldberg", {"players": ["w1", "b1"]}, "Sam and Zaphod played Goldberg"),

    # eggs / grammar: pass-through text
    ("eggs", {"players": ["w1", "b1"], "text": "Sam smashed Zaphod at eggs"},
     "Sam smashed Zaphod at eggs"),

    # a game with no result logic still leaves a line
    ("brandnew", {"players": ["w1", "b1"]}, "Sam and Zaphod played brandnew"),

    # blastoff: `win` is the winning pilot, `score` the red cards taken
    ("blastoff", {"players": ["w1", "b1"], "win": "w1", "score": 9},
     "Sam won Blast Off with 9 red cards"),
    ("blastoff", {"players": ["w1", "b1"], "win": "b1", "score": 1},
     "Zaphod won Blast Off with 1 red card"),
    # a missing score must not print "undefined"
    ("blastoff", {"players": ["w1", "b1"], "win": "w1"},
     "Sam won Blast Off"),

    # wordbridge: rounds played, no winner
    ("wordbridge", {"players": ["w1", "b1"], "rounds": 12},
     "Sam and Zaphod played 12 rounds at Word Bridge"),
    ("wordbridge", {"players": ["w1", "b1"]},
     "Sam and Zaphod played Word Bridge"),

    # daltadka: solo, so the local player is the cook
    ("daltadka", {"players": ["w1"], "dish": "Moong", "score": 8420},
     "Sam cooked Moong scoring 8420 at Dal Tadka"),
    ("daltadka", {"players": ["w1"]}, "Sam played Dal Tadka"),

    # ids nobody knows fall back to the local name rather than printing
    # "undefined" — and an unresolvable opponent degrades to "an opponent"
    ("chess", {"players": ["ghost1", "ghost2"], "won": "w"},
     "Sam beat an opponent at Chess"),
]


def main():
    src = RECORD_JS.read_text()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.add_script_tag(content=src)

        # Stub the hub's dependencies: a roster, a local name, the game titles.
        got = pg.evaluate(
            """(cases) => {
              const NAMES = { w1: 'Sam', b1: 'Zaphod', c1: 'Trillian', c2: 'Marvin' };
              const TITLES = { lotr: 'LOTR Cards', chess: 'Chess', waltz: 'Waltz Engine',
                               goldberg: 'Goldberg', eggs: 'eggs', grammar: 'Discover the Grammar',
                               blastoff: 'Blast Off!', wordbridge: 'Word Bridge', daltadka: 'Dal Tadka' };
              const R = window.BubRecord.create({
                getName: () => 'Sam',
                rosterList: () => Object.keys(NAMES).map(id => ({ id, name: NAMES[id] })),
                gameTitle: (g) => TITLES[g] || g,
                isHost: () => true,
                sendAll: () => {}
              });
              return cases.map(c => R.sentence(c[0], c[1]));
            }""",
            [[g, p] for g, p, _ in CASES],
        )
        br.close()

    bad = 0
    for (game, payload, want), have in zip(CASES, got):
        ok = have == want
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + game + ": " + json.dumps(have))
        if not ok:
            print("         want: " + json.dumps(want))

    print()
    print("%d/%d sentences matched" % (len(CASES) - bad, len(CASES)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
