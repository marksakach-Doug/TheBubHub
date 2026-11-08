"""Blight in a real browser.

Serves the repo root over HTTP, mounts the SHIPPED games/blight/index.js behind a stand-in hub
(tests/blight_harness.html: the real reduce()/project(), one Shadow DOM per player) and drives the
buttons. Assertions are on the DOM, on computed styles and on what is painted.

    python3 tests/blight_play.py            (needs: pip install playwright && playwright install chromium)
    python3 tests/blight_play.py layout     (just one section: layout | roots | stacks | palette | fold | play | misc)
"""
import functools, http.server, os, random, re, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ONLY = sys.argv[1] if len(sys.argv) > 1 else None
fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)
        print('  FAIL', msg)
    return bool(cond)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d/tests/blight_harness.html' % srv.server_address[1]


def new_page(b, url, w, h, users='Ann', bar=0, dark=False, extra=''):
    pg = b.new_page(viewport={'width': w, 'height': h}, color_scheme='dark' if dark else 'light')
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: pg.errs.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
    pg.goto(url + '?users=' + users + ('&bar=%d' % bar if bar else '') + extra)
    pg.wait_for_selector('.bl', state='attached')
    pg.wait_for_timeout(200)
    return pg


# ---------------------------------------------------------------------------------------------
#  Scenarios: worst-case boards injected straight into the stand-in hub's state
# ---------------------------------------------------------------------------------------------
PREAMBLE = """
const ids = ['u0','~bot1','~bot2','~bot3','~bot4','~bot5'].slice(0, %(N)d);
const mk = (o, i, k) => ({ id: o + '.' + i, k, s: (i + 1) * 7919 + o.charCodeAt(o.length - 1) * 131 });
S.order = ids; S.p = {}; S.epoch = 1; S.round = 3; S.winner = null; S.shown = {}; S.flips = []; S.ready = [];
S.bid = null; S.challenger = null; S.need = 0; S.count = 0; S.fail = null; S.turn = null; S.max = 0; S.placed = [];
S.log = ['Bot 1 places a card face down.', 'Bot 2 raises to 6.'];
const kinds = ['P', 'D', 'P', 'P'];
ids.forEach((id, n) => {
  const bot = id[0] === '~', mine = id === 'u0';
  const sN = mine ? %(MINE)d : %(OPP)d, hN = mine ? %(HAND)d : 4 - %(OPP)d;
  S.p[id] = { name: bot ? 'Bot ' + id.slice(4) : 'Ann', bot, alive: true, wins: n %% 2, tag: '', rev: [],
    stack: kinds.slice(0, sN).map((k, i) => mk(id, i, k)), hand: kinds.slice(0, Math.max(0, hN)).map((k, i) => mk(id, 4 + i, k)) };
});
"""


def scen(phase, n=6, mine=2, opp=3, hand=2, body=''):
    return (PREAMBLE % {'N': n, 'MINE': mine, 'OPP': opp, 'HAND': hand}) + "S.phase = '%s';\n" % phase + body


SCENARIOS = {
    'plant (me up, 6 players)': scen('plant', mine=0, opp=1, hand=4, body="S.turn = 'u0'; S.starter = 'u0';"),
    'grow (me up, 4-card stack)': scen('grow', mine=3, opp=4, hand=1, body="S.turn = 'u0'; S.starter = 'u0';"),
    'bid (me up, 24 max, three folded)': scen('bid', mine=4, opp=4, hand=0,
        body="S.max = 24; S.turn = 'u0'; S.bid = { cur: 7, high: '~bot2', out: ['~bot1','~bot3','~bot4'] }; S.p['~bot1'].tag = 'Folded';"),
    'challenge (me flipping, 8 reveals)': scen('challenge', mine=0, opp=4, hand=4,
        body="S.challenger = 'u0'; S.turn = 'u0'; S.need = 9; S.count = 8; S.bid = { cur: 9, high: 'u0', out: ['~bot1','~bot2'] };"
             "const f = []; for (let i = 0; i < 8; i++) { const o = i < 4 ? 'u0' : '~bot3'; f.push({ o, c: mk(o, i, 'P') }); } S.flips = f;"),
    'challenge (someone else flipping, my 4-card stack)': scen('challenge', mine=4, opp=4, hand=0,
        body="S.challenger = '~bot2'; S.turn = '~bot2'; S.need = 6; S.count = 3; S.bid = { cur: 6, high: '~bot2', out: ['~bot1'] };"
             "S.p['~bot2'].stack = []; S.flips = [0,1,2].map(i => ({ o: '~bot2', c: mk('~bot2', i, 'P') }));"),
    'dead tree revealed (lose)': scen('lose', mine=1, opp=2, hand=2,
        body="S.challenger = 'u0'; S.turn = 'u0'; S.need = 3; S.count = 1; S.bid = { cur: 3, high: 'u0', out: [] }; S.flips = [{ o: 'u0', c: mk('u0', 0, 'P') }, { o: 'u0', c: mk('u0', 1, 'D') }];"),
    'result': scen('result', mine=0, opp=0, hand=4,
        body="S.challenger = 'u0'; S.p.u0.tag = 'Won round'; S.p.u0.wins = 1; S.bid = { cur: 3, high: 'u0', out: ['~bot1'] };"
             "S.flips = [0,1,2].map(i => ({ o: 'u0', c: mk('u0', i, 'P') })); S.shown = { u0: S.flips.map(f => f.c) };"),
    'over': scen('over', mine=0, opp=0, hand=4, body="S.winner = 'u0'; S.round = 7; S.p.u0.wins = 2;"),
    'lobby (6 at the table)': "S.phase = 'lobby'; S.order = []; S.p = {}; S.flips = []; S.log = []; S.lobby = ['u0','a','b','c','d','e']; S.names = { u0: 'Ann', a: 'Bea', b: 'Cyrus', c: 'Dominika', d: 'Edmund', e: 'Fatima' };",
}

