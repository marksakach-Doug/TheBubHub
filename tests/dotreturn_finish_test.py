#!/usr/bin/env python3
"""A Focus round must always reach `over`, or its score is never recorded.

`recordModule()` writes a line only when `summarize()` succeeds, and summarize()
returns null until the phase is `over`. The phase only changes on a `finish`
intent, so any round that fails to send one loses its score silently — the
round sits in `play`, the results screen never appears, and the record list
stays empty. That is the "sometimes it doesn't record anything" report.

Two ways it used to fail, both covered here:

  * **A single latched attempt.** The client latched `askedFinish = true` before
    sending. reduce() rejects `finish` with "The clock is still running." when
    the client's clock is more than FINISH_GRACE ahead of the host's, nothing
    retried, and the round was over — as a frozen field with no score.

  * **A hidden tab.** The clock was only ever noticed inside a
    requestAnimationFrame loop, which a hidden tab stops running entirely. A
    solo player who looked away for the last few seconds had no round left to
    come back to.

`api.raf` is a fake clock so a 70-second round costs milliseconds, and
`frozen` is the hidden-tab stand-in: time passes, no frames.

    pip install playwright && playwright install chromium
    python3 tests/dotreturn_finish_test.py
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "dotreturn" / "index.js"

HARNESS = r"""
(src) => {
  src = src.replace(/export (const|function)/g, '$1');
  const factory = new Function(src + `
    window.__dr = { meta, init, reduce, project, summarize, mount,
                    roundId: typeof roundId === 'function' ? roundId : function () { return ''; } };
  `);
  factory();
  const dr = window.__dr;

  const out = [];
  // `detail` is serialised at assert time, not when the page finishes — passing
  // a live array would report the state after later cases had run.
  const ok = (name, cond, detail) =>
    out.push([name, !!cond,
              detail === undefined ? null : JSON.parse(JSON.stringify(detail))]);

  // fake clock; `frozen` = hidden tab (time passes, frames do not)
  let clock = 10000, nextId = 1, frozen = false, framesRun = 0;
  const t0 = Date.now();
  Date.now = () => t0 + clock;
  const cbs = new Map();
  const pump = (ms) => {
    const step = 1000 / 60, target = clock + ms;
    if (frozen) { clock = target; return; }
    while (clock < target) {
      clock += step;
      framesRun++;
      const running = Array.from(cbs.values());
      cbs.clear();
      running.forEach((fn) => fn(clock));
    }
  };

  // Timeouts the game asked for, kept so a test can fire the deadline itself
  // instead of waiting 71 real seconds for it.
  const timers = [];
  const fireTimers = () => { const t = timers.splice(0, timers.length); t.forEach(x => x.fn()); };

  const ME = 'me';
  const table = [{ id: ME, name: 'Sam', host: true, game: 'dotreturn' }];
  let state = dr.init({ seats: table, atTable: table, options: {} });

  const intents = [];
  const recorded = [];          // what recordModule() would have written
  let lastRound = null;
  let denyFinish = 0;           // how many `finish` intents the host refuses
  let askedAtDeny = null;       // finish count at the moment of a refusal

  const settle = () => {
    const text = dr.summarize(state, (id) => (id === ME ? 'Sam' : 'Someone'));
    if (!text) return;
    const r = dr.roundId(state);
    if (r === lastRound) return;      // recordModule dedupes on this
    lastRound = r;
    recorded.push(text);
  };

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
      if (action.a === 'finish' && denyFinish > 0) {
        denyFinish--;
        askedAtDeny = intents.filter((a) => a.a === 'finish').length;
        // Exactly what src/main.js does with a reduce() denial: it does not
        // apply the state, and it tells the game it was refused.
        handle.denied('The clock is still running.');
        return;
      }
      const next = dr.reduce(state, action, { from: { id: ME, name: 'Sam' }, rng: Math.random });
      if (!next || next.error) { handle.denied(next && next.error); return; }
      state = next;
      handle.update(dr.project(state, ME));
      settle();
    },
    raf: (fn) => { const id = nextId++; cbs.set(id, fn); return id; },
    cancelRaf: (id) => { cbs.delete(id); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    setInterval: (fn, ms) => window.setInterval(fn, ms)
  };

  const host = document.getElementById('stage');
  host.style.cssText = 'position:relative;width:400px;height:600px';
  const shadow = host.attachShadow({ mode: 'open' });
  const handle = dr.mount(shadow, api);
  handle.update(dr.project(state, ME));

  const q = (sel) => shadow.querySelector(sel);
  const btn = () => q('.dr-btn');
  // Relative to the current round. A cumulative count reads as "asked again"
  // even when the extra ask belonged to an earlier round — which is exactly
  // how the old one-shot latch slips past.
  let finishBase = 0;
  const finishTotal = () => intents.filter((a) => a.a === 'finish').length;
  const finishAsks = () => finishTotal() - finishBase;
  // A round that failed to end leaves no Start button on screen, so this has
  // to fail the assertions rather than throw and hide the reason.
  const begin = () => {
    const b = btn();
    finishBase = finishTotal();
    if (!b || b.disabled) return false;
    b.click();
    api.send({ a: 'revealend' });
    return true;
  };
  const resultShown = () => q('.dr-overlay').hidden === false && q('.dr-title').textContent.indexOf('Round Over') >= 0;

  // ================================================================ case 1
  // The ordinary path: the clock runs out and the round ends.
  begin();
  ok('the round is under way', state.phase === 'play');
  const finishesBefore = finishAsks();
  pump(20000);
  ok('nothing asks to finish while the clock is running',
    finishAsks() === finishesBefore, finishAsks());
  ok('the round has not ended early', state.phase === 'play');

  pump(60000);
  ok('the round ends when the clock runs out', state.phase === 'over');
  ok('the results screen is shown', resultShown());
  ok('the score reaches the record list', recorded.length === 1, recorded);
  ok('a finished round is only written once', settle() === undefined && recorded.length === 1);

  // ================================================================ case 2
  // The regression: a refused `finish` must not end the round's life. The old
  // code latched before sending, so one denial lost the score for good.
  const before = recorded.length;
  begin();
  denyFinish = 1;                       // the host's clock is behind ours
  pump(81000);
  // Asked *again after* the refusal, not merely once in total: counting the
  // denied ask itself would pass on the old latch, which never tried twice.
  ok('the game asks again after being refused',
    finishTotal() > askedAtDeny, { asked: finishTotal(), atDeny: askedAtDeny });
  ok('the round ends once the host accepts', state.phase === 'over');
  ok('the score is recorded despite the refusal', recorded.length > before,
    recorded);

  // ================================================================ case 3
  // The hidden tab: no frames at all, only the host's own deadline timer.
  const before3 = recorded.length;
  frozen = true;
  const framesBefore = framesRun;
  begin();
  pump(81000);
  ok('a hidden tab runs no frames', framesRun === framesBefore,
    { frames: framesRun - framesBefore });
  ok('a hidden round does not end on its own', state.phase === 'play');
  ok('the host armed a deadline timer', timers.length > 0);
  fireTimers();
  ok('the deadline ends a round nobody was watching', state.phase === 'over');
  ok('that score is recorded too', recorded.length > before3);
  frozen = false;

  // ================================================================ case 4
  // Two rounds that happen to score the same must be two distinct rounds.
  const ids = [];
  begin(); pump(81000);
  ids.push(dr.roundId(state));
  begin(); pump(81000);
  ids.push(dr.roundId(state));
  ok('each round has its own id', ids[0] !== ids[1], ids);
  ok('the id is stable within a round', dr.roundId(state) === ids[1]);

  handle.destroy();
  return out;
}
"""


def main():
    src = GAME.read_text(encoding="utf-8")
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content("<!DOCTYPE html><html><body><div id='stage'></div></body></html>")
        res = pg.evaluate(HARNESS, src)
        br.close()

    bad = 0
    for name, cond, detail in res:
        bad += not cond
        line = ("  ok   " if cond else "  FAIL ") + name
        if detail is not None:
            line += "  " + json.dumps(detail)
        print(line)

    print()
    print("%d/%d round-ending checks passed" % (len(res) - bad, len(res)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())