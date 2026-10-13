#!/usr/bin/env python3
"""Guard: bun.lock must stay readable by the bun that Cloudflare runs.

This is here because of a self-inflicted outage. `bun install` writes
`bun.lock` in whatever format the *local* bun writes, so a lockfile committed
by bun 1.4.3 (`"lockfileVersion": 2`) is unparseable by the bun 1.2.15 in
Workers Builds:

    error: Unknown lockfile version
      at bun.lock:2:22
    warn: Ignoring lockfile
    error: lockfile had changes, but lockfile is frozen

…and because CI installs with `--frozen-lockfile`, that is a hard build
failure on every push. The build failed on a commit that changed nothing about
dependencies.

So the contract is: the committed lockfile must be in the format the pinned
bun writes. `.bun-version` records the pin; this test proves the two agree.

    python3 tests/lockfile_test.py      # no browser needed
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCK = ROOT / "bun.lock"
PIN = ROOT / ".bun-version"

# bun < 1.3 writes lockfileVersion 1; 1.3+ writes 2. The pinned bun decides
# which one is legal, so derive the expectation instead of hard-coding a guess.
VERSION_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")


def main():
    results = []

    pin = PIN.read_text(encoding="utf-8").strip() if PIN.exists() else ""
    results.append((".bun-version exists and pins a version", bool(VERSION_RE.match(pin))))

    results.append(("bun.lock is committed", LOCK.exists()))
    if not LOCK.exists():
        for name, ok in results:
            print(("  ok   " if ok else "  FAIL ") + name)
        print("\n%d/%d lockfile checks passed" % (len(results) - sum(1 for _, ok in results if not ok), len(results)))
        return 1

    raw = LOCK.read_text(encoding="utf-8")
    found = re.search(r'"lockfileVersion"\s*:\s*(\d+)', raw)
    results.append(("bun.lock declares a lockfileVersion", bool(found)))
    if not found:
        for name, ok in results:
            print(("  ok   " if ok else "  FAIL ") + name)
        print("\n%d/%d lockfile checks passed" % (len(results) - sum(1 for _, ok in results if not ok), len(results)))
        return 1

    version = int(found.group(1))
    m = VERSION_RE.match(pin)
    major, minor = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
    expected = 2 if (major, minor) >= (1, 3) else 1

    results.append((
        "lockfileVersion %d matches the pinned bun %s (expected %d)" % (version, pin, expected),
        version == expected))

    # A frozen install must not want to change it. This is the exact CI command.
    if major or minor:
        import shutil
        import subprocess
        bun = shutil.which("bun") or str(pathlib.Path.home() / ".bun-1.2.15" / "bin" / "bun")
        if pathlib.Path(bun).exists():
            try:
                proc = subprocess.run([bun, "install", "--frozen-lockfile", "--dry-run"],
                                      cwd=ROOT, capture_output=True, text=True, timeout=120)
                results.append((
                    "`bun install --frozen-lockfile` is happy with this lockfile",
                    proc.returncode == 0))
            except (subprocess.SubprocessError, OSError) as e:
                results.append(("`bun install --frozen-lockfile` is happy with this lockfile", False))
                print("         (could not run it: %s)" % str(e)[:100])
        else:
            print("  note: no bun binary found, skipping the frozen-lockfile check")

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)
    if bad and expected != version:
        print()
        print("  Fix: regenerate with the pinned bun, never a newer one —")
        print("        rm bun.lock && bun install && git add bun.lock")
        print("  A newer bun rewrites the lockfile in a format CI cannot read,")
        print("  and --frozen-lockfile turns that into a failed build.")

    print()
    print("%d/%d lockfile checks passed" % (len(results) - bad, len(results)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())