# ---------------------------------------------------------------------------------------------
#  Probes (run in the page)
# ---------------------------------------------------------------------------------------------
LAYOUT = """
(cid) => {
  const R = H.root(cid), bl = R.querySelector('#bl'), r = bl.getBoundingClientRect(), P = [];
  const doc = document.documentElement;
  if (doc.scrollHeight > innerHeight + 1) P.push('the page scrolls: ' + doc.scrollHeight + ' > ' + innerHeight);
  const want = Math.max(320, innerHeight - r.top);
  if (Math.abs(r.height - want) > 1.5) P.push('height ' + r.height.toFixed(1) + ' is not 100dvh minus chrome (' + want.toFixed(1) + ')');
  const ratios = {};
  for (const [id, lo, hi] of [['#top', .25, .30], ['#mid', .40, .45], ['#bot', .25, .30]]) {
    const z = R.querySelector(id).getBoundingClientRect(), q = z.height / r.height; ratios[id] = +q.toFixed(3);
    if (q < lo - .004 || q > hi + .004) P.push(id + ' zone is ' + (q * 100).toFixed(1) + '% of the height (want ' + lo * 100 + '-' + hi * 100 + '%)');
  }
  for (const id of ['#top', '#mid', '#bot']) {
    const z = R.querySelector(id), zr = z.getBoundingClientRect();
    z.querySelectorAll('.opp,.stkw,.c,.tx,button,.fp,.mine,#hand,#prompt,#acts,#flips,#hero,.lob').forEach((el) => {
      if (el.closest('.stk.spread')) return;
      const e = el.getBoundingClientRect(); if (!e.width || !e.height) return;
      const d = (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"';
      if (e.bottom > zr.bottom + 1.5) P.push(d + ' pokes ' + (e.bottom - zr.bottom).toFixed(1) + 'px below the ' + id + ' zone');
      if (e.top < zr.top - 1.5) P.push(d + ' pokes ' + (zr.top - e.top).toFixed(1) + 'px above the ' + id + ' zone');
      if (e.right > r.right + 1.5 || e.left < r.left - 1.5) P.push(d + ' pokes out sideways');
    });
  }
  return { P, ratios, h: Math.round(r.height) };
}
"""

# Which text is painted UNDER a decoration? SVG decorations are pointer-events:none, which hides them from
# hit-testing, so the probe turns that back on and then asks, for a grid of points over every text run,
# whether a root/outline <path> sits above the text's own element in the paint order.
SCAN = """
([cid, breakIt]) => {
  const R = H.root(cid), st = document.createElement('style');
  st.textContent = '#bgr,#bgr *,.bd,.bd *{pointer-events:auto !important}' +
    (breakIt ? '#bgr{z-index:0 !important}.tx{position:static !important;z-index:auto !important}.bd{z-index:auto !important}' : '');
  R.append(st);
  const isDecor = (el) => el.tagName === 'path' && !!(el.closest('#bgr') || el.closest('.bd'));
  const out = []; let runs = 0;
  const w = document.createTreeWalker(R.querySelector('.bl'), NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    const t = n.textContent.trim(); if (!t) continue;
    const par = n.parentElement; if (!par || par.closest('style')) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) {
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      runs++; let hit = 0;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
        const x = r.left + r.width * (i + .5) / 8, y = r.top + r.height * (j + .5) / 4;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const stack = R.elementsFromPoint(x, y);
        const ti = stack.findIndex((e) => e === par || par.contains(e)), di = stack.findIndex(isDecor);
        if (di >= 0 && (ti < 0 || di < ti)) hit++;
      }
      if (hit) out.push(t.slice(0, 36) + ' (' + hit + '/32 points)');
    }
  }
  st.remove();
  return { runs, covered: out };
}
"""

