#!/usr/bin/env python3
"""Clicker's samples have to survive the trip through the build.

The unit test (tests/clicker_sound_test.mjs) proves the sampler picks the
right sample and plays it at the right rate, in the abstract. This proves
the rest of the trip, in a real browser against the built bundle:

  1. the .wav files made it into dist/ - Vite has to hash and emit them, and
     the game has to ask for the hashed names
  2. the browser really fetched them, and the game really decoded them
  3. tapping a cell starts a note FROM A SAMPLE, at a sane playback rate -
     a rate of 1 is a note at its own key, 2 is an octave up
  4. nothing threw on the way

It also proves the game is not silent: the first tap may land before the
samples have arrived, and the oscillators have to cover that.

    python3 tests/clicker_sound_play.py <port>

Needs dist/ built (test.sh does it).
"""
import pathlib
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
PORT = 5180

SHADOW = "document.querySelector('#game-stage .stage-host').shadowRoot"

# Installed before any page script runs: it counts the audio the game makes
# and remembers WHICH FILE each sound came from, so a test can tell the
# piano from the electric piano from the Wurlitzer.
#
# The file cannot be read off the buffer: a browser resamples a decoded
# buffer to the context's rate, so every buffer comes back at 48 kHz. The
# way to know what played is to follow the bytes - the fetch is wrapped to
# remember which URL each ArrayBuffer came from, and the decoder is wrapped
# to remember which URL each AudioBuffer came from.
PROBE = """(() => {
  const Real = window.AudioContext || window.webkitAudioContext;
  if (!Real) return;
  const probe = {
    contexts: 0, decoded: 0, samples: 0, oscillators: 0,
    rates: [], files: [], decodedFiles: [], loops: []
  };
  window.__audio = probe;

  // Which URL did these bytes come from?
  const bytesUrl = new Map();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await realFetch(...args);
    const url = String(args[0]);
    const orig = res.arrayBuffer.bind(res);
    res.arrayBuffer = async () => {
      const ab = await orig();
      bytesUrl.set(ab, url);
      return ab;
    };
    return res;
  };

  // Which URL did this buffer come from?
  const bufferUrl = new Map();

  function Patched(...args) {
    const ctx = new Real(...args);
    probe.contexts++;
    const realSource = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const s = realSource();
      const start = s.start.bind(s);
      s.start = (t) => {
        probe.samples++;
        probe.rates.push(s.playbackRate.value);
        const file = bufferUrl.get(s.buffer) || '';
        probe.files.push(file);
        probe.loops.push({
          file: file,
          loop: !!s.loop,
          start: s.loopStart,
          end: s.loopEnd,
          duration: s.buffer ? s.buffer.duration : 0
        });
        return start(t);
      };
      return s;
    };
    const realOsc = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => { probe.oscillators++; return realOsc(); };
    const realDecode = ctx.decodeAudioData.bind(ctx);
    ctx.decodeAudioData = (d) => Promise.resolve(realDecode(d)).then((b) => {
      probe.decoded++;
      const url = bytesUrl.get(d) || '';
      bufferUrl.set(b, url);
      probe.decodedFiles.push(url);
      return b;
    });
    return ctx;
  }
  Patched.prototype = Real.prototype;
  window.AudioContext = Patched;
  window.webkitAudioContext = Patched;
})()"""


def check(cond, name, detail=""):
    if cond:
        print(f"  ok   {name}")
        return 0
    print(f"FAIL  {name}")
    if detail:
        for line in str(detail).split("\n"):
            print(f"        {line}")
    return 1


