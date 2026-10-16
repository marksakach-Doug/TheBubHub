// games/hook/library.js
// Durations are ticks: 12 per quarter note (eighth = 6, triplet eighth = 4, sixteenth = 3).
// Step: [noteIndex, ticks, accent?]; noteIndex -1 = rest.
// Phrase: { name, kind, bpm, swing, wave, gate, scale?, len, steps, bridge?: { len, steps } }
// scale: a key of SCALES (default 'major'), or 'any' for a random scale each round. Notes are scale degrees 0-7.
// Paste the exported array from phrase-builder.html over PHRASES.
export const PHRASES = [
  { name: 'Skip', kind: 'both', bpm: 110, swing: 0, wave: 'triangle', gate: 0.9, len: 48, steps: [[0, 12], [2, 6], [3, 6], [4, 12], [-1, 12]] },
  { name: 'Question', kind: 'intro', bpm: 100, swing: 30, wave: 'triangle', gate: 0.85, len: 48, steps: [[3, 6], [3, 6], [4, 12], [-1, 6], [5, 6], [4, 12]] },
  { name: 'Triplet roll', kind: 'intro', bpm: 120, swing: 0, wave: 'square', gate: 0.7, len: 48, steps: [[0, 4], [2, 4], [3, 4, 1], [4, 12], [-1, 12], [3, 12]],
    bridge: { len: 48, steps: [[0, 6], [0, 6], [0, 6], [0, 6], [0, 12], [-1, 12]] } },
  { name: 'Settle', kind: 'outro', bpm: 100, swing: 0, wave: 'triangle', gate: 0.95, len: 48, steps: [[4, 12], [3, 12], [2, 12], [0, 12]] }
];

export const SCALES = {
  major: ['Major', [0, 2, 4, 5, 7, 9, 11]], minor: ['Natural minor', [0, 2, 3, 5, 7, 8, 10]],
  harmonic: ['Harmonic minor', [0, 2, 3, 5, 7, 8, 11]], melodic: ['Melodic minor', [0, 2, 3, 5, 7, 9, 11]],
  dorian: ['Dorian', [0, 2, 3, 5, 7, 9, 10]], phrygian: ['Phrygian', [0, 1, 3, 5, 7, 8, 10]],
  lydian: ['Lydian', [0, 2, 4, 6, 7, 9, 11]], mixolydian: ['Mixolydian', [0, 2, 4, 5, 7, 9, 10]],
  locrian: ['Locrian', [0, 1, 3, 5, 6, 8, 10]], majpent: ['Major pentatonic', [0, 2, 4, 7, 9]],
  minpent: ['Minor pentatonic', [0, 3, 5, 7, 10]], blues: ['Blues', [0, 3, 5, 6, 7, 10]], whole: ['Whole tone', [0, 2, 4, 6, 8, 10]]
};
// Notes are scale degrees 0-7 from C, wrapping into the next octave (so every scale has 8 keys).
const semi = (k, i) => { const s = (SCALES[k] || SCALES.major)[1]; return 12 * Math.floor(i / s.length) + s[i % s.length]; };
export const hz = (k, i) => 261.63 * 2 ** (semi(k, i) / 12);
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const label = (k, i) => NAMES[semi(k, i) % 12] + (semi(k, i) >= 12 ? "'" : '');
export const SIZE = 8;   // keys per scale

export function pick(kind, rng) {
  const pool = PHRASES.filter(p => p.kind === kind || p.kind === 'both');
  const list = pool.length ? pool : PHRASES;
  return list[Math.floor(rng() * list.length)];
}

// The rhythm template the bridge uses: the intro's own bridge rhythm if it has one, else the intro itself.
const template = intro => (intro.bridge || intro).steps;

// How many notes the player chooses.
export const fillCount = intro => template(intro).filter(s => s[0] >= 0).length;

// Template rhythm with the player's notes dropped into its note slots (unfilled slots become rests).
export function bridgeSteps(intro, notes) {
  let k = 0;
  return template(intro).map(([n, d, a]) => {
    if (n < 0) return [-1, d];
    const v = notes && notes[k++];
    return [v >= 0 ? v : -1, d, a];
  });
}

// Column durations for the bridge grid, one per player choice.
export const fillDurations = intro => template(intro).filter(s => s[0] >= 0).map(s => s[1]);

export const fmt = (steps, k) => steps.map(([n, d]) =>
  (n < 0 ? '·' : label(k, n)) + '~'.repeat(Math.max(0, Math.round(d / 6) - 1))).join(' ');

// Plays steps using the phrase's tempo, swing, timbre and articulation. Returns the end time.
export function schedule(ac, steps, o, t) {
  const bpm = o.bpm || 110, gate = o.gate || 0.9, wave = o.wave || 'triangle';
  const tick = 60 / bpm / 12, sw = (o.swing || 0) / 100 * 2;
  let pos = 0;
  steps.forEach(([n, d, a]) => {
    if (n >= 0) {
      const st = t + (pos + (pos % 12 === 6 ? sw : 0)) * tick;
      const dur = Math.max(0.03, d * tick * gate);
      const os = ac.createOscillator(), g = ac.createGain();
      os.type = wave;
      os.frequency.value = hz(o.scale, n);
      g.gain.setValueAtTime(a ? 0.5 : 0.3, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + dur);
      os.connect(g).connect(ac.destination);
      os.start(st); os.stop(st + dur + 0.02);
    }
    pos += d;
  });
  return t + pos * tick;
}