LUM = """
const lum = (c) => { const m = String(c).match(/[\\d.]+/g); if (!m) return 1; const [r, g, b] = m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const hue = (c) => { const m = String(c).match(/[\\d.]+/g).slice(0, 3).map(Number); const [r, g, b] = m.map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
"""


def patch(pg, src):
    pg.evaluate("(s) => H.patch(s)", src)
    pg.wait_for_timeout(60)


def drive(pg, cid='u0', rnd=None, prefer=('ready', 'flip', 'lose', 'raise', 'fold', 'bid', 'add', 'addmode', 'openmode', 'place')):
    """One real click on whatever the player can do. Returns the act clicked, or None."""
    rnd = rnd or random.Random(1)
    acts = [a['act'] for a in pg.evaluate("(c) => H.actions(c)", cid)]
    for pref in prefer:
        if pref in acts:
            if pref == 'raise' and rnd.random() < .6:
                pref = 'fold'
            if pref in ('bid', 'openmode') and rnd.random() < .4:
                continue
            loc = pg.locator('[data-act="%s"]' % pref)
            loc.nth(rnd.randrange(loc.count()) if pref == 'flip' else 0).click()
            return pref
    return None


def phase(pg):
    return pg.evaluate("() => H.state().phase")


# ---------------------------------------------------------------------------------------------
def section_layout(b, url):
    print('1) Locked viewport: no vertical scroll, three zones (28/44/28), nothing poking out — 10 viewports x 9 worst-case boards')
    views = [(320, 568, 0), (360, 640, 0), (375, 667, 0), (390, 844, 0), (412, 915, 0), (390, 844, 56), (844, 390, 0), (667, 375, 0), (768, 1024, 0), (1280, 800, 0)]
    for (w, h, bar) in views:
        pg = new_page(b, url, w, h, bar=bar)
        bad = []
        for name, src in SCENARIOS.items():
            patch(pg, src)
            r = pg.evaluate(LAYOUT, 'u0')
            bad += ['[%s] %s' % (name, p) for p in r['P']]
        label = '%dx%d%s' % (w, h, ' +%dpx hub header' % bar if bar else '')
        print('   %-30s %s' % (label, 'ok' if not bad else '%d problem(s)' % len(bad)))
        for x in bad[:10]:
            print('        ', x)
        check(not bad, '%s: %d layout problems' % (label, len(bad)))
        check(not [e for e in pg.errs if 'favicon' not in e], '%s page errors %s' % (label, pg.errs[:2]))
        pg.close()
    pg = new_page(b, url, 390, 844)
    patch(pg, SCENARIOS['grow (me up, 4-card stack)'])
    pg.set_viewport_size({'width': 390, 'height': 700}); pg.wait_for_timeout(250)
    r = pg.evaluate(LAYOUT, 'u0')
    check(not r['P'], 'after the viewport shrinks 844 -> 700 tall (address bar): %s' % r['P'][:3])
    pg.close()


def section_roots(b, url):
    print('2) Text is never under a root or outline — every board, 5 viewports, light + dark')
    total = 0
    for (w, h, dark) in [(1280, 900, False), (768, 1024, True), (390, 844, False), (390, 844, True), (360, 640, False)]:
        pg = new_page(b, url, w, h, dark=dark)
        worst = []
        for name, src in SCENARIOS.items():
            patch(pg, src); pg.wait_for_timeout(120)
            r = pg.evaluate(SCAN, ['u0', False]); total += r['runs']
            if r['covered']:
                worst.append((name, r['covered'][:3]))
        print('   %4dx%-4d %-5s %s' % (w, h, 'dark' if dark else 'light', 'clean' if not worst else worst))
        check(not worst, '%dx%d: text under a root/outline: %s' % (w, h, worst[:2]))
        pg.close()
    print('   (%d text runs probed)' % total)
    pg = new_page(b, url, 390, 844)
    flagged = 0
    for name, src in SCENARIOS.items():
        patch(pg, src); pg.wait_for_timeout(100)
        flagged += len(pg.evaluate(SCAN, ['u0', True])['covered'])
    check(flagged > 0, 'control run: the probe flags overlap when the layering fix is switched off')
    print('   control: with the fix switched off the same probe flags %d text runs, so a clean result means something' % flagged)
    pg.close()


