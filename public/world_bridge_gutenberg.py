#!/usr/bin/env python3
"""
WORLD BRIDGE: Gutenberg edition (one passage per game)

Picks a random book from a fixed shelf of Project Gutenberg titles, downloads
the plain text directly from gutenberg.org, finds a passage with at least 52
usable words, and maps those words onto a standard 52-card deck. Writes two
files:

  key.html     print this; players use it as the word key
  reveal.txt   the source passage and book. DON'T OPEN until the game ends.

Usage:
  python3 world_bridge_gutenberg.py                 # random book, with veto prompt
  python3 world_bridge_gutenberg.py --file book.txt # use a local text file instead
  python3 world_bridge_gutenberg.py --seed 42       # repeatable game
  python3 world_bridge_gutenberg.py --list          # show the titles in play
  python3 world_bridge_gutenberg.py --book "Emma"    # one specific title
  python3 world_bridge_gutenberg.py --blocklist my_words.txt

Needs only the Python 3 standard library.
"""
import argparse, html, random, re, sys, urllib.request
from pathlib import Path

FREE = {"the", "a", "of", "in", "and", "is", "to", "not"}

STOP = set("""
about above after again against all also although always among and any are around
because been before being below between both but came can could did does doing done down
during each either else even ever every few for from further had has have having her here
hers herself him himself his how however into its itself just know like made make many may
might more most much must myself never next nor not now off once one only onto other ought
our ours ourselves out over own perhaps quite rather said same say shall she should since
some still such than that their theirs them themselves then there these they this those
though through thus under until upon very was well went were what when where whether which
while who whom whose why will with within without would yet you your yours yourself
there's that's didn't don't one two three four five six seven eight nine ten
""".split())

# Starter veto list: cruelty, violence, and a few things that make a bad party game.
# This is deliberately short and incomplete. Add your own words with --blocklist
# (one per line), and use the human veto: anyone can say "reroll".
BLOCK = set("""
murder murdered murderer massacre torture tortured rape raped lynch lynched
hang hanged hanging gallows slave slaves slavery savage
savages heathen heathens suicide nigger negro negroes negros niggers
""".split())

SUITS = [("\u2660", "Spades"), ("\u2665", "Hearts"), ("\u2666", "Diamonds"), ("\u2663", "Clubs")]
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]

# The shelf: titles from the Top 100 list (duplicates removed).
BOOKS = [
    "Pride and Prejudice", "Frankenstein; or, The modern Prometheus",
    "Moby Dick; Or, The Whale", "Alice's Adventures in Wonderland",
    "The Adventures of Sherlock Holmes", "Dracula",
    "Chambers's Twentieth Century Dictionary", "The Complete Works of William Shakespeare",
    "Romeo and Juliet", "A Tale of Two Cities", "Middlemarch", "The Picture of Dorian Gray",
    "The strange case of Dr. Jekyll and Mr. Hyde", "Jane Eyre", "Crime and Punishment",
    "The Great Gatsby", "The Prince", "The Legend of Sleepy Hollow", "Metamorphosis",
    "Meditations", "A Room with a View", "The Count of Monte Cristo", "The Yellow Wallpaper",
    "Great Expectations", "Walden, and On The Duty Of Civil Disobedience",
    "Little Women", "The Adventures of Tom Sawyer", "War and Peace", "The Blue Castle",
    "The Odyssey", "A Modest Proposal", "Wuthering Heights", "The Importance of Being Earnest",
    "Leviathan", "The Enchanted April", "The Scarlet Letter", "Cranford",
    "The Wonderful Wizard of Oz", "A Christmas Carol in Prose", "Treasure Island",
    "History of Tom Jones, a Foundling", "Adventures of Huckleberry Finn",
    "The Expedition of Humphry Clinker", "Twenty years after", "Beowulf",
    "The Adventures of Ferdinand Count Fathom", "Anne of Green Gables", "Grimms' Fairy Tales",
    "My Life", "The Adventures of Roderick Random", "The Time Machine", "Ulysses",
    "Sense and Sensibility", "A Doll's House",
    "Narrative of the Life of Frederick Douglass, an American Slave",
    "The Confessions of St. Augustine", "The Works of William Shakespeare [Cambridge Edition]",
    "The King James Version of the Bible", "The King in Yellow", "The Republic",
    "Second Treatise of Government", "Emma", "Harrods for Everything",
    "Thus Spake Zarathustra", "Beyond Good and Evil", "The Brothers Karamazov",
    "The Souls of Black Folk", "Heart of Darkness", "On Liberty", "Peter Pan",
    "The Art of War", "Tractatus Logico-Philosophicus",
    "An Inquiry into the Nature and Causes of the Wealth of Nations", "The war of the worlds",
    "Autobiography of Benjamin Franklin", "On the Origin of Species By Means of Natural Selection",
    "Spoon River Anthology", "Les Misérables", "The Hound of the Baskervilles",
    "A Study in Scarlet", "The International Development of China", "The Kama Sutra of Vatsyayana",
    "The Works of Edgar Allan Poe", "Winnie-the-Pooh", "A Biblia Sagrada", "Don Quixote",
    "White nights, and other stories", "Gulliver's Travels into Several Remote Nations of the World",
    "Anna Karenina", "Calculus Made Easy", "Carmilla", "The divine comedy", "Don Quijote",
    "Diccionario Ingles-Español-Tagalog", "Dubliners", "Through the Looking-Glass",
]

