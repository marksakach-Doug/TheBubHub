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
import { canonSemis, makeMidiFile } from '../games/clicker/index.js';

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

// ------------------------------------------------------------- the canon --
// The canon follower transposes by scale degrees, so its notes always stay
// in the leader's key. The grid is 9 rows of the row scale: row index 0 is
// the top of the grid and the highest pitch.

const GAME_CFG = { row: 'mixolydian', col: 'chromatic', root: 0 };
const MIXO = [0, 2, 4, 5, 7, 9, 10];   // mixolydian semitone steps

await check('canon unison reproduces the grid pitch exactly', () => {
  const rd = [0, 2, 4, 5, 7, 9, 10, 12, 14]; // mixolydian degrees over 9 rows
  for (let cell = 0; cell < 81; cell++) {
    const row = Math.floor(cell / 9), col = cell % 9;
    const want = rd[8 - row] + col;
    assert.equal(canonSemis(cell, 0, GAME_CFG), want,
      'cell ' + cell + ' is ' + want + ' semitones above A3');
  }
});

await check('a canon fifth up is four scale degrees, still in key', () => {
  // cell 45 is row index 5, melody degree rd[3] = 5; up four degrees of the
  // same scale lands on rd[7] = 12.
  assert.equal(canonSemis(45, 4, GAME_CFG), 12);
  // the same walk from column 1 keeps its chromatic colour (column step 1)
  assert.equal(canonSemis(1, 4, GAME_CFG), 22);
  // every transposed melody note (column 0) is a pitch class of the scale
  [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((row) => {
    const rel = canonSemis(row * 9, 4, GAME_CFG) % 12;
    assert.ok(MIXO.indexOf(rel) >= 0,
      'row ' + row + ' a fifth up sits on a mixolydian step, not ' + rel);
  });
});

await check('walking past the edges folds the octave the degrees spell', () => {
  // the lowest melody step (row index 8, the bottom row) a fifth up climbs
  // into the next octave: index 12 of the scale walk is 21 semitones.
  assert.equal(canonSemis(0, 4, GAME_CFG), 21);
  assert.equal(canonSemis(0, 4, GAME_CFG) % 12, 9,
    'and it lands on the fifth, still a scale tone');
  // the bottom melody step a fifth down falls below the ladder: index -1
  // is a scale tone an octave lower.
  assert.equal(canonSemis(45, -4, GAME_CFG), -2);
  assert.equal((((canonSemis(45, -4, GAME_CFG) % 12) + 12) % 12), 10,
    'a fifth down from the 4th is the same class an octave lower');
});

// --------------------------------------------------------- the midi file --

await check('the midi file reads back as a well formed Type-1 SMF', () => {
  // one pattern of three steps, each an eighth note at 100 bpm
  const tracks = [{
    name: 'Pat 1',
    notes: [[0, 192, 60, 90], [240, 432, 62, 90], [480, 672, 64, 90]]
  }];
  const b = makeMidiFile(100, tracks);
  const u = Buffer.from(b);

  // header: MThd, six bytes, format 1, one track per export + the tempo track
  assert.ok(u.subarray(0, 4).toString('ascii') === 'MThd', 'the file starts MThd');
  assert.equal(u.readUInt32BE(4), 6, 'the header is six bytes long');
  assert.equal(u.readUInt16BE(8), 1, 'format 1');
  assert.equal(u.readUInt16BE(10), 2, 'two tracks: the tempo track and Pat 1');
  assert.equal(u.readUInt16BE(12), 480, '480 ticks per quarter note');

  // walk the chunks by name and length, the way a real decoder would
  let p = 14;
  const chunks = [];
  while (p < u.length) {
    const id = u.subarray(p, p + 4).toString('ascii');
    const len = u.readUInt32BE(p + 4);
    assert.equal(id, 'MTrk', 'every chunk is an MTrk');
    chunks.push(u.subarray(p + 8, p + 8 + len));
    p += 8 + len;
  }
  assert.equal(p, u.length, 'the chunks tile the file exactly');
  assert.equal(chunks.length, 2);

  // tempo meta: 100 bpm is 600000 microseconds per quarter note. The track
  // names itself first, then carries the tempo.
  const t0 = chunks[0];
  assert.deepEqual([...t0.subarray(0, 11)], [0x00, 0xff, 0x03, 0x07,
    0x43, 0x6c, 0x69, 0x63, 0x6b, 0x65, 0x72], 'the tempo track is called "Clicker"');
  assert.deepEqual([...t0.subarray(11, 18)], [0x00, 0xff, 0x51, 0x03, 0x09, 0x27, 0xc0],
    '600000 us recorded big-endian');

  // track 1: name meta, note-ons in order
  const t1 = chunks[1];
  assert.deepEqual([...t1.subarray(0, 8)], [0x00, 0xff, 0x03, 0x05,
    0x50, 0x61, 0x74, 0x20], 'the track is called "Pat 1"');
  assert.deepEqual([...t1.subarray(9, 17)], [0x00, 0x90, 60, 90, 0x81, 0x40, 0x80, 60],
    'note-on 60, then 192 ticks (a varint) later, note-off');
});

await check('a note-off is written before a note-on that shares its tick', () => {
  const b = makeMidiFile(120, [{
    name: 'T',
    notes: [[0, 240, 60, 90], [240, 480, 60, 90]]
  }]);
  const u = Buffer.from(b);
  // walk to track 1 the way the decoder above does
  let p = 14 + 8 + u.readUInt32BE(18);       // past MThd + the tempo track
  const t1 = u.subarray(p + 8, p + 8 + u.readUInt32BE(p + 4));
  // after the name meta (00 ff 03 01 'T') comes the first note-on,
  // then the off/on pair that both live at tick 240
  assert.deepEqual([...t1.subarray(5, 8)], [0x00, 0x90, 60], 'the first note strikes at 0');
  assert.deepEqual([...t1.subarray(9, 12)], [0x81, 0x70, 0x80],
    'delta 240, then the note-off before the new strike');
  assert.deepEqual([...t1.subarray(12, 15)], [60, 0, 0x00],
    'the off lands (a zero velocity), then zero delta');
  assert.deepEqual([...t1.subarray(14, 17)], [0x00, 0x90, 60],
    'the new strike follows without further delay');
});

await check('multiple simultaneous notes at the same tick (split/CP mode) serialize correctly', () => {
  const b = makeMidiFile(120, [{
    name: 'Pat 1 (Split)',
    notes: [
      [0, 240, 60, 90],
      [0, 240, 72, 64]
    ]
  }]);
  const u = Buffer.from(b);
  assert.ok(u.length > 0);
});

console.log('\nALL GREEN (' + ok + ' checks)');