def section_stacks(b, url):
    print('3) Stack readability: borders, step offsets, ×count, TOP/FLIP, private pips, press-and-hold spread')
    pg = new_page(b, url, 390, 844)
    patch(pg, SCENARIOS['grow (me up, 4-card stack)'])
    pg.wait_for_timeout(2500)
    info = pg.evaluate("""() => {
      const R = H.root('u0'), cs = [...R.querySelectorAll('.c')], bad = [];
      cs.forEach(c => { const s = getComputedStyle(c);
        const bw = parseFloat(s.borderTopWidth), col = s.borderTopColor;
        if (bw < 2 || bw > 3.01) bad.push('border ' + bw + 'px'); if (col !== 'rgb(17, 17, 17)') bad.push('border colour ' + col);
        if (!s.boxShadow || s.boxShadow === 'none') bad.push('no shadow'); });
      const stacks = [...R.querySelectorAll('.opp .stk')].map(st => [...st.querySelectorAll('.c')].map(c => { const r = c.getBoundingClientRect(); return [r.left, r.top]; }));
      const badges = [...R.querySelectorAll('.opp .badge')].map(x => x.textContent.trim());
      const mine = [...R.querySelectorAll('.mine .stk .c')].map(c => { const r = c.getBoundingClientRect(); return [r.left, r.top]; });
      return { n: cs.length, bad: [...new Set(bad)], stacks, badges, mine, mineBadge: (R.querySelector('.mine .badge') || {}).textContent };
    }""")
    check(info['n'] > 8 and not info['bad'], 'every card has a 2-3px #111 border and a shadow (%d cards): %s' % (info['n'], info['bad']))
    steps = []
    for st in info['stacks'] + [info['mine']]:
        for a, c in zip(st, st[1:]):
            steps.append((a[1] - c[1], c[0] - a[0]))          # later cards sit higher (smaller top) and a hair to the right
    check(steps and all(6 <= dy <= 8.01 and dx > 0 for dy, dx in steps), 'each card steps 6-8px up and a little right of the one below it: %s' % sorted(set((round(a, 1), round(b_, 1)) for a, b_ in steps))[:6])
    check(info['badges'] and all(t == '×4' for t in info['badges']) and info['mineBadge'] == '×3', 'every stack has a ×count pill (%s, mine %s)' % (info['badges'], info['mineBadge']))

    pips = pg.evaluate("() => [...H.root('u0').querySelectorAll('.mine .pip')].map(p => [p.textContent.trim(), p.className])")
    kinds = pg.evaluate("() => H.state().p.u0.stack.map(c => c.k)")
    want = ['%d %s' % (i + 1, '✿' if k == 'P' else '✖') for i, k in enumerate(kinds)]
    check([p[0] for p in pips] == want, 'pips number the stack 1..n from the bottom with ✿/✖ (%s vs %s)' % ([p[0] for p in pips], want))
    check(all(('D' in p[1]) == (k == 'D') for p, k in zip(pips, kinds)), 'and carry the plant/dead colour code')
    tabs = pg.evaluate("() => H.root('u0').querySelectorAll('.mine .tab').length")
    check(tabs == len(kinds) - 1, 'one colour tab per hidden edge (%d)' % tabs)

    pg2 = new_page(b, url, 900, 1000, users='Ann,Bo')
    pg2.evaluate("() => H.click('u0','start')")
    patch(pg2, "S.p.u0.stack=[{id:'u0.0',k:'P',s:11},{id:'u0.1',k:'D',s:22},{id:'u0.2',k:'P',s:33}]; S.p.u0.hand=[{id:'u0.3',k:'P',s:44}];")
    bo = pg2.evaluate("""() => { const R = H.root('u1'); return { pips: R.querySelectorAll('.pip').length - R.querySelectorAll('.mine .pip').length, tabs: R.querySelectorAll('.opp .tab').length,
       hold: R.querySelectorAll('.opp [data-hold]').length, kindClass: [...R.querySelectorAll('.opp .stk .c')].filter(c => c.classList.contains('P') || c.classList.contains('D')).length,
       ids: R.innerHTML.includes('u0.0') || R.innerHTML.includes('u0.1') || R.innerHTML.includes('u0.2') }; }""")
    check(bo == {'pips': 0, 'tabs': 0, 'hold': 0, 'kindClass': 0, 'ids': False}, "an opponent's DOM carries no pips, tabs, kind classes or real ids for Ann's stack: %s" % bo)
    pg2.close()

    box = pg.locator('[data-hold]').bounding_box()
    before = pg.evaluate("() => [...H.root('u0').querySelectorAll('.mine .stk .c')].map(c => c.getBoundingClientRect().top)")
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    pg.mouse.down(); pg.wait_for_timeout(100)
    early = pg.evaluate("() => !!H.root('u0').querySelector('.stk.spread')")
    pg.wait_for_timeout(550)
    held = pg.evaluate("() => [...H.root('u0').querySelectorAll('.mine .stk .c')].map(c => c.getBoundingClientRect().top)")
    spread = pg.evaluate("() => !!H.root('u0').querySelector('.stk.spread')")
    pg.mouse.up(); pg.wait_for_timeout(350)
    after = pg.evaluate("() => [...H.root('u0').querySelectorAll('.mine .stk .c')].map(c => c.getBoundingClientRect().top)")
    gaps_b = [a - c for a, c in zip(before, before[1:])]; gaps_h = [a - c for a, c in zip(held, held[1:])]
    check(not early, 'a quick tap does not spread the stack')
    check(spread and all(g > 20 for g in gaps_h) and all(g < 9 for g in gaps_b), 'holding fans the cards out vertically (%s -> %s px apart)' % ([round(g) for g in gaps_b], [round(g) for g in gaps_h]))
    check(not pg.evaluate("() => !!H.root('u0').querySelector('.stk.spread')") and all(abs(a - b_) < 1 for a, b_ in zip(before, after)), 'and letting go puts them back exactly')
    pg.close()

    pg = new_page(b, url, 390, 844)
    patch(pg, SCENARIOS['challenge (me flipping, 8 reveals)'])
    r = pg.evaluate("""() => { const R = H.root('u0'); const stacks = [...R.querySelectorAll('.opp .stk')];
      return { tops: stacks.map(s => s.querySelectorAll('.c.top').length), topIsLast: stacks.every(s => { const c = s.querySelectorAll('.c'); return c[c.length - 1].classList.contains('top'); }),
        labels: [...R.querySelectorAll('.opp .toplbl')].map(x => x.textContent.trim()), flippable: R.querySelectorAll('.opp.flip').length,
        glow: getComputedStyle(R.querySelector('.opp .c.top')).animationName,
        strip: [...R.querySelectorAll('#flips .fp')].map(f => [f.querySelector('.no').textContent.trim(), f.querySelector('.own').textContent.trim()]) }; }""")
    check(all(t == 1 for t in r['tops']) and r['topIsLast'], 'exactly one TOP card per stack, and it is the last one placed: %s' % r['tops'])
    check(set(r['labels']) == {'FLIP'} and len(r['labels']) == r['flippable'] == 5, 'tappable stacks wear FLIP (%s)' % r['labels'])
    check('topglow' in r['glow'], 'the uppermost card pulses (%s)' % r['glow'])
    check([s[0] for s in r['strip']] == [str(i) for i in range(1, 9)] and [s[1] for s in r['strip']] == ['You'] * 4 + ['Bot 3'] * 4, 'the reveal strip is numbered in flip order with owners: %s' % r['strip'])
    patch(pg, SCENARIOS['challenge (someone else flipping, my 4-card stack)'])
    r = pg.evaluate("""() => { const R = H.root('u0'); return { mine: R.querySelectorAll('.mine .c.top').length, lbl: (R.querySelector('.mine .toplbl') || {}).textContent, flippable: R.querySelectorAll('.opp.flip').length }; }""")
    check(r['mine'] == 1 and r['lbl'] == 'TOP' and r['flippable'] == 0, 'when someone else is flipping, your own top card shows TOP and nothing is tappable: %s' % r)
    patch(pg, SCENARIOS['grow (me up, 4-card stack)'])
    check(pg.evaluate("() => H.root('u0').querySelectorAll('.c.top').length") == 0, 'no TOP marks outside the reveal phase')
    pg.close()


