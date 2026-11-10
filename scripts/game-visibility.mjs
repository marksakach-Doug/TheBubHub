#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REG_FILE = path.join(ROOT, 'src', 'registry.js');
const GAMES_DIR = path.join(ROOT, 'games');
const LEGACY_FILE = path.join(ROOT, 'public', 'games.js');

const [cmd, targetId] = process.argv.slice(2);

function getHiddenList(src) {
  const m = src.match(/const HIDDEN_GAMES = \[(.*?)\];/s);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function setHiddenList(src, list) {
  const body = list.length ? '\n' + list.map((id) => `  '${id}',`).join('\n') + '\n' : '\n';
  return src.replace(/const HIDDEN_GAMES = \[.*?\];/s, `const HIDDEN_GAMES = [${body}];`);
}

function allGameIds() {
  const modIds = fs.existsSync(GAMES_DIR)
    ? fs.readdirSync(GAMES_DIR).filter((d) => fs.existsSync(path.join(GAMES_DIR, d, 'index.js'))).sort()
    : [];
  const legSrc = fs.existsSync(LEGACY_FILE) ? fs.readFileSync(LEGACY_FILE, 'utf8') : '';
  const legIds = [...legSrc.matchAll(/^\s*\{\s*id:\s*'([^']+)'/gm)].map((m) => m[1]);
  return { modIds, legIds: legIds.filter((id) => !modIds.includes(id)) };
}

const regSrc = fs.readFileSync(REG_FILE, 'utf8');
const hidden = new Set(getHiddenList(regSrc));
const { modIds, legIds } = allGameIds();

if (!cmd || cmd === 'list') {
  console.log('\nBubHub Games Visibility (edit HIDDEN_GAMES in src/registry.js):\n');
  for (const id of modIds) {
    console.log(`  ${hidden.has(id) ? '🙈 HIDDEN' : '✅ SHOWN '}  ${id.padEnd(16)} (module: games/${id}/index.js)`);
  }
  for (const id of legIds) {
    console.log(`  ${hidden.has(id) ? '🙈 HIDDEN' : '✅ SHOWN '}  ${id.padEnd(16)} (legacy: public/games.js)`);
  }
  console.log('\nCommands:\n  bun run games          List all games\n  bun run hide <id>      Hide a game from menus\n  bun run show <id>      Show a game in menus\n');
  process.exit(0);
}

if ((cmd !== 'hide' && cmd !== 'show') || !targetId) {
  console.error('Usage: bun run games | bun run hide <id> | bun run show <id>');
  process.exit(2);
}

if (cmd === 'hide') {
  hidden.add(targetId);
  fs.writeFileSync(REG_FILE, setHiddenList(regSrc, [...hidden]));
  console.log(`🙈 Hid "${targetId}" in src/registry.js. Run \`bun run build\` before deploying.`);
} else if (cmd === 'show') {
  hidden.delete(targetId);
  fs.writeFileSync(REG_FILE, setHiddenList(regSrc, [...hidden]));
  const modFile = path.join(GAMES_DIR, targetId, 'index.js');
  if (fs.existsSync(modFile)) {
    const cleaned = fs.readFileSync(modFile, 'utf8').replace(/\n\s*hidden:\s*true,/, '');
    fs.writeFileSync(modFile, cleaned);
  }
  console.log(`✅ Showed "${targetId}" in src/registry.js. Run \`bun run build\` before deploying.`);
}
