// MiniGo offline tests: rules, the game's reduce() flows, the bot, and the worker source.
// Needs only node or bun, no browser:  node tests/minigo_test.mjs
import vm from 'node:vm';
import { engine as E, makeEngine } from '../games/minigo/engine.js';
import * as G from '../games/minigo/index.js';

let fails = 0, n = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log('FAIL', m); } }
const B = rows => rows.join('').split('').map(ch => ch === 'x' ? 1 : ch === 'o' ? 2 : 0);
const pt = (x, y) => y * 7 + x;
const pos = (rows, ko = -1, hist = []) => ({ b: B(rows), ko, hist });

// ---------- rules ----------
let r = E.applyMove(pos(['.......', '.......', 'xox....', '.x.....', '.......', '.......', '.......']), pt(1, 1), 1);
ok(r.b && r.caps === 1 && r.b[pt(1, 2)] === 0, 'captures a stone in atari');
r = E.applyMove(pos(['.x.....', 'x......', '.......', '.......', '.......', '.......', '.......']), 0, 2);
ok(r.err && /Suicide/.test(r.err), 'suicide refused');
r = E.applyMove(pos(['.xo....', 'xo.....', '.......', '.......', '.......', '.......', '.......']), 0, 2);
ok(r.b && r.caps >= 1, 'a capturing move is not suicide');
r = E.applyMove(pos(['.......', '.......', '.......', '.......', '.......', '.......', '.......']), 99, 1);
ok(r.err, 'off-board refused');
r = E.applyMove(pos(['.xo....', 'xo.o...', '.xo....', '.......', '.......', '.......', '.......']), pt(2, 1), 1);
ok(r.caps === 1 && r.ko === pt(1, 1), 'ko point is set after a ko capture');
ok(/Ko/.test(E.applyMove({ b: r.b, ko: r.ko, hist: [] }, pt(1, 1), 2).err || ''), 'immediate retake refused');
r = E.applyMove(pos(['.......', '..x....', '..ox...', '..x....', '.......', '.......', '.......']), pt(1, 2), 1);
ok(r.caps === 1 && r.ko === -1, 'capture with many liberties is not a ko');
const k0 = E.applyMove(pos(Array(7).fill('.......')), 24, 1).key;
ok(/repeat/.test(E.applyMove({ b: Array(49).fill(0), ko: -1, hist: [k0] }, 24, 1).err || ''), 'positional superko');
ok(E._isEye(Int8Array.from(B(['.x.....', 'xx.....', ...Array(5).fill('.......')])), 0, 1), 'corner eye');
ok(!E._isEye(Int8Array.from(B(['.x.....', 'xo.....', ...Array(5).fill('.......')])), 0, 1), 'false corner eye');
let s = E.score(B(['xx.oo..', 'xx.oo..', 'xx.oo..', 'xx.oo..', 'xx.oo..', 'xx.oo..', 'xx.oo..']), null, 0);
ok(s.black === 14 && s.white === 28, 'dame belongs to nobody');
const dead = Array(49).fill(0); dead[24] = 1;
ok(E.score(B(['xxxxxxx', 'xxxxxxx', 'xxxxxxx', 'xxxoxxx', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx']), dead, 0).black === 49, 'dead stone lifted');
ok(E.groupOf(B(['xx.....', 'x......', ...Array(5).fill('.......')]), 0).length === 3, 'groupOf');

// ---------- the worker's source must stand alone ----------
// Run it in an empty VM: no imports, no outer variables. If makeEngine() leans on anything
// outside itself, this throws, and so would the real worker.
const sandbox = { performance, Math, Int8Array, Int32Array, Object, Array, Set, Number };
const E2 = vm.runInNewContext('(' + makeEngine.toString() + ')()', sandbox);
ok(typeof E2.Searcher === 'function', 'makeEngine() runs in an empty context');
ok(!/import\.meta|`/.test(makeEngine.toString()), 'no import.meta or backticks in the engine');

// ---------- the bot ----------
function search(posn, cfg, searcher) {
  const s = searcher || new E.Searcher();
  s.start(Object.assign({ komi: 9.5, hist: [], passes: 0, last: -1 }, posn), Object.assign({ ms: 5000, iters: 1500 }, cfg));
  while (!s.step(1e9)) {}
  return s.result();
}
E.seed(7);
// A uniformly random mover (legal, never fills its own eye, passes when it has nothing else).
function randomMove(b, ko, turn, hist) {
  const idx = [];
  for (let i = 0; i < 49; i++) if (!b[i] && !E._isEye(Int8Array.from(b), i, turn)) idx.push(i);
  while (idx.length) {
    const k = Math.floor(Math.random() * idx.length), i = idx.splice(k, 1)[0];
    const m = E.applyMove({ b, ko, hist }, i, turn);
    if (!m.err) return { i, m };
  }
  return { i: E.PASS };
}
// The bot must beat a random player, on both colours, even giving 9.5 komi to Black's side.
{
  let wins = 0, games = 6;
  for (let g = 0; g < games; g++) {
    const botColor = g % 2 ? 2 : 1, sb = new E.Searcher();
    let b = Array(49).fill(0), ko = -1, turn = 1, passes = 0, last = -1, moves = 0;
    const hist = [b.join('')];
    while (passes < 2 && moves < 200) {
      if (turn === botColor) {
        sb.start({ b, ko, turn, passes, last, komi: 9.5, hist }, { ms: 1e9, iters: 150 });
        while (!sb.step(1e9)) {}
        const x = sb.result();
        if (x.move === E.PASS) { passes++; ko = -1; last = -1; }
        else { const m = E.applyMove({ b, ko, hist }, x.move, turn); b = m.b; ko = m.ko; hist.push(m.key); passes = 0; last = x.move; }
      } else {
        const x = randomMove(b, ko, turn, hist);
        if (x.i === E.PASS) { passes++; ko = -1; last = -1; }
        else { b = x.m.b; ko = x.m.ko; hist.push(x.m.key); passes = 0; last = x.i; }
      }
      turn = 3 - turn; moves++;
    }
    const sc = E.score(b, null, 9.5);
    if ((sc.diff > 0 ? 1 : 2) === botColor) wins++;
  }
  ok(wins >= 5, 'bot beats a random player at least 5 of 6 (won ' + wins + ')');
}
// tree reuse: after our move and a reply the old subtree is found again
const sr = new E.Searcher();
let p = { b: Array(49).fill(0), ko: -1, turn: 1, passes: 0, last: -1 };
const first = search(p, { iters: 600 }, sr);
let mv = E.applyMove({ b: p.b, ko: -1, hist: [] }, first.move, 1);
let p2 = { b: mv.b, ko: mv.ko, turn: 2, passes: 0, last: first.move };
// opponent replies with the most likely reply the tree explored
const reply = sr.root.kids.find(k => k.m === first.move).kids.sort((a, b) => b.n - a.n)[0];
if (reply) {
  const mv2 = E.applyMove({ b: mv.b, ko: mv.ko, hist: [] }, reply.m, 2);
  const p3 = { b: mv2.b, ko: mv2.ko, turn: 1, passes: 0, last: reply.m };
  const second = search(p3, { iters: 200 }, sr);
  ok(second.reused === true, 'tree is reused after the expected reply');
}
const fresh = search(p, { iters: 50, reuse: false }, new E.Searcher());
ok(fresh.reused === false, 'no reuse on a fresh searcher');
// the bot never returns an illegal move over a whole self-played game
{
  const sa = new E.Searcher(), sb = new E.Searcher();
  let b = Array(49).fill(0), ko = -1, turn = 1, passes = 0, last = -1, moves = 0, bad = 0;
  const hist = [b.join('')];
  while (passes < 2 && moves < 120) {
    const s2 = turn === 1 ? sa : sb;
    s2.start({ b, ko, turn, passes, last, komi: 9.5, hist }, { ms: 1e9, iters: 60 });
    while (!s2.step(1e9)) {}
    const x = s2.result();
    if (x.move === E.PASS) { passes++; ko = -1; last = -1; }
    else {
      const m = E.applyMove({ b, ko, hist }, x.move, turn);
      if (m.err) { bad++; break; }
      b = m.b; ko = m.ko; hist.push(m.key); passes = 0; last = x.move;
    }
    turn = 3 - turn; moves++;
  }
  ok(bad === 0, 'a full self-played game contains no illegal move (' + moves + ' moves)');
}

// ---------- the game's reduce() ----------
const people = [{ id: 'a', name: 'Ann', host: true }, { id: 'b', name: 'Bo' }];
const ctxOf = (id, name) => ({ from: { id, name: name || id, host: id === 'a' } });
let st = G.init({ atTable: [people[0]] });
ok(st.vsBot && st.players[0] === 'a' && st.players[1] === 'bot', 'one person at the table: vs bot');
ok(G.init({ atTable: people }).vsBot === false, 'two people: human game');
ok(G.init({ atTable: [people[1], people[0]] }).players[0] === 'a', 'host sits Black');
ok(G.init({}).players[0] === null, 'empty table is safe');
ok(G.roundId(st) === 'g1', 'roundId');

const v = G.project(st, 'a');
ok(v.you === 'a' && v.seat === 1 && G.project(st, 'z').seat === 0, 'project adds you and seat');

let t = G.reduce(st, { a: 'play', i: 24 }, ctxOf('b'));
ok(t.error, 'a stranger cannot move');
t = G.reduce(st, { a: 'play', i: 24 }, ctxOf('a'));
ok(!t.error && t.b[24] === 1 && t.turn === 2 && t.moves === 1, 'black plays centre');
ok(G.reduce(t, { a: 'play', i: 25 }, ctxOf('a')).error, 'not your turn');
ok(G.reduce(t, { a: 'play', i: 24 }, ctxOf('a')).error, 'cannot play on a stone');
// bot intents
ok(G.reduce(t, { a: 'bot', i: 10, n: 1, g: 1 }, ctxOf('a')).b[10] === 2, 'bot move accepted from the human');
ok(G.reduce(t, { a: 'bot', i: 10, n: 0, g: 1 }, ctxOf('a')).error, 'stale bot move refused');
ok(G.reduce(t, { a: 'bot', i: 10, n: 1, g: 9 }, ctxOf('a')).error, 'bot move from another game refused');
ok(G.reduce(st, { a: 'bot', i: 10, n: 0, g: 1 }, ctxOf('a')).error, 'bot cannot move on your turn');
ok(G.reduce(t, { a: 'bot', i: 10, n: 1, g: 1 }, ctxOf('zz')).error, 'a spectator cannot drive the bot');
ok(G.reduce(t, { a: 'bot', i: 24, n: 1, g: 1 }, ctxOf('a')).passes === 1, 'an illegal bot move becomes a pass');
// pass, pass -> score -> mark -> accept
let g = G.reduce(t, { a: 'bot', i: E.PASS, n: 1, g: 1 }, ctxOf('a'));
g = G.reduce(g, { a: 'pass' }, ctxOf('a'));
ok(g.phase === 'score', 'two passes start scoring');
ok(G.reduce(g, { a: 'play', i: 5 }, ctxOf('a')).error, 'no moves while scoring');
const m1 = G.reduce(g, { a: 'mark', i: 24 }, ctxOf('a'));
ok(m1.dead[24] === 1, 'marking a stone dead');
ok(G.reduce(m1, { a: 'mark', i: 24 }, ctxOf('a')).dead[24] === 0, 'marking again restores it');
ok(G.reduce(g, { a: 'mark', i: 0 }, ctxOf('a')).error, 'cannot mark an empty point');
const over = G.reduce(g, { a: 'accept' }, ctxOf('a'));
ok(over.phase === 'over' && over.winner === 1 && over.margin > 0, 'vs bot, your accept ends the game (the bot accepts for itself)');
ok(/beat the|beat/.test(G.summarize(over, id => id === 'a' ? 'Ann' : id) || '') || G.summarize(over, id => 'Ann'), 'summarize on a finished game');
ok(G.summarize(st, x => x) === null, 'summarize is null mid-game');
const back = G.reduce(g, { a: 'resume' }, ctxOf('a'));
ok(back.phase === 'play' && back.passes === 0, 'keep playing resumes');
// resign
const rs = G.reduce(st, { a: 'resign' }, ctxOf('a'));
ok(rs.phase === 'over' && rs.winner === 2 && /lost to the bot/.test(G.summarize(rs, () => 'Ann')), 'resigning to the bot');
// new game
const ng = G.reduce(rs, { a: 'new' }, ctxOf('a'));
ok(ng.gameNo === 2 && ng.phase === 'play' && ng.players[0] === 'a' && G.roundId(ng) === 'g2', 'new game keeps sides vs bot');
const sw = G.reduce(rs, { a: 'new', swap: true }, ctxOf('a'));
ok(sw.players[1] === 'a' && sw.players[0] === 'bot' && sw.turn === 1, 'swap sides: the bot is Black and moves first');
ok(G.reduce(sw, { a: 'bot', i: 24, n: 0, g: 2 }, ctxOf('a')).b[24] === 1, 'the bot can play Black');
ok(G.reduce(st, { a: 'new' }, ctxOf('a')).error, 'no new game mid-game');
// two humans
let h = G.init({ atTable: people });
h = G.reduce(h, { a: 'play', i: 24 }, ctxOf('a'));
ok(G.reduce(h, { a: 'play', i: 24 }, ctxOf('b')).error, 'taken point');
h = G.reduce(h, { a: 'play', i: 10 }, ctxOf('b'));
ok(h.b[10] === 2, 'white replies');
h = G.reduce(h, { a: 'pass' }, ctxOf('a'));
h = G.reduce(h, { a: 'pass' }, ctxOf('b'));
ok(h.phase === 'score', 'human game reaches scoring');
h = G.reduce(h, { a: 'accept' }, ctxOf('a'));
ok(h.phase === 'score', 'one accept is not enough');
h = G.reduce(h, { a: 'accept' }, ctxOf('b'));
ok(h.phase === 'over', 'both accept: over');
ok(G.reduce(G.reduce(h, { a: 'new' }, ctxOf('a')), { a: 'bot', i: 1, n: 0, g: 2 }, ctxOf('a')).error, 'no bot in a human game');
const sw2 = G.reduce(h, { a: 'new' }, ctxOf('a'));
ok(sw2.players[0] === 'b', 'human game swaps colours by default');
// join and prune
let jn = G.init({ atTable: [people[0]] });
jn = G.reduce(jn, { a: 'join' }, ctxOf('b', 'Bo'));
ok(!jn.vsBot && jn.players[1] === 'b' && jn.names.b === 'Bo', 'a newcomer takes the bot seat before the first move');
// A join that cannot be seated must SAY SO. It used to answer with the state
// unchanged, the client saw no difference, and never asked again — which is
// how "we can't play each other" happened.
let jn2 = G.reduce(G.init({ atTable: [people[0]] }), { a: 'play', i: 24 }, ctxOf('a'));
const jnRefused = G.reduce(jn2, { a: 'join' }, ctxOf('b', 'Bo'));
ok(!!jnRefused.error, 'a refused join returns an error, not silence');
ok(/bot is mid-game/.test(jnRefused.error || ''), 'the refusal explains why: ' + JSON.stringify(jnRefused.error));
ok(G.reduce(jn2, { a: 'join' }, ctxOf('a')).players[1] === 'bot', 'no seat change once a bot game is under way');
// After New game the same newcomer CAN sit down — moves is back to 0.
const jnAfter = G.reduce(G.reduce(jn2, { a: 'resign' }, ctxOf('a')), { a: 'new' }, ctxOf('a'));
ok(G.reduce(jnAfter, { a: 'join' }, ctxOf('b', 'Bo')).players[1] === 'b', 'a newcomer can take the seat after a new game');
// A third player at a human table is told the table is full, not left watching.
const full = G.init({ atTable: people });
ok(/full/.test(G.reduce(full, { a: 'join' }, ctxOf('c', 'Cy')).error || ''), 'a third player is told the table is full');
// vsBot must clear when both seats fill through join, or the bot buttons and
// Swap sides stay on screen through a human game.
const jfilled = G.reduce(G.reduce(G.init({}), { a: 'join' }, ctxOf('a')), { a: 'join' }, ctxOf('b'));
ok(jfilled.vsBot === false && jfilled.players.indexOf('bot') < 0, 'two joins clear vsBot');
const jsc = G.reduce(G.reduce(G.reduce(jfilled, { a: 'pass' }, ctxOf('a')), { a: 'pass' }, ctxOf('b')), { a: 'accept' }, ctxOf('a'));
ok(jsc.phase === 'score', 'one accept is not enough in a joined human game');
ok(G.reduce(jsc, { a: 'accept' }, ctxOf('b')).phase === 'over', 'both accepts end a joined human game');
const pr = G.prune(G.init({ atTable: people }), 'b');
ok(pr.players[1] === null, 'prune frees the seat');
ok(G.reduce(pr, { a: 'play', i: 24 }, ctxOf('a')).error, 'cannot play with an empty seat');
ok(G.prune(pr, 'zz') === pr, 'prune of a stranger changes nothing');
ok(G.reduce(pr, { a: 'join' }, ctxOf('c', 'Cy')).players[1] === 'c', 'a freed seat can be taken');
ok(G.summarize(h, id => id === 'a' ? 'Ann' : 'Bo').includes('at MiniGo'), 'summarize names both players');
ok(JSON.stringify(G.init({ atTable: people })).length < 4000, 'state stays small');


// ---------- move rating ----------
{
  // Straight three. White is dead if Black plays the middle, alive otherwise. At komi 30 that decides
  // the whole game, so the rating has something real to measure.
  const rows = ['xo...ox', 'xooooox', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', '.xxxxx.'];
  const posn = { b: B(rows), turn: 1, komi: 30, passes: 0, last: -1, hist: [], ko: -1 };
  const rate = (m, extra) => {
    const r = new E.Rater();
    r.start(posn, m, { ms: 1500, iters: 2500, extra: extra || 400 });
    while (!r.step(1e9)) {}
    return r.result();
  };
  E.seed(11);
  const kill = rate(pt(3, 0)), wrong = rate(pt(2, 0)), pass = rate(E.PASS), eye = rate(pt(0, 6));
  ok(kill.rating >= 90, 'rating: the vital point scores high (' + kill.rating + '%)');
  ok(wrong.rating <= 25, 'rating: a move that lets the group live scores low (' + wrong.rating + '%)');
  ok(pass.rating <= 25, 'rating: passing there scores low (' + pass.rating + '%)');
  ok(eye.rating <= 25 && typeof eye.rating === 'number', 'rating: filling your own eye is rated, not ignored (' + eye.rating + '%)');
  ok(wrong.best === pt(3, 0), 'rating: names the better move');
  ok(kill.rating === 100 && kill.best === pt(3, 0), 'rating: the best move is exactly 100');
  // the opening: a corner point is worse than the centre, on average over a few runs
  const empty = { b: new Array(49).fill(0), turn: 1, komi: 9.5, passes: 0, last: -1, hist: [], ko: -1 };
  const avg = m => { let t = 0; for (let k = 1; k <= 3; k++) { E.seed(k * 7); const r = new E.Rater(); r.start(empty, m, { ms: 700, iters: 2500, extra: 600 }); while (!r.step(1e9)) {} t += r.result().rating; } return t / 3; };
  const centre = avg(pt(3, 3)), corner = avg(pt(0, 0));
  ok(centre > corner + 25, 'rating: centre beats the 1-1 point on average (' + Math.round(centre) + ' vs ' + Math.round(corner) + ')');
}

// ---------- tsumego ----------
{
  const rows = ['xo...ox', 'xooooox', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', '.xxxxx.'];
  const b = B(rows), zone = [pt(2, 0), pt(3, 0), pt(4, 0)];
  const st = { b, ko: -1, turn: 1, passes: 0, att: 1, def: 2, zone, goal: 'kill', depth: 12 };
  ok(E._benson(b, 1).alive && !E._benson(b, 2).alive, 'benson: the walled-in side lives, the straight three does not');
  ok(JSON.stringify(E.tsumegoSolutions(st)) === JSON.stringify([pt(3, 0)]), 'straight three: only the middle kills');
  ok(JSON.stringify(E.tsumegoSolutions(Object.assign({}, st, { turn: 2, goal: 'live' }))) === JSON.stringify([pt(3, 0)]), 'straight three: only the middle lives');
  const two = B(['.o.o.xx', 'ooooxxx', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', '.xxxxx.']);
  ok(E._benson(two, 2).alive, 'benson: two separate eyes are alive');
  ok(E.tsumegoSolutions(Object.assign({}, st, { b: two, zone: [pt(0, 0), pt(2, 0), pt(4, 0)] })).length === 0, 'two eyes: nothing kills');
  ok(E._benson(B(['.o.xxxx', 'ooxxxxx', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', 'xxxxxxx', '.xxxxx.']), 2).alive === false, 'benson: one eye is not enough');

  // An independent solver for checking generated puzzles. It shares no code with the engine's:
  // plain minimax over applyMove, no Benson inside the kill search, its own terminal rules.
  const naive = (p, kill) => {
    const memo = new Map();
    const win = (bd, ko, turn, passes, d) => {
      const hasDef = bd.includes(p.def);
      if (kill ? !hasDef : (hasDef && E._benson(bd, p.def).alive)) return true;
      if (!kill && !hasDef) return false;
      if (passes >= 2 || d <= 0) return false;
      const key = bd.join('') + turn + ko + passes + ':' + d;
      if (memo.has(key)) return memo.get(key);
      const mv = [];
      for (const z of p.zone) if (bd[z] === 0 && z !== ko) { const r = E.applyMove({ b: bd, ko, hist: [] }, z, turn); if (!r.err) mv.push([r.b, r.ko, 0]); }
      mv.push([bd, -1, passes + 1]);
      const seeker = kill ? p.att : p.def;
      const res = turn === seeker ? mv.some(m => win(m[0], m[1], 3 - turn, m[2], d - 1)) : mv.every(m => win(m[0], m[1], 3 - turn, m[2], d - 1));
      memo.set(key, res);
      return res;
    };
    return win;
  };
  const counts = { easy: 12, medium: 6, hard: 1 };
  for (const level of E.tsumegoLevels) {
    let good = 0, made = 0, played = 0, sawLive = 0, sawKill = 0;
    for (let k = 0; k < counts[level]; k++) {
      const p = E.tsumegoGenerate(level, 'any', 20000);
      if (!p) continue;
      made++;
      p.goal === 'live' ? sawLive++ : sawKill++;
      const kill = p.goal === 'kill', seeker = kill ? p.att : p.def, win = naive(p, kill);
      const mine = [];
      for (const z of p.zone) {
        if (p.b[z] !== 0) continue;
        const r = E.applyMove({ b: p.b, ko: -1, hist: [] }, z, seeker);
        if (!r.err && win(r.b, r.ko, 3 - seeker, 0, p.depth - 1)) mine.push(z);
      }
      const same = mine.length === p.solutions.length && mine.every(z => p.solutions.includes(z));
      const sane = E._benson(p.b, p.att).alive && !E._benson(p.b, p.def).alive && p.solutions.length >= 1 && p.solutions.length <= 2 &&
        p.toPlay === seeker && p.solutions.every(z => p.zone.includes(z) && p.b[z] === 0);
      if (same && sane) good++;
      // play it out the way a solver would: always a right move, the engine answering, until it is solved
      const s2 = { b: p.b.slice(), ko: -1, turn: p.toPlay, passes: 0, att: p.att, def: p.def, zone: p.zone, goal: p.goal, depth: p.depth };
      let plies = 0, done = '';
      while (!done && plies < 40) {
        const sols = E.tsumegoSolutions(s2);
        if (!sols.length) break;
        let r = E.applyMove({ b: s2.b, ko: s2.ko, hist: [] }, sols[0], s2.turn);
        if (r.err) break;
        s2.b = r.b; s2.ko = r.ko; s2.turn = 3 - s2.turn; plies++;
        done = E.tsumegoDone(s2);
        if (done) break;
        const rep = E.tsumegoReply(s2);
        if (rep.move === E.PASS) { s2.passes++; s2.ko = -1; s2.turn = 3 - s2.turn; }
        else { r = E.applyMove({ b: s2.b, ko: s2.ko, hist: [] }, rep.move, s2.turn); if (r.err) break; s2.b = r.b; s2.ko = r.ko; s2.passes = 0; s2.turn = 3 - s2.turn; }
        plies++;
        done = E.tsumegoDone(s2);
      }
      if (done) played++;
    }
    ok(made === counts[level], 'tsumego ' + level + ': made ' + made + ' of ' + counts[level]);
    ok(good === made, 'tsumego ' + level + ': every answer agrees with the independent solver, and every position is sane (' + good + '/' + made + ')');
    ok(played === made, 'tsumego ' + level + ': following the answers always solves it (' + played + '/' + made + ')');
  }
  const lp = E.tsumegoGenerate('easy', 'live', 20000), kp = E.tsumegoGenerate('easy', 'kill', 20000);
  ok(lp && lp.goal === 'live' && lp.toPlay === lp.def, 'tsumego: a live problem has the defender to play');
  ok(kp && kp.goal === 'kill' && kp.toPlay === kp.att, 'tsumego: a kill problem has the attacker to play');
  ok(E.tsumegoGenerate('nonsense', 'any', 20000) !== null, 'tsumego: an unknown level falls back to easy');
  // the same engine, stripped of everything but its own text, still makes puzzles and rates moves
  const E3 = vm.runInNewContext('(' + makeEngine.toString() + ')()', sandbox);
  const vp = E3.tsumegoGenerate('easy', 'any', 20000);
  ok(vp && vp.solutions.length > 0, 'tsumego: works inside the empty context the worker runs in');
  const vr = new E3.Rater();
  vr.start({ b: Array(49).fill(0), turn: 1, komi: 9.5, passes: 0, last: -1, hist: [], ko: -1 }, 24, { ms: 200, iters: 400, extra: 100 });
  while (!vr.step(1e9)) {}
  ok(typeof vr.result().rating === 'number', 'rating: works inside the empty context the worker runs in');
}

console.log(fails ? fails + ' of ' + n + ' FAILED' : 'minigo: all ' + n + ' checks passed');
process.exit(fails ? 1 : 0);
