#!/usr/bin/env python3
"""The dot must be *painted*, not merely present.

Dot Return shipped a dot that was not there. The one-dot rewrite removed
`PALETTE` and the per-player `render()` that did `dot.style.background = colour`,
and `.dr-dot` never gained a background of its own — so the element existed, moved
every frame, reported `hidden: false`, and was **completely transparent**. The
game was unplayable and every structural test passed, because "there is a dot"
and "you can see a dot" are different questions.

`tests/dotreturn_play.py` covers structure. This file covers paint, with the one
assertion that cannot be fooled: the pixel at the dot's centre, compared against
a sampled pixel of plain field a few px away. Counting colours, or trusting
`getComputedStyle`, both pass on an invisible dot — `.dr-field` is itself
transparent, so its computed background is black and even a contrast check
against it lies.

    pip install playwright && playwright install chromium   # + Pillow
    python3 tests/dotreturn_paint_test.py
"""
import io
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "dotreturn" / "index.js"

# One handle, one fake host, no shared raf bookkeeping to reason about.
HARNESS = r"""
(src) => {
  src = src.replace(/export (const|function)/g, '$1');
  const dr = new Function(src + '; return {init, reduce, project, mount};')();

  let clock = 0, nextId = 1;
  const cbs = new Map();
  const pump = (ms) => {
    const step = 1000 / 60;
    for (let t = 0; t < ms; t += step) {
      clock += step;
      const run = Array.from(cbs.values());
      cbs.clear();
      run.forEach((fn) => fn(clock));
    }
  };

  const ME = 'dev';
  let state = dr.init({ seats: [{ id: ME, name: 'Dev' }] });
  const api = {
    me: { id: ME, name: 'Dev' },
    seats: { 0: ME },
    roster: [{ id: ME, name: 'Dev' }],
    isSpectator: false,
    send: (a) => {
      const next = dr.reduce(state, a, { from: { id: ME }, rng: Math.random });
      if (!next || next.error) return;
      state = next;
      handle.update(dr.project(state, ME));
    },
    raf: (fn) => { const id = nextId++; cbs.set(id, fn); return id; },
    cancelRaf: (id) => { cbs.delete(id); },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    setInterval: (fn, ms) => setInterval(fn, ms)
  };

  const host = document.getElementById('stage');
  const shadow = host.attachShadow({ mode: 'open' });
  const handle = dr.mount(shadow, api);
  handle.update(dr.project(state, ME));

  shadow.querySelector('.dr-btn').click();   // start a round
  pump(1200);                                // drift it clear of the centre

  const dot = shadow.querySelector('.dr-dot');
  const cs = getComputedStyle(dot);
  const rect = dot.getBoundingClientRect();
  const out = {
    phase: state.phase,
    hidden: dot.hidden,
    background: cs.backgroundColor,
    opacity: cs.opacity,
    visibility: cs.visibility,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    radius: cs.borderTopLeftRadius,
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  };
  handle.destroy();
  return out;
}
"""

MARGIN = 6   # slack around the dot before sampling the field beside it
GAP = 12     # clear field between the dot and the reference pixel


def sample(pg, rect):
    """(dot centre pixel, plain-field pixel) around the dot.

    Patch layout, left to right: MARGIN of field, the dot, GAP of field. The dot
    centre sits at MARGIN + w/2 and the reference at the far right. Deriving
    those from the patch width is how an earlier version compared the field
    against itself and always passed.
    """
    from PIL import Image

    shot = pg.screenshot(clip={
        "x": max(0, rect["x"] - MARGIN), "y": max(0, rect["y"] - MARGIN),
        "width": rect["w"] + MARGIN * 2 + GAP, "height": rect["h"] + MARGIN * 2,
    })
    im = Image.open(io.BytesIO(shot)).convert("RGB")
    row = im.height // 2
    return (im.getpixel((int(MARGIN + rect["w"] / 2), row)),
            im.getpixel((im.width - 3, row)))


def main():
    src = GAME.read_text(encoding="utf-8")
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("  FAIL Pillow is not installed — pip install Pillow")
        print("\n0/1 paint checks passed")
        return 1

    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.set_content(
            "<!DOCTYPE html><html><body>"
            "<div id='stage'></div></body></html>"
        )
        got = pg.evaluate("(" + HARNESS + ")", src)
        # Two real frames: the fake clock mutates the DOM inside one evaluate,
        # and the compositor has not necessarily painted that frame yet.
        pg.evaluate("() => new Promise(function (r) {"
                    "requestAnimationFrame(function () {"
                    "requestAnimationFrame(function () { r(1); }); }); })")
        dot_px, field_px = sample(pg, got["rect"])
        br.close()

    results = [
        ("the round is running", got["phase"] == "play"),
        ("the dot is not hidden", got["hidden"] is False),
        ("the dot has a background colour",
         got["background"] not in ("rgba(0, 0, 0, 0)", "transparent")),
        ("the dot is opaque", got["opacity"] == "1" and got["visibility"] == "visible"),
        ("the dot has a real size", got["width"] >= 4 and got["height"] >= 4),
        ("the dot is round", str(got["radius"]).rstrip("px") != "0"),
        ("the dot is painted, not merely present", False),
        ("no page errors", not errors),
    ]
    delta = sum(abs(dot_px[i] - field_px[i]) for i in range(3))
    results[6] = ("the dot is painted, not merely present "
                  "(dot %s vs field %s, delta %d)" % (dot_px, field_px, delta),
                  delta > 40)

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)
    for e in errors:
        bad += 1
        print("  FAIL page error: " + e)

    print()
    print("%d/%d paint checks passed" % (len(results) - bad, len(results)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())