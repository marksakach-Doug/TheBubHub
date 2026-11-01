#!/usr/bin/env python3
"""
Bake a word bank for humus.html using world_bridge_gutenberg.py's own picker.

humus.html runs in a browser iframe: it cannot run Python, and gutenberg.org
sends no CORS headers, so the page cannot download books itself. Instead this
tool runs the script's pipeline ahead of time over the same shelf
(strip_boilerplate -> paragraphs -> build_passage) and writes the passages it
finds into humus.html, between the BANK markers. Each game then draws its 52
words from one of them.

  python3 bake_humus_passages.py --html public/humus.html
  python3 bake_humus_passages.py --html public/humus.html --cache books/   # books/<id>.txt, fetch + save the rest
  python3 bake_humus_passages.py --per-book 3 --seed 7 --blocklist my_words.txt

Needs world_bridge_gutenberg.py next to it. Standard library only.
"""
import argparse, json, random, re, sys, unicodedata
from pathlib import Path

import world_bridge_gutenberg as wb

BEGIN, END = "<!-- BANK:BEGIN", "<!-- BANK:END -->"


def book_id(title):
    """KNOWN_IDS lookup, tolerant of accents and long titles ('Les Misérables',
    'An Inquiry into ... the Wealth of Nations' never match the script's keys)."""
    k = wb.norm(title)
    if k in wb.KNOWN_IDS:
        return wb.KNOWN_IDS[k]
    folded = wb.norm(unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode())
    for key, gid in wb.KNOWN_IDS.items():
        if f" {key} " in f" {folded} ":
            return gid
    return None


def load(gid, cache):
    path = Path(cache) / f"{gid}.txt" if cache else None
    if path and path.exists():
        return path.read_text(encoding="utf-8", errors="replace")
    raw = wb.fetch_direct(gid)
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(raw, encoding="utf-8")
    return raw


def clean(passage, block):
    """Stricter than the script, because the passage is shown at the end of a game:
    no accented letters (they tokenise into fragments like 'rables'), and no blocked
    word even inside a compound ('slave-trade')."""
    if any(ord(c) > 127 and unicodedata.category(c).startswith("L") for c in passage):
        return False
    return not any(w in block for w in re.findall(r"[a-z]+", passage.lower()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--html", default="humus.html", help="humus.html to update in place")
    ap.add_argument("--cache", help="folder of <gutenberg id>.txt files; missing ones are fetched and saved here")
    ap.add_argument("--per-book", type=int, default=2, help="passages to keep per book (default 2)")
    ap.add_argument("--max-words", type=int, default=100, help="skip passages with more usable words than this")
    ap.add_argument("--seed", default="humus", help="seed; the same seed bakes the same bank")
    ap.add_argument("--blocklist", help="file of extra blocked words, one per line")
    a = ap.parse_args()

    block = set(wb.BLOCK)
    if a.blocklist:
        block |= {l.strip().lower() for l in Path(a.blocklist).read_text().splitlines() if l.strip()}

    bank, skipped = [], []
    for title in wb.shelf():
        gid = book_id(title)
        if not gid:
            skipped.append((title, "no Gutenberg id"))
            continue
        try:
            paras = wb.paragraphs(wb.strip_boilerplate(load(gid, a.cache)))
        except Exception as e:
            skipped.append((title, str(e)[:70]))
            continue
        rng = random.Random(f"{a.seed}:{gid}")  # per book, so adding a book never reshuffles the others
        seen = []
        for _ in range(a.per_book * 8):
            if len(seen) >= a.per_book:
                break
            passage, words = wb.build_passage(paras, rng, block)
            if not passage or len(words) > a.max_words or not clean(passage, block):
                continue
            if any(passage[:60] in s or s[:60] in passage for s in seen):
                continue
            seen.append(passage)
            bank.append({"t": title, "g": int(gid), "p": passage, "w": " ".join(words)})
        if not seen:
            skipped.append((title, "no clean passage found"))

    html_path = Path(a.html)
    html = html_path.read_text(encoding="utf-8")
    pat = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.S)
    if not pat.search(html):
        sys.exit(f"{a.html} has no {BEGIN} ... {END} markers to replace")
    blob = json.dumps(bank, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    block_html = (f"{BEGIN} (written by bake_humus_passages.py; re-run it, don't edit by hand) -->\n"
                  f'<script type="application/json" id="humus-bank">{blob}</script>\n{END}')
    html_path.write_text(pat.sub(lambda m: block_html, html, count=1), encoding="utf-8")

    print(f"{len(bank)} passages from {len({b['g'] for b in bank})} books; bank is {len(blob) // 1024} KB")
    for title, why in skipped:
        print(f"  skipped {title!r}: {why}", file=sys.stderr)


if __name__ == "__main__":
    main()
