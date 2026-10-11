#!/usr/bin/env python3
"""Chess rules tests — runs the REAL functions out of chess.html.

It extracts the actual source text of the move generator (rather than
re-implementing it) and evaluates it in headless Chromium against textbook
positions: Scholar's mate, Fool's mate, castling, en passant, promotion,
stalemate, pins, draws — plus a batch of full games driven by the bot to
prove it never returns an illegal move and always terminates.

    pip install playwright esprima && playwright install chromium
    python3 tests/chess_rules.py

This file caught three real bugs during development:
  * the bot referenced an undefined variable (threw on every move),
  * en passant was generated on the wrong squares (never available at all),
  * the en-passant capture removed the wrong pawn.
"""
import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = (ROOT / "chess.html").read_text(encoding="utf-8")
SCRIPT = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", SRC, re.S)[-1]


def grab(name):
    """Source of a top-level function: `function n(){...}` or
    `const n = (...) => {...}` / `= function(){...}` (prefix stripped)."""
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
            # brace-less arrow body, e.g. (p) => (p !== '.' && ...)
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
const P = (n) => Array(8).fill(n).join('');            // empty rank
const SQ = (nm) => FILES.indexOf(nm[0]) + (8 - parseInt(nm[1], 10)) * 8;

function fromRows(rows, turn, cw, ep){
  const s = makeState();
  s.b = rows.join('').split('');
  s.turn = turn;
  s.cw = { w: cw[0], b: cw[1] };
  s.ep = ep === undefined ? -1 : ep;
  return s;
}
function play(st, moves){        // 'e2e4', 'd1h5', ...
  for (const mv of moves){
    const from = SQ(mv.slice(0,2)), to = SQ(mv.slice(2,4));
    const m = legal(st, st.turn).find(x => x.from === from && x.to === to);
    if (!m) return false;
    applyMove(st, m);
  }
  return true;
}

// ---- start position ----
eq('start_position_is_64_squares', START.length, 64);
eq('start_black_on_top_row', START.slice(0,8), 'rnbqkbnr');
eq('start_white_pawns_on_rank2', START.slice(48,56), 'PPPPPPPP');
eq('start_white_back_rank_on_rank1', START.slice(56), 'RNBQKBNR');

// ---- checkmate detection ----
let s = makeState();
play(s, ['e2e4','e7e5','d1h5','b8c6','f1c4','g8f6']);
const qxf7 = legal(s, WHITE).find(x => x.from === SQ('h5') && x.to === SQ('f7'));
eq('scholars_mate_queen_can_take_f7', !!qxf7, true);
if (qxf7) applyMove(s, qxf7);
eq('scholars_mate_is_mate', outcome(s) && outcome(s).result, WHITE);

let f = makeState();
play(f, ['f2f3','e7e5','g2g4']);
const qh4 = legal(f, BLACK).find(x => x.from === SQ('d8') && x.to === SQ('h4'));
eq('fools_mate_queen_reaches_h4', !!qh4, true);
if (qh4) applyMove(f, qh4);
eq('fools_mate_is_mate', outcome(f) && outcome(f).result, BLACK);

// ---- castling ----
const castleBoard = [P('.'), P('.'), P('.'), P('.'), P('.'), P('.'), P('.'), 'R...K..R'];
let c = fromRows(castleBoard, WHITE, [[true,true],[true,true]]);
const ck = legal(c, WHITE).find(x => x.castle === 'K');
const cq = legal(c, WHITE).find(x => x.castle === 'Q');
eq('castle_kingside_offered', !!ck, true);
eq('castle_queenside_offered', !!cq, true);
if (ck) applyMove(c, ck);
eq('castle_k_moved_king_and_rook',
   [c.b[SQ('g1')], c.b[SQ('f1')], c.b[SQ('e1')]], ['K','R','.']);
let c2 = fromRows(castleBoard, WHITE, [[true,true],[true,true]]);
c2.b[SQ('f8')] = 'r';                       // transit square f1 attacked
eq('castle_blocked_through_check', !!legal(c2, WHITE).find(x => x.castle === 'K'), false);

// ---- en passant (black pawn e4 just double-pushed; ep target e3) ----
const e = fromRows([P('.'), P('.'), P('.'), '....P...', '....p...', P('.'), P('.'), '....K...'],
                   BLACK, [[false,false],[false,false]], SQ('e3'));
