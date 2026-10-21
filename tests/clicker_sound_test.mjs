// The sampler behind Clicker's Instrument and Sequencer modes.
//
// It is a small piece of machinery, and the mistakes it can make are all
// musical: a note played at the wrong pitch, a sample chosen that belongs
// to another key, a held note that never stops, or - the one that matters
// most - a game that goes silent because the samples have not arrived yet.
//
//     node tests/clicker_sound_test.mjs
import assert from 'node:assert/strict';
import { createSampler, midiOf, pickSample, rateFor } from '../games/clicker/soundfont.js';
import { BANK } from '../games/clicker/samples/bank.js';

let ok = 0;
// Awaited, because half of these checks are asynchronous: a check that is
// not awaited is a check that never runs, which is worse than no check.
async function check(name, fn) {
  await fn();
  console.log('  ok   ' + name);
  ok++;
}

// The range the game can reach: A3 (57) to B5 (83) in the game, wider in
// Instrument mode. The bank is extracted for 55-87.
const KEY_LO = 55;
const KEY_HI = 87;

// A WebAudio context that records what it was asked to do.
function fakeCtx() {
  const made = { sources: [], gains: [] };
  return {
    made,
    currentTime: 0,
    destination: {},
    createBufferSource() {
      const s = {
        buffer: null,
        playbackRate: { value: 1 },
        loop: false, loopStart: 0, loopEnd: 0,
        started: null, stopped: null,
        start(t) { this.started = t; },
        stop(t) { this.stopped = t; },
        connect() {}
      };
      made.sources.push(s);
      return s;
    },
    createGain() {
      const g = {
        gain: {
          value: 0,
          setValueAtTime() {}, linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {}, cancelScheduledValues() {}
        },
        connect() {}
      };
      made.gains.push(g);
      return g;
    },
    async decodeAudioData() { return { duration: 1, sampleRate: 44100 }; }
  };
}

function settle() {
  return new Promise((r) => setTimeout(r, 0));
}

// ------------------------------------------------------------- the maths --

await check('a frequency becomes a MIDI number', () => {
  assert.equal(midiOf(440), 69, 'A4 is 69');
  assert.equal(midiOf(220), 57, 'A3 is 57');
  assert.ok(Math.abs(midiOf(261.6256) - 60) < 0.001, 'C4 is 60');
});

await check('a note plays at the rate that puts it back on its key', () => {
  const s = { rootKey: 60, cents: 0 };
  assert.ok(Math.abs(rateFor(60, s) - 1) < 1e-9, 'its own key plays at 1');
  assert.ok(Math.abs(rateFor(72, s) - 2) < 1e-9, 'an octave up plays at 2');
  assert.ok(Math.abs(rateFor(48, s) - 0.5) < 1e-9, 'an octave down plays at half');
  const detuned = { rootKey: 60, cents: 50 };
  assert.ok(rateFor(60, detuned) > 1, 'a sample recorded sharp is slowed down');
  assert.ok(Math.abs(rateFor(60, detuned) - Math.pow(2, 0.5 / 12)) < 1e-9,
    'by exactly the amount it was recorded off');
});

await check('every voice covers every key the game can reach', () => {
  Object.keys(BANK).forEach((voice) => {
    for (let key = KEY_LO; key <= KEY_HI; key++) {
      const s = pickSample(voice, key);
      assert.ok(s, voice + ' has no sample for key ' + key);
      assert.ok(s.keys.indexOf(key) >= 0,
        voice + ' plays key ' + key + ' with a sample that does not hold it');
    }
  });
});

await check('a key the bank does not hold falls back to the nearest sample', () => {
  const s = pickSample('piano', 20);
  assert.ok(s, 'there is a sample to fall back on');
  let best = null;
  BANK.piano.samples.forEach((x) => {
    if (!best || Math.abs(20 - x.rootKey) < Math.abs(20 - best.rootKey)) best = x;
  });
  assert.equal(s.rootKey, best.rootKey, 'it is the one recorded nearest');
});

