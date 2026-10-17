// Bot-vs-bot harness for MiniGo. Not part of the suite: it is the tool for answering
// "did that change make the bot stronger?" with games instead of a guess.
//
//   node tests/minigo_selfplay.mjs speed
//   node tests/minigo_selfplay.mjs match <games> <iters> '<cfgA json>' '<cfgB json>'
//
// Both sides play at the same iteration budget, colours alternate, scoring is Tromp-Taylor
// (a bot has to capture dead stones before passing, exactly like its playouts assume).
import { makeEngine } from '../games/minigo/engine.js';

const KOMI = 9.5;

function playGame(E, cfgBlack, cfgWhite, iters, seedN) {
  E.seed(seedN);
  const sb = new E.Searcher(), sw = new E.Searcher();
  let b = new Array(49).fill(0), ko = -1, turn = 1, passes = 0, last = -1, moves = 0, reuseHits = 0;
  const hist = [b.join('')];
  while (passes < 2 && moves < 200) {
    const s = turn === 1 ? sb : sw, cfg = turn === 1 ? cfgBlack : cfgWhite;
    s.start({ b, ko, turn, passes, last, komi: KOMI, hist }, Object.assign({ ms: 1e9, iters }, cfg));
    while (!s.step(1e9)) {}
    const r = s.result();
    if (r.reused) reuseHits++;
    if (r.move === E.PASS) { passes++; ko = -1; last = -1; }
    else {
      const m = E.applyMove({ b, ko, hist }, r.move, turn);
      if (m.err) throw new Error('bot played illegal move ' + r.move + ': ' + m.err);
      b = m.b; ko = m.ko; hist.push(m.key); passes = 0; last = r.move;
    }
    turn = 3 - turn; moves++;
  }
  const sc = E.score(b, null, KOMI);
  return { winner: sc.diff > 0 ? 1 : 2, diff: sc.diff, moves, reuseHits };
}

const mode = process.argv[2];
if (mode === 'speed') {
  const E = makeEngine();
  for (const heur of [false, true]) {
    E._setPlayout(heur, 0.4, false);
    E.seed(1);
    const b = Int8Array.from(new Array(49).fill(0));
    const n = 3000, t0 = performance.now();
    for (let i = 0; i < n; i++) E._playout(b, -1, 1, 0, -1, KOMI);
    const dt = performance.now() - t0;
    console.log((heur ? 'smart ' : 'random') + ' playouts: ' + Math.round(n / dt * 1000) + '/sec');
  }
} else if (mode === 'match') {
  const games = +process.argv[3], iters = +process.argv[4];
  const A = JSON.parse(process.argv[5] || '{}'), Bc = JSON.parse(process.argv[6] || '{}');
  const E = makeEngine();
  let aWins = 0, bWins = 0, aDiff = 0, reuse = 0, total = 0;
  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    const aBlack = g % 2 === 0;
    const r = playGame(E, aBlack ? A : Bc, aBlack ? Bc : A, iters, 1000 + g);
    const aWon = (r.winner === 1) === aBlack;
    if (aWon) aWins++; else bWins++;
    aDiff += aBlack ? r.diff : -r.diff;
    reuse += r.reuseHits; total += r.moves;
  }
  const n = aWins + bWins, p = aWins / n, se = Math.sqrt(p * (1 - p) / n);
  console.log('A ' + JSON.stringify(A) + '  vs  B ' + JSON.stringify(Bc));
  console.log('A won ' + aWins + '/' + n + ' (' + (p * 100).toFixed(0) + '% ± ' + (se * 100).toFixed(0) + ')'
    + '  avg margin for A ' + (aDiff / n).toFixed(1) + '  reuse hits ' + reuse + '/' + total
    + '  ' + ((performance.now() - t0) / 1000).toFixed(0) + 's');
}
