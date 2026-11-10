// Offline rules suite for The Story & the Story.
// Run: node tests/storyandstory_rules.mjs   (Node 22+, or bun)
// Exits 1 on any failure. Needs no browser.

import assert from 'node:assert/strict';
import * as game from '../games/storyandstory/index.js';
import content from '../games/storyandstory/content.mjs';

const ARCHIVE = 'https://archive.example/story';
const NAMES = { p1: 'Ann', p2: 'Bo', p3: 'Cy', p4: 'Di', p5: 'Ed', p6: 'Fay', p7: 'Gus', p8: 'Hal', p9: 'Ivy' };
const ctx = (id, host = false) => ({ from: { id, name: NAMES[id] || id, host }, rng: Math.random });

function run(st, id, action, host = false) {
  const out = game.reduce(st, action, ctx(id, host));
  assert.ok(!out.error, `${id} ${action.a} should succeed, got: ${out.error}`);
  return out;
}

function refused(st, id, action, host, pattern) {
  const out = game.reduce(st, action, ctx(id, host));
  assert.ok(out.error, `${id} ${action.a} should be refused`);
  if (pattern) assert.match(out.error, pattern);
  return out.error;
}

function sents(prefix) {
  return Array.from({ length: 8 }, (_, i) => `${prefix} sentence ${i + 1} happens.`);
}

const OLD = { id: 'gOLD', stories: [sents('old-a'), sents('old-b')], themes: ['Grief', 'Joy'] };

function lobby(n, archive = false) {
  globalThis.BUB_STORY_ARCHIVE = archive ? ARCHIVE : '';
  const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const st = game.init({ atTable: ids.map((id, i) => ({ id, name: NAMES[id], host: i === 0 })) });
  return { st, ids };
}

// Start a game with the host. Returns the state and the ids.
function started(n, archive = false) {
  const { st, ids } = lobby(n, archive);
  return { st: run(st, ids[0], { a: 'start' }, true), ids };
}

// Play every remaining writing round, with each team's designated writer.
function playRounds(st, ref) {
  while (st.phase === 'writing') {
    const k = st.round;
    const [w0, w1] = game.project(st, ref).writers;
    st = run(st, w0, { a: 'write', text: `Team zero adds line ${k}.` });
    st = run(st, w1, { a: 'write', text: `Team one adds line ${k}.` });
  }
  return st;
}

// Open both stories and seal both themes (setup), then play every round.
function playOut(st, themes) {
  const [t0, t1] = st.teams;
  st = run(st, t0[0], { a: 'write', text: 'The door creaked open.' });
  st = run(st, t1[0], { a: 'write', text: 'A bell rang far away.' });
  st = run(st, t0[0], { a: 'theme', text: themes[0] });
  st = run(st, t1[0], { a: 'theme', text: themes[1] });
  return playRounds(st, t0[0]);
}

// Start a game that skips judging (no stories from two games ago), ready for setup.
function startedNoJudge(n) {
  const { st: lob, ids } = lobby(n, true);
  let st = run(lob, ids[0], { a: 'start' }, true);
  st = run(st, ids[0], { a: 'archive', entry: null }, true);
  return { st, ids };
}

// A game that has been judged on archive data, with the table voting.
function judging(n) {
  const { st: lob, ids } = lobby(n, true);
  let st = run(lob, ids[0], { a: 'start' }, true);
  assert.equal(st.phase, 'loading');
  refused(st, ids[1], { a: 'archive', entry: OLD }, false, /host/);
  st = run(st, ids[0], { a: 'archive', entry: OLD }, true);
  assert.equal(st.phase, 'judging');
  return { st, ids };
}

const vote = (st, id, story, theme) => run(st, id, { a: 'vote', story, theme });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- lobby ----------

test('lobby: anyone can join up to eight; only the host starts; the ninth is refused', () => {
  let { st } = lobby(2);
  refused(st, 'p2', { a: 'start' }, false, /host/);
  for (const id of ['p3', 'p4', 'p5', 'p6', 'p7', 'p8']) st = run(st, id, { a: 'join' });
  assert.equal(st.players.length, 8);
  refused(st, 'p9', { a: 'join' }, false, /full/);
  assert.equal(st.phase, 'lobby');
});