def section_palette(b, url):
    print('4) Visual hierarchy: muted frames and backs, one hue per living card, cards fill the face, charcoal only on dead trees')
    pg = new_page(b, url, 390, 844)
    patch(pg, SCENARIOS['challenge (me flipping, 8 reveals)'])
    pg.wait_for_timeout(3200)
    r = pg.evaluate("() => {" + LUM + """
      const R = H.root('u0'), q = (s) => [...R.querySelectorAll(s)];
      const dark = [];
      q('path').forEach(p => { const f = getComputedStyle(p).fill; if (f.startsWith('rgb') && lum(f) < .06 && !p.closest('.art.dd')) dark.push(f + ' in ' + (p.closest('.c') ? '.c' : (p.closest('.bd') ? '.bd' : p.closest('#bgr') ? '#bgr' : '?'))); });
      const frame = q('.bd path').map(p => lum(getComputedStyle(p).fill)), roots = q('#bgr path').map(p => lum(getComputedStyle(p).fill));
      const backs = q('.c.b').map(c => lum(getComputedStyle(c).backgroundColor)), backArt = q('.c.b .art path').map(p => lum(getComputedStyle(p).fill));
      const deadArt = q('.art.dd path').map(p => lum(getComputedStyle(p).fill));
      const cards = q('#hand .c.P, #flips .c.P').map(c => ({ hs: [...c.querySelectorAll('g:has(> circle) > path')].map(p => hue(getComputedStyle(p).fill)).filter(h => h >= 0), id: c.dataset.id,
          leaves: [...c.querySelectorAll('svg > g > g:not(:has(> circle)) > path')].map(p => hue(getComputedStyle(p).fill)) }));
      const fills = q('#hand .c.P, #flips .c.P').map(c => { const o = c.getBoundingClientRect(), g = c.querySelector('svg > g').getBoundingClientRect(), bw = parseFloat(getComputedStyle(c).borderTopWidth);
          return Math.max(g.width / (o.width - 2 * bw), g.height / (o.height - 2 * bw)); });
      return { dark, bg: lum(getComputedStyle(R.querySelector('#bl')).backgroundColor), frame: Math.min(...frame), roots: Math.min(...roots), backs: Math.min(...backs), backArt: Math.min(...backArt), deadArt: Math.max(...deadArt), cardTwigs: q('.c .bd').length, cards, fills }; }""")
    check(not r['dark'], 'nothing near-black is drawn except Dead Tree art: %s' % r['dark'][:3])
    check(r['frame'] > .45 and r['frame'] < r['bg'], 'frame outlines are a light muted brown (min luminance %.2f)' % r['frame'])
    check(.55 < r['roots'] < r['bg'] and r['bg'] - r['roots'] < .2, 'background roots are a faint parchment tone, just off the table colour (%.2f vs table %.2f)' % (r['roots'], r['bg']))
    check(r['backs'] > .5 and r['backArt'] > .3, 'card backs are parchment with soft roots (%.2f / %.2f)' % (r['backs'], r['backArt']))
    check(r['deadArt'] < .05, 'dead trees are charcoal (%.3f)' % r['deadArt'])
    check(r['cardTwigs'] == 0, 'cards carry no root twigs (%d)' % r['cardTwigs'])
    spreads = [round(max(c['hs']) - min(c['hs'])) for c in r['cards'] if c['hs']]
    check(len(spreads) >= 4 and all(s_ < 16 for s_ in spreads), 'each living card uses one flower hue (hue spread per card, degrees): %s' % spreads)
    leaf = [h for c in r['cards'] for h in c['leaves'] if h >= 0]
    check(len(leaf) > 30 and all(70 <= h <= 180 for h in leaf), 'foliage is healthy green only, no autumn leaves (%d leaves, hue %d-%d)' % (len(leaf), min(leaf), max(leaf)))
    check(r['fills'] and all(.78 <= f <= 1.0 for f in r['fills']), 'living art fills the card face (%s)' % [round(f, 2) for f in r['fills']])
    pg.close()


