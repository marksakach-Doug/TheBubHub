#!/usr/bin/env node
// Sandbox for the builder agent.
//
//   node scripts/run-builder.mjs <card.md> [--try 3] [--keep] [--print]
//
// A builder gets its own git worktree on a throwaway branch and nothing else.
// Two things follow from that, and both are the point:
//
//   · The branch is the rollback boundary. Nothing the builder does can touch
//     the working tree you are sitting in.
//   · You merge. Always, by hand, having read the diff. There is no path from
//     this script to `git push`, because this script never runs git push and the
//     agent has no shell to run one.
//
// THE ALLOWLIST IS NOT ENFORCED HERE — it is enforced by the agent's own
// permission config in .opencode/agents/builder.md (bash denied, edit allowed
// only on games/*/index.js). This script's job is to make the blast radius
// small and to REPORT whether the agent stayed inside it, so a misconfigured
// permission block is caught rather than assumed. Run `--verify` to see that
// check on its own.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SANDBOX = '/tmp/bubhub-builder';

// ---------------------------------------------------------------- git bits ----

// git exits non-zero for plenty of ordinary answers ("no differences"), and a
// throw here would hide the very output the caller asked for. Return the
// output either way and let the caller decide what a non-zero exit means.
function git(args, cwd = ROOT, quiet = true) {
  const opts = quiet
    ? { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    : { cwd, stdio: 'inherit' };   // inherit returns null for stdout
  try {
    const out = execFileSync('git', args, opts);
    return out === null ? '' : String(out).trim();
  } catch (e) {
    if (quiet) {
      const out = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
      if (args[0] === 'diff') return out.replace(/^error:.*$/gm, '').trim();
      return out;
    }
    throw e;
  }
}

// Everything that is NOT games/<id>/index.js must be byte-identical to the
// branch point. This is the allowlist, checked from the outside rather than
// trusted from the inside.
function allowed(id) {
  return new Set([
    `games/${id}/index.js`,
    `games/${id}/scenarios.json`,   // written by new-game.mjs, before the agent starts
    `cards/${id}.md`                // the card itself, if it was new
  ]);
}

function changedFiles(cwd, id) {
  // -uall: without it git collapses a new directory into one "??" line, which
  // made the allowlist report games/<id>/ as a stray change on a run where the
  // agent had written nothing at all.
  const out = git(['status', '--porcelain', '-uall'], cwd);
  const files = [];
  out.split('\n').filter(Boolean).forEach((line) => {
    // Porcelain is XY<space>PATH. A fixed offset breaks as soon as a status is
    // three characters wide — which happens the moment `git add -N` leaves an
    // "A " behind — and it silently drops the first letter of the filename.
    const m = line.match(/^(.{1,2})\s+(.*)$/);
    if (!m) return;
    let path = m[2].trim();
    // "R  old -> new": the new path is what matters.
    if (path.includes('->')) path = path.split('->').pop().trim();
    files.push({ status: m[1].trim(), path });
  });
  return files;
}

function checkAllowlist(cwd, id) {
  const ok = allowed(id);
  const bad = [];
  for (const f of changedFiles(cwd, id)) {
    if (ok.has(f.path)) continue;
    // Only complain about things a builder could plausibly have caused.
    if (f.status === '??' && f.path.startsWith('node_modules/')) continue;
    bad.push(f);
  }
  return bad;
}

// ------------------------------------------------------------------ verify ----
//
// Three refusals, demonstrated rather than assumed. If the agent's permission
// config is ever loosened by accident, this is the suite that notices, because
// nothing else in the repo would.

function verify() {
  const cfgPath = path.join(ROOT, '.opencode', 'agents', 'builder.md');
  const cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
  const fm = cfg.split('---')[1] || '';

  const cases = [
    ['bash is denied outright, so "never git push" is a fact not a rule',
      /^\s*bash:\s*deny\s*$/m, 'bash: deny'],
    // Deny-by-default first, then the one allow. A list that starts with the
    // allow is the same list with no protection at all.
    ['the write allowlist is deny-by-default, not allow-by-default',
      /edit:\s*\n\s*["']?\*["']?:\s*deny/, "edit:\n    \"*\": deny"],
    ['only games/*/index.js is writable',
      /["']games\/\*\/index\.js["']:\s*allow/, '"games/*/index.js": allow'],
    ['paths outside the worktree are denied, which is what keeps the Cloudflare token unreachable',
      /external_directory:\s*deny/, 'external_directory: deny'],
    ['no network', /webfetch:\s*deny/, 'webfetch: deny'],
    ['the agent cannot spawn another agent', /task:\s*deny/, 'task: deny'],
    // The whole allowlist is small enough to be read by a person. If it grows a
    // seventh line, someone should look at it.
    ['the write allowlist names at most two paths',
      () => (fm.match(/: allow/g) || []).length <= 2, 'at most two `allow` rules under `edit:`']
  ];

  let failed = 0;
  console.log('=== builder sandbox — refusal proof ===');
  console.log('');
  for (const [name, re, what] of cases) {
    if ((typeof re === 'function' ? re(fm) : re.test(fm))) {
      console.log(`  ok   ${name}`);
    } else {
      console.log(`FAIL  ${name}`);
      console.log(`        .opencode/agents/builder.md has no "${what}"`);
      failed++;
    }
  }

  // And the credential really is outside the tree the builder can see.
  const cred = path.join(process.env.HOME || '', '.config', 'bubhub');
  const outside = !path.resolve(cred).startsWith(path.resolve(ROOT) + path.sep);
  if (outside) {
    console.log('  ok   the credential directory is outside the repo, so it is unreachable');
  } else {
    console.log('FAIL  ~/.config/bubhub is inside the repo — deny rules cannot save you now');
    failed++;
  }

  console.log('');
  if (failed) {
    console.log(`${failed} refusal(s) are not in place. Do not run a builder until this passes.`);
    return 1;
  }
  console.log('the builder has no shell, one writable file, and no path to a credential.');
  console.log('');
  console.log('This checks the CONFIG. The end-to-end proof is a real builder run against a');
  console.log('card whose agent tries to `git push` — do that once before trusting it.');
  return 0;
}


function cardCap(wt, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(wt, 'games', id, 'scenarios.json'), 'utf8')).maxLines || 250;
  } catch (e) {
    return 250;
  }
}

// ------------------------------------------------------------------ review ----
//
// The half that is not the agent's. Nothing here merges anything: it runs the
// gate on the sandbox, reports whether the agent stayed inside the allowlist,
// and prints the diff. The decision is yours.

function review(id) {
  const wt = path.join(SANDBOX, id);
  if (!fs.existsSync(wt)) {
    console.error(`no sandbox at ${wt}. Run scripts/run-builder.mjs cards/${id}.md first.`);
    process.exit(2);
  }
  let rc = 0;

  // 1. The gate, run where the builder wrote the file. Not here: the point is
  //    that the sandbox is self-contained. A non-zero exit is the expected way
  //    this ends when the agent has not finished, so read the output out of the
  //    throw rather than letting it become a stack trace.
  console.log('=== the gate, in the sandbox ===');
  let gateOut = '';
  try {
    gateOut = String(execFileSync('node', [path.join(wt, 'scripts', 'check-game.mjs'), id],
      { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '');
  } catch (e) {
    // A non-zero exit is the normal way this ends when the agent is not done,
    // so read the report out of the throw rather than printing a stack trace.
    gateOut = String(e.stdout || '') + String(e.stderr || '');
  }
  process.stdout.write(gateOut);
  if (!/^PASS\b/m.test(gateOut)) rc = 1;

  // 2. Did it stay inside the allowlist? A permission block that does not hold
  //    is worth more than a gate failure, because it is the one that is silent.
  console.log('');
  console.log('=== did it stay inside the allowlist? ===');
  const bad = checkAllowlist(wt, id);
  if (bad.length) {
    bad.forEach((f) => console.log(`FAIL  ${f.status}  ${f.path}`));
    console.log('');
    console.log(`${bad.length} file(s) changed that the builder has no business touching.`);
    console.log('The permission block in .opencode/agents/builder.md is not holding.');
    console.log('Do not merge. Re-run scripts/run-builder.mjs --verify, and treat this');
    console.log('as a hole in the sandbox rather than a mistake by the model.');
    rc = 1;
  } else {
    console.log('  ok   only games/<id>/index.js changed');
  }

  // 3. The diff. Small by construction — that is the whole point of the cap.
  //
  // `git add -N` marks the new files as intent-to-add WITHOUT staging their
  // contents, which is the only way to get a real `git diff` for a file the
  // agent created. Staging them for real would leave the sandbox in a state
  // that looks like a half-finished commit.
  const changed = changedFiles(wt, id);
  const newOnes = changed.filter((f) => f.status === '??').map((f) => f.path);
  if (newOnes.length) git(['add', '-N', '--'].concat(newOnes), wt);

  console.log('');
  console.log('=== the diff ===');
  if (!changed.length) {
    console.log('  (nothing changed — the builder did not write anything)');
    rc = 1;
  } else {
    const stat = git(['diff', '--stat'], wt);
    console.log(stat || '  (no textual diff)');
    console.log('');
    console.log(`changed: ${changed.map((f) => f.path).join(', ')}`);
    const gameLines = stat.split('\n').filter((l) => l.includes(`games/${id}/index.js`))[0] || '';
    const m = gameLines.match(/(\d+) insertions?/);
    if (m && Number(m[1]) > 400) {
      console.log('');
      console.log(`That is a ${m[1]}-line change to a file the card caps at ${cardCap(wt, id)}.`);
      console.log('Read it before merging, and check it did not simply rewrite the scaffold.');
    }
  }

  console.log('');
  if (rc) {
    console.log('NOT READY TO MERGE. Fix what is above, or do not merge.');
  } else {
    console.log('Green, and inside the allowlist. Play it before you trust it:');
    console.log('');
    console.log(`  cd ${wt} && bun install && bun run dev`);
    console.log('');
    console.log('Then merge by hand. This script will not do it for you:');
    console.log('');
    console.log(`  cp ${wt}/games/${id}/index.js games/${id}/index.js`);
    console.log(`  cp ${wt}/games/${id}/scenarios.json games/${id}/scenarios.json`);
    console.log(`  git diff --stat                 # read this before committing`);
    console.log('');
    console.log('and when you are done with the sandbox:');
    console.log('');
    console.log(`  git worktree remove --force ${wt} && git branch -D build/${id}`);
  }
  return rc;
}

// -------------------------------------------------------------------- main ----

const TASK_PROMPT = [
  'Build the game described in {card}.',
  '',
  'Read {card} and games/{id}/scenarios.json first — the scenarios are the spec.',
  'Then fill in ONLY the regions between the BUILDER START/END comments in',
  'games/{id}/index.js. Do not touch anything else.',
  '',
  'After you write, stop and wait. You have no shell: the harness runs the gate',
  'for you and shows you the first failing check.'
].join('\n');

function usage() {
  console.error([
    'usage:',
    '  node scripts/run-builder.mjs <card.md>        scaffold a sandbox for the agent',
    '  node scripts/run-builder.mjs <card.md> --review  judge what it wrote',
    '  node scripts/run-builder.mjs --verify          print the refusal proof',
    '',
    'The agent runs inside the sandbox, not here:  cd <sandbox> && opencode --agent builder',
    'Nothing in this script merges anything, and nothing in it can push.'
  ].join('\n'));
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--verify')) process.exit(verify());
  if (argv.includes('--help')) usage();

  // --review takes the id, which the card's `id:` line is the source of.
  if (argv.includes('--review')) {
    const at = argv.indexOf('--review');
    const explicit = argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
    if (explicit) process.exit(review(explicit));
    const cards = argv.filter((a) => a.endsWith('.md'));
    if (cards.length !== 1) usage();
    const id = (fs.readFileSync(cards[0], 'utf8').match(/^id:\s*(\S+)/m) || [])[1];
    if (!id) { console.error('the card has no "id:" line'); process.exit(2); }
    process.exit(review(id));
  }

  const cardFile = argv.find((a) => !a.startsWith('--'));
  if (!cardFile) usage();
  if (!fs.existsSync(cardFile)) {
    console.error(`no card at ${cardFile}`);
    process.exit(2);
  }

  const id = (fs.readFileSync(cardFile, 'utf8').match(/^id:\s*(\S+)/m) || [])[1];
  if (!id) { console.error('the card has no "id:" line'); process.exit(2); }

  const branch = `build/${id}`;
  const wt = path.join(SANDBOX, id);

  // A worktree is a full checkout: it has the repo's tracked files but NOT its
  // untracked ones, so node_modules and dist/ are absent. That is deliberate —
  // the gate runs on plain node with no dependencies, so there is nothing to
  // install, and there is therefore no way to reach `bun install` and rewrite
  // bun.lock in the format CI cannot read.
  // This branch exists only to be thrown away, so a leftover one from a run
  // that was interrupted is not worth failing over — clear it and carry on.
  // `git worktree add` refuses to reuse the name, and the resulting message
  // ("a branch named build/x already exists") tells a person nothing about what
  // to do next.
  if (fs.existsSync(wt)) {
    console.log(`clearing a leftover sandbox at ${wt}`);
    git(['worktree', 'remove', '--force', wt]);
  }
  git(['worktree', 'prune']);
  git(['branch', '-D', branch]);
  fs.mkdirSync(SANDBOX, { recursive: true });

  console.log(`sandbox: ${wt}  (branch ${branch})`);
  try {
    git(['worktree', 'add', '-b', branch, wt], ROOT, false);
  } catch (e) {
    console.error(`could not create the worktree at ${wt}.`);
    console.error(String(e.stderr || e.message || '').slice(0, 300));
    process.exit(1);
  }

  // Scaffold inside the sandbox, so this working tree is never touched.
  //
  // The worktree is built from HEAD, which means the GATE has to be committed
  // before a builder can run. That is the workflow working, not an
  // inconvenience: a builder judged by a version of the gate you cannot
  // reproduce is not a real check. Say so plainly rather than letting node
  // print MODULE_NOT_FOUND.
  for (const need of ['scripts/new-game.mjs', 'scripts/check-game.mjs', 'scripts/fake-dom.mjs']) {
    if (fs.existsSync(path.join(wt, need))) continue;
    console.error('');
    console.error(`The sandbox is missing ${need}.`);
    console.error('It was created from the last commit, and the gate is not committed yet —');
    console.error('so the builder would have nothing to be judged by. Commit the tooling');
    console.error('(scripts/, cards/, .opencode/agents/) and run this again.');
    console.error('');
    console.log(`Cleaning up ${wt}.`);
    git(['worktree', 'remove', '--force', wt]);
    git(['branch', '-D', branch]);
    process.exit(2);
  }

  fs.mkdirSync(path.join(wt, 'cards'), { recursive: true });
  const cardName = path.basename(cardFile);
  if (path.resolve(cardFile) !== path.resolve(path.join(wt, 'cards', cardName))) {
    fs.copyFileSync(cardFile, path.join(wt, 'cards', cardName));
  }
  try {
    execFileSync('node', [path.join(wt, 'scripts', 'new-game.mjs'), `cards/${cardName}`],
      { cwd: wt, encoding: 'utf8' });
  } catch (e) {
    console.error(`new-game.mjs failed:\n${(e.stdout || '') + (e.stderr || '')}`);
    process.exit(1);
  }

  const prompt = TASK_PROMPT
    .replace(/\{card\}/g, `cards/${cardName}`)
    .replace(/\{id\}/g, id);

  console.log('');
  console.log(`scaffolded games/${id}/ in the sandbox. It will not pass the gate yet —`);
  console.log('the rules are blank. That is what the agent is for.');
  console.log('');
  console.log('  1. run the agent against the SANDBOX, not this repo:');
  console.log('');
  console.log(`       cd ${wt}`);
  console.log('       opencode');
  console.log('');
  console.log('     then paste this prompt:');
  console.log('');
  prompt.split('\n').forEach((l) => console.log('       ' + l));
  console.log('');
  console.log('  2. judge what it wrote:');
  console.log('');
  console.log(`       node scripts/run-builder.mjs cards/${cardName} --review`);
  console.log('');
  console.log(`  3. play it in the sandbox before merging:   cd ${wt} && bun install && bun run dev`);
  console.log('');
  console.log(`Remove the sandbox when you are done:  git worktree remove --force ${wt}`);
  process.exit(0);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