test('start needs two players and seats alternate between the teams', () => {
  const { st } = lobby(1);
  refused(st, 'p1', { a: 'start' }, true, /Two to eight/);
  const four = started(4).st;
  assert.equal(four.phase, 'setup');
  assert.deepEqual(four.teams, [['p1', 'p3'], ['p2', 'p4']]);
});

// ---------- setup and writing ----------

test('setup: only the designated writer writes the opening; the phase waits for both themes', () => {
  let { st } = started(4);
  refused(st, 'p3', { a: 'write', text: 'Hello there.' }, false, /Only Ann/);
  st = run(st, 'p1', { a: 'write', text: 'The door creaked open.' });
  st = run(st, 'p2', { a: 'write', text: 'A bell rang far away.' });
  assert.equal(st.phase, 'setup', 'no writing until both themes are sealed');
  st = run(st, 'p1', { a: 'theme', text: 'Trust' });
  assert.equal(st.phase, 'setup');
  st = run(st, 'p4', { a: 'theme', text: 'Betrayal' });
  assert.equal(st.phase, 'writing');
  assert.equal(st.round, 2);
});

test('writing: writers rotate, stories alternate teams, and the game ends at eight sentences each', () => {
  let { st } = started(4);
  st = run(st, 'p1', { a: 'write', text: 'The door creaked open.' });
  st = run(st, 'p2', { a: 'write', text: 'A bell rang far away.' });
  st = run(st, 'p1', { a: 'theme', text: 'Trust' });
  st = run(st, 'p2', { a: 'theme', text: 'Betrayal' });
  // Round 2: team 0's writer is Cy (the second member), team 1's is Di.
  refused(st, 'p1', { a: 'write', text: 'Out of turn.' }, false, /Only Cy/);
  st = run(st, 'p3', { a: 'write', text: 'The bell tolled again.' });
  st = run(st, 'p4', { a: 'write', text: 'Dust settled on the stairs.' });
  assert.equal(st.round, 3);
  assert.equal(st.stories[0][1], 'Dust settled on the stairs.', 'team 1 wrote into story 1');
  assert.equal(st.stories[1][1], 'The bell tolled again.', 'team 0 wrote into story 2');
  st = playRounds(st, 'p1');
  assert.equal(st.phase, 'over');
  assert.equal(st.stories[0].length, 8);
  assert.equal(st.stories[1].length, 8);
});

test('one sentence per turn, a non-empty sentence, and the length cap', () => {
  const { st } = started(2);
  refused(st, 'p1', { a: 'write', text: 'Hello there. Friend.' }, false, /One sentence/);
  refused(st, 'p1', { a: 'write', text: '   ' }, false, /Write a sentence/);
  refused(st, 'p1', { a: 'write', text: 'a'.repeat(301) }, false, /under 300/);
  refused(st, 'p1', { a: 'write', text: '1234.' }, false, /does not look like a sentence/);
});

test('themes are sealed only in setup, and only by team members', () => {
  const { st } = started(2);
  refused(st, 'p9', { a: 'theme', text: 'Hope' }, false, /team members/);
  const playing = playOut(st, ['Trust', 'Betrayal']);
  refused(playing, 'p1', { a: 'theme', text: 'Changed' }, false, /during setup/);
});

test('writing rotates through a three-person team in seat order', () => {
  let { st } = started(6);
  assert.deepEqual(st.teams, [['p1', 'p3', 'p5'], ['p2', 'p4', 'p6']]);
  st = run(st, 'p1', { a: 'write', text: 'Opener zero.' });
  st = run(st, 'p2', { a: 'write', text: 'Opener one.' });
  st = run(st, 'p1', { a: 'theme', text: 'Trust' });
  st = run(st, 'p2', { a: 'theme', text: 'Loss' });
  const seen0 = [];
  const seen1 = [];
  while (st.phase === 'writing') {
    const [w0, w1] = game.project(st, 'p1').writers;
    seen0.push(w0);
    seen1.push(w1);
    st = run(st, w0, { a: 'write', text: 'Team zero line.' });
    st = run(st, w1, { a: 'write', text: 'Team one line.' });
  }
  assert.deepEqual(seen0, ['p3', 'p5', 'p1', 'p3', 'p5', 'p1', 'p3']);
  assert.deepEqual(seen1, ['p4', 'p6', 'p2', 'p4', 'p6', 'p2', 'p4']);
  assert.equal(st.stories[0][1], 'Team one line.', 'team one wrote into story one');
});

