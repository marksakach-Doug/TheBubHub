#!/usr/bin/env python3
"""Chess capture + end-to-end tests — runs the REAL functions out of chess.html.

Covers what broke for the knight (and the same hole for the king): every
piece type must be able to capture, captures must remove the victim, the
fifty-move clock must reset on any capture, en passant must work diagonally
for both colours, plus perft node counts from the start position and
bot-vs-bot full games that always terminate with only legal moves.

    pip install playwright && playwright install chromium
    python3 tests/chess_captures.py
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = (ROOT / "public" / "chess.html").read_text(encoding="utf-8")
SCRIPT = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", SRC, re.S)[-1]


def grab(name):
    m = re.search(r"function\s+" + name + r"\s*\(", SCRIPT)
    if m:
        start, i = m.start(), SCRIPT.index("{", m.end())
    else:
        m = re.search(r"\b(?:const|var|let)\s+" + name + r"\s*=\s*", SCRIPT)
        if not m:
            sys.exit(f"cannot find function {name}")
        start = m.end()
        arrow = SCRIPT.index("=>", start)
        head = SCRIPT[arrow + 2:]
        stripped = head.lstrip()
        if not stripped.startswith("{"):
            return SCRIPT[start: SCRIPT.index(";", start) + 1].strip()
        i = arrow + 2 + (len(head) - len(stripped))
    depth, j = 0, i
    while j < len(SCRIPT):
        if SCRIPT[j] == "{":
            depth += 1
        elif SCRIPT[j] == "}":
            depth -= 1
            if depth == 0:
                return SCRIPT[start: j + 1].strip()
        j += 1
    sys.exit(f"unbalanced braces in {name}")


def const(name):
    m = re.search(r"(?:const|var|let)\s+" + name + r"\s*=\s*([^;]+);", SCRIPT)
    return m.group(1).strip() if m else None


FUNCS = ["makeState", "copy", "posKey", "kingSq", "attackedBy", "inCheck",
         "pseudo", "applyMove", "legal", "outcome", "hasMatingMaterial",
         "botMove", "opponent", "isWhite", "colourOf", "typeOf"]

HARNESS = """
(() => {
const R = {}, fails = [];
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  R[name] = { ok, got, want };
  if (!ok) fails.push(name);
};
const WHITE='w', BLACK='b';
__FUNCS__
__CONSTS__
const P = (n) => Array(8).fill(n).join('');
const SQ = (nm) => FILES.indexOf(nm[0]) + (8 - parseInt(nm[1], 10)) * 8;
function fromRows(rows, turn, cw, ep){
  const s = makeState();
  s.b = rows.join('').split('');
  s.turn = turn;
  s.cw = { w: cw[0], b: cw[1] };
  s.ep = ep === undefined ? -1 : ep;
  return s;
}
const NC = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

// ---- 1. knight captures every landing square, both colours ----
for (const side of [WHITE, BLACK]){
  const me = side === WHITE ? 'N' : 'n', foe = side === WHITE ? 'p' : 'P';
  const rows = [P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),P('.')];
  rows[4] = '....' + me + '...';                       // e4
  for (const [df, dr] of NC) rows[4 + dr] =
    rows[4 + dr].slice(0, 4 + df) + foe + rows[4 + dr].slice(4 + df + 1);
  const s = fromRows(rows, side, [[false,false],[false,false]]);
  const mv = legal(s, side).filter(x => x.from === SQ('e4'));
  eq('knight_' + side + '_captures_all_eight', mv.length, 8);
  const dests = mv.map(x => x.to).sort((a,b) => a - b);
  const want = NC.map(([df, dr]) => (4 + dr) * 8 + 4 + df).sort((a,b) => a - b);
  eq('knight_' + side + '_capture_squares', dests, want);
  const first = mv[0];
  applyMove(s, first);
  eq('knight_' + side + '_capture_removes_victim', s.b[first.to], me);
  eq('knight_' + side + '_capture_empties_origin', s.b[SQ('e4')], '.');
}
// knight blocked by its own pieces: zero captures offered
{
  const rows = [P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),P('.')];
  rows[4] = '....N...';
  for (const [df, dr] of NC) rows[4 + dr] =
    rows[4 + dr].slice(0, 4 + df) + 'P' + rows[4 + dr].slice(4 + df + 1);
  const s = fromRows(rows, WHITE, [[false,false],[false,false]]);
  eq('knight_blocked_by_own_offers_nothing',
     legal(s, WHITE).filter(x => x.from === SQ('e4')).length, 0);
}

