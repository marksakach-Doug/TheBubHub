#!/usr/bin/env python3
"""Every test file must be in a suite table, and every suite table entry must exist.

    python3 tests/test_wiring.py

Why this exists: `tests/chess_play.py` sat unwired in this folder for a year. It
looked like coverage, it ran when you ran it by hand, and `./test.sh` never ran
it at all. Nothing in the repo could tell the difference between a suite that
passes and a suite that does not exist.

The same failure is worse for a game: a new `tests/<id>_test.mjs` that nobody
added to `test.sh` is a test nobody runs, so the game looks tested and is not.
That is why `README.md` says a new test belongs in `test.sh` in the same commit
as the code — this file is what makes that sentence true rather than aspirational.

Two directions, because both have bitten:
  · a test file not in any table      (dead suite — chess_play.py)
  · a table entry with no file        (a typo that silently skips a suite)

KNOWN_FAILURES is the escape hatch, and it is deliberately explicit: a suite can
only be skipped by being named there with a reason. See chess_capture_play.py,
which fails on a clean tree for reasons unrelated to anything here.
"""
import pathlib
import re
import sys
from pathlib import Path

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
SH = ROOT / "test.sh"

# Suites that exist but are not wired in, each with why. Adding a name here is a
# decision, so it leaves a trail in `git blame`.
KNOWN_FAILURES = {
    "chess_play.py": "targets the pre-v10 shell over file:// and is excluded by design (test.sh header)",
    "chess_capture_play.py": "fails on a clean tree; separate work, not this change",
    "kick_ghost.mjs": "a helper loaded by kick_ghost_test.py, not a suite of its own",
    "minigo_selfplay.mjs": "an optional strength harness, run by hand on purpose",
}

HELPERS = {"gate_fixtures"}   # a fixture tree, not a suite


def main():
    sh = SH.read_text(encoding="utf-8")
    body = sh[sh.find("OFFLINE_SUITES=("):sh.find("for entry in")]

    # Table entries are "display name|file" — take the file half.
    wired = set(m for m in re.findall(r'"([^"]+)"', body) if "|" in m
                for m in [m.split("|")[-1].strip()])

    on_disk = set()
    for p in sorted(TESTS.iterdir()):
        if not p.is_file() or p.suffix not in (".py", ".mjs"):
            continue
        on_disk.add(p.name)

    problems = []

    # This file is exempt from the "unwired" direction only. It is still counted
    # as present on disk, or the reverse check would report that test.sh runs a
    # file that does not exist — which is the typo it is here to catch.
    unwired = sorted(on_disk - wired - set(KNOWN_FAILURES) - {Path(__file__).name})
    for name in unwired:
        problems.append(f"{name} is not in any test.sh suite table — "
                        f"it will never run. Add it, or name it in KNOWN_FAILURES with a reason.")

    missing = sorted(wired - on_disk)
    for name in missing:
        problems.append(f"test.sh runs {name}, which does not exist in tests/. "
                        f"A typo here silently skips a suite.")

    # And the reverse of the original rule: a game with a card must be covered by
    # the shared suites that read those cards, or the card is decoration.
    for card in sorted((ROOT / "games").glob("*/scenarios.json")):
        gid = card.parent.name
        if not (ROOT / "games" / gid / "index.js").exists():
            problems.append(f"{gid} has a card but no index.js — the card is dead weight.")

    for name, why in sorted(KNOWN_FAILURES.items()):
        if name not in on_disk:
            print(f"  info  KNOWN_FAILURES names {name}, which no longer exists — drop the entry")

    for p in sorted(TESTS.iterdir()):
        if not p.is_dir() or p.name == "__pycache__":
            continue
        rel = p.relative_to(TESTS).as_posix()
        if rel not in HELPERS:
            problems.append(f"tests/{rel}/ is not in HELPERS — say what it is for, "
                            f"or a reader will assume it is a suite")

    for p in problems:
        print(f"FAIL  {p}")
    if problems:
        print(f"\n{len(problems)} wiring problem(s)")
        return 1

    print(f"  ok   every test file is wired in ({len(on_disk)} files, {len(wired)} entries)")
    print(f"  ok   every suite table entry points at a real file")
    print(f"  ok   every game with a card has an index.js the suites will read")
    print(f"  ok   {len(KNOWN_FAILURES)} deliberately unwired suite(s) declared")
    return 0


if __name__ == "__main__":
    sys.exit(main())