test('team suggestions stay inside the team; only team members may suggest', () => {
  const { st } = started(4);
  refused(st, 'p9', { a: 'suggest', text: 'Go on.' }, false, /team members/);
  const with1 = run(st, 'p3', { a: 'suggest', text: 'Make it a storm.' });
  assert.equal(game.project(with1, 'p1').ideas.length, 1);
  assert.equal(game.project(with1, 'p2').ideas.length, 0, 'the other team sees no ideas');
  const after = run(with1, 'p1', { a: 'write', text: 'The door creaked open.' });
  assert.equal(game.project(after, 'p3').ideas.length, 0, 'ideas clear when the team writes');
});

// ---------- secrecy ----------

test('project(): each team sees only its own theme; spectators see neither', () => {
  const { st } = started(4);
  const playing = playOut(st, ['Trust', 'Betrayal']);
  const p1 = JSON.stringify(game.project(playing, 'p1'));
  const p2 = JSON.stringify(game.project(playing, 'p2'));
  const spec = JSON.stringify(game.project(playing, 'p9'));
  assert.ok(p1.includes('Trust') && !p1.includes('Betrayal'));
  assert.ok(p2.includes('Betrayal') && !p2.includes('Trust'));
  assert.ok(!spec.includes('Trust') && !spec.includes('Betrayal'));
});

test('project(): filing carries only the filer team’s theme, and only when the game is over', () => {
  const { st } = started(4);
  const playing = playOut(st, ['Trust', 'Betrayal']);
  assert.equal(game.project(playing, 'p1').filing.theme, 'Trust');
  assert.equal(game.project(playing, 'p2').filing.theme, 'Betrayal');
  assert.equal(game.project(playing, 'p9').filing, null);
  assert.equal(game.project(st, 'p1').filing, null, 'no filing before the stories are done');
});

test('project(): tallies stay hidden until the verdict', () => {
  const { st, ids } = judging(3);
  const v = game.project(vote(st, ids[0], 0, 0), ids[0]);
  assert.equal(v.verdict, null);
  assert.deepEqual(v.judge.myVotes, [0, null]);
  assert.ok(!JSON.stringify(v).includes('"counts"'));
});

// ---------- judging ----------

test('judging: the verdict is the theme with more story points; votes break a points tie', () => {
  const { st: j, ids } = judging(5);
  let st = j;
  // Story A: four vote theme 1, one votes theme 2. Story B: three vote theme 2, two vote theme 1.
  const s0 = [0, 0, 0, 0, 1];
  const s1 = [1, 1, 1, 0, 0];
  ids.forEach((id, i) => {
    st = vote(st, id, 0, s0[i]);
    if (i < 4) assert.equal(st.phase, 'judging', 'no reveal until every seated player has voted');
    st = vote(st, id, 1, s1[i]);
  });
  assert.equal(st.phase, 'verdict');
  assert.deepEqual(st.verdict.points, [1, 1]);
  assert.deepEqual(st.verdict.totals, [6, 4]);
  assert.equal(st.verdict.winner, 0, 'more total votes decides a points tie');
  assert.match(game.summarize(st), /preferred “Grief” over “Joy”/);
  assert.equal(game.roundId(st), 'verdict:gOLD');
});

test('judging: a level points tie and level votes is a draw', () => {
  const { st: j, ids } = judging(4);
  let st = j;
  const s0 = [0, 0, 1, 1];
  const s1 = [0, 1, 1, 0];
  ids.forEach((id, i) => {
    st = vote(st, id, 0, s0[i]);
    st = vote(st, id, 1, s1[i]);
  });
  assert.equal(st.verdict.winner, null);
  assert.match(game.summarize(st), /called “Grief” and “Joy” a draw/);
});