# Left out by default: plays, verse, reference works, non-English, and a few that
# don't suit this game. Delete a line to put a book back. Matching is by substring.
SKIP = [
    "dictionary", "diccionario", "shakespeare", "romeo and juliet", "doll's house",
    "importance of being earnest", "beowulf", "divine comedy", "spoon river",
    "tractatus", "calculus", "harrods", "biblia", "don quijote", "kama sutra",
    "modest proposal", "international development of china",
]


# ---------- fetching ----------

def get(url, binary=False, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "world-bridge/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data


def norm(t):
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


# Map of normalized shelf title -> Project Gutenberg id.
# Used to build direct gutenberg.org plain-text URLs.
# Source: gutenberg.org (verify IDs against the site before trusting).
KNOWN_IDS = {
    "pride and prejudice": "1342",
    "frankenstein or the modern prometheus": "84",
    "moby dick or the whale": "2701",
    "alice s adventures in wonderland": "11",
    "the adventures of sherlock holmes": "1661",
    "dracula": "345",
    "a tale of two cities": "98",
    "middlemarch": "145",
    "the picture of dorian gray": "174",
    "the strange case of dr jekyll and mr hyde": "43",
    "jane eyre": "1260",
    "crime and punishment": "2554",
    "the great gatsby": "64317",
    "the prince": "1232",
    "the legend of sleepy hollow": "41",
    "metamorphosis": "5200",
    "meditations": "2680",
    "a room with a view": "2641",
    "the count of monte cristo": "1184",
    "the yellow wallpaper": "1952",
    "great expectations": "1400",
    "walden and on the duty of civil disobedience": "205",
    "little women": "514",
    "the adventures of tom sawyer": "74",
    "war and peace": "2600",
    "the blue castle": "67979",
    "the odyssey": "1727",
    "wuthering heights": "768",
    "leviathan": "3207",
    "the enchanted april": "16389",
    "the scarlet letter": "25344",
    "cranford": "394",
    "the wonderful wizard of oz": "55",
    "a christmas carol in prose": "46",
    "treasure island": "120",
    "history of tom jones a foundling": "6593",
    "adventures of huckleberry finn": "76",
    "the expedition of humphry clinker": "2160",
    "twenty years after": "1259",
    "the adventures of ferdinand count fathom": "6761",
    "anne of green gables": "45",
    "grimms fairy tales": "2591",
    "my life": "5197",
    "the adventures of roderick random": "4199",
    "the time machine": "35",
    "ulysses": "4300",
    "sense and sensibility": "161",
    "narrative of the life of frederick douglass an american slave": "23",
    "the confessions of st augustine": "3296",
    "the king james version of the bible": "10",
    "the king in yellow": "8492",
    "the republic": "1497",
    "second treatise of government": "7370",
    "emma": "158",
    "thus spake zarathustra": "1998",
    "beyond good and evil": "4363",
    "the brothers karamazov": "28054",
    "the souls of black folk": "408",
    "heart of darkness": "219",
    "on liberty": "34901",
    "peter pan": "16",
    "the art of war": "132",
    "the wealth of nations": "3300",
    "the war of the worlds": "36",
    "autobiography of benjamin franklin": "148",
    "on the origin of species by means of natural selection": "1228",
    "les miserables": "135",
    "the hound of the baskervilles": "2852",
    "a study in scarlet": "244",
    "the works of edgar allan poe": "2148",
    "winnie the pooh": "67098",
    "don quixote": "996",
    "white nights and other stories": "36034",
    "gulliver s travels into several remote nations of the world": "829",
    "anna karenina": "1399",
    "carmilla": "10007",
    "dubliners": "2814",
    "through the looking glass": "12",
}


def shelf(only=None):
    """Titles in play: BOOKS minus SKIP, or just the one named with --book."""
    if only:
        return [only]
    return [b for b in BOOKS if not any(k in b.lower() for k in SKIP)]


def direct_url(gid):
    """Candidate gutenberg.org plain-text URLs for a given id."""
    return [
        f"https://www.gutenberg.org/files/{gid}/{gid}-8.txt",
        f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt",
    ]


def fetch_direct(gid, timeout=20):
    last_err = None
    for url in direct_url(gid):
        try:
            return get(url, binary=True, timeout=timeout).decode("utf-8", errors="replace")
        except Exception as e:
            last_err = e
    raise RuntimeError(f"direct gutenberg fetch failed for id {gid}: {last_err}")


def random_book(rng, only=None):
    wanted = rng.choice(shelf(only))
    gid = KNOWN_IDS.get(norm(wanted))
    if gid is None:
        raise RuntimeError(f"no known gutenberg id for '{wanted}'")
    return wanted, "local fallback", fetch_direct(gid)


def strip_boilerplate(text):
    m = re.search(r"\*\*\* ?START OF.*?\*\*\*", text, re.S)
    if m:
        text = text[m.end():]
    m = re.search(r"\*\*\* ?END OF", text)
    if m:
        text = text[:m.start()]
    return text


def paragraphs(text):
    out = []
    for p in re.split(r"\n\s*\n", text):
        p = re.sub(r"\s+", " ", p).strip()
        if len(p) < 40 or p.upper() == p:
            continue
        out.append(p)
    return out


# ---------- word filtering ----------

def stem(w):
    for suf in ("ing", "ed", "es", "ly", "s"):
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            return w[: -len(suf)]
    return w


def tokens(text):
    """Lowercased alphabetic tokens, ignoring mid-sentence capitalized words (names)."""
    out = []
    for sent in re.split(r"(?<=[.!?])\s+", text):
        for i, tok in enumerate(re.findall(r"[A-Za-z][A-Za-z'\u2019-]*", sent)):
            out.append((tok, i == 0))
    return out


def usable_words(text, block):
    seen, stems, words = set(), set(), []
    for tok, first in tokens(text):
        if "'" in tok or "\u2019" in tok or "-" in tok:
            continue
        if tok[0].isupper() and not first:
            continue  # probably a name
        w = tok.lower()
        if len(w) < 4 or w in STOP or w in FREE or w in block:
            continue
        s = stem(w)
        if w in seen or s in stems:
            continue
        seen.add(w)
        stems.add(s)
        words.append(w)
    return words


def build_passage(paras, rng, block, tries=400):
    for _ in range(tries):
        start = rng.randrange(len(paras))
        chunk, total = [], 0
        for p in paras[start:start + 12]:
            chunk.append(p)
            total += len(p.split())
            text = " ".join(chunk)
            if any(t.lower() in block for t, _ in tokens(text)):
                break  # blocked word in passage: abandon this start point
            words = usable_words(text, block)
            if len(words) >= 52:
                return text, words
            if total > 700:
                break
    return None, None


# ---------- output ----------

def deck_map(words, rng):
    words = rng.sample(words, 52)
    cards = [(r, s) for s, _ in SUITS for r in RANKS]
    return dict(zip(cards, words))


def write_key(path, mapping):
    rows = []
    for sym, name in SUITS:
        red = "red" if sym in "\u2665\u2666" else ""
        cells = "".join(
            f'<tr><td class="card {red}">{sym}{r}</td><td>{html.escape(mapping[(r, sym)])}</td></tr>'
            for r in RANKS)
        rows.append(f'<div class="suit"><h2 class="{red}">{sym}</h2><table>{cells}</table></div>')
    doc = f"""<!doctype html><meta charset="utf-8"><title>World Bridge key</title>
<style>
body{{font-family:Georgia,serif;margin:1.5rem;max-width:800px}}
h1{{font-size:1.3rem;margin:0}} p{{margin:.2rem 0 1rem;font-size:.9rem}}
.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem}}
h2{{margin:0 0 .3rem;font-size:1.6rem}} .red{{color:#b00}}
table{{border-collapse:collapse;width:100%}}
td{{padding:.18rem .3rem;border-bottom:1px solid #ccc;font-size:1rem}}
td.card{{width:3rem;font-weight:bold}}
</style>
<h1>WORLD BRIDGE: word key</h1>
<p>Free words: the, a, of, in, and, is, to, not &middot; endings -s -es -ed -ing -ly &middot; . and ?<br>
Four cards per speaker. Seven words per line. No form of the secret word.</p>
<div class="grid">{''.join(rows)}</div>"""
    Path(path).write_text(doc, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="use a local .txt file instead of fetching")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--blocklist", help="file of extra blocked words, one per line")
    ap.add_argument("--book", help="use only this title (ignores the shelf and skip list)")
    ap.add_argument("--list", action="store_true", help="print the titles in play and exit")
    ap.add_argument("--no-veto", action="store_true", help="skip the preview prompt")
    ap.add_argument("--out", default=".", help="output folder")
    ap.add_argument("--timeout", type=int, default=10, help="network timeout in seconds")
    a = ap.parse_args()

    if a.list:
        print("\n".join(shelf(a.book)))
        return
    rng = random.Random(a.seed)
    block = set(BLOCK)
    if a.blocklist:
        block |= {l.strip().lower() for l in Path(a.blocklist).read_text().splitlines() if l.strip()}
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    fetch_failures = 0
    MAX_FETCH_FAILS = 3
    book_failures = 0
    MAX_BOOK_FAILS = 10

    while True:
        if a.file:
            title, author = Path(a.file).name, "local file"
            raw = Path(a.file).read_text(encoding="utf-8", errors="replace")
        else:
            try:
                title, author, source = random_book(rng, a.book)
                if isinstance(source, str) and source.startswith("http"):
                    raw = get(source, binary=True, timeout=a.timeout).decode("utf-8", errors="replace")
                else:
                    raw = source  # already-fetched mirror text
                fetch_failures = 0
            except Exception as e:
                fetch_failures += 1
                if fetch_failures >= MAX_FETCH_FAILS:
                    sys.exit(
                        f"could not reach gutendex.com after {MAX_FETCH_FAILS} tries "
                        f"(last error: {e}); check your network, or use --file book.txt"
                    )
                print("fetch failed, trying another book:", e, file=sys.stderr)
                continue
        paras = paragraphs(strip_boilerplate(raw))
        if len(paras) < 5:
            if a.file:
                sys.exit("not enough text in that file")
            book_failures += 1
            if book_failures >= MAX_BOOK_FAILS:
                sys.exit("could not find a usable passage in any book; try --blocklist or --file")
            continue
        passage, words = build_passage(paras, rng, block)
        if not passage:
            if a.file:
                sys.exit("could not find a clean passage with 52 usable words")
            book_failures += 1
            if book_failures >= MAX_BOOK_FAILS:
                sys.exit("could not find a usable passage in any book; try --blocklist or --file")
            continue

        mapping = deck_map(words, rng)
        if not a.no_veto:
            print("\nThe 52 words for this game:\n")
            print("  ".join(sorted(mapping.values())))
            try:
                ans = input("\nAnyone want to veto? Type 'reroll' to redraw, or press Enter to keep: ")
            except EOFError:
                ans = ""
            if ans.strip().lower().startswith("r"):
                if a.file:
                    rng = random.Random()
                continue
        break

    write_key(out / "key.html", mapping)
    (out / "reveal.txt").write_text(
        f"{title}\nby {author}\n\n{passage}\n", encoding="utf-8")
    print(f"\nWrote {out/'key.html'} (print this) and {out/'reveal.txt'} (don't open until the end).")


if __name__ == "__main__":
    main()
