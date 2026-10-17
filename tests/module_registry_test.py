#!/usr/bin/env python3
"""Tests for the module registry (src/registry.js).

This file exists because of a bug that shipped silently. `loadRegistry()` used
to guard its glob behind `typeof import.meta.glob === 'function'`, which is
true under `npm run dev` and *always false* in a production bundle: Vite
rewrites the `import.meta.glob(...)` call at build time but leaves the guard as
a runtime property check on something that no longer exists. The module branch
was therefore skipped in production and every module game vanished — bubhub.us
served 15 iframe games and zero module games, with no error anywhere.

The guard has to fail here rather than in production, so these tests assert the
bug's shape as text, and then run the real `loadRegistry()` the two ways it can
ever be run: as a built bundle (glob replaced by a stub loader map) and with no
Vite at all (no glob, so the catch must fall through to the legacy list).

    pip install playwright && playwright install chromium
    python3 tests/module_registry_test.py
"""
import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "src" / "registry.js"
GAMES = sorted((ROOT / "games").glob("*/index.js"))

# Stand-ins for window.BUB_GAMES, so the legacy branch has something to find.
# Keep these ids that have NO games/<id>/index.js — a module id here would be
# filtered out as a duplicate, which is a different test.
LEGACY = [
    {"id": "chess", "title": "Chess", "file": "chess.html", "players": "2"},
    {"id": "warp", "title": "Warp Front", "file": "warpfront.html", "players": "1-3"},
]


def strip(src):
    """Strip `export` so a classic <script> can define the functions globally."""
    return (src.replace("export async function", "async function")
               .replace("export function", "function"))


def strip_comments(src):
    """Comments must not trip the guard search — the fix explains the guard in
    prose, and prose about `typeof import.meta.glob` is not the bug.

    Order matters: strip `//` lines FIRST. A `//` comment containing
    `games/*/index.js` opens a fake block comment if blocks go first, and the
    non-greedy match then eats real code — which is how this helper briefly
    passed a file that still had the guard in it.
    """
    src = re.sub(r"//[^\n]*", "", src)
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


def source_checks():
    """The bug was a shape, so some of it can only be checked as text."""
    out = []
    src = REGISTRY.read_text(encoding="utf-8")

    out.append((
        "no typeof import.meta.glob guard in src/",
        not any(re.search(r"typeof\s+import\.meta\.glob",
                          strip_comments(p.read_text(encoding="utf-8")))
                for p in (ROOT / "src").rglob("*.js"))))

    out.append((
        "the glob call is still there",
        "import.meta.glob('../games/*/index.js')" in src))

    # The non-Vite fallback depends on the call being inside a try: a plain
    # `python3 -m http.server` must get the legacy list, not a stack trace.
    call_at = src.find("import.meta.glob(")
    try_at = src.rfind("try {", 0, call_at)
    catch_at = src.find("} catch", call_at)
    out.append((
        "the glob call sits inside a try/catch",
        try_at != -1 and catch_at != -1 and try_at < call_at < catch_at))

    out.append((
        "every shipped game module sits at games/<id>/index.js",
        bool(GAMES) and all(g.parent.parent.name == "games" and g.name == "index.js"
                            for g in GAMES)))
    return out


# Run inside the page: loadRegistry() is already a global from the injected
# script, so this only reports what it assembled. The `typeof` check keeps a
# regression a *reported failure* instead of a ReferenceError traceback — with
# the guard back, `import.meta` makes the classic script unparseable.
INSPECT = r"""
() => (typeof loadRegistry === 'function'
  ? loadRegistry().then((full) => {
      const ids = (pred) => full.filter(pred).map((g) => g.meta.id);
      const all = full.map((g) => g.meta.id);
      return {
        modules: ids((g) => g.kind === 'module'),
        legacy: ids((g) => g.kind === 'iframe'),
        soloCorner: ids((g) => g.meta.solo || g.meta.soloable || g.meta.lobby),
        roomList: ids((g) => !g.meta.solo),
        dupes: all.filter((id, i) => all.indexOf(id) !== i)
      };
    })
  : { modules: [], legacy: [], soloCorner: [], roomList: [], dupes: [],
      note: 'loadRegistry was never defined — the file did not parse' })
"""

COUNT_VIA = r"""
() => (typeof window.__lr === 'function'
  ? window.__lr().then((full) => ({
      modules: full.filter((g) => g.kind === 'module').length,
      legacy: full.filter((g) => g.kind === 'iframe').length
    }))
  : { modules: 0, legacy: 0 })
"""


def main():
    results = list(source_checks())

    raw = REGISTRY.read_text(encoding="utf-8")
    game_ids = [g.parent.name for g in GAMES]

    with sync_playwright() as p:
        br = p.chromium.launch()

        # ---- as a production bundle: the glob call replaced by a loader map,
        # which is precisely what Vite emits.
        pg = br.new_page()
        warnings = []
        pg.on("console", lambda m: warnings.append(m.text) if m.type == "warning" else None)
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.evaluate("() => { window.BUB_GAMES = " + json.dumps(LEGACY) + "; }")
        # real loader *functions*, not JSON strings — a string would throw
        # inside the registry and be swallowed as "game module failed"
        pg.evaluate("""(ids) => {
          window.__loaded = {};
          ids.forEach((id) => {
            window.__loaded['../games/' + id + '/index.js'] = () => Promise.resolve({
              meta: { id: id, title: id, players: '1-2', soloable: true }
            });
          });
        }""", game_ids)
        stubbed = strip(raw).replace(
            "import.meta.glob('../games/*/index.js')", "__glob('../games/*/index.js')")
        pg.add_script_tag(content="function __glob() { return window.__loaded; }\n" + stubbed)
        got = pg.evaluate("(" + INSPECT + ")")

        # ---- with no Vite at all: `import.meta.glob` does not exist, so the
        # call throws and the catch has to fall through to the legacy games.
        pg2 = br.new_page()
        pg2.set_content("<!DOCTYPE html><html><body></body></html>")
        pg2.evaluate("() => { window.BUB_GAMES = " + json.dumps(LEGACY) + "; }")
        pg2.add_script_tag(content="window.__lr = loadRegistry;\n" + strip(raw),
                           type="module")
        fb = pg2.evaluate("(" + COUNT_VIA + ")")
        br.close()

    results += [
        ("a built bundle registers every module game",
         sorted(got["modules"]) == sorted(game_ids)),
        ("a built bundle still registers the legacy games",
         got["legacy"] == [g["id"] for g in LEGACY]),
        ("a module id wins over a legacy entry with the same id",
         got["dupes"] == []),
        ("Dot Return is in the pre-room Solo Corner",
         "dotreturn" in got["soloCorner"]),
        ("Dot Return keeps its real count in the in-room list",
         "dotreturn" in got["roomList"]),
        ("without Vite it falls back to the legacy list instead of throwing",
         fb["modules"] == 0 and fb["legacy"] == len(LEGACY)),
        ("no game module failed to load in the built shape",
         not any("game module failed" in w for w in warnings)),
    ]

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)

    print()
    print("%d/%d registry checks passed" % (len(results) - bad, len(results)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())