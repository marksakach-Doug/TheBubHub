// games/hook/library.js
// Durations are ticks: 12 per quarter note (eighth = 6, triplet eighth = 4, sixteenth = 3).
// Step: [noteIndex, ticks, accent?]; noteIndex -1 = rest.
// Pair: { name, bpm, swing, wave, gate, scale, intro: { len, steps }, outro: { len, steps }, bridge?: { len, steps } }
// scale: a key of SCALES (default 'major'), or 'any' for a random scale each round. Notes are scale degrees 0-7.
// An intro and outro always ship as one pair: the game deals a whole pair, never a random intro + random outro.
// Paste the exported array from phrase-builder.html over PAIRS.
export const PAIRS = [
  {"name":"Tinguss","scale":"major","bpm":220,"swing":0,"wave":"sawtooth","gate":0.9,"intro":{"len":96,"steps":[[7,12],[6,12],[7,12],[6,12],[7,12],[6,12],[5,12],[4,12]]},"outro":{"len":48,"steps":[[3,12],[2,12],[1,12],[0,12]]},"bridge":{"len":48,"steps":[[0,12],[1,12],[2,12],[0,12]]}},
  {"name":"Horsey","scale":"major","bpm":100,"swing":21,"wave":"triangle","gate":0.9,"intro":{"len":48,"steps":[[0,4],[1,4],[2,4],[1,4],[2,4],[3,4],[2,4],[3,4],[4,4],[3,12]]},"outro":{"len":48,"steps":[[3,4],[4,4],[3,4],[2,4],[3,4],[2,4],[1,4],[2,4],[1,4],[0,12]]}},
  {"name":"ConeTones","scale":"major","bpm":190,"swing":21,"wave":"triangle","gate":0.9,"intro":{"len":48,"steps":[[0,3],[1,3],[2,3],[1,3],[-1,12],[3,3],[4,3],[5,3],[4,3],[-1,12]]},"outro":{"len":48,"steps":[[7,3],[6,3],[5,3],[4,3],[6,6],[7,6],[4,6],[1,6],[0,12]]}},
  {"name":"NightTime","scale":"major","bpm":100,"swing":21,"wave":"triangle","gate":0.9,"intro":{"len":48,"steps":[[0,3],[2,3],[4,3],[7,3],[1,3],[3,3],[5,3],[7,3],[2,3],[4,3],[6,3],[7,3],[7,3],[6,3],[5,3],[4,3]]},"outro":{"len":24,"steps":[[7,3],[6,3],[7,3],[4,3],[0,12]]},"bridge":{"len":24,"steps":[[0,3],[-1,3],[1,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3]]}},
  {"name":"CrazyGuys","scale":"major","bpm":130,"swing":21,"wave":"sawtooth","gate":0.9,"intro":{"len":24,"steps":[[0,3],[7,3],[0,3],[6,3],[0,3],[5,3],[0,3],[4,3]]},"outro":{"len":48,"steps":[[0,3],[4,3],[0,3],[3,3],[0,3],[2,3],[0,3],[1,3],[0,3],[4,3],[7,3],[4,3],[0,12]]}},
  {"name":"BallsToTheWalls","scale":"major","bpm":180,"swing":0,"wave":"square","gate":0.9,"intro":{"len":24,"steps":[[1,3],[3,3],[5,3],[3,3],[5,6],[1,6]]},"outro":{"len":24,"steps":[[5,6],[3,6],[5,6],[1,6]]}},
  {"name":"TakeMyHAnd","scale":"melodic","bpm":60,"swing":0,"wave":"sine","gate":1.2,"intro":{"len":24,"steps":[[0,4],[2,4],[4,4],[7,4],[6,4],[7,4]]},"outro":{"len":24,"steps":[[7,4],[6,4],[7,4],[4,4],[2,4],[0,4]]}},
  {"name":"FartSounds","scale":"dorian","bpm":150,"swing":0,"wave":"sawtooth","gate":0.31,"intro":{"len":48,"steps":[[0,3],[1,3],[2,3],[1,3],[-1,12],[2,3],[3,3],[4,3],[3,3],[-1,12]]},"outro":{"len":24,"steps":[[7,3],[6,3],[5,3],[4,12],[-1,3]]},"bridge":{"len":24,"steps":[[0,3],[1,3],[2,3],[3,3],[-1,12]]}},
  {"name":"CreateYourOwnSand","scale":"blues","bpm":100,"swing":91,"wave":"triangle","gate":0.31,"intro":{"len":48,"steps":[[0,12],[1,12],[0,12],[2,12]]},"outro":{"len":24,"steps":[[6,3],[5,3],[4,3],[3,3],[2,3],[1,3],[0,6]]},"bridge":{"len":24,"steps":[[0,3],[1,3],[2,3],[3,3],[1,3],[2,3],[3,3],[4,3]]}},
  {"name":"DoingChores","scale":"any","bpm":100,"swing":19,"wave":"square","gate":1.2,"intro":{"len":48,"steps":[[0,12],[1,12],[2,12],[3,12]]},"outro":{"len":24,"steps":[[1,12],[0,12]]},"bridge":{"len":24,"steps":[[0,12],[1,12]]}},
  {"name":"AshamedOfGreed","scale":"majpent","bpm":160,"swing":19,"wave":"sawtooth","gate":1.2,"intro":{"len":48,"steps":[[0,3],[1,3],[2,3],[3,3],[4,3],[3,3],[2,3],[1,3],[0,3],[1,3],[2,3],[3,3],[2,3],[1,3],[0,3],[1,3]]},"outro":{"len":24,"steps":[[0,24]]}},
  {"name":"WhatIsTOday","scale":"mixolydian","bpm":100,"swing":19,"wave":"sawtooth","gate":1.2,"intro":{"len":96,"steps":[[4,3],[-1,3],[4,3],[-1,9],[5,3],[-1,3],[4,3],[-1,9],[3,3],[-1,3],[2,3],[-1,3],[3,3],[-1,9],[2,3],[-1,9],[3,3],[-1,9],[2,3],[-1,9]]},"outro":{"len":72,"steps":[[4,3],[-1,3],[4,3],[-1,3],[4,3],[-1,3],[5,3],[-1,3],[4,3],[-1,9],[2,3],[-1,9],[3,3],[2,3],[1,3],[0,3],[0,3],[-1,9]]},"bridge":{"len":24,"steps":[[4,24]]}},
  {"name":"ThisHasAnAnswer","scale":"major","bpm":100,"swing":19,"wave":"sawtooth","gate":0.38,"intro":{"len":48,"steps":[[7,3],[-1,3],[6,3],[-1,3],[7,3],[-1,3],[4,3],[-1,3],[5,3],[-1,3],[6,3],[-1,3],[7,3],[-1,3],[5,3],[-1,3]]},"outro":{"len":24,"steps":[[0,24]]},"bridge":{"len":24,"steps":[[4,3],[-1,3],[3,3],[-1,3],[2,3],[-1,3],[1,3],[-1,3]]}},
  {"name":"ForkedTum","scale":"major","bpm":100,"swing":75,"wave":"triangle","gate":1.2,"intro":{"len":48,"steps":[[7,3],[6,3],[5,3],[4,3],[6,3],[4,3],[2,3],[0,3],[1,3],[2,3],[3,3],[4,3],[2,3],[3,3],[4,3],[5,3]]},"outro":{"len":24,"steps":[[1,3],[2,3],[3,3],[4,3],[3,3],[2,3],[1,3],[0,3]]},"bridge":{"len":24,"steps":[[2,3],[3,3],[4,3],[3,3],[2,3],[1,3],[4,3],[0,3]]}},
  {"name":"TraitorsINtheKitchen","scale":"minor","bpm":60,"swing":0,"wave":"sine","gate":1.2,"intro":{"len":48,"steps":[[0,3],[2,3],[0,3],[2,3],[4,12],[-1,6],[4,12],[-1,6]]},"outro":{"len":48,"steps":[[4,3],[3,3],[2,3],[1,3],[0,12],[-1,6],[0,12],[-1,6]]}}
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

export function pickPair(rng) {
  const list = PAIRS.length ? PAIRS : [];
  return list[Math.floor(rng() * list.length)];
}

// The rhythm template the bridge uses: the pair's own bridge rhythm if it has one, else the intro itself.
// Accepts a pair ({ intro, bridge }) or a legacy intro phrase ({ steps, bridge }) so old saves keep working.
const stepsOf = (x) => (x && x.intro ? (x.bridge || x.intro).steps : (x.bridge || x).steps);
const template = (pairOrIntro) => ({ steps: stepsOf(pairOrIntro) });

// How many notes the player chooses.
export const fillCount = (pairOrIntro) => stepsOf(pairOrIntro).filter(s => s[0] >= 0).length;

// Template rhythm with the player's notes dropped into its note slots (unfilled slots become rests).
export function bridgeSteps(pairOrIntro, notes) {
  let k = 0;
  return stepsOf(pairOrIntro).map(([n, d, a]) => {
    if (n < 0) return [-1, d];
    const v = notes && notes[k++];
    return [Number.isInteger(v) && v >= 0 ? v : -1, d, a];
  });
}

// Column durations for the bridge grid, one per player choice.
export const fillDurations = (pairOrIntro) => stepsOf(pairOrIntro).filter(s => s[0] >= 0).map(s => s[1]);

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