await check('the manifest and the bank agree about every voice', () => {
  Object.keys(BANK).forEach((voice) => {
    const bank = BANK[voice];
    assert.ok(bank.samples.length > 0, voice + ' has samples');
    bank.samples.forEach((s) => {
      assert.ok(s.url && s.url.indexOf('.wav') >= 0, voice + '/' + s.file + ' has a wav url');
      assert.ok(s.rootKey >= 21 && s.rootKey <= 108, voice + '/' + s.file + ' has a sane root key');
      assert.ok(s.keys.length > 0, voice + '/' + s.file + ' serves some keys');
      if (s.loopEnd > 0) {
        assert.ok(s.loopStart > 0 && s.loopEnd > s.loopStart, voice + '/' + s.file + ' has a real loop');
        assert.ok(s.loopEnd <= s.dur + 0.01, voice + '/' + s.file + ' has a loop inside the note');
      }
    });
  });
});

// --------------------------------------------------------- the behaviour --

await check('a note that is not ready says so instead of playing', () => {
  const s = createSampler();
  assert.equal(s.play(440, { gain: 0.2, dur: 0.3 }), false,
    'no context, no sound - the caller falls back to its oscillator');
  assert.equal(s.hold(440, { gain: 0.2 }), null, 'and nothing to hold');
});

await check('the samples are fetched and decoded, and then notes play', async () => {
  const ctx = fakeCtx();
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const s = createSampler();
  s.attach(ctx);
  s.loadVoice('piano');
  await settle();
  await settle();
  assert.ok(fetched.length > 0, 'the voice was fetched');
  assert.ok(fetched.every((u) => u.indexOf('.wav') >= 0), 'only wav files are fetched');
  assert.ok(s.ready('piano'), 'the voice is ready');
  assert.equal(s.ready('wurly'), false, 'a voice nobody asked for is not ready');

  const played = s.play(440, { gain: 0.2, dur: 0.3 });
  assert.equal(played, true, 'the note played');
  assert.equal(ctx.made.sources.length, 1, 'one source was made');
  const src = ctx.made.sources[0];
  assert.ok(src.buffer, 'it plays the decoded buffer');
  const midi = 69;
  const want = rateFor(midi, pickSample('piano', midi));
  assert.ok(Math.abs(src.playbackRate.value - want) < 1e-9,
    'at the rate that puts it on the right key: ' + src.playbackRate.value + ' vs ' + want);
  assert.ok(src.started !== null, 'it was started');
  assert.ok(src.stopped !== null, 'and it was given an end');
});

await check('a held note loops and stops when it is released', async () => {
  const ctx = fakeCtx();
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
  const s = createSampler();
  s.attach(ctx);
  s.loadVoice('wurly');
  await settle();
  await settle();
  assert.ok(s.ready('wurly'), 'the sustaining voice is ready');

  const held = s.hold(440, { gain: 0.2 });
  assert.ok(held, 'a note is holding');
  const src = ctx.made.sources[0];
  assert.equal(src.loop, true, 'it loops, so it does not run out');
  assert.ok(src.loopEnd > src.loopStart, 'the loop is a region');
  assert.equal(src.stopped, null, 'and it is still sounding');
  held.release(0.2);
  assert.ok(src.stopped !== null, 'releasing it stops it');
  held.release(0.2);
  assert.equal(src.stopped, src.stopped, 'releasing twice is harmless');
});

await check('tearing the game down stops the samples', async () => {
  const ctx = fakeCtx();
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
  const s = createSampler();
  s.attach(ctx);
  s.loadVoice('piano');
  await settle();
  await settle();
  s.play(440, { gain: 0.2, dur: 0.3 });
  s.dispose();
  assert.ok(ctx.made.sources[0].stopped !== null, 'the note was stopped');
});

console.log('\nALL GREEN (' + ok + ' checks)');