def section_fold(b, url):
    print('5) Fold: wording, and folded players dimmed until the next round')
    pg = new_page(b, url, 390, 844)
    patch(pg, SCENARIOS['bid (me up, 24 max, three folded)'])
    r = pg.evaluate("""() => { const R = H.root('u0'), opps = [...R.querySelectorAll('.opp')];
      const f = opps.filter(o => o.classList.contains('folded')), n = opps.filter(o => !o.classList.contains('folded'));
      const bg = (el) => getComputedStyle(el, '::before').backgroundColor;
      return { f: f.length, n: n.length, chips: f.map(o => o.querySelector('.chip').textContent.trim()),
        fBg: [...new Set(f.map(bg))], nBg: [...new Set(n.map(bg))], opacityTile: f.map(o => getComputedStyle(o).opacity), opacityStk: f.map(o => getComputedStyle(o.querySelector('.stk')).opacity),
        stkN: n.map(o => getComputedStyle(o.querySelector('.stk')).opacity), acts: H.actions('u0').map(a => a.label), text: R.textContent }; }""")
    check(r['f'] == 3 and r['n'] == 2, 'three folded tiles, two still bidding (%d/%d)' % (r['f'], r['n']))
    check(set(r['chips']) == {'Folded'}, 'folded players wear a "Folded" chip: %s' % r['chips'])
    check(not set(r['fBg']) & set(r['nBg']), 'a folded tile has a different (dimmer) panel colour: %s vs %s' % (r['fBg'], r['nBg']))
    check(all(float(o) < .5 for o in r['opacityStk']) and all(o == '1' for o in r['opacityTile']) and all(o == '1' for o in r['stkN']),
          'its cards fade but the tile never uses opacity (that would break the text layering): tile %s cards %s' % (r['opacityTile'], r['opacityStk']))
    check('Fold' in r['acts'] and not any('pass' in a.lower() for a in r['acts']), 'the button says Fold: %s' % r['acts'])
    check(not re.search(r'\bpass(es|ed)?\b', r['text'], re.I), 'the word "pass" appears nowhere on screen')
    patch(pg, SCENARIOS['challenge (me flipping, 8 reveals)'])
    r = pg.evaluate("""() => { const R = H.root('u0'); const f = [...R.querySelectorAll('.opp.folded')]; return { n: f.length, stk: f.map(o => getComputedStyle(o.querySelector('.stk')).opacity) }; }""")
    check(r['n'] == 2 and all(o == '1' for o in r['stk']), 'folded tiles stay dimmed through the reveal, but their stacks go full-strength so TOP stays readable: %s' % r)
    patch(pg, SCENARIOS['result'])
    check(pg.evaluate("() => H.root('u0').querySelectorAll('.opp.folded').length") == 1, 'still dimmed on the result screen')
    patch(pg, SCENARIOS['plant (me up, 6 players)'])
    check(pg.evaluate("() => H.root('u0').querySelectorAll('.opp.folded').length") == 0, 'and the dimming is gone when the next round starts')
    pg.close()