const ep = legal(e, BLACK).find(x => x.from === SQ('e4') && x.to === SQ('e3'));
eq('en_passant_offered', !!ep, true);
if (ep) applyMove(e, ep);
eq('en_passant_pawn_lands_on_e3', e.b[SQ('e3')], 'p');
eq('en_passant_removes_captured_pawn', e.b[SQ('e5')], '.');

// ---- promotion ----
const pr = fromRows([P('.'), '....P....', P('.'), P('.'), P('.'), P('.'), P('.'), '....K...'],
                    WHITE, [[false,false],[false,false]]);
const promos = legal(pr, WHITE).filter(x => x.from === SQ('e7'));
eq('promotion_offers_all_four', [...new Set(promos.map(x => x.promo))].sort().join(''), 'BNQR');
eq('promotion_first_choice_is_queen', promos[0].promo, 'Q');   // auto-queen
applyMove(pr, promos[0]);
eq('promotion_becomes_queen', pr.b[SQ('e8')], 'Q');
const pr2 = fromRows(['....r...', '...P....', P('.'), P('.'), P('.'), P('.'), P('.'), '....K...'],
                     WHITE, [[false,false],[false,false]]);
const pc = legal(pr2, WHITE).find(x => x.from === SQ('d7') && x.to === SQ('e8'));
eq('capture_promotion_is_queen', pc && pc.promo, 'Q');
const prFwd = fromRows(['...r....', '...P....', P('.'), P('.'), P('.'), P('.'), P('.'), '....K...'],
                       WHITE, [[false,false],[false,false]]);
eq('pawn_cannot_capture_straight_ahead',
   legal(prFwd, WHITE).some(x => x.from === SQ('d7') && x.to === SQ('d8')), false);
const prBlk = fromRows([P('.'), '...p....', '...P....', P('.'), P('.'), P('.'), P('.'), '....K...'],
                       WHITE, [[false,false],[false,false]]);
eq('blocked_pawn_has_no_promotion', legal(prBlk, WHITE).filter(x => x.promo).length, 0);

// ---- a pawn capture is only a promotion on the back rank ----
// Regression: the capture branch of pseudo() had no `nr === lastRank` guard
// (the push branch always had one), so EVERY capture anywhere on the board
// also offered Q/R/B/N. Both doMove() and the bot resolve a move by first
// match from/to, and the queen is pushed first — so any pawn capture in the
// middle of the board silently became a queen.
const backRank = (p, t) => (t === WHITE ? 0 : 7);      // rank 8 = row 0

// White pawn d5 takes the black pawn on e6. Mid-board: must be a plain capture.
const midW = fromRows([P('.'), P('.'), '....p...', '...P....', P('.'), P('.'), P('.'), '....K...'],
                      WHITE, [[false,false],[false,false]]);
const midWm = legal(midW, WHITE).filter(x => x.from === SQ('d5'));
eq('midboard_capture_white_is_not_a_promotion', midWm.filter(x => x.promo).length, 0);
const midWx = midWm.find(x => x.to === SQ('e6'));
eq('midboard_capture_white_exists', !!midWx, true);
eq('midboard_capture_white_promo_is_null', midWx.promo, null);
applyMove(midW, midWx);
eq('midboard_capture_white_leaves_a_pawn', midW.b[SQ('e6')], 'P');
eq('midboard_capture_white_victim_is_gone', midW.b[SQ('d5')], '.');

// Black pawn e4 takes the white pawn on d3. Mid-board: same for the far side.
const midB = fromRows(['....K...', P('.'), P('.'), P('.'), '....p...', '...P....', P('.'), P('.')],
                      BLACK, [[false,false],[false,false]]);
const midBm = legal(midB, BLACK).filter(x => x.from === SQ('e4') && x.to === SQ('d3'));
eq('midboard_capture_black_is_not_a_promotion', midBm.length, 1);
eq('midboard_capture_black_stays_a_pawn', (applyMove(midB, midBm[0]), midB.b[SQ('d3')]), 'p');

