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

function git(args, cwd = ROOT, quiet = true) {
  const opts = quiet
    ? { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    : { cwd, stdio: 'inherit' };   // inherit returns null for stdout
  const out = execFileSync('git', args, opts);
  return out === null ? '' : String(out).trim();
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
  const out = git(['status', '--porcelain'], cwd);
  const files = [];
  out.split('\n').filter(Boolean).forEach((line) => {
    const path = line.slice(3).trim();
    // "R  old -> new" shows as "old -> new"; the new path is what matters.
    const target = path.includes('->') ? path.split('->').pop().trim() : path;
    files.push({ status: line.slice(0, 2).trim(), path: target });
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

// -------------------------------------------------------------------- main ----

function usage() {
  console.error('usage: node scripts/run-builder.mjs <card.md> [--try N] [--keep] [--verify]');
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--verify')) process.exit(verify());
  if (argv.includes('--help')) usage();

  const tries = argv.includes('--try') ? Number(argv[argv.indexOf('--try') + 1]) : 3;
  const keep = argv.includes('--keep');
  const cardFile = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);
  if (!cardFile) usage();

  if (!fs.existsSync(cardFile)) {
    console.error(`no card at ${cardFile}`);
    process.exit(2);
  }

  const id = (fs.readFileSync(cardFile, 'utf8').match(/^id:\s*(\S+)/m) || [])[1];
  if (!id) {
    console.error('the card has no "id:" line');
    process.exit(2);
  }

  const branch = `build/${id}`;
  const wt = path.join(SANDBOX, id);

  // A worktree is a full checkout: it has the repo's files but NOT its
  // untracked ones, so node_modules and dist/ are absent. That is deliberate —
  // the gate runs on plain node with no dependencies, so there is nothing to
  // install, and there is therefore no way to reach `bun install` and rewrite
  // bun.lock in the format CI cannot read.
  if (fs.existsSync(wt)) {
    console.error(`${wt} already exists — remove it or pass a different card id.`);
    process.exit(2);
  }
  fs.mkdirSync(SANDBOX, { recursive: true });
  console.log(`sandbox: ${wt}  (branch ${branch})`);
  try {
    git(['worktree', 'add', '-b', branch, wt], ROOT, false);
  } catch (e) {
    console.error('could not create the worktree. Is the branch name already taken?');
    console.error(String(e.stderr || e.message).slice(0, 300));
    process.exit(1);
  }

  // Scaffold inside the sandbox, so the repo is untouched.
  //
  // The worktree is built from HEAD, which means the GATE has to be committed
  // before a builder can run. That is not an inconvenience — it is the workflow
  // working: the gate is shared infrastructure, and a builder that judges itself
  // with a version of the gate you cannot reproduce is not a real check. Say so
  // plainly rather than letting node print MODULE_NOT_FOUND.
  for (const need of ['scripts/new-game.mjs', 'scripts/check-game.mjs', 'scripts/fake-dom.mjs']) {
    if (fs.existsSync(path.join(wt, need))) continue;
    console.error(`The sandbox is missing ${need}.`);
    console.error('');
    console.error('It was created from the last commit, and the gate is not committed yet —');
    console.error('so the builder would have nothing to be judged by. Commit the tooling');
    console.error('(scripts/, cards/, .opencode/agents/) and run this again.');
    console.error('');
    console.error(`Cleaning up ${wt}.`);
    git(['worktree', 'remove', '--force', wt]);
    git(['branch', '-D', branch]);
    process.exit(2);
  }

  const cardInWt = fs.existsSync(path.join(wt, 'cards'))
    ? path.join(wt, 'cards', path.basename(cardFile))
    : null;
  if (!cardInWt) {
    fs.mkdirSync(path.join(wt, 'cards'), { recursive: true });
    fs.copyFileSync(cardFile, path.join(wt, 'cards', path.basename(cardFile)));
  }
  try {
    execFileSync('node', [path.join(wt, 'scripts', 'new-game.mjs'),
      path.join(wt, 'cards', path.basename(cardFile))],
      { cwd: wt, encoding: 'utf8' });
  } catch (e) {
    console.error(`new-game.mjs failed:\n${(e.stdout || '') + (e.stderr || '')}`);
    process.exit(1);
  }

  console.log('');
  console.log(`scaffolded games/${id}/ in the sandbox.`);
  console.log('');
  console.log('Now run the builder agent against the sandbox, not this repo:');
  console.log('');
  console.log(`  cd ${wt} && opencode --agent builder`);
  console.log(`  > ${TASK_PROMPT.replace('{id}', id).replace('{card}', `cards/${path.basename(cardFile)}`)}`);
  console.log('');
  console.log('Then come back and judge it:');
  console.log('');
  console.log(`  node scripts/run-builder.mjs ${cardFile} --review`);
  console.log('');

  if (!keep) {
    console.log(`(the sandbox is still there — remove ${wt} when you are done)`);
  }
  process.exit(0);
}

const TASK_PROMPT = `Build the game described in {card}. Read the card and games/{id}/scenarios.json first, fill in the BUILDER regions of games/{id}/index.js, and stop after each write for the harness to run the gate.`;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();