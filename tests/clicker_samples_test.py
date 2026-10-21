#!/usr/bin/env python3
"""The Clicker sample bank has to sound like what it claims.

Clicker plays real instrument samples instead of a triangle wave. The
samples are extracted from a SoundFont by games/clicker/tools/extract_sf2.py
and committed to the repository, so this test is the only thing standing
between the game and a bank of samples that are in the wrong key, truncated
to nothing, or missing.

What it checks, for every sample of every voice:

  * the file is there, and it is 16-bit mono at the rate the manifest says;
  * it is as long as the manifest says it is;
  * it SOUNDS like the key the manifest claims - the pitch is measured out
    of the audio and compared with the claim, to a third of a semitone;
  * its loop (if it has one) is inside the note;
  * every key the game can reach, 55 to 87, is covered by some sample.

The pitch measurement is the same code the extractor uses, so the test and
the tool can never disagree about what a note is.

    python3 tests/clicker_samples_test.py
"""
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "games" / "clicker" / "samples"
TOOL = ROOT / "games" / "clicker" / "tools" / "extract_sf2.py"

# The grid runs from A3 (57) to B5 (83) in the game and a little wider in
# Instrument mode, so the bank has to cover this whole stretch.
KEY_LO, KEY_HI = 55, 87

ok = 0
fails = []


def check(name, cond, detail=""):
    global ok
    if cond:
        ok += 1
        print("  ok   " + name)
    else:
        fails.append(name + ((" - " + detail) if detail else ""))
        print("  FAIL " + name + ((" - " + detail) if detail else ""))


def load_tool():
    spec = importlib.util.spec_from_file_location("extract_sf2", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    if not SAMPLES.is_dir():
        print("no sample bank at " + str(SAMPLES))
        return 1
    if not TOOL.is_file():
        print("no extractor at " + str(TOOL))
        return 1

    tool = load_tool()

    voices = sorted(p.stem for p in SAMPLES.glob("*.json"))
    check("the bank has voices", len(voices) > 0, "found " + repr(voices))
    for wanted in ("piano", "rhodes", "wurly"):
        check("the bank has a " + wanted + " voice", wanted in voices)

    # The browser reads these; if one is missing the game has no instrument.
    for voice in voices:
        check("%s has a manifest the browser can import" % voice,
              (SAMPLES / (voice + ".js")).is_file())
    check("bank.js exists", (SAMPLES / "bank.js").is_file())

    # The real check: does every sample sound like its key?
    problems = tool.check_bank(str(SAMPLES), KEY_LO, KEY_HI)
    check("every sample is present and in tune", not problems,
          "; ".join(problems[:6]))

    # And the coverage, spelled out, so a failure says which key is missing.
    covered = {}
    for voice in voices:
        with open(SAMPLES / (voice + ".json")) as fh:
            data = json.load(fh)
        keys = set()
        for s in data["samples"]:
            keys.update(s["keys"])
        covered[voice] = keys
        missing = [k for k in range(KEY_LO, KEY_HI + 1) if k not in keys]
        check("%s covers keys %d-%d" % (voice, KEY_LO, KEY_HI), not missing,
              "missing " + repr(missing))

    # The samples have to be small enough to fetch on a phone.
    total = sum(p.stat().st_size for p in SAMPLES.rglob("*.wav"))
    check("the bank is under 4 MB", total < 4 * 1024 * 1024,
          "%.1f MB" % (total / (1024.0 * 1024.0)))

    print()
    if fails:
        print("%d passed, %d FAILED" % (ok, len(fails)))
        return 1
    print("ALL GREEN (%d checks)" % ok)
    return 0


if __name__ == "__main__":
    sys.exit(main())