test('judging: only seated players vote; the host can reveal early and begin setup', () => {
  const { st, ids } = judging(3);
  refused(st, 'p9', { a: 'vote', story: 0, theme: 0 }, false, /seated/);
  refused(st, ids[1], { a: 'reveal' }, false, /host/);
  const revealed = run(st, ids[0], { a: 'reveal' }, true);
  assert.equal(revealed.phase, 'verdict');
  refused(revealed, ids[1], { a: 'beginSetup' }, false, /host/);
  const setup = run(revealed, ids[0], { a: 'beginSetup' }, true);
  assert.equal(setup.phase, 'setup');
  assert.equal(game.summarize(setup), null, 'nothing is recorded twice');
});

test('summarize: nothing until a verdict or the end of the writing', () => {
  const { st } = started(2);
  assert.equal(game.summarize(st), null);
  assert.equal(game.roundId(st), '');
  const done = playOut(st, ['Trust', 'Betrayal']);
  assert.match(game.summarize(done), /finished its stories \(not filed/);
  assert.equal(game.roundId(done), done.gid);
  const archived = playOut(startedNoJudge(2).st, ['Trust', 'Betrayal']);
  assert.match(game.summarize(archived), /judged two games from now/);
});

test('an archive that cannot be reached skips judging and says so', () => {
  const { st: lob, ids } = lobby(2, true);
  let st = run(lob, ids[0], { a: 'start' }, true);
  st = run(st, ids[0], { a: 'archive', entry: null, error: 'unreachable' }, true);
  assert.equal(st.phase, 'setup');
  assert.match(st.notice, /not judged this time/);
});

test('a malformed archive entry is not used for judging', () => {
  const { st: lob, ids } = lobby(2, true);
  let st = run(lob, ids[0], { a: 'start' }, true);
  st = run(st, ids[0], { a: 'archive', entry: { id: 'x', stories: [['only one']], themes: ['a'] } }, true);
  assert.equal(st.phase, 'setup');
});

// ---------- leaving ----------

test('prune: a team that empties abandons the game; nothing is filed', () => {
  const { st } = started(2);
  const gone = game.prune(st, 'p1');
  assert.equal(gone.phase, 'abandoned');
  assert.match(gone.notice, /ran out of players/);
  assert.equal(game.summarize(gone), null);
});

test('prune: when the last unvoted player leaves, the judging reveals', () => {
  const { st, ids } = judging(3);
  let s = vote(st, ids[0], 0, 0);
  s = vote(s, ids[0], 1, 0);
  s = vote(s, ids[1], 0, 1);
  s = vote(s, ids[1], 1, 1);
  assert.equal(s.phase, 'judging');
  const after = game.prune(s, ids[2]);
  assert.equal(after.phase, 'verdict');
});

test('prune: returns the same object when the player was not at the table', () => {
  const { st } = started(4);
  assert.equal(game.prune(st, 'nobody'), st);
});

test('the host can go back to the lobby from anywhere and then start again', () => {
  const { st } = started(2);
  const lob = run(playOut(st, ['Trust', 'Betrayal']), 'p1', { a: 'toLobby' }, true);
  assert.equal(lob.phase, 'lobby');
  assert.equal(lob.players.length, 2);
  const again = run(lob, 'p1', { a: 'start' }, true);
  assert.equal(again.phase, 'setup');
  assert.notEqual(again.gid, st.gid);
});

test('defaults: setup offers starter sentences and default themes from content.json', () => {
  const { st } = started(4);
  const v1 = game.project(st, 'p1');
  const v2 = game.project(st, 'p2');
  const spec = game.project(st, 'p9');
  assert.ok(content.starterSentences.includes(v1.starter));
  assert.ok(content.starterSentences.includes(v2.starter));
  assert.ok(content.themes.includes(v1.defaultTheme));
  assert.ok(content.themes.includes(v2.defaultTheme));
  assert.equal(spec.starter, '');
  assert.equal(spec.defaultTheme, '');
});

// ---------- runner ----------

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`ok    ${t.name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${t.name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}
console.log(`\n${tests.length - failed} of ${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