def section_play(b, url):
    print('6) Two humans + a bot, played to the end through the buttons; nothing hidden reaches the other browser')
    pg = new_page(b, url, 1100, 800, users='Ann,Bo')
    lob = pg.evaluate("() => H.G.project(H.state(), 'u1').lobby.map(m => m.name)")
    check(lob == ['Ann', 'Bo'], 'both humans are in the lobby (%s)' % lob)
    check(pg.evaluate("() => H.actions('u1').filter(a => a.act === 'start').length") == 0, 'a guest has no Start button')
    check(pg.evaluate("() => H.actions('u0').filter(a => a.act === 'start').length") == 1, 'the host has one')
    pg.evaluate("() => H.click('u0', 'start')")
    rnd = random.Random(11)
    steps = leaks = 0
    while phase(pg) != 'over' and steps < 1500:
        steps += 1
        order = ['u0', 'u1']; rnd.shuffle(order)
        for cid in order:
            acts = [a['act'] for a in pg.evaluate("(c) => H.actions(c)", cid)]
            pick = None
            for pref in ('ready', 'flip', 'lose', 'raise', 'fold', 'bid', 'add', 'addmode', 'openmode', 'place'):
                if pref in acts:
                    if pref == 'raise' and rnd.random() < .6: pref = 'fold'
                    if pref in ('bid', 'openmode') and rnd.random() < .4: continue
                    pick = pref; break
            if pick:
                pg.evaluate("([c, a, k]) => H.click(c, a, k)", [cid, pick, rnd.randrange(4)])
                break
        if steps % 6 == 0:
            leaks += pg.evaluate("""() => {
              const S = H.state(), pub = new Set(); let bad = 0;
              S.order.forEach(id => { S.p[id].rev.forEach(c => pub.add(c.id)); (S.shown[id] || []).forEach(c => pub.add(c.id)); });
              for (const viewer of ['u0', 'u1']) { const html = H.html(viewer);
                for (const owner of S.order) { if (owner === viewer) continue;
                  for (const c of S.p[owner].hand.concat(S.p[owner].stack)) if (!pub.has(c.id) && html.includes('data-id="' + c.id + '"')) bad++; } }
              return bad; }""")
    check(phase(pg) == 'over', 'two-human game reached its end (%d steps, phase %s)' % (steps, phase(pg)))
    check(leaks == 0, "hidden card ids found in the other player's DOM %d times" % leaks)
    host_acts = [a['act'] for a in pg.evaluate("() => H.actions('u0')")]
    guest_acts = [a['act'] for a in pg.evaluate("() => H.actions('u1')")]
    check('start' in host_acts and 'toLobby' in host_acts, 'host sees Play again + Back to lobby (%s)' % host_acts)
    check('start' not in guest_acts and 'toLobby' not in guest_acts, 'guest does not (%s)' % guest_acts)
    check('the game' in pg.evaluate("() => H.root('u1').querySelector('#hero').textContent"), 'result banner shown to the guest')
    pg.evaluate("() => H.click('u0', 'toLobby')")
    check(phase(pg) == 'lobby' and pg.evaluate("() => H.root('u1').textContent.includes('At the table')"), 'host can go back to the lobby and the guest follows')
    pg.evaluate("() => H.click('u0', 'start')")
    check(phase(pg) == 'plant', 'and start a fresh game')
    check(not [e for e in pg.errs if 'favicon' not in e], 'no page errors: %s' % pg.errs[:2])
    pg.close()

    print('   solo vs bots through real mouse clicks at phone size, including the bid stepper')
    pg = new_page(b, url, 390, 844)
    pg.locator('[data-act="start"]').click()
    rnd = random.Random(5); steps = 0; saw = set(); stepped = False
    while phase(pg) != 'over' and steps < 500:
        steps += 1
        saw.add(phase(pg))
        acts = [a['act'] for a in pg.evaluate("() => H.actions('u0')")]
        if 'stepup' in acts and not stepped:
            before = int(pg.evaluate("() => H.root('u0').querySelector('#acts .num').textContent"))
            pg.locator('[data-act="stepup"]').click()
            after = int(pg.evaluate("() => H.root('u0').querySelector('#acts .num').textContent"))
            label = pg.evaluate("() => H.root('u0').querySelector('#acts .go').textContent.trim()")
            check(after in (before, before + 1), 'stepper + moves the number (%d -> %d)' % (before, after))
            check(str(after) in label, 'and the confirm button says what it will do ("%s")' % label)
            pg.locator('[data-act="stepdn"]').click(); stepped = True
        if drive(pg, 'u0', rnd) is None:
            pg.wait_for_timeout(30)
    check(phase(pg) == 'over', 'solo game finished through real clicks (%d steps)' % steps)
    check({'plant', 'grow'} <= saw, 'visited the phases %s' % sorted(saw))
    check(stepped, 'the bid stepper was exercised')
    check(not [e for e in pg.errs if 'favicon' not in e], 'no page errors: %s' % pg.errs[:2])
    pg.close()


