#!/usr/bin/env python3
"""Play test for What's the Hook?: drive the mounted game and assert on the DOM.

tests/hook_test.py proves the rules. This one proves the game *plays* —
mount() builds, the keys fill a draft, lock reaches the host, the solo reveal
offers a hook you can hear on its own and a Next button, a wide pair paginates
instead of running off the screen, a table of two can vote and skip the vote,
spectators stay read-only, and teardown stops the clock.

It stands in for the hub the way src/main.js drives a game: `api.send(action)`
goes to `reduce()`, and the result is projected and handed back to
`update(view)`.

    pip install playwright && playwright install chromium
    python3 tests/hook_play.py
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "hook" / "index.js"
LIB = ROOT / "games" / "hook" / "library.js"

HARNESS = r"""
(src) => {
  const parts = src.split('__LIB__');
  let lib = parts[0], mod = parts[1];
  lib = lib.replace(/export (const|function)/g, '$1');
  mod = mod.replace(/export (const|function)/g, '$1')
           .replace(/import\s+\{[^}]*\}\s+from\s+['"]\.\/library\.js['"];?/, '');
  const factory = new Function(lib + '\n' + mod + `
    window.__hook = { meta, init, reduce, project, summarize, mount, prune, fillCount, SIZE, PAIRS };
  `);
  factory();

  const hk = window.__hook;
  const out = [];
  const ok = (name, cond) => out.push([name, !!cond]);

  // A stand-in for Web Audio that records what was scheduled and when. The order the three
  // parts are queued in is invisible in the DOM, and getting it wrong (nested calls) plays
  // intro, outro, hook — so the DOM test watches the audio schedule instead of the pixels.
  const played = [];
  const FakeParam = function (v) { this.value = v; };
  FakeParam.prototype.setValueAtTime = function () {};
  FakeParam.prototype.exponentialRampToValueAtTime = function () {};
  window.AudioContext = function () {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.resume = function () {};
    this.close = function () {};
    this.createGain = function () { return { gain: new FakeParam(1), connect: function () { return this; } }; };
    this.createOscillator = function () {
      const os = { type: 'sine', frequency: new FakeParam(440), connect: function () { return this; },
        start: function (t) { played.push({ at: Number(t), hz: Math.round(this.frequency.value) }); },
        stop: function () {} };
      return os;
    };
  };

  const ME = 'me';
  const table = [{ id: ME, name: 'Sam', host: true, game: 'hook' }];
  let state = hk.init({ seats: table, atTable: table, options: {} });
  const intents = [];
  const denied = [];
  let intervals = new Map(), nextTimer = 1;
  const api = {
    me: { id: ME, name: 'Sam' },
    seats: { 0: ME },
    roster: table,
    atTable: table,
    isSpectator: false,
    isHost: true,
    isInRoom: false,
    send: (action) => {
      intents.push(action);
      const next = hk.reduce(state, action, { from: { id: ME, name: 'Sam', host: true }, rng: Math.random });
      if (!next || next.error) {
        denied.push(next && next.error);
        handle.denied(next && next.error);
        return;
      }
      state = next;
      handle.update(hk.project(state, ME));
    },
    raf: (fn) => requestAnimationFrame(fn),
    cancelRaf: (id) => cancelAnimationFrame(id),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    setInterval: (fn, ms) => { const id = nextTimer++; intervals.set(id, { fn, ms }); return id; }
  };
  const realClearInterval = window.clearInterval.bind(window);
  window.clearInterval = (id) => { intervals.delete(id); try { realClearInterval(id); } catch (e) {} };

  const host = document.getElementById('stage');
  host.style.cssText = 'position:relative;width:400px;height:600px';
  const shadow = host.attachShadow({ mode: 'open' });
  const handle = hk.mount(shadow, api);
  handle.update(hk.project(state, ME));

  const q = (sel) => shadow.querySelector(sel);
  const qa = (sel) => Array.from(shadow.querySelectorAll(sel));

  ok('mount builds the Hook title', !!q('h1') && q('h1').textContent === "What's the Hook?");
  ok('the game is called Hook', hk.meta.id === 'hook');
  ok('the bubble renders', !!q('#bubble'));
  ok('first update asks to join', intents.some((a) => a.a === 'join'));
  ok('the rule is on screen under the title',
    /You make the best hook to fit between the intro and outro\./.test(q('#rules').textContent));
  ok('a table of one is not promised a vote', /No table, no vote/.test(q('#rules').textContent));
  // The clock is switched off at the moment: no countdown on screen, and nothing times a
  // round out. PLAY_MS is the one constant that brings it back.
  ok('the round is untimed', state.deadline === 0);
  ok('no countdown is drawn while untimed', !q('#clock') && shadow.textContent.indexOf('\u23f1') < 0);
  ok('an untimed round never asks to tick',
    !intents.some((a) => a.a === 'tick'));

  // The grid draws one screenful of columns, and never more than that: a 16-slot pair
  // paginates rather than running off the side of a phone.
  const cellsPerPage = (w, n) => Math.max(1, Math.min(n, Math.floor((w - 26 + 4) / 48)));
  ok('grid renders one page of note cells', (() => {
    const n = hk.fillCount(state.pair);
    return qa('#grid button').length === cellsPerPage(host.clientWidth, n) * hk.SIZE;
  })());
  ok('the grid fits the width it is given',
    q('#grid').scrollWidth <= q('#grid').clientWidth + 1 && q('.k').scrollWidth <= q('.k').clientWidth + 1);
  ok('the compose panel can play each part on its own',
    !!q('[data-part="hook"]') && !!q('[data-part="intro"]') && !!q('[data-part="outro"]') && !!q('[data-part="all"]'));
  ok('the parts play in order: intro, hook, outro, all', (() => {
    const parts = qa('.plays button').map((b) => b.dataset.part);
    return parts.join(',') === 'intro,hook,outro,all';
  })());

  // ---- compose a hook: one cell per column (paging as needed), then lock
  const firstPair = state.pair.name;
  const cell = (c, r) => q('#grid [data-col="' + c + '"][data-row="' + r + '"]');
  // One note per column, paging to reach the columns that do not fit.
  const fillDraft = () => {
    const n = hk.fillCount(state.pair);
    let filled = 0, paged = 0;
    for (let c = 0; c < n; c++) {
      let b = cell(c, 0);
      while (!b && paged < n) {
        const next = q('[data-pg="1"]');
        if (!next) break;
        next.click(); paged++; b = cell(c, 0);
      }
      if (b) { b.click(); filled++; }
    }
    return filled;
  };
  const n = hk.fillCount(state.pair);
  ok('every slot of the hook can be filled', fillDraft() === n);

  // ---- the three parts play in the order the game goes: intro, hook, outro.
  // Only "All" plays more than one part, so it is the one that can get the order wrong.
  const heard = (name) => {
    played.length = 0;
    q('.plays [data-part="' + name + '"]').click();
    return played.slice().sort((a, b) => a.at - b.at);
  };
  const introNotes = heard('intro'), hookNotes = heard('hook'), outroNotes = heard('outro');
  ok('each part plays on its own', introNotes.length > 0 && hookNotes.length > 0 && outroNotes.length > 0);
  const allNotes = heard('all');
  const seq = (notes) => notes.map((x) => x.hz).join(',');
  ok('All plays every part once', allNotes.length === introNotes.length + hookNotes.length + outroNotes.length);
  // The order inside All is the whole point: nested schedule() calls queue the inner part
  // first, which is how this ever played intro, outro, hook.
  ok('All plays the parts in order: intro, hook, outro',
    seq(allNotes) === seq(introNotes) + ',' + seq(hookNotes) + ',' + seq(outroNotes));
  const iLast = allNotes[introNotes.length - 1], hFirst = allNotes[introNotes.length];
  const hLast = allNotes[introNotes.length + hookNotes.length - 1];
  const oFirst = allNotes[introNotes.length + hookNotes.length];
  ok('the hook starts after the intro has finished', hFirst.at >= iLast.at);
  ok('the outro starts after the hook has finished', oFirst.at >= hLast.at);
  ok('nothing overlaps the part before it', allNotes.every((x, i) => i === 0 || x.at >= allNotes[i - 1].at));

  // ---- New game: the host throws the round away for a different pair, keeping scores
  ok('the host is offered a new game', !!q('[data-a="newpair"]'));
  const pairBeforeSwap = state.pair.name, scoresBeforeSwap = JSON.stringify(state.scores);
  q('[data-a="newpair"]').click();
  ok('new game deals a different pair', state.phase === 'play' && state.pair.name !== pairBeforeSwap);
  ok('new game keeps the scores', JSON.stringify(state.scores) === scoresBeforeSwap);
  ok('new game says so in the bubble', /New pair dealt/.test(q('#bubble').textContent));
  ok('new game clears the draft', /0\/[0-9]+ slots filled/.test(q('#game').textContent));
  q('[data-a="newpair"]').click();
  ok('two new games never hand back the same pair', state.pair.name !== pairBeforeSwap);
  ok('the fresh round can be filled and locked', fillDraft() === hk.fillCount(state.pair));

  ok('lock reaches the host', (() => {
    q('[data-a="lock"]').click();
    return intents.some((a) => a.a === 'lock') && state.locked[ME];
  })());

  // ---- solo: a reveal of your own hook and a Next button, never a vote for yourself
  ok('solo lock reveals your hook', state.phase === 'reveal');
  ok('solo is never asked to vote for itself', !q('[data-a="vote"]'));
  ok('the reveal shows the hook it just took', /Your hook/.test(q('#game').textContent));
  ok('the reveal can play the hook alone', !!q('[data-part="hook"]'));
  const roundBeforeNext = state.round, pairBeforeNext = state.pair.name;
  q('[data-a="next"]').click();
  ok('next deals a fresh pair',
    state.phase === 'play' && state.round === roundBeforeNext + 1 && state.pair.name !== pairBeforeNext);
  ok('holding the hook scores a point', state.scores[ME] === 1);
  ok('the win is named', /held the hook/.test(q('#game').textContent));
  const line = hk.summarize(state, (id) => id === ME ? 'Sam' : id);
  ok('the record names the winner',
    typeof line === 'string' && line.indexOf("What's the Hook?:") === 0 && line.indexOf('Sam') >= 0);

  // ---- locking with an empty draft never leaves the client
  const sentBefore = intents.length;
  const lockBtn = q('[data-a="lock"]');
  if (lockBtn) lockBtn.click();
  ok('an empty draft is stopped locally',
    intents.length === sentBefore && /Choose .* notes first/.test(q('#bubble').textContent));

  // ---- a wide pair on a narrow screen: pager, no sideways scroll
  const widest = hk.PAIRS.reduce((a, p) => (hk.fillCount(p) > hk.fillCount(a) ? p : a));
  host.style.width = '320px';
  const wide = hk.project({ ...state, pair: widest, round: 500 }, ME);
  handle.update(wide);
  const wn = hk.fillCount(wide.pair), wpp = cellsPerPage(320, wn);
  ok('the widest pair is wider than a phone', wn > wpp);
  ok('a pair that will not fit gets a pager', !!q('#pager') && /of /.test(q('#pager').textContent));
  ok('only a page of columns is drawn', qa('#grid button').length === wpp * hk.SIZE);
  ok('the pager shows the columns you are on', /slots 1[–-]\d+ of \d+/.test(q('#pager').textContent));
  ok('nothing runs off the side',
    q('#grid').scrollWidth <= q('#grid').clientWidth + 1 && q('.k').scrollWidth <= q('.k').clientWidth + 1);
  q('[data-pg="1"]').click();
  ok('the pager moves to the next columns', !!q('#grid [data-col="' + wpp + '"]'));

  // ---- a table of two: the vote panel, and a way out of it once someone has voted
  const duoHost = document.createElement('div');
  document.body.appendChild(duoHost);
  const duoShadow = duoHost.attachShadow({ mode: 'open' });
  const duo = [{ id: ME, name: 'Sam' }, { id: 'zed', name: 'Zoe' }];
  let duoState = hk.init({ seats: duo, atTable: duo });
  const hooks = Array(hk.fillCount(duoState.pair));
  duoState = hk.reduce(duoState, { a: 'lock', b: hooks.map((_, i) => i % 8) },
    { from: { id: ME, name: 'Sam' }, rng: Math.random });
  duoState = hk.reduce(duoState, { a: 'lock', b: hooks.map((_, i) => (i + 3) % 8) },
    { from: { id: 'zed', name: 'Zoe' }, rng: Math.random });
  const duoApi = Object.assign({}, api, {
    isHost: false, isInRoom: true,
    send: (a) => {
      const next = hk.reduce(duoState, a, { from: { id: ME, name: 'Sam', host: false }, rng: Math.random });
      if (!next || next.error) return;
      duoState = next;
      duoHandle.update(hk.project(duoState, ME));
    },
    setInterval: (fn, ms) => window.setInterval(fn, ms)
  });
  const duoHandle = hk.mount(duoShadow, duoApi);
  const dq = (sel) => duoShadow.querySelector(sel);
  const dqa = (sel) => Array.from(duoShadow.querySelectorAll(sel));
  duoHandle.update(hk.project(duoState, ME));
  ok('a table of two is promised the vote',
    /We will vote on who found the best hook\./.test(dq('#rules').textContent));
  ok('both hooks lock and the vote opens', duoState.phase === 'vote' && dqa('[data-a="vote"]').length === 1);
  ok('a guest is not offered a new game', !dq('[data-a="newpair"]'));
  ok('your own hook offers no vote button', !dq('[data-a="vote"][data-id="' + ME + '"]'));
  ok('there is no way out of a vote nobody has cast', !dq('[data-a="skip"]'));
  ok('a guest cannot smuggle a new pair through the rules',
    !!(hk.reduce(duoState, { a: 'newpair' }, { from: { id: ME, name: 'Sam', host: false }, rng: Math.random }) || {}).error);
  dq('[data-a="vote"]').click();
  ok('the vote records your pick', duoState.votes[ME] === 'zed');
  ok('a Next round button appears once a vote lands', !!dq('[data-a="skip"]'));
  dq('[data-a="skip"]').click();
  ok('Next round ends the vote and deals again',
    duoState.phase === 'play' && duoState.round === 2 && duoState.scores.zed === 1);

  // ---- a spectator watches read-only and never joins
  const watchHost = document.createElement('div');
  document.body.appendChild(watchHost);
  const watchShadow = watchHost.attachShadow({ mode: 'open' });
  const sent = [];
  const watchApi = Object.assign({}, api, {
    isSpectator: true, isHost: false, isInRoom: true,
    me: { id: 'ghost', name: 'Cy' },
    send: (a) => sent.push(a),
    setInterval: (fn, ms) => window.setInterval(fn, ms)
  });
  const watchHandle = hk.mount(watchShadow, watchApi);
  watchHandle.update(hk.project(state, 'ghost'));
  ok('a spectator is told they are watching',
    watchShadow.textContent.indexOf('watching') >= 0);
  ok('a spectator gets no grid', !watchShadow.querySelector('#grid'));
  ok('a spectator never asks to join', sent.every((a) => a.a !== 'join'));

  // ---- teardown stops the clock
  handle.destroy();
  watchHandle.destroy();
  duoHandle.destroy();
  ok('destroy stops the clock', intervals.size === 0);

  return out;
}
"""


def main():
    lib = LIB.read_text(encoding="utf-8")
    mod = GAME.read_text(encoding="utf-8")
    payload = lib + "__LIB__" + mod
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content(
            "<!DOCTYPE html><html><body>"
            "<div id='stage'></div></body></html>"
        )
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        got = pg.evaluate("(" + HARNESS + ")", payload)
        br.close()

    results = list(got)

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)
    for e in errors:
        bad += 1
        print("  FAIL page error: " + e)

    print()
    print("%d/%d hook play checks passed" % (len(results) + len(errors) - bad,
                                             len(results) + len(errors)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
