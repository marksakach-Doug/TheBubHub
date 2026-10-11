#!/usr/bin/env python3
"""Syntax-check every inline <script> in the BubHub folder (and games.js).

No build step exists here, so this is the safety net: it parses each script
with a real JS parser (esprima) and prints anything that fails.

    python3 tests/jscheck.py                 # whole folder
    python3 tests/jscheck.py chess.html      # just one file

Why the rewrites below: esprima-python only understands ES2017, while the
games use two newer-but-common constructs:
  * `catch {`          — optional catch binding (ES2019)
  * `x ?? y` / `??= y`  — nullish coalescing (ES2020)
Both are rewritten to equivalent ES2017 so the parse reflects real syntax
errors instead of grammar-version gaps. These are semantics-changing
rewrites, which is fine: we only care whether it parses.

Requires: pip install esprima
"""
import pathlib
import re
import sys

import esprima

OPT_CATCH = re.compile(r"\bcatch\s*\{")


def check(path):
    src = path.read_text(encoding="utf-8")
    if path.suffix == ".js":
        blocks = [src]
    else:
        blocks = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", src, re.S)
    if not blocks:
        print(f"{path.name}: no inline <script> (nothing to check)")
        return 0
    for i, code in enumerate(blocks, 1):
        code = OPT_CATCH.sub("catch (__e__) {", code)
        code = re.sub(r"\?\?=", "||=", code)
        code = re.sub(r"\?\?", "||", code)
        try:
            esprima.parseScript(code)
        except Exception as exc:  # noqa: BLE001
            idx = getattr(exc, "index", None)
            where = ""
            if idx is not None:
                where = f" (line {code[:idx].count(chr(10)) + 1})"
            print(f"{path.name} block {i}: SYNTAX ERROR: {exc}{where}")
            return 1
    print(f"{path.name}: OK ({len(blocks)} script block(s))")
    return 0


def main(argv):
    root = pathlib.Path(__file__).resolve().parent.parent
    targets = [root / a for a in argv[1:]] or sorted(root.glob("*.html")) + sorted(root.glob("*.js"))
    return max(check(t) for t in targets if t.exists())


if __name__ == "__main__":
    sys.exit(main(sys.argv))
