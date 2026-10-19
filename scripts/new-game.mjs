#!/usr/bin/env node
// Scaffold a new game from a task card.
//
//   node scripts/new-game.mjs cards/tictactoe.md
//   node scripts/new-game.mjs --demo tictactoe     # write into /tmp, not the repo
//
// Two files come out, and the builder agent may only ever touch one of them:
//
//   games/<id>/scenarios.json   the spec, machine-checkable. Generated here from
//                               the card so a builder cannot quietly weaken it.
//   games/<id>/index.js         THE FILE THE BUILDER WRITES. Generated here as a
//                               complete, correct shell with the rules left blank.
//
// The scaffold is deliberately not an empty file. A 14B model asked to write six
// exports from memory will get one of them wrong; asked to fill in one marked
// region of a file that already works, it only has to get the rules right. That
// is the whole trick, so the generator is not a convenience — it is the reason
// the builder can be small.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// -------------------------------------------------------------- card parse ----
//
// Deliberately tiny. A card is written by a person, read by a small model, and
// parsed here, so a full YAML parser would be a dependency the gate then has to
// police. Six `key: value` lines plus two blocks is the entire format.

function parseCard(text) {
  const card = { scenarios: [], roster: defaultRoster() };
  const lines = text.split('\n');
  let section = null;
  let scenario = null;
  let blockKey = null;      // the key whose `|` block we are collecting
  let block = [];

  const flushBlock = () => {
    if (!blockKey) return;
    card[blockKey] = block.join('\n').trim();
    if (blockKey === 'rules') card.rules_one_line = card[blockKey].split('\n')[0].trim();
    blockKey = null;
    block = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\s+$/, '');
    if (!raw.trim() || /^\s*#/.test(raw)) continue;

    // Inside a `key: |` block: every indented line belongs to it, verbatim.
    if (blockKey !== null) {
      if (/^\s{2,}\S/.test(raw)) { block.push(raw.replace(/^\s{2}/, '')); continue; }
      flushBlock();
    }

    // A block scalar opener: `key: |`
    const openBlock = raw.match(/^\s*([a-z_]+):\s*\|\s*$/);
    if (openBlock) { blockKey = openBlock[1]; block = []; continue; }

    if (/^scenarios:\s*$/.test(raw)) { section = 'scenarios'; scenario = null; continue; }
    if (/^roster:\s*$/.test(raw)) { section = 'roster'; continue; }
    if (/^[a-z_]+:\s*$/.test(raw)) {
      section = raw.split(':')[0].trim();
      if (section === 'scenarios') scenario = null;
      continue;
    }

    if (section === 'scenarios') {
      const nm = raw.match(/^\s*-\s*name:\s*(.+)$/);
      if (nm) {
        scenario = { name: nm[1].trim().replace(/^["']|["']$/g, ''), steps: [], expect: {} };
        card.scenarios.push(scenario);
        continue;
      }
      const st = raw.match(/^\s*steps:\s*(.+)$/);
      if (st && scenario) { parseSteps(st[1], scenario); continue; }
      const ex = raw.match(/^\s*expect:\s*(\{.*\})\s*$/);
      if (ex && scenario) {
        try { scenario.expect = JSON.parse(ex[1]); }
        catch (e) { scenario.expect = { _unparsed: ex[1].trim() }; }
        continue;
      }
      const more = raw.match(/^\s{4,}-\s*(\{.*\})\s*$/);
      if (more && scenario) {
        try { scenario.steps.push(JSON.parse(more[1])); } catch (e) {}
      }
      continue;
    }

    const kv = raw.match(/^\s*([a-z_]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const val = kv[2].trim().replace(/^["']|["']$/g, '');
      section = null;
      if (key === 'players') card.players = parseRange(val);
      else if (key === 'hidden') card.hidden = val && val !== 'none' ? val.split(',').map((s) => s.trim()).filter(Boolean) : [];
      else card[key] = val;
      continue;
    }
  }
  flushBlock();
  return card;
}

function parseRange(v) {
  const m = String(v).match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  if (/^\d+$/.test(v)) return { min: Number(v), max: Number(v) };
  if (/^solo$/i.test(v)) return 'solo';
  return { min: 2, max: 2 };
}

// "p1 take 3, p2 take 2"  ->  [{as:'p1', action:{a:'take', n:3}}, ...]
// "p1 take 4" with expect { error: true } is a move that must be refused.
function parseSteps(text, scenario) {
  const trimmed = String(text).trim();
  if (trimmed === 'none' || trimmed === '') { scenario.steps = []; return; }
  trimmed.split(',').forEach((chunk) => {
    const bits = chunk.trim().split(/\s+/).filter(Boolean);
    if (bits.length < 2) return;
    const as = bits[0];
    const a = bits[1];
    const action = { a };
    if (bits[2] !== undefined) {
      const n = Number(bits[2]);
      action.n = Number.isFinite(n) ? n : bits[2];
    }
    scenario.steps.push({ as, action });
  });
}

function defaultRoster() {
  return [
    { id: 'p1', name: 'Alice', host: true },
    { id: 'p2', name: 'Bo', host: false }
  ];
}

// --------------------------------------------------------------- generation ----

const INDEX_TEMPLATE = (card) => `// ${card.title || card.id} — a BubHub module game.
//
// GENERATED by scripts/new-game.mjs from the task card. Everything outside the
// marked region is finished, correct, and in the house style. Change ONLY what
// is between the BUILDER markers — everything else is already right.
//
// The rules to build are in games/${card.id}/scenarios.json. That file is the
// spec: every scenario there is a list of moves and the result each must
// produce. The gate runs them, so a rule that does not match is a failed build.

export const meta = {
  id: '${card.id}',
  title: ${JSON.stringify(card.title || card.id)},
  players: ${JSON.stringify(card.players || { min: 2, max: 2 })},
  color: '#7aa2f7',
  icon: '🎲',
  desc: ${JSON.stringify(card.desc || card.rules_one_line || 'A BubHub game.')}
};

function tableOf(ctx) {
  const c = ctx || {};
  const list = c.atTable || c.seats || [];
  const ids = [];
  list.forEach(function (m) {
    if (!m || !m.id || m.spectator) return;
    if (ids.indexOf(m.id) < 0) ids.push(m.id);
  });
  return ids.slice(0, ${(card.players && card.players.max) || 2});
}

function fresh(ctx) {
  return {
    epoch: 0,
    players: tableOf(ctx),
    turn: '',
    // ---- BUILDER STARTS HERE ----
    // The state your rules need. Plain data ONLY — numbers, strings, booleans,
    // null, plain objects and plain arrays. A Set, Map, Date or function here
    // arrives at the other player as {} and their board breaks.
    over: null,
    last: { player: '', move: '' }
    // ---- BUILDER ENDS HERE ----
  };
}

export function init(ctx) {
  const st = fresh(ctx);
  st.turn = st.players[0] || '';
  return st;
}

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const rng = (ctx && ctx.rng) || Math.random;
  const id = from.id || '';
  const kind = (action && action.a) || '';

  // same() copies — use it for EVERY change. Never write to \`state\`: the copy
  // you were handed may already have gone to another player.
  const same = function (extra) { return Object.assign({}, state, extra); };
  // bad() refuses. Every message here is shown to a player on screen, so it has
  // to read like a sentence a human would want to read.
  const bad = function (why) { return { error: why }; };

  if (!id) return bad('No identity — reopen the game.');
  if (state.players.indexOf(id) < 0) return bad('You are watching — not seated.');

  if (kind === 'reset') {
    const st = fresh(ctx);
    st.epoch = state.epoch + 1;
    st.turn = st.players[0] || '';
    return st;
  }

  // ---- BUILDER STARTS HERE ----
  //
  // Write your move here. The shape you are aiming for:
  //
  //   if (kind === 'yourAction') {
  //     if (<it is somebody else's turn>) return bad('It is not your turn.');
  //     if (<the move is not legal>)       return bad('A message for the player.');
  //     if (<the move ends the game>)      return same({ epoch: state.epoch + 1, over: { winner: <id> }, turn: '' });
  //     return same({ turn: <the next player id>, /* your changes */ });
  //   }
  //
  // Rules to remember:
  //   · Return \`same({...})\` or \`bad('...')\`. Never return nothing, never throw.
  //   · Any player can send any action at any time. Check every field it carries.
  //   · Use \`rng\` for anything random. Never Math.random().
  //
  return bad('Unknown action: ' + kind);
  // ---- BUILDER ENDS HERE ----
}

export function project(state, playerId) {
  // Build the view field by field. Do NOT spread all of state into it: anything
  // here is sent to every player, and \`project\` is the only place you can take
  // something out. The card's "hidden:" line, if it has one, is enforced by the gate.
  return Object.assign({}, state, { you: playerId || '' });
}

export function roundId(state) {
  return 'e' + ((state && state.epoch) || 0);
}

export function summarize(state, nameOf) {
  // null until the game is genuinely over, or the record sheet fills with lines
  // nobody can take back. Use nameOf(id) for names — never a raw id.
  if (!state.over || !state.over.winner) return null;
  // The loser is "the other player", derived rather than recorded. Writing it
  // down when the game ends gets it wrong for anything but a game whose LAST
  // mover is the loser: in a race to ten the winner is the last mover, so
  // "Alice beat Alice" is what a hard-coded version produces. If your game does
  // not end with one winner and one loser, change this line — it is the only
  // part of this scaffold that is not one-size-fits-all.
  const loser = (state.players || []).filter((p) => p !== state.over.winner)[0] || '';
  return nameOf(state.over.winner) + ' beat ' + nameOf(loser) + ' at ${card.title || card.id}';
}

export function mount(root, api) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:460px;margin:0 auto;padding:16px 12px 24px;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;'
    + 'user-select:none;-webkit-user-select:none;text-align:center;';

  const head = document.createElement('div');
  head.style.cssText = 'font-size:20px;font-weight:600;margin-bottom:6px;';
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:14px;opacity:.75;min-height:20px;margin-bottom:14px;';
  const board = document.createElement('div');
  board.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:16px;';

  // ---- BUILDER STARTS HERE ----
  // Build the buttons or cells your game needs. For each one:
  //   const b = document.createElement('button');
  //   b.style.cssText = 'min-width:56px;min-height:48px;font:inherit;font-size:16px;border-radius:10px;'
  //     + 'border:1px solid #3a465f;background:#232c3f;color:#e8ecf4;cursor:pointer;';
  //   b.addEventListener('click', function () { api.send({ a: 'yourAction', n: 3 }); });
  //   board.appendChild(b);
  // When you are done, delete this whole comment — it must not stay here.
  // ---- BUILDER ENDS HERE ----

  const reset = document.createElement('button');
  reset.textContent = 'New game';
  reset.style.cssText = 'font:inherit;font-size:14px;min-height:40px;padding:8px 14px;'
    + 'border-radius:10px;border:1px solid #3a465f;background:#1b2231;color:#e8ecf4;cursor:pointer;';
  reset.addEventListener('click', function () { api.send({ a: 'reset' }); });

  wrap.appendChild(head);
  wrap.appendChild(sub);
  wrap.appendChild(board);
  wrap.appendChild(reset);
  root.appendChild(wrap);

  const names = {};
  ((api && api.roster) || []).forEach(function (r) { names[r.id] = r.name; });
  const who = function (pid) { return names[pid] || 'someone'; };

  function update(view) {
    if (!view) return;
    // ---- BUILDER STARTS HERE ----
    // Repaint EVERYTHING from the view, every time. Reading a field that is not
    // there throws; leaving last turn's value on screen is a bug nobody can
    // explain and nothing logs.
    head.textContent = view.over ? 'Game over' : 'Your turn to move.';
    sub.textContent = view.over ? 'New game to play again.'
      : (view.turn === view.you ? 'Your turn.' : ('Waiting for ' + who(view.turn) + '.'));
    // ---- BUILDER ENDS HERE ----
  }

  function denied(text) {
    sub.textContent = text || 'Not allowed.';
    sub.style.color = '#ffd479';
  }

  function destroy() {}

  return { update: update, denied: denied, destroy: destroy };
}
`;

function main() {
  const argv = process.argv.slice(2);
  const demo = argv.includes('--demo');
  const args = argv.filter((a) => a !== '--demo');
  if (args.length !== 1) {
    console.error('usage: node scripts/new-game.mjs <card.md> [--demo]');
    process.exit(2);
  }
  const cardFile = args[0];
  if (!fs.existsSync(cardFile)) {
    console.error(`no card at ${cardFile}`);
    process.exit(2);
  }

  const card = parseCard(fs.readFileSync(cardFile, 'utf8'));
  const id = card.id;

  if (!id || !/^[a-z0-9]+$/.test(id)) {
    console.error(`card id "${id}" must be a-z0-9 only.`);
    process.exit(2);
  }
  const liveDir = path.join(ROOT, 'games', id);
  if (!demo && fs.existsSync(liveDir)) {
    console.error(`games/${id} already exists. Not overwriting it.`);
    process.exit(2);
  }
  if (!card.scenarios.length) {
    console.error('the card has no scenarios, so the gate would have nothing to check.\n'
      + 'Write at least one, and at least one that ends the game so summarize() is tested.');
    process.exit(2);
  }

  const outDir = demo ? path.join('/tmp', 'newgame', id) : liveDir;
  fs.mkdirSync(outDir, { recursive: true });

  const scenarioCard = {
    id,
    title: card.title || id,
    version: 1,
    note: 'Generated by scripts/new-game.mjs from ' + path.basename(cardFile)
      + '. The builder may not edit this file — the gate reads it.',
    players: card.players || { min: 2, max: 2 },
    maxLines: Number(card['max-lines'] || 250),
    summarizeMaxChars: 120,
    seed: 12345,
    hidden: card.hidden || [],
    roster: card.roster && card.roster.length ? card.roster : defaultRoster(),
    rules: card.rules || '',
    actions: card.actions || {},
    summarize: card.summarize || '',
    scenarios: card.scenarios
  };

  fs.writeFileSync(path.join(outDir, 'scenarios.json'), JSON.stringify(scenarioCard, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'index.js'), INDEX_TEMPLATE(card));

  const shown = demo ? outDir : path.join('games', id);
  console.log(demo ? 'wrote (demo — nothing in the repo changed):' : 'wrote:');
  console.log(`  ${shown}/scenarios.json   ${card.scenarios.length} scenarios`);
  console.log(`  ${shown}/index.js         builder fills in 4 marked regions`);
  console.log('');
  // A builder finds its region by searching for the marker. If an example
  // comment ever repeats it, there are two regions and the model writes into
  // the wrong one — which is how a scaffold quietly stops being a scaffold.
  const generated = fs.readFileSync(path.join(outDir, 'index.js'), 'utf8');
  // Four regions: the state, the rules, the buttons, the repaint. The count is
  // written out rather than inferred so that adding a region without updating
  // this line is a build failure, not a silently shorter scaffold.
  const WANT = 4;
  const starts = (generated.match(/BUILDER STARTS HERE/g) || []).length;
  const ends = (generated.match(/BUILDER ENDS HERE/g) || []).length;
  if (starts !== WANT || ends !== WANT) {
    console.error(`the scaffold has ${starts} START and ${ends} END markers, expected ${WANT} of each.`);
    console.error('A marker must appear exactly once per region — including inside example');
    console.error('comments, where a second copy makes the region ambiguous.');
    process.exit(1);
  }

  console.log('The generated index.js does NOT pass the gate yet — the rules are blank.');
  console.log('That is expected: it passes once the BUILDER regions are filled in.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();