def section_misc(b, url):
    print('7) Joining, watching, refusals shown, names escaped')
    pg2 = new_page(b, url, 900, 800, users='Ann,Bo', extra='&seated=1')
    lob = pg2.evaluate("() => H.G.project(H.state(), 'u1').lobby.map(m => m.name)")
    check(lob == ['Ann', 'Bo'], 'a guest not yet at the table joins itself from its first update (%s)' % lob)
    pg2.evaluate("() => H.click('u0', 'start')")
    turn = pg2.evaluate("() => H.state().turn")
    other = 'u1' if turn == 'u0' else 'u0'
    check(pg2.evaluate("(o) => H.actions(o).filter(a => a.act !== 'skip').length", other) == 0, 'the player who is not up has no game-action buttons')
    skip_host = pg2.evaluate("() => H.actions('u0').filter(a => a.act === 'skip').length"); skip_guest = pg2.evaluate("() => H.actions('u1').filter(a => a.act === 'skip').length")
    check(skip_guest == 0 and skip_host == (1 if turn == 'u1' else 0), 'only the host is offered "let a bot move" and only while the other human is up (host %d, guest %d, turn %s)' % (skip_host, skip_guest, turn))
    pg2.evaluate("(o) => H.send(o, { a: 'place', k: 'P' })", other)
    pg2.wait_for_timeout(100)
    msg = pg2.evaluate("(o) => { const p = H.root(o).querySelector('#prompt'); return [p.textContent, p.className]; }", other)
    check('turn' in msg[0].lower() and 'err' in msg[1], 'a refused move is explained where the instruction normally is: %s' % msg)
    pg2.close()

    pg3 = new_page(b, url, 900, 800, users='Ann,Bo', extra='&seated=1&spec=1')
    lob = pg3.evaluate("() => H.G.project(H.state(), 'u1').lobby.map(m => m.name)")
    check(lob == ['Ann'], 'a spectator never takes a seat (%s)' % lob)
    check('not at this table' in pg3.evaluate("() => H.html('u1')"), 'and is told why they cannot play')
    pg3.evaluate("() => H.click('u0', 'start')")
    check('Watching' in pg3.evaluate("() => H.root('u1').querySelector('#prompt').textContent") and pg3.evaluate("() => H.actions('u1').length") == 0, 'a watcher gets an explanation, not a dead board, and no buttons')
    check(pg3.evaluate("() => H.root('u1').querySelectorAll('.opp').length") == 3, 'and sees every seat as an opponent tile')
    pg3.close()

    pg4 = b.new_page(viewport={'width': 900, 'height': 800})
    pg4.errs = []
    pg4.on('pageerror', lambda e: pg4.errs.append(str(e)))
    pg4.on('dialog', lambda d: (pg4.errs.append('dialog ' + d.message), d.dismiss()))
    pg4.goto(url + '?users=' + '%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E,Bo')
    pg4.wait_for_timeout(400)
    pg4.evaluate("() => H.click('u0', 'start')")
    pg4.wait_for_timeout(300)
    check(pg4.evaluate("() => H.root('u0').querySelectorAll('img').length + H.root('u1').querySelectorAll('img').length") == 0, 'no <img> was injected through a name')
    check(not pg4.errs, 'no script ran from a name: %s' % pg4.errs)
    pg4.close()


SECTIONS = [('layout', section_layout), ('roots', section_roots), ('stacks', section_stacks), ('palette', section_palette),
            ('fold', section_fold), ('play', section_play), ('misc', section_misc)]


def main():
    srv, url = serve()
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, fn in SECTIONS:
            if ONLY and ONLY != name:
                continue
            fn(b, url)
        b.close()
    srv.shutdown()
    print()
    if fails:
        print('FAILED: %d check(s)' % len(fails))
        sys.exit(1)
    print('blight browser checks: all green')


if __name__ == '__main__':
    main()