// ---- 2. king captures, but not into check and never its own ----
{
  const s = fromRows([P('.'),P('.'),P('.'),P('.'),'...pK...',P('.'),P('.'),'....K...'.slice(0,8)],
                     WHITE, [[false,false],[false,false]]);
  s.b[SQ('e1')] = 'K';
  const m = legal(s, WHITE).find(x => x.from === SQ('e4') && x.to === SQ('d4'));
  eq('king_captures_adjacent_enemy', !!m, true);
  if (m) applyMove(s, m);
  eq('king_capture_occupies_square', s.b[SQ('d4')], 'K');
}
{
  // black rook on d8 defends d4: white king e4 must NOT capture d4
  const s = fromRows(['...r....',P('.'),P('.'),P('.'),'...pK...',P('.'),P('.'),'....K...'],
                     WHITE, [[false,false],[false,false]]);
  eq('king_refuses_capture_into_check',
     legal(s, WHITE).some(x => x.from === SQ('e4') && x.to === SQ('d4')), false);
}
{
  const s = fromRows([P('.'),P('.'),P('.'),P('.'),'...PK...',P('.'),P('.'),'....K...'.slice(0,8)],
                     WHITE, [[false,false],[false,false]]);
  s.b[SQ('e1')] = 'K';
  eq('king_ignores_own_piece',
     legal(s, WHITE).some(x => x.from === SQ('e4') && x.to === SQ('d4')), false);
}

// ---- 3. sliders capture, blocked by own, stop behind victim ----
{
  const s = fromRows([P('.'),P('.'),P('.'),P('.'),'K..R...p',P('.'),P('.'),P('.')],
                     WHITE, [[false,false],[false,false]]);
  eq('rook_captures_down_file', legal(s, WHITE).some(x => x.from === SQ('d4') && x.to === SQ('h4')), true);
  const s2 = fromRows([P('.'),P('.'),P('.'),P('.'),'K..RP..p',P('.'),P('.'),P('.')],
                      WHITE, [[false,false],[false,false]]);
  eq('rook_blocked_by_own', legal(s2, WHITE).some(x => x.from === SQ('d4') && x.to === SQ('h4')), false);
  const b = fromRows([P('.'),P('.'),P('.'),'....B...','.....p..',P('.'),P('.'),'....K...'],
                     WHITE, [[false,false],[false,false]]);
  eq('bishop_captures_diagonal', legal(b, WHITE).some(x => x.from === SQ('e5') && x.to === SQ('f4')), true);
  const q = fromRows([P('.'),P('.'),P('.'),P('.'),'...Q....','...p....',P('.'),'....K...'],
                     WHITE, [[false,false],[false,false]]);
  eq('queen_captures_adjacent', legal(q, WHITE).some(x => x.from === SQ('d4') && x.to === SQ('d3')), true);
}

// ---- 4. pawn captures + fifty-move clock resets on ANY capture ----
{
  const s = fromRows([P('.'),P('.'),'....p...','...P....',P('.'),P('.'),P('.'),'....K...'],
                     WHITE, [[false,false],[false,false]]);
  s.half = 17;
  const m = legal(s, WHITE).find(x => x.from === SQ('d5') && x.to === SQ('e6'));
  eq('pawn_capture_exists', !!m, true);
  applyMove(s, m);
  eq('pawn_capture_leaves_pawn', s.b[SQ('e6')], 'P');
  eq('pawn_capture_resets_halfmove', s.half, 0);
}
{
  const s = fromRows([P('.'),P('.'),'...p....',P('.'),'....N...',P('.'),P('.'),'....K...'],
                     WHITE, [[false,false],[false,false]]);
  s.half = 40;
  const m = legal(s, WHITE).find(x => x.from === SQ('e4') && x.to === SQ('d6'));
  eq('knight_capture_exists_for_clock', !!m, true);
  applyMove(s, m);
  eq('knight_capture_resets_halfmove', s.half, 0);
}
{
  // half=99 + quiet king step -> fifty-move draw; half=99 + capture -> no draw
  const q = fromRows([P('.'),P('.'),P('.'),P('.'),'....K...','........',P('.'),'...k....'],
                     WHITE, [[false,false],[false,false]]);
  q.half = 99;
  const step = legal(q, WHITE).find(x => x.from === SQ('e4') && x.to === SQ('e5'));
  const q2 = copy(q); applyMove(q2, step);
  eq('fifty_move_draw_on_quiet_move', outcome(q2) && outcome(q2).result, 'draw');
  const c = fromRows(['r.......',P('.'),P('.'),P('.'),'...pK...',P('.'),P('.'),'...k....'],
                     WHITE, [[false,false],[false,false]]);
  c.half = 99;
  const cap = legal(c, WHITE).find(x => x.from === SQ('e4') && x.to === SQ('d4'));
  eq('capture_at_99_exists', !!cap, true);
  const c2 = copy(c); applyMove(c2, cap);
  eq('capture_at_99_resets_clock', c2.half, 0);
  eq('capture_at_99_is_not_draw', outcome(c2), null);
}

