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
# esprima-python predates `import.meta` (Vite's import.meta.glob for
# auto-registering games/*/index.js). Rewrite it to a plain identifier so
# the parse reflects real syntax errors instead of grammar-version gaps.
IMPORT_META_GLOB = re.compile(r"\bimport\.meta\.glob\s*\(")
IMPORT_META = re.compile(r"\bimport\.meta\b")


def _modern(code):
    code = OPT_CATCH.sub("catch (__e__) {", code)
    code = re.sub(r"\?\?=", "||=", code)
    code = re.sub(r"\?\?", "||", code)
    code = IMPORT_META_GLOB.sub("__viteGlob__(", code)
    code = IMPORT_META.sub("__importMeta", code)
    return code


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
        code = _modern(code)
        try:
            esprima.parseScript(code)
        except Exception as exc:  # noqa: BLE001
            # v10 hub shell uses <script type="module"> (import/export):
            # retry as a module before reporting a syntax error.
            try:
                esprima.parseModule(code)
                continue
            except Exception:
                pass
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
    if len(argv) > 1:
        targets = [root / a for a in argv[1:]]
    else:
        targets = sorted(root.glob("*.html")) + sorted(root.glob("*.js"))
        for sub in ("src", "net", "room", "plugins", "games"):
            targets += sorted((root / sub).rglob("*.js"))
    # inline <script> blocks come from .html; bare .js files parse as modules
    rc = 0
    for t in targets:
        if not t.exists():
            continue
        if t.suffix == ".js":
            code = _modern(t.read_text(encoding="utf-8"))
            try:
                try:
                    esprima.parseModule(code)
                except Exception:
                    esprima.parseScript(code)
                print(f"{t.relative_to(root)}: OK")
            except Exception as exc:  # noqa: BLE001
                print(f"{t.relative_to(root)}: SYNTAX ERROR: {exc}")
                rc = 1
        else:
            rc = max(rc, check(t))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
