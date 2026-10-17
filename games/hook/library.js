// games/hook/library.js
// Durations are ticks: 12 per quarter note (eighth = 6, triplet eighth = 4, sixteenth = 3).
// Step: [noteIndex, ticks, accent?]; noteIndex -1 = rest.
// Pair: { name, bpm, swing, wave, gate, scale, intro: { len, steps }, outro: { len, steps }, bridge?: { len, steps } }
// scale: a key of SCALES (default 'major'), or 'any' for a random scale each round. Notes are scale degrees 0-7.
// An intro and outro always ship as one pair: the game deals a whole pair, never a random intro + random outro.
// Pairs are dealt from a shuffled bag (dealPair), so nothing repeats back to back.
// This list is expected to keep growing — pairs get added by hand from phrase-builder.html as they turn up.
// So never assume how many there are: dealPair shuffles whatever is here, and the tests read PAIRS.length
// rather than a number, so a new batch of pairs needs no code change and no test edits.
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
  {"name":"TraitorsINtheKitchen","scale":"minor","bpm":60,"swing":0,"wave":"sine","gate":1.2,"intro":{"len":48,"steps":[[0,3],[2,3],[0,3],[2,3],[4,12],[-1,6],[4,12],[-1,6]]},"outro":{"len":48,"steps":[[4,3],[3,3],[2,3],[1,3],[0,12],[-1,6],[0,12],[-1,6]]}},
  {"name":"CraftBeer","scale":"harmonic","bpm":70,"swing":17,"wave":"sine","gate":1.2,"intro":{"len":96,"steps":[[0,24],[7,24],[5,24],[3,24]]},"outro":{"len":48,"steps":[[1,12],[3,12],[4,12],[6,12]]},"bridge":{"len":48,"steps":[[0,12],[2,12],[4,12],[3,12]]}},
  {"name":"FamousLadies","scale":"major","bpm":120,"swing":17,"wave":"sawtooth","gate":0.99,"intro":{"len":96,"steps":[[7,3],[-1,9],[6,3],[-1,9],[7,3],[-1,9],[4,3],[-1,9],[4,3],[-1,9],[5,3],[-1,9],[4,3],[-1,9],[2,3],[-1,9]]},"outro":{"len":48,"steps":[[1,3],[-1,9],[3,3],[-1,9],[4,3],[-1,21]]},"bridge":{"len":48,"steps":[[3,3],[-1,3],[2,3],[-1,3],[3,3],[-1,9],[2,3],[-1,9],[2,3],[-1,9]]}},
  {"name":"2 people split one grape","scale":"major","bpm":200,"swing":17,"wave":"triangle","gate":1.2,"intro":{"len":96,"steps":[[7,3],[-1,9],[6,3],[-1,9],[4,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[5,3],[-1,3],[5,3],[-1,9],[4,3],[-1,3],[2,3],[-1,3],[1,3],[-1,3],[2,3],[-1,3],[1,3],[-1,3],[2,3],[-1,3]]},"outro":{"len":48,"steps":[[1,3],[-1,3],[3,3],[-1,3],[4,3],[-1,3],[3,3],[-1,3],[4,3],[-1,3],[7,3],[-1,3],[0,3],[-1,9]]},"bridge":{"len":48,"steps":[[3,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3],[4,3],[-1,3],[3,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3],[2,3],[-1,3]]}},
  {"name":"Frer Rej Jah Cuh","scale":"major","bpm":250,"swing":70,"wave":"triangle","gate":1.2,"intro":{"len":96,"steps":[[0,3],[-1,3],[1,3],[-1,3],[2,3],[-1,3],[0,3],[-1,3],[0,3],[-1,3],[1,3],[-1,3],[2,3],[-1,3],[0,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3],[4,3],[-1,9],[2,3],[-1,3],[3,3],[-1,3],[4,3],[-1,9]]},"outro":{"len":96,"steps":[[4,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[3,3],[-1,3],[2,3],[-1,9],[0,3],[-1,9],[7,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[0,3],[-1,9],[7,3],[-1,3],[0,3],[-1,3]]},"bridge":{"len":48,"steps":[[4,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[3,3],[-1,3],[2,3],[-1,9],[0,3],[-1,9]]}},
  {"name":"Invention 8","scale":"major","bpm":200,"swing":4,"wave":"sawtooth","gate":1.2,"intro":{"len":96,"steps":[[0,3],[-1,9],[2,3],[-1,9],[0,3],[-1,9],[4,3],[-1,9],[0,3],[-1,9],[7,3],[-1,9],[6,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[5,3],[-1,3]]},"outro":{"len":96,"steps":[[2,3],[-1,9],[4,3],[-1,9],[2,3],[-1,9],[7,3],[-1,9],[4,3],[-1,9],[0,3],[-1,3],[2,3],[-1,3],[1,3],[-1,3],[2,3],[-1,3],[0,3],[-1,9]]},"bridge":{"len":48,"steps":[[4,3],[-1,3],[3,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3],[2,3],[-1,3],[1,3],[-1,3],[0,3],[-1,9]]}},
  {"name":"Crazy Guys 2","scale":"blues","bpm":200,"swing":78,"wave":"sawtooth","gate":1.2,"intro":{"len":96,"steps":[[0,3],[-1,3],[1,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3],[4,3],[-1,3],[4,3],[-1,3],[4,3],[-1,3],[4,3],[-1,3],[5,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[7,3],[-1,3],[5,3],[-1,3],[7,3],[-1,3]]},"outro":{"len":48,"steps":[[7,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3],[1,3],[-1,3],[0,3],[-1,3]]},"bridge":{"len":48,"steps":[[7,3],[-1,3],[6,3],[-1,3],[7,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[6,3],[-1,3],[7,3],[-1,3],[6,3],[-1,3]]}},
  {"name":"Phóng Dật","scale":"any","bpm":250,"swing":8,"wave":"triangle","gate":1.12,"intro":{"len":96,"steps":[[7,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[7,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[7,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[3,3],[-1,3],[2,3],[-1,3],[1,3],[-1,3],[0,3],[-1,3]]},"outro":{"len":48,"steps":[[7,3],[-1,3],[6,3],[-1,3],[5,3],[-1,3],[4,3],[-1,3],[3,3],[-1,3],[2,3],[-1,3],[1,3],[-1,3],[0,3],[-1,3]]}},
  {"name":"Praline is what?","scale":"major","bpm":100,"swing":56,"wave":"triangle","gate":0.6,"intro":{"len":24,"steps":[[7,3],[-1,3],[4,3],[-1,3],[7,3],[-1,3],[4,3],[-1,3]]},"outro":{"len":48,"steps":[[7,3],[-1,9],[4,3],[-1,9],[0,3],[-1,21]]},"bridge":{"len":48,"steps":[[0,3],[-1,3],[1,3],[-1,3],[2,3],[-1,9],[2,3],[-1,3],[1,3],[-1,3],[0,3],[-1,9]]}},
  {"name":"Horse Shoes, Shoes for horse","scale":"major","bpm":100,"swing":56,"wave":"sine","gate":1.2,"intro":{"len":24,"steps":[[7,3],[-1,9],[0,3],[-1,9]]},"outro":{"len":24,"steps":[[7,3],[-1,9],[0,3],[-1,9]]},"bridge":{"len":48,"steps":[[0,3],[-1,3],[1,3],[-1,3],[2,3],[-1,9],[2,3],[-1,3],[1,3],[-1,3],[0,3],[-1,9]]}},
  {"name":"The holy grail","scale":"major","bpm":200,"swing":56,"wave":"sawtooth","gate":1.2,"intro":{"len":72,"steps":[[6,3],[-1,9],[4,3],[-1,9],[2,3],[-1,9],[6,3],[-1,9],[4,3],[-1,9],[2,3],[-1,9]]},"outro":{"len":36,"steps":[[6,3],[-1,9],[4,3],[-1,9],[2,3],[-1,9]]},"bridge":{"len":48,"steps":[[1,3],[-1,3],[3,3],[-1,3],[5,3],[-1,3],[3,3],[-1,3],[2,3],[-1,3],[4,3],[-1,3],[6,3],[-1,3],[4,3],[-1,3]]}},
  {"name":"Kavya Ate a Crayon","scale":"major","bpm":200,"swing":0,"wave":"sawtooth","gate":1.2,"intro":{"len":72,"steps":[[7,3],[-1,9],[7,3],[-1,9],[6,3],[-1,9],[6,3],[-1,9],[5,3],[-1,3],[6,3],[-1,3],[7,3],[-1,3],[5,3],[-1,3]]},"outro":{"len":48,"steps":[[1,3],[-1,9],[1,3],[-1,9],[4,3],[-1,9],[4,3],[-1,9]]},"bridge":{"len":72,"steps":[[4,3],[-1,9],[4,3],[-1,9],[3,3],[-1,9],[3,3],[-1,9],[2,3],[-1,9],[2,3],[-1,9]]}},
  {"name":"Sheild your eyes its a butt","scale":"dorian","bpm":100,"swing":76,"wave":"sawtooth","gate":1.2,"intro":{"len":72,"steps":[[7,4],[6,4],[5,4],[6,4],[4,4],[5,4],[3,12],[5,4],[4,4],[3,4],[4,4],[3,4],[2,4],[1,12]]},"outro":{"len":48,"steps":[[2,4],[3,4],[4,4],[2,12],[1,4],[2,4],[3,4],[6,12]]},"bridge":{"len":48,"steps":[[4,3],[-1,1],[3,4],[2,4],[-1,12],[4,4],[3,4],[2,4],[-1,12]]}},
  {"name":"Would you vouch for me?","scale":"mixolydian","bpm":100,"swing":0,"wave":"sine","gate":1.2,"intro":{"len":96,"steps":[[7,3],[-1,9],[6,3],[-1,9],[7,3],[-1,15],[4,3],[3,3],[2,3],[-1,3],[3,3],[-1,3],[4,3],[-1,3],[2,3],[-1,3],[0,3],[-1,9],[7,3],[-1,9]]},"outro":{"len":96,"steps":[[7,3],[-1,9],[6,3],[-1,9],[7,3],[-1,15],[6,3],[4,3],[2,3],[3,3],[4,3],[5,3],[6,3],[-1,3],[6,3],[-1,3],[5,3],[-1,21]]},"bridge":{"len":96,"steps":[[4,3],[-1,9],[3,3],[-1,9],[4,3],[-1,15],[2,3],[1,3],[0,3],[-1,3],[2,3],[-1,3],[4,3],[-1,3],[2,3],[-1,3],[0,3],[-1,21]]}},
  {"name":"crazy guys3","scale":"whole","bpm":159,"swing":0,"wave":"sawtooth","gate":0.6,"intro":{"len":48,"steps":[[7,3],[6,3],[5,3],[4,3],[3,3],[2,3],[6,3],[5,3],[4,3],[3,3],[2,3],[1,3],[5,3],[4,3],[3,3],[2,3]]},"outro":{"len":24,"steps":[[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],[0,3]]}},
  {"name":"that haircut is a choice","scale":"minor","bpm":100,"swing":100,"wave":"triangle","gate":1.2,"intro":{"len":48,"steps":[[0,4],[7,4],[5,4],[0,4],[6,4],[4,4],[5,4],[6,4],[5,4],[4,4],[3,4],[4,4]]},"outro":{"len":36,"steps":[[0,4],[2,4],[0,4],[4,4],[0,4],[7,12],[-1,4]]},"bridge":{"len":24,"steps":[[5,4],[6,4],[5,4],[7,4],[6,4],[7,4]]}},
  {"name":"star wars can you feel it","scale":"major","bpm":100,"swing":100,"wave":"triangle","gate":1.2,"intro":{"len":48,"steps":[[0,4],[4,4],[3,4],[2,4],[1,4],[7,4],[4,4],[3,4],[2,4],[1,4],[7,4],[4,4]]},"outro":{"len":24,"steps":[[1,24]]},"bridge":{"len":24,"steps":[[3,6],[-1,2],[2,6],[-1,2],[3,6],[-1,2]]}},
  {"name":"This one is for Kavya","scale":"major","bpm":100,"swing":100,"wave":"triangle","gate":1.2,"intro":{"len":48,"steps":[[0,6],[-1,6],[0,6],[-1,6],[0,6],[-1,6],[7,6],[5,6]]},"outro":{"len":24,"steps":[[7,6],[5,6],[4,6],[3,6]]},"bridge":{"len":72,"steps":[[4,6],[-1,6],[3,6],[-1,6],[4,6],[5,6],[4,6],[5,6],[4,6],[-1,6],[0,3],[0,3],[0,3],[-1,3]]}},
  {"name":"This one is for Thi","scale":"mixolydian","bpm":200,"swing":18,"wave":"triangle","gate":1.2,"intro":{"len":72,"steps":[[7,3],[-1,9],[4,3],[-1,3],[7,3],[-1,3],[6,3],[-1,9],[5,3],[-1,3],[4,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3],[4,3],[-1,3],[5,3],[-1,3]]},"outro":{"len":96,"steps":[[7,3],[-1,9],[4,3],[-1,3],[7,3],[-1,3],[6,3],[-1,9],[5,3],[-1,3],[4,3],[-1,3],[2,3],[-1,3],[3,3],[-1,3],[4,3],[-1,3],[0,3],[-1,3],[1,3],[-1,3],[1,3],[-1,3],[0,3],[-1,9]]},"bridge":{"len":24,"steps":[[6,3],[-1,3],[6,3],[-1,3],[5,3],[-1,9]]}}
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

// Deals from a shuffled bag rather than picking at random, so every pair gets a turn
// before any repeats. The pair just played is also pushed to the back of the next
// shuffle: refilling a bag with the pair you were holding hands back the same pair twice
// running about one time in fifteen.
const shuffle = (list, rng) => {
  const d = list.map((_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)), t = d[i];
    d[i] = d[j]; d[j] = t;
  }
  return d;
};

const refill = (list, rng, last) => {
  // pop() takes from the back, so the pair just played is parked at the front: it is
  // dealt last next cycle, which is the only place it cannot follow itself.
  const d = shuffle(list, rng), i = last === undefined || last === null ? -1 : d.indexOf(last);
  if (i > 0) { const t = d[0]; d[0] = last; d[i] = t; }
  return d;
};

export function dealPair(rng, bag) {
  const list = PAIRS.length ? PAIRS : [];
  if (!list.length) return { pair: list[0], index: -1, bag: { left: [], last: -1 } };
  const left = bag && bag.left && bag.left.length ? bag.left.slice() : refill(list, rng, bag && bag.last);
  const index = left.pop();
  return { pair: list[index], index, bag: { left, last: index } };
}

// Progression. A game is a short climb: the early rounds deal the pairs with the fewest notes to choose
// (the gentlest), the last rounds the longest. Pairs are ranked by how many notes the player chooses
// (fillCount), the ranking is cut into `rounds` even tiers, and round r deals from tier r. Inside a tier
// the deal is random, never the pair just played, and it still draws from the shuffled bag first so
// every pair gets a turn before any repeats. Adding pairs to PAIRS needs no change here.
export function dealPairFor(rng, bag, round) {
  const n = PAIRS.length;
  if (!n) return dealPair(rng, bag);
  const byEase = PAIRS.map((_, i) => i).sort((a, b) => fillCount(PAIRS[a]) - fillCount(PAIRS[b]) || a - b);
  const r = round;
  const lo = 0, hi = n;
  const tier = byEase, last = bag && bag.last;
  let left = bag && bag.left && bag.left.length ? bag.left.slice() : shuffle(PAIRS, rng);
  let pool = tier.filter((i) => i !== last);
  if (!pool.length) { left = shuffle(PAIRS, rng); pool = tier;
  // No need to reassign pool if it's already populated
  const index = pool[Math.floor(rng() * pool.length)];
  return { pair: PAIRS[index], index, bag: { left: left, last: index } };
}
}

// The rhythm template the hook uses: the pair's own hook rhythm if it has one, else the intro itself.
// `bridge` is the data key inside a pair — the wording on screen is "hook", the key is what the
// phrase-builder exports and what every pasted pair carries, so it stays. Accepts a pair
// ({ intro, bridge }) or a legacy intro phrase ({ steps, bridge }) so old saves keep working.
const stepsOf = (x) => (x && x.intro ? (x.bridge || x.intro).steps : (x.bridge || x).steps);
const template = (pairOrIntro) => ({ steps: stepsOf(pairOrIntro) });

// How many notes the player chooses.
export const fillCount = (pairOrIntro) => stepsOf(pairOrIntro).filter(s => s[0] >= 0).length;

// Template rhythm with the player's notes dropped into its note slots (unfilled slots become rests).
export function hookSteps(pairOrIntro, notes) {
  let k = 0;
  return stepsOf(pairOrIntro).map(([n, d, a]) => {
    if (n < 0) return [-1, d];
    const v = notes && notes[k++];
    return [Number.isInteger(v) && v >= 0 ? v : -1, d, a];
  });
}

// Column durations for the hook grid, one per player choice.
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