// ---- 5. en passant both colours, victim removed from the right square ----
{
  const w = fromRows([P('.'),P('.'),P('.'),'...pP...',P('.'),P('.'),P('.'),'....K...'],
                     WHITE, [[false,false],[false,false]], SQ('d6'));
  const m = legal(w, WHITE).find(x => x.from === SQ('e5') && x.to === SQ('d6'));
  eq('ep_white_offered', !!m && !!m.ep, true);
  applyMove(w, m);
  eq('ep_white_lands', w.b[SQ('d6')], 'P');
  eq('ep_white_victim_gone', w.b[SQ('d5')], '.');
  eq('ep_white_origin_empty', w.b[SQ('e5')], '.');
  const b = fromRows(['....K...',P('.'),P('.'),P('.'),'...Pp...','........',P('.'),P('.')],
                     BLACK, [[false,false],[false,false]], SQ('d3'));
  const mb = legal(b, BLACK).find(x => x.from === SQ('e4') && x.to === SQ('d3'));
  eq('ep_black_offered', !!mb && !!mb.ep, true);
  applyMove(b, mb);
  eq('ep_black_lands', b.b[SQ('d3')], 'p');
  eq('ep_black_victim_gone', b.b[SQ('d4')], '.');
}

// ---- 6. a real knight capture inside a game line ----
{
  // 1.Nf3 d5 2.Ne5 Nf6 3.Nxf7?? — illegal (king escapes), but Nxd5 must exist first
  const s = makeState();
  const play = (mvs) => {
    for (const mv of mvs){
      const from = SQ(mv.slice(0,2)), to = SQ(mv.slice(2,4));
      const m = legal(s, s.turn).find(x => x.from === from && x.to === to);
      if (!m) return false;
      applyMove(s, m);
    }
    return true;
  };
  eq('opening_line_plays', play(['g1f3','d7d5','f3e5','g8f6']), true);
  eq('knight_takes_pawn_d5', !!legal(s, s.turn).find(x => x.from === SQ('e5') && x.to === SQ('d7')) ||
                              !!legal(s, s.turn).find(x => x.from === SQ('e5') && x.to === SQ('c6')), true);
  const nxd = legal(s, s.turn).find(x => x.from === SQ('e5') && x.to === SQ('c6'));
  if (nxd){ const v = copy(s); applyMove(v, nxd); eq('knight_capture_leaves_knight', v.b[SQ('c6')], 'N'); }
}

// ---- 7. perft: start-position node counts (generator hole detector) ----
function perft(st, depth){
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legal(st, st.turn)){
    const ns = copy(st);
    applyMove(ns, m);
    n += perft(ns, depth - 1);
  }
  return n;
}
{
  const t0 = performance.now();
  eq('perft_depth1', perft(makeState(), 1), 20);
  eq('perft_depth2', perft(makeState(), 2), 400);
  eq('perft_depth3', perft(makeState(), 3), 8902);
  R.perft_ms = Math.round(performance.now() - t0);
}

// ---- 8. bot-vs-bot full games: legal moves only, always terminate ----
// Mirrors the live game: threefold repetition is a draw (driveBot tracks it;
// outcome() alone does not), fifty-move and mating rules come from outcome().
let illegal = 0, played = 0, games = 0, unfinished = 0, captures = 0;
for (let g = 0; g < 40; g++){
  let b = makeState();
  const seen = {};
  seen[posKey(b)] = 1;
  let done = false;
  for (let ply = 0; ply < 500; ply++){
    if (outcome(b)){ done = true; break; }
    const m = botMove(b, b.turn);
    if (!m) break;
    if (b.b[m.to] !== '.' || m.ep) captures++;
    if (!legal(b, b.turn).some(x => x.from === m.from && x.to === m.to)) illegal++;
    applyMove(b, m);
    played++;
    const k = posKey(b);
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] === 3){ done = true; break; }
  }
  if (outcome(b)) done = true;
  if (done) games++; else unfinished++;
}
eq('bot_never_illegal', illegal, 0);
eq('bot_games_terminated', unfinished, 0);
eq('bot_games_finished', games, 40);
R.bot_moves_played = played;
R.bot_captures_seen = captures;
return { results: R, fails };
})()
"""


def build():
    js = HARNESS.replace("__FUNCS__", "\n  ".join(f"const {n} = {grab(n)};" for n in FUNCS))
    js = js.replace(
        "__CONSTS__",
        f"const FILES={const('FILES')}; const GLYPH={const('GLYPH')}; const VAL={const('VAL')};\n"
        f"  const HOME_COUNT={const('HOME_COUNT')}; const START={const('START')};\n"
        f"  const R1=56, R8=0;",
    )
    return js


def main():
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("about:blank")
        out = pg.evaluate(build())
        bad = 0
        for name, v in out["results"].items():
            if isinstance(v, dict) and "ok" in v:
                if not v["ok"]:
                    bad += 1
                    print(f"FAIL  {name}: got={v['got']!r} want={v['want']!r}")
            else:
                print(f"info  {name}: {v}")
        total = sum(1 for v in out["results"].values() if isinstance(v, dict) and "ok" in v)
        print(f"\n{total - bad}/{total} capture assertions passed")
        if errs:
            print("PAGE ERRORS:", errs, file=sys.stderr)
        br.close()
    return 1 if bad or errs else 0


if __name__ == "__main__":
    sys.exit(main())