// Every rank below the last must refuse promotion, for a plain capture too.
let midRank = 0, midRankSampled = 0;
for (const t of [WHITE, BLACK]){
  const back = backRank(WHITE, t);
  const dr = t === WHITE ? -1 : 1;
  for (let row = 0; row < 8; row++){
    for (let f = 0; f < 8; f++){
      const nr = row + dr;
      if (nr < 0 || nr > 7) continue;
      // Skip the two situations that are NOT mid-board: a capture that lands
      // ON the back rank is a legal promotion and must be left alone.
      if (nr === back) continue;
      for (const df of [-1, 1]){
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        const mid = fromRows([P('.'), P('.'), P('.'), P('.'), P('.'), P('.'), P('.'), P('.')], t,
                             [[false,false],[false,false]]);
        mid.b[row * 8 + f] = t === WHITE ? 'P' : 'p';
        mid.b[nr * 8 + nf] = t === WHITE ? 'p' : 'P';      // enemy piece to capture
        const from = row * 8 + f;
        const found = legal(mid, t).filter(x => x.from === from && x.to === nr * 8 + nf);
        midRankSampled++;
        if (!found.length) continue;                      // no legal capture — fine
        if (found.some(x => x.promo)) midRank++;           // offered promotion — bug
        if (found.length !== 1) midRank++;                // duplicated capture — bug
      }
    }
  }
}
eq('midboard_capture_positions_sampled', midRankSampled > 40, true);
eq('no_promotion_offered_below_the_back_rank', midRank, 0);

// ...and the back rank itself still offers all four, by push and by capture.
const capRow = fromRows(['..r.....', '...P....', P('.'), P('.'), P('.'), P('.'), P('.'), '....K...'],
                        WHITE, [[false,false],[false,false]]);
eq('backrank_capture_still_promotes',
   [...new Set(legal(capRow, WHITE).filter(x => x.from === SQ('d7')).map(x => x.promo))].sort().join(''),
   'BNQR');

// ---- stalemate & draws ----
const st1 = fromRows(['k.......','..Q......','...K.....', P('.'), P('.'), P('.'), P('.'), P('.')],
                     BLACK, [[false,false],[false,false]]);
eq('stalemate_is_draw', outcome(st1) && outcome(st1).result, 'draw');
eq('stalemate_no_moves', legal(st1, BLACK).length, 0);
eq('kings_only_is_draw', outcome(fromRows([P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),'...kK...'],WHITE,[[false,false],[false,false]])).result, 'draw');
eq('knight_vs_king_is_draw', outcome(fromRows([P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),'..NkK...'],WHITE,[[false,false],[false,false]])).result, 'draw');
eq('bishop_vs_king_is_draw', outcome(fromRows([P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),'..BkK...'],WHITE,[[false,false],[false,false]])).result, 'draw');
eq('rook_present_is_not_draw', outcome(fromRows([P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),P('.'),'..RkK...'],WHITE,[[false,false],[false,false]])), null);

// ---- pins ----
const pin = fromRows(['..k....r', P('.'), P('.'), P('.'), P('.'), P('.'), P('.'), '....K.R.'],
                     WHITE, [[false,false],[false,false]]);
eq('pinned_rook_cannot_leave_file',
   legal(pin, WHITE).some(x => x.from === SQ('h1') && x.to === SQ('g1')), false);

// ---- bot sanity + full games ----
// `strayPromo` counts generated moves that promote a pawn on a rank that is
// not its back rank — the exact shape of the mid-board-queen bug. This walks
// the FULL legal move list at every ply, not just the move the bot picked,
// so it catches the generator rather than the bot's choice.
let illegal = 0, played = 0, worst = 0, strayPromo = 0, seenPromo = 0;
for (let g = 0; g < 40; g++){
  let b = makeState();
  for (let ply = 0; ply < 300; ply++){
    if (outcome(b)) break;
    const m = botMove(b, b.turn);
    if (!m) break;
    for (const lm of legal(b, b.turn)){
      if (!lm.promo) continue;
      seenPromo++;
      const t = colourOf(b.b[lm.from]);
      const back = t === WHITE ? 0 : 7;
      if ((lm.to >> 3) !== back) strayPromo++;
    }
    if (!legal(b, b.turn).some(x => x.from === m.from && x.to === m.to)) illegal++;
    const t0 = performance.now();
    applyMove(b, m);
    worst = Math.max(worst, performance.now() - t0);
    played++;
  }
}
eq('bot_never_illegal', illegal, 0);
eq('no_stray_promotion_in_any_bot_game', strayPromo, 0);
R.bot_moves_played = played;
R.bot_promotions_seen = seenPromo;
R.bot_max_reply_ms = Math.round(worst);
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
        print(f"\n{total - bad}/{total} rules assertions passed")
        if errs:
            print("PAGE ERRORS:", errs, file=sys.stderr)
        br.close()
    return 1 if bad or errs else 0


if __name__ == "__main__":
    sys.exit(main())
