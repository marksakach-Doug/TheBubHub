#!/usr/bin/env python3
"""
Bake the word bank for Fugue's solo connectionist mode out of the bank that
bake_humus_passages.py already wrote into humus.html. One-time extraction:
the generated games/fugue/words.js is committed, so the game never touches
Python, the network, or humus at runtime.

  python3 scripts/bake-fugue-words.py            # default paths
  python3 scripts/bake-fugue-words.py --check    # exit 1 if words.js is stale

Standard library only.
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK_HTML = ROOT / "public" / "humus.html"
OUT = ROOT / "games" / "fugue" / "words.js"


def read_bank():
    id_expr = 'id="humus-bank"'
    html = BANK_HTML.read_text(encoding="utf-8")
    m = re.search(re.escape(id_expr) + r">(.*?)</script>", html, re.S)
    if not m:
        sys.exit(f"no {id_expr} bank inside {BANK_HTML.relative_to(ROOT)} — bake it first with bake_humus_passages.py")
    bank = json.loads(m.group(1).replace("\\u003c", "<"))
    if not bank or not all(p.get("t") and p.get("w") for p in bank):
        sys.exit("bank entries are missing 't' (book) or 'w' (words) — the bank looks broken")
    return bank


def bake(_):
    bank = [{"t": p["t"], "g": p["g"], "w": p["w"]} for p in read_bank()]
    blob = json.dumps(bank, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    js = ("// GENERATED — do not edit. Run scripts/bake-fugue-words.py to refresh.\n"
          "// Stolen from the bank baked into public/humus.html: literary passages,\n"
          "// pre-cleaned (no accents, no stop words, stems deduped). Each entry is\n"
          "// one book: 't' title, 'g' gutenberg id, 'w' space-separated words. The\n"
          "// solo connectionist turns books into streamers and books into their words.\n"
          f"export const BANK = {blob};\n")
    OUT.write_text(js, encoding="utf-8")
    print(f"baked {OUT.relative_to(ROOT)}: {len(bank)} books, "
          f"{len({w for p in bank for w in p['w'].split()})} words, {len(js) // 1024} KB")


def check(_):
    if not OUT.exists():
        sys.exit(1)
    bank = read_bank()
    got = re.search(r"^export const BANK = (.*);\s*$", OUT.read_text(encoding="utf-8"), re.M)
    want = json.dumps([{"t": p["t"], "g": p["g"], "w": p["w"]} for p in bank], ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    if not got or got.group(1) != want:
        sys.exit(f"{OUT.relative_to(ROOT)} is stale — re-run scripts/bake-fugue-words.py")


ap = argparse.ArgumentParser()
ap.add_argument("--check", action="store_true", help="fail if words.js does not match the humus bank")
args = ap.parse_args()
check(None) if args.check else bake(None)