def build_if_needed():
    if (DIST / "index.html").exists():
        return True
    print("dist/ is missing - building it")
    r = subprocess.run(["bun", "run", "build"], cwd=ROOT,
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("build failed:\n" + r.stdout[-600:] + r.stderr[-600:])
        return False
    return True


def serve(port):
    """Serve dist/ - or reuse the server the suite already started."""
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=2)
        return None
    except Exception:  # noqa: BLE001
        pass
    p = subprocess.Popen([sys.executable, "-m", "http.server", str(port)],
                         cwd=DIST, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    return p


def open_clicker(pg):
    pg.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
    pg.wait_for_timeout(900)
    if pg.locator("#welcome-landing:not(.hidden)").count():
        pg.click("#btn-welcome-go")
        pg.wait_for_timeout(400)
    # The game button in the menu.
    btn = pg.locator("button", has_text="Clicker").first
    if not btn.count():
        return False
    btn.click(force=True)
    pg.wait_for_timeout(1200)
    return pg.evaluate(f"() => !!{SHADOW}")


def goto_instrument(pg):
    """Click the Instrument tab, so the test does not depend on which mode
    the game happens to open in."""
    return pg.evaluate(f"""() => {{
      const r = {SHADOW};
      if (!r) return false;
      const b = [...r.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Instrument');
      if (!b) return false;
      b.dispatchEvent(new PointerEvent('pointerdown', {{ bubbles: true, button: 0 }}));
      return true;
    }}""")


def press(pg, label):
    """Press one of the mode buttons by its label."""
    return pg.evaluate(f"""(want) => {{
      const r = {SHADOW};
      if (!r) return false;
      const b = [...r.querySelectorAll('button')].find((e) => e.textContent.trim() === want);
      if (!b) return false;
      b.dispatchEvent(new PointerEvent('pointerdown', {{ bubbles: true, button: 0 }}));
      return true;
    }}""", label)


def tap_cell(pg, index=40):
    return pg.evaluate(f"""(i) => {{
      const r = {SHADOW};
      if (!r) return false;
      const c = r.querySelector('[data-i="' + i + '"]');
      if (!c) return false;
      c.dispatchEvent(new PointerEvent('pointerdown', {{ bubbles: true, button: 0 }}));
      return true;
    }}""", index)


def mark(pg):
    """How many samples have been played so far."""
    return pg.evaluate("() => ((window.__audio || {}).rates || []).length")


def rates_since(pg, n):
    """The playback rates of everything played since the mark."""
    return pg.evaluate("(n) => ((window.__audio || {}).rates || []).slice(n)", n)


def cell_text(pg, index=0):
    """What a cell says."""
    return pg.evaluate(f"""(i) => {{
      const r = {SHADOW};
      if (!r) return '';
      const c = r.querySelector('[data-i="' + i + '"]');
      return c ? c.textContent : '';
    }}""", index)


def split_button_on(pg):
    """Is the Split button showing as pressed?"""
    return pg.evaluate(f"""() => {{
      const r = {SHADOW};
      if (!r) return False;
      const b = [...r.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Split');
      return !!b && b.style.borderColor === 'rgb(250, 204, 21)';
    }}""")


def main():
    global PORT
    for a in sys.argv[1:]:
        if a.isdigit():
            PORT = int(a)

    if not build_if_needed():
        print("\nFAIL  could not build dist/")
        return 1
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL  playwright is not installed - pip install playwright && playwright install chromium")
        return 1

    print("=== clicker sound (built) ===")
    server = serve(PORT)
    fails = 0
    errs = []
    wavs = []
    try:
        with sync_playwright() as p:
            br = p.chromium.launch()
            pg = br.new_page()
            pg.add_init_script(PROBE)
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console " + m.text)
                  if m.type == "error" else None)
            pg.on("request", lambda r: wavs.append(r.url)
                  if ".wav" in r.url else None)

            if not open_clicker(pg):
                fails += check(False, "clicker opens", "the game did not open")
            else:
                fails += check(True, "clicker opens")

                goto_instrument(pg)
                pg.wait_for_timeout(2500)

                fails += check(len(wavs) > 0, "the samples are fetched",
                               "no .wav was requested - the game is not loading its instrument")
                bad = [u for u in wavs if "/assets/" not in u]
                fails += check(not bad, "the samples are the hashed build files",
                               "a sample was requested from an unhashed path: " + ", ".join(bad[:2]))

                # The first tap may land before the samples arrive: the
                # oscillators have to cover that, so the game is never silent.
                tap_cell(pg, 40)
                pg.wait_for_timeout(700)
                probe = pg.evaluate("() => window.__audio || {}")
                fails += check(probe.get("contexts", 0) > 0, "an audio context is made")
                fails += check(probe.get("oscillators", 0) > 0 or probe.get("samples", 0) > 0,
                               "the first tap makes a sound",
                               "neither a sample nor a tone was played")

                # Split mode holds the Wurlitzer (48 kHz samples).
                tap_cell(pg, 4)
                pg.wait_for_timeout(700)
                # Split off: a plain note is the piano (22/32 kHz).
                press(pg, "Split")
                pg.wait_for_timeout(300)
                tap_cell(pg, 22)
                pg.wait_for_timeout(700)
                # Counterpoint on: the note you strike and the note coming up
                # are the piano and the electric piano (44.1 kHz).
                press(pg, "♪ CP")
                pg.wait_for_timeout(300)
                tap_cell(pg, 60)
                pg.wait_for_timeout(900)

                probe = pg.evaluate("() => window.__audio || {}")
                fails += check(probe.get("decoded", 0) > 0, "the samples are decoded",
                               "nothing was decoded, so every note fell back to a tone")
                fails += check(probe.get("samples", 0) > 0, "a note plays from a sample",
                               "no sample was ever started")
                rates = probe.get("rates", [])
                odd = [r for r in rates if not (0.25 <= r <= 4.0)]
                fails += check(not odd, "the playback rates are sane",
                               "a sample was played at rate " + str(odd[:3]))
                files = probe.get("files", [])
                # The build flattens the folder into /assets with a hashed
                # name, so the voice is in the file name: 0g... is the piano,
                # rhodes-... the electric piano, wurly-... the Wurlitzer.
                fails += check(any("/0g" in f or f.startswith("0g") for f in files),
                               "the piano plays", "no piano sample was played")
                fails += check(any("rhodes-" in f for f in files),
                               "the electric piano plays",
                               "no electric piano sample was played")
                fails += check(any("wurly-" in f for f in files),
                               "the Wurlitzer holds",
                               "no Wurlitzer sample was played")
                # The held voice has to LOOP, and the loop has to be a region
                # of the note - a loop point outside the sample plays nothing
                # and a loop that does not join itself is a buzz.
                held = [l for l in probe.get("loops", []) if l["loop"]]
                fails += check(bool(held), "the held voice loops",
                               "no sample was played with a loop")
                for l in held:
                    if not (0 < l["start"] < l["end"] <= l["duration"] + 0.001):
                        fails += check(False, "the loop is inside the note",
                                       "%s loops %.3f-%.3f in a %.3fs note"
                                       % (l["file"].split("/")[-1], l["start"], l["end"], l["duration"]))
                        break
                else:
                    fails += check(True, "the loop is inside the note")

                # ---- the Sequencer can split too ----
                # The Sequencer keeps its own split, because its default has
                # to stay a plain melody: a player who presses Play expecting
                # to hear their melody must not get two voices instead.
                press(pg, "Sequencer")
                pg.wait_for_timeout(600)
                fails += check(not split_button_on(pg),
                               "the Sequencer starts as a melody",
                               "the split is already on in the Sequencer")
                plain_label = cell_text(pg, 0)
                press(pg, "Split")
                pg.wait_for_timeout(300)
                fails += check(split_button_on(pg), "the Sequencer can be split")
                # In split the grid is a two-voice score: every cell says the
                # two notes it will sound, not one.
                split_label = cell_text(pg, 0)
                fails += check("·" in split_label,
                               "the grid shows both voices in the Sequencer",
                               "the cell says %r" % split_label)
                fails += check("·" not in plain_label,
                               "the grid shows one note in the plain Sequencer",
                               "the cell says %r" % plain_label)

                # The same cell has to sound the same two notes in both modes:
                # the low voice is the row, the high voice is the column.
                # The Instrument's own split was switched off earlier in this
                # test, so put it back before measuring. The counterpoint is
                # shared by both modes, and the split was switched on above,
                # which switched the counterpoint off - so it is left alone.
                press(pg, "Instrument")
                pg.wait_for_timeout(400)
                press(pg, "Split")            # the Instrument's split on again
                pg.wait_for_timeout(400)
                fails += check(split_button_on(pg), "the Instrument's split is back on")
                tap_cell(pg, 40)
                pg.wait_for_timeout(700)
                n = mark(pg)
                tap_cell(pg, 8)          # a different row AND column: both voices move
                pg.wait_for_timeout(800)
                inst_rates = rates_since(pg, n)

                press(pg, "Sequencer")
                pg.wait_for_timeout(500)
                fails += check(split_button_on(pg),
                               "each mode keeps its own split",
                               "the Sequencer lost its split when the Instrument was used")
                tap_cell(pg, 8)          # one cell in the pattern
                pg.wait_for_timeout(700)
                n = mark(pg)
                press(pg, "▶ Play")
                pg.wait_for_timeout(1400)
                seq_rates = rates_since(pg, n)
                press(pg, "■ Stop")
                pg.wait_for_timeout(300)

                fails += check(len(inst_rates) == 2,
                               "the Instrument's split sounds two voices",
                               "it sounded %d: %s" % (len(inst_rates), inst_rates))
                fails += check(len(seq_rates) == 2,
                               "the Sequencer's split sounds two voices",
                               "it sounded %d: %s" % (len(seq_rates), seq_rates))
                if len(inst_rates) == 2 and len(seq_rates) == 2:
                    same = all(abs(a - b) < 1e-9 for a, b in
                               zip(sorted(inst_rates), sorted(seq_rates)))
                    fails += check(same, "both modes play a cell the same way",
                                   "the Instrument played %s and the Sequencer %s"
                                   % (sorted(inst_rates), sorted(seq_rates)))
                    fails += check(len(set(round(r, 6) for r in inst_rates)) == 2,
                                   "the two voices are two different notes",
                                   "both voices played the same note")
                if files:
                    print("        played: " + ", ".join(f.split("/")[-1] for f in files[:8]))
                if rates:
                    print("        played at rates: " + ", ".join("%.3f" % r for r in rates[:8]))

            pg.close()
            br.close()
    finally:
        if server is not None:
            server.terminate()

    if errs:
        uniq = []
        for e in errs:
            if e not in uniq:
                uniq.append(e)
        fails += check(False, "no page errors", "\n".join(uniq[:3]))
    else:
        fails += check(True, "no page errors")

    print()
    if fails:
        print("%d check(s) failed" % fails)
        return 1
    print("ALL GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
