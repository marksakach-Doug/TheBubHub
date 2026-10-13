#!/usr/bin/env python3
"""Guard: no deploy credential can quietly end up in git.

The reason this exists is real. A live Cloudflare API token sat in the repo root
as `CLOUDFLARE_API_TOKEN`, untracked but *not* gitignored — one `git add -A` from
being committed and pushed to a public remote. Nothing would have warned: the
token has no file extension, it is a bare value, and `git status` shows untracked
files as harmless.

So this checks the three things that actually stop it:

  1. no credential-named file exists in the working tree,
  2. .gitignore would ignore those names if one appears,
  3. no *tracked* file contains a literal token.

Deliberately not a generic secret scanner — no dependency, no network, and fast
enough to run on every test pass. It matches a *literal* token in an assignment
or a Bearer header, and deliberately ignores the indirection we recommend
(`$(cat ~/.config/bubhub/cloudflare-token)`) and the non-secret ids in
wrangler.jsonc.

    python3 tests/secrets_test.py      # no browser needed
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Names that must never be tracked.
FORBIDDEN_NAMES = ("CLOUDFLARE_API_TOKEN", ".env", ".token")

# A literal credential: 20+ base64url chars assigned to a token-ish variable, or
# handed to an Authorization header. Shell indirection and placeholders are
# excluded by the lookarounds.
PATTERNS = [
    re.compile(r"CLOUDFLARE_API_TOKEN\s*=\s*[\"']?(?!\$\(|<|~)[A-Za-z0-9_-]{20,}"),
    re.compile(r"Bearer\s+(?!\$\()[A-Za-z0-9_-]{20,}"),
]

SKIP_DIRS = {".git", "node_modules", "dist", ".wrangler", "__pycache__"}


def tracked_files():
    """Everything git would commit, tracked *and* new-but-not-ignored.

    Scanning only `git ls-files` would miss the exact window that matters: a
    secret sitting untracked, one `git add` away from the next commit.
    """
    try:
        out = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
            cwd=ROOT, capture_output=True, text=True, timeout=30, check=True).stdout
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    return [ROOT / line for line in out.splitlines() if line.strip()]


def main():
    results = []

    # ---- 1. nothing credential-shaped is sitting in the working tree
    strays = []
    for path in ROOT.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and (path.name in FORBIDDEN_NAMES or path.suffix == ".token"):
            strays.append(str(path.relative_to(ROOT)))
    results.append(("no credential file in the working tree", not strays))

    # ---- 2. those names are ignored, so one appearing cannot be staged
    try:
        ignored = subprocess.run(["git", "check-ignore"] + list(FORBIDDEN_NAMES),
                                 cwd=ROOT, capture_output=True, text=True, timeout=30)
        ignored_names = {pathlib.Path(line).name for line in ignored.stdout.split()}
    except (subprocess.SubprocessError, FileNotFoundError):
        ignored_names = set()
    results.append((".gitignore covers every credential name",
                    all(n in ignored_names for n in FORBIDDEN_NAMES)))

    # ---- 3. no tracked file holds a literal token
    files = tracked_files()
    if files is None:
        results.append(("tracked files scanned for tokens", False))
        print("  note: git unavailable, skipped the scan of tracked files")
    else:
        hits = []
        for f in files:
            if not f.is_file() or f.suffix in (".png", ".jpg", ".jpeg", ".gif", ".txt"):
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for pat in PATTERNS:
                if pat.search(text):
                    hits.append(str(f.relative_to(ROOT)))
                    break
        results.append(("nothing git would commit contains a literal token", not hits))

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)
    for s in strays:
        print("         stray credential: " + s)
    for h in hits if files is not None else []:
        print("         token found in: " + h)

    print()
    print("%d/%d secret checks passed" % (len(results) - bad, len(results)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())