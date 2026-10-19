#!/usr/bin/env node
// The gate for a BubHub module game.
//
//   node scripts/check-game.mjs <id>          check one game
//   node scripts/check-game.mjs --all         check every game with a card
//
// Node only. No dependencies, no bun, no network. That is deliberate: the gate
// is what a small model runs three times in a row, so it has to start in under
// a second and it must never be the thing that can touch bun.lock.
//
// THE EXIT CODE IS THE VERDICT. Not the output, not the model's pasted
// transcript — those are how a model talks itself into a green build. `0` means
// the game is shippable; anything else means it is not.
//
// WHY FIRST-FAILURE-ONLY
// A wall of failures is noise to a weak model. Sixteen red lines at once is
// worse than one, because the model tries to fix all sixteen at once and makes
// the file worse. So: run every check, then report ONE, in a fixed order chosen
// so the cheapest and most fundamental failure is the one you see. Everything
// else is reduced to a bare count it is told to ignore.
//
// WHY THE MESSAGES ARE THE PRODUCT
// Every message is written for someone who has not read the BubHub README. It
// says what broke, what to do about it, and nothing else. When a message here
// is vague, the fix is to rewrite this file, not to write a longer prompt for
// the model.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeApi, fakeRoot, seeded, withGlobals } from './fake-dom.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ------------------------------------------------------------------ checks ----
//
// Each check returns null when it passes, or { id, title, fix } when it does
// not. `fix` is the whole message: a sentence or two, in plain English, ending
// in an instruction. That is the entire contract between this file and the
// model.

const checks = [];
const check = (id, title, fn) => checks.push({ id, title, fn });

// ------------------------------------------------------------- card + code ----

function loadCard(id, root) {
  const file = path.join(root || ROOT, 'games', id, 'scenarios.json');
  if (!fs.existsSync(file)) return { error: `no card at games/${id}/scenarios.json` };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { error: `games/${id}/scenarios.json is not valid JSON: ${e.message}` };
  }
}

// Comments are stripped before the code-shaped checks so a file may talk about
// the forbidden things in prose. Strings are left alone: a URL in a string is
// exactly what we want to catch.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ------------------------------------------------------------- static ones ----

check('load', 'the file is a valid module', async (ctx) => {
  try {
    const url = pathToFileURL(ctx.srcFile).href;
    ctx.mod = await import(url);
    return null;
  } catch (e) {
    return {
      fix: `games/${ctx.id}/index.js could not be loaded as a JavaScript module.\n`
        + `    ${e.message.split('\n')[0]}\n`
        + `    The file must be a module that node can import on its own. A stray "export export",\n`
        + `    an unbalanced brace, or an import of a file that is not there all land here.`
    };
  }
});

check('exports', 'all six exports are there', async (ctx) => {
  const need = ['init', 'reduce', 'project', 'mount', 'summarize'];
  const missing = need.filter((k) => typeof ctx.mod[k] !== 'function');
  if (missing.length) {
    return {
      fix: `games/${ctx.id}/index.js must export ${need.join(', ')}.\n`
        + `    Missing or not a function: ${missing.join(', ')}.\n`
        + `    Every one of them needs the word "export" in front of it. A function you only\n`
        + `    declare is invisible to the hub, and the game will fail to start with\n`
        + `    "mount is not a function".`
    };
  }
  if (!ctx.mod.meta || typeof ctx.mod.meta !== 'object') {
    return {
      fix: `games/${ctx.id}/index.js must export a "meta" object (it does not).\n`
        + `    meta needs at least: id, title, players, desc.`
    };
  }
  return null;
});

check('meta.id', 'meta.id matches the folder name', async (ctx) => {
  const id = ctx.mod.meta.id;
  if (id !== ctx.id) {
    return {
      fix: `meta.id is "${id}" but the folder is "games/${ctx.id}".\n`
        + `    They must match EXACTLY, including capital letters — this filesystem is\n`
        + `    case-sensitive and a mismatch fails to load in production.\n`
        + `    Change meta.id to "${ctx.id}".`
    };
  }
  return null;
});

check('meta.players', 'meta.players matches the card', async (ctx) => {
  const want = ctx.card.players;
  if (want === undefined) return null;
  const got = ctx.mod.meta.players;
  const norm = (p) => (typeof p === 'object' ? `${p.min}-${p.max}` : String(p));
  if (norm(got) !== norm(want)) {
    return {
      fix: `meta.players is "${norm(got)}" but the card says "${norm(want)}".\n`
        + `    The card is the spec. Set meta.players to ${JSON.stringify(want)}.`
    };
  }
  return null;
});

check('size', 'the file is not too long', async (ctx) => {
  const cap = ctx.card.maxLines || 250;
  const n = ctx.src.split('\n').length;
  if (n > cap) {
    return {
      fix: `games/${ctx.id}/index.js is ${n} lines and the cap is ${cap}.\n`
        + `    Cut it down. If the rules genuinely need more, raise "maxLines" in the card —\n`
        + `    the card is the spec, not the limit you have to hit.`
    };
  }
  return null;
});

check('no-module-state', 'there is no module-level `let` or `var`', async (ctx) => {
  const code = stripComments(ctx.src);
  const m = code.match(/^(let|var)\s+[A-Za-z_$]/m);
  if (m) {
    const line = code.slice(0, m.index).split('\n').length;
    return {
      fix: `Line ${line} declares a module-level \`${m[1]}\`.\n`
        + `    A module-level variable is shared by every table and every reload, and it is\n`
        + `    invisible to the hub — which is how a game ends up with an empty board: the\n`
        + `    hub builds one copy of the state, and mount() reads a different one.\n`
        + `    Use \`const\` for anything that never changes, and keep the board in the state\n`
        + `    that init() returns.`
    };
  }
  return null;
});

check('banned-apis', 'no forbidden APIs', async (ctx) => {
  const code = stripComments(ctx.src);
  // [pattern, why]. Math.random( is banned but the bare reference is not:
  // dotreturn legitimately writes `(ctx && ctx.rng) || Math.random` as a fallback.
  const banned = [
    [/\.innerHTML\s*=/, 'innerHTML', 'Build text with createElement and textContent, not innerHTML. Everything a player types is untrusted.'],
    [/\.outerHTML\s*=/, 'outerHTML', 'Use createElement and replaceWith.'],
    [/insertAdjacentHTML/, 'insertAdjacentHTML', 'Use createElement and appendChild.'],
    [/\beval\s*\(/, 'eval', 'Write the code out instead.'],
    [/\bnew\s+Function\s*\(/, 'new Function', 'Write the code out instead.'],
    [/\bdocument\.write/, 'document.write', 'Use createElement and appendChild.'],
    [/\bfetch\s*\(/, 'fetch', 'A game may not talk to the network. Everything it needs is in its state.'],
    [/XMLHttpRequest/, 'XMLHttpRequest', 'A game may not talk to the network.'],
    [/\bWebSocket\b/, 'WebSocket', 'A game may not talk to the network.'],
    [/\bimport\s*\(/, 'a dynamic import()', 'Import at the top of the file, or not at all.'],
    [/\bhttps?:\/\//, 'a URL', 'Games must work offline. Never fetch a CDN or a font.'],
    [/\bsetInterval\s*\(/, 'setInterval', 'Use api.setInterval — the hub cancels it for you when the game closes.'],
    [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame', 'Use api.raf — the hub cancels it for you when the game closes.'],
    [/\bwindow\.addEventListener/, 'window.addEventListener', 'Attach listeners to your own elements, and let destroy() clean up.'],
    [/\bdocument\.addEventListener/, 'document.addEventListener', 'Attach listeners to your own elements, and let destroy() clean up.'],
    [/\blocalStorage\b/, 'localStorage', 'The table is short-lived. Nothing important may be persisted.'],
    [/\bdocument\.cookie\b/, 'document.cookie', 'Nothing about a game belongs in a cookie.'],
    [/\bMath\.random\s*\(/, 'Math.random()', 'Use ctx.rng, the random source the hub hands you, so a replay is reproducible.']
  ];
  for (const [re, name, why] of banned) {
    if (re.test(code)) {
      return {
        fix: `This game uses ${name}, which a game is not allowed to use.\n`
          + `    ${why}\n`
          + `    (api.setTimeout, api.setInterval and api.raf are the allowed versions.)`
      };
    }
  }
  return null;
});

check('own-folder', 'the game imports nothing but its own files', async (ctx) => {
  const code = stripComments(ctx.src);
  // The game folder is its own island: one file, no libraries, no reaching into
  // the hub or the tools that check it. This is an allowlist, not a denylist —
  // a new package, a CDN helper or a ../.. reach up all land here.
  const specs = [];
  for (const m of code.matchAll(/\bimport\s+[^'"]*from\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);

  const bad = specs.filter((s) => {
    if (!s.startsWith('.')) return true;                       // a package or a bare name
    const resolved = path.posix.normalize(path.posix.join('/x', s));
    if (resolved.startsWith('/x/../')) return true;            // climbs out of games/<id>/
    return !resolved.startsWith('/x/');
  });

  if (bad.length) {
    return {
      fix: `This game imports ${bad.map((b) => `"${b}"`).join(', ')}, which is outside its own folder.\n`
        + `    A game may only use what is in games/${ctx.id}/. It may not import a package, and it\n`
        + `    may not reach up into the hub or into scripts/ — the tools that check a game are\n`
        + `    not something a game gets to lean on.\n`
        + `    Delete the import and write the code it was used for.`
    };
  }
  return null;
});

// ------------------------------------------------------------ live ones ----

function seatCtx(state, who, card, seed) {
  const roster = card.roster || [{ id: 'p1', name: 'Alice', host: true }, { id: 'p2', name: 'Bo', host: false }];
  const me = roster.find((r) => r.id === who);
  return {
    from: { id: who, name: me ? me.name : who, host: !!(me && me.host) },
    rng: seeded(seed)
  };
}

function freshInit(card, seed) {
  const roster = card.roster || [{ id: 'p1', name: 'Alice', host: true }, { id: 'p2', name: 'Bo', host: false }];
  return card.mod.init({
    atTable: roster.map((r) => ({ ...r, game: null, spectator: false })),
    seats: roster,
    options: {},
    rng: seeded(seed)
  });
}

// The junk list is FIXED and lives here, not in the card, so a card cannot
// quietly narrow it. It is also written to be unfriendly: prototype keys,
// wrong types, out-of-range numbers, and actions aimed at a player who is
// watching.
const JUNK = [
  {}, { a: null }, { a: undefined }, { a: 123 }, { a: [] }, { a: {} }, { a: 'take' },
  { a: '__proto__' }, { a: 'constructor' }, { a: 'prototype' },
  { a: 'take', n: NaN }, { a: 'take', n: -1 }, { a: 'take', n: 0 },
  { a: 'take', n: 1e9 }, { a: 'take', n: Infinity }, { a: 'take', n: '2' },
  { a: 'take', n: null }, { a: 'take', n: [2] }, { a: 'take', n: { toString() { return '2'; } } },
  { a: 'take', __proto__: { polluted: true } }, { a: 'move', to: { x: 1, y: 2 } },
  { a: 'pass' }, { a: '' }, { a: 'take', n: 2, extra: Symbol('s') }
];

// A Set serialises to `{}` and round-trips back to `{}` — the JSON is byte for
// byte identical, so comparing strings finds nothing. What is lost is the
// BEHAVIOUR: `taken.has(x)` throws on the far side of the wire, for the second
// player only. So find the offending value by walking the state, and then
// prove the loss by replaying a scenario through the round-tripped copy.
function findNonPlain(value, at, seen) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return null;
  if (t === 'number') return Number.isFinite(value) ? null : `${at} is ${value}`;
  if (t === 'undefined') return `${at} is undefined`;
  if (t === 'function') return `${at} is a function`;
  if (t !== 'object') return `${at} is a ${t}`;
  if (value instanceof Set) return `${at} is a Set`;
  if (value instanceof Map) return `${at} is a Map`;
  if (value instanceof Date) return `${at} is a Date`;
  if (value instanceof RegExp) return `${at} is a RegExp`;
  if (!Array.isArray(value) && (value.constructor !== Object)) {
    return `${at} is a ${value.constructor ? value.constructor.name : 'class'} instance`;
  }
  // A cycle would survive JSON.stringify() as nothing at all, and would also
  // make this walk infinite. Both are the same mistake.
  seen = seen || new Set();
  if (seen.has(value)) return `${at} points back at itself (a cycle)`;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findNonPlain(value[i], `${at}[${i}]`, seen);
      if (bad) return bad;
    }
    return null;
  }
  for (const k of Object.keys(value)) {
    const bad = findNonPlain(value[k], `${at}.${k}`, seen);
    if (bad) return bad;
  }
  return null;
}

check('json-safe', 'state survives a JSON round trip', async (ctx) => {
  const sc = (ctx.card.scenarios || []).find((s) => (s.steps || []).length);
  const st = sc ? replay(ctx, sc) : freshInit(ctx, 1);

  const bad = findNonPlain(st, 'state');
  if (bad) {
    return {
      fix: `${bad}, and the state is sent between players as JSON.\n`
        + `    On the way it becomes {} — the other player gets a board that does not work,\n`
        + `    and nothing says why. It also becomes invisible to the hub's replay.\n`
        + `    State may hold only: numbers, strings, true/false, null, plain objects and\n`
        + `    plain arrays. A set of played cards is { played: ['c1', 'c2'] }, not a Set.`
    };
  }

  let wire;
  try {
    wire = JSON.parse(JSON.stringify(st));
  } catch (e) {
    return {
      fix: `The state cannot be sent over the network as JSON.\n`
        + `    ${e.message}\n`
        + `    State may hold only plain data — see the note above about sets and classes.`
    };
  }

  // And prove the loss, not just the shape: play the same scenario again from
  // the round-tripped copy and demand the same result. This is what catches a
  // value that survives JSON but changes meaning.
  if (sc) {
    let live;
    try { live = ctx.mod.summarize(st, nameOf); } catch (e) { live = '(threw)'; }
    let viaWire;
    try {
      const r = replayFrom(ctx, sc, wire);
      viaWire = ctx.mod.summarize(r, nameOf);
    } catch (e) {
      return {
        fix: `The state stopped working after being sent over the network.\n`
          + `    ${e.message.split('\n')[0]}\n`
          + `    It plays fine in memory and breaks for every other player. Something in the\n`
          + `    state is not plain data, so it arrives as something else.`
      };
    }
    if (live !== viaWire) {
      return {
        fix: `The same scenario plays differently after the state crosses the network.\n`
          + `      in memory:  ${JSON.stringify(live)}\n`
          + `      over JSON:  ${JSON.stringify(viaWire)}\n`
          + `    Something in the state does not survive the trip. Walk the state and replace\n`
          + `    anything that is not a number, string, boolean, null, plain object or array.`
      };
    }
  }
  return null;
});

check('junk-actions', 'garbage never crashes or corrupts reduce()', async (ctx) => {
  const before = freshInit(ctx, 1);
  const snapshot = JSON.stringify(before);

  for (const action of JUNK) {
    for (const who of ['p1', 'p2', 'stranger']) {
      let out;
      try {
        out = ctx.mod.reduce(before, action, seatCtx(before, who, ctx, 3));
      } catch (e) {
        return {
          fix: `reduce() threw on a junk action instead of refusing it.\n`
            + `    ${e.message.split('\n')[0]}\n`
            + `    Action: ${JSON.stringify(action)}, sent by "${who}".\n`
            + `    Any player can send any action, from any peer, at any time. reduce() must\n`
            + `    always return either a new state or { error: "..." } — never throw.`
        };
      }
      if (out === undefined || out === null) {
        return {
          fix: `reduce() returned ${out} for a junk action. It must always return either\n`
            + `    a new state object or { error: "..." }. Returning nothing leaves the hub with\n`
            + `    no next state and the game silently stops.`
        };
      }
      if (out.error !== undefined) {
        if (typeof out.error !== 'string' || !out.error) {
          return {
            fix: `reduce() refused an action with a non-string error: ${JSON.stringify(out.error)}.\n`
              + `    Use bad('a message the player can read') — the text is shown on screen.`
          };
        }
      }
    }
  }

  if (JSON.stringify(before) !== snapshot) {
    return {
      fix: `reduce() changed the state it was given.\n`
        + `    Returning a new object is required, but so is never EDITING the one you were\n`
        + `    handed: the previous state may already have been sent to another player.\n`
        + `    Use the same() helper — it copies. Never write to \`state\` directly.`
    };
  }
  if (({}).polluted !== undefined) {
    return {
      fix: `A junk action wrote to Object.prototype ("polluted" is now set).\n`
        + `    An action containing __proto__ must never be spread or assigned onto state.\n`
        + `    Pick the fields you read by name — never merge an action into state.`
    };
  }
  return null;
});

check('mount', 'mount() builds, and update() survives what the hub sends', async (ctx) => {
  const api = fakeApi('p1');
  let handle, root;
  // `document` is a global in a browser, so mount() and update() both use it
  // without being handed one. withGlobals installs it for the length of the
  // call — not just mount(), or a game that creates elements inside update()
  // would fail here for a reason that has nothing to do with the game.
  const run = (fn) => withGlobals((doc) => {
    if (!root) {
      root = doc.createElement('div');
      doc.body.appendChild(root);
      api.root = root;
    }
    return fn(root);
  });
  try {
    handle = run((r) => ctx.mod.mount(r, api));
  } catch (e) {
    return {
      fix: `mount() threw while building the screen.\n`
        + `    ${e.message.split('\n')[0]}\n`
        + `    mount() is handed an empty shadow root and must build everything it needs.`
    };
  }
  if (!handle || typeof handle.update !== 'function') {
    return {
      fix: `mount() must return an object with an "update" function.\n`
        + `    The hub calls update(view) every time the state changes. Return\n`
        + `    { update, denied, destroy }.`
    };
  }

  const st = freshInit(ctx, 4);
  let view;
  try {
    view = ctx.mod.project(st, 'p1', api);
  } catch (e) {
    return {
      fix: `project() threw on the state init() returned.\n`
        + `    ${e.message.split('\n')[0]}`
    };
  }
  if (!view || typeof view !== 'object') {
    return {
      fix: `project() must return an object — the view it hands the screen.\n`
        + `    It returned ${JSON.stringify(view)}.`
    };
  }

  try {
    run(() => handle.update(view));
  } catch (e) {
    return {
      fix: `update() threw when it was handed the view project() returned.\n`
        + `    ${e.message.split('\n')[0]}\n`
        + `    update() reads the fields you wrote in project(). If it reads a field that is\n`
        + `    not there, either project() forgot it or update() is reading the wrong name.`
    };
  }

  // A second update must fully repaint. The classic bug is leaving last turn's
  // value on screen: a stale colour nobody can explain and nothing logs.
  try {
    run(() => handle.update(view));
    run(() => handle.update(view));
  } catch (e) {
    return {
      fix: `update() threw when called twice in a row with the same view.\n`
      + `    ${e.message.split('\n')[0]}\n`
      + `    A game must be able to receive the same view more than once.`
    };
  }
  if (root.children.length === 0) {
    return {
      fix: `mount() built nothing. The screen is empty.\n`
        + `    root.appendChild(...) something. The hub hands you an empty shadow root and\n`
        + `    nothing else will ever appear.`
    };
  }
  if (typeof handle.destroy === 'function') {
    try { handle.destroy(); } catch (e) {
      return {
        fix: `destroy() threw while cleaning up.\n`
        + `    ${e.message.split('\n')[0]}\n`
        + `    It is called when the game closes. If you have nothing to clean up, return\n`
        + `    a destroy() that does nothing — not one that throws.`
      };
    }
  }
  return null;
});

// -------------------------------------------------------- scenario replay ----

// One step, in the shape a card writes it. A step is either a bare action name
// ({"a":"take"}) or { as: "p1", action: {...} }.
function stepOf(step) {
  if (step == null) return { as: 'p1', action: {} };
  if (typeof step === 'string') return { as: 'p1', action: { a: step } };
  return { as: step.as || 'p1', action: step.action || step };
}

// Replay one scenario and return the state it ends in. Shared by the four
// checks that need "where does this scenario end up", so they cannot disagree
// about how a step is read.
// Replay one scenario and return the state it ends in. Shared by the four
// checks that need "where does this scenario end up", so they cannot disagree
// about how a step is read.
//
// A throw or a refusal stops the replay and leaves the last good state. That is
// deliberate: the checks that call this are asking about the shape of the state,
// not about whether the moves are legal. When a move really is illegal the
// `scenarios` check reports it properly, with the action that caused it — much
// better than every caller reporting "the gate crashed".
function stepUntil(st, ctx, sc, limit) {
  const steps = sc.steps || [];
  for (const step of steps.slice(0, limit === undefined ? steps.length : limit)) {
    const { as, action } = stepOf(step);
    let next;
    try {
      next = ctx.mod.reduce(st, action, seatCtx(st, as, ctx, ctx.card.seed || 12345));
    } catch (e) {
      break;
    }
    if (!next || next.error !== undefined) break;
    st = next;
  }
  return st;
}

// `limit` stops early — used to ask "where is the game half way through?", which
// is a better question than "where is it before anyone has moved?".
function replay(ctx, sc, limit) {
  return stepUntil(freshInit(ctx, ctx.card.seed || 12345), ctx, sc, limit);
}

// The same replay, but from a state that has already been through JSON — the
// shape the second player actually receives.
function replayFrom(ctx, sc, wireState) {
  return stepUntil(wireState, ctx, sc, undefined);
}

check('scenarios', 'the scenarios in the card play out as written', async (ctx) => {
  const list = ctx.card.scenarios || [];
  if (!list.length) {
    return {
      fix: `The card has no scenarios, so there is nothing to test.\n`
        + `    A scenario is a list of steps and the result each one must produce — they are\n`
        + `    how anyone can tell the rules are the right rules.`
    };
  }
  const seed = ctx.card.seed || 12345;
  for (const sc of list) {
    const want = sc.expect || {};
    const steps = sc.steps || [];
    // "expect: { error: true }" is about the LAST step only. Every step before
    // it is a legal move that has to be accepted, otherwise a scenario could
    // "pass" because the game refused to start.
    const lastIsExpectedToFail = !!want.error && steps.length > 0;

    let st = freshInit(ctx, seed);
    for (let i = 0; i < steps.length; i++) {
      const { as, action } = stepOf(steps[i]);
      const isLast = i === steps.length - 1;
      let next;
      try {
        next = ctx.mod.reduce(st, action, seatCtx(st, as, ctx, seed));
      } catch (e) {
        return {
          fix: `Scenario "${sc.name}" crashed at step ${i + 1}.\n`
            + `    ${e.message.split('\n')[0]}\n`
            + `    Action: ${JSON.stringify(action)}, sent by ${as}.\n`
            + `    reduce() must always return a state or { error }, never throw.`
        };
      }
      if (next && next.error !== undefined) {
        if (isLast && lastIsExpectedToFail) break;
        return {
          fix: `Scenario "${sc.name}" was refused at step ${i + 1}: ${next.error}\n`
            + `    Action: ${JSON.stringify(action)}, sent by ${as}.\n`
            + `    ${lastIsExpectedToFail
              ? 'Every step before the last one is a move the rules allow.'
              : 'A scenario describes moves the rules allow. Either the move is wrong, or\n    reduce() is refusing something legal.'}`
        };
      }
      if (isLast && lastIsExpectedToFail) {
        return {
          fix: `Scenario "${sc.name}" says the last step should be REFUSED, but it was accepted.\n`
            + `    Action: ${JSON.stringify(action)}, sent by ${as}.\n`
            + `    reduce() must return { error: "..." } for a move the rules do not allow.`
        };
      }
      st = next;
    }

    if (!lastIsExpectedToFail && want.summarize !== undefined) {
      const line = ctx.mod.summarize(st, nameOf);
      if (line !== want.summarize) {
        return {
          fix: `Scenario "${sc.name}" ended with the wrong result.\n`
            + `      you produced: ${JSON.stringify(line)}\n`
            + `      the card wants: ${JSON.stringify(want.summarize)}\n`
            + `    The card is the spec. If you think the card is wrong, stop and say so\n`
            + `    rather than changing it — the same sentence goes onto a shared record sheet.`
        };
      }
    }
  }
  return null;
});

check('summarize-quiet', 'summarize() stays quiet until the game is over', async (ctx) => {
  // Judge this on the MIDDLE of a scenario that ends the game, not on the state
  // before it starts: "the game has not begun" is a weaker claim than "the game
  // is half over and the sheet is still empty".
  const sc = finalScenario(ctx);
  if (!sc || !(sc.steps || []).length) return null;
  const st = replay(ctx, sc, Math.max(0, sc.steps.length - 2));
  const line = ctx.mod.summarize(st, nameOf);
  if (line !== null && line !== undefined) {
    return {
      fix: `summarize() returned ${JSON.stringify(line)} before the game had even started.\n`
        + `    It must return null until the game is genuinely over — otherwise the record\n`
        + `    sheet fills with "so far" lines that can never be taken back.`
    };
  }
  return null;
});

// The card field `final: true` marks the scenario the run is judged on: one that
// actually ends the game, so summarize() has something to say. Without it a
// check cannot tell "summarize is broken" from "the game is not over yet", and
// guesses wrong in both directions.
// The scenario the run is judged on: the one that expects an actual SENTENCE,
// not the one that expects null (which is the "not over yet" case, and picking
// that would ask for a string from a game that correctly has nothing to say).
function finalScenario(ctx) {
  const list = ctx.card.scenarios || [];
  return list.find((s) => (s.expect || {}).final === true) ||
    list.find((s) => typeof (s.expect || {}).summarize === 'string');
}

check('summarize-format', 'the record sentence is short and readable', async (ctx) => {
  const sc = finalScenario(ctx);
  if (!sc) return null;      // the card has no finished game to judge
  const line = ctx.mod.summarize(replay(ctx, sc), nameOf);
  const cap = ctx.card.summarizeMaxChars || 120;

  if (line === null || line === undefined) {
    return {
      fix: `summarize() returned ${JSON.stringify(line)} for the scenario that ends the game.\n`
        + `    A finished game has to produce a sentence — it is the line that goes on the\n`
        + `    shared record sheet, and there is no undo for that.\n`
        + `    Return null only while the game is still running.`
    };
  }
  if (typeof line !== 'string') {
    return {
      fix: `summarize() returned a ${typeof line} instead of a sentence.\n`
        + `    It has to be a string once the game is over.`
    };
  }
  if (line.length > cap) {
    return {
      fix: `The record sentence is ${line.length} characters; the cap is ${cap}.\n`
        + `    It is: "${line}"\n`
        + `    Keep it to one sentence a person would want to read on a shared sheet.`
    };
  }
  for (const bad of ['undefined', '[object Object]', '{{', '}}', 'null']) {
    if (line.includes(bad)) {
      return {
        fix: `The record sentence contains "${bad}":\n    "${line}"\n`
          + `    Something reached the sentence that had no text. Names must come from\n`
          + `    nameOf(id) — never from state, and never from a player id.`
      };
    }
  }
  return null;
});

// ------------------------------------------------------------- stability ----

function nameOf(id) {
  const roster = (currentCard && currentCard.roster) || [];
  const hit = roster.find((r) => r.id === id);
  return hit ? hit.name : id;
}
let currentCard = null;

check('roundId', 'roundId() identifies one round and holds still', async (ctx) => {
  if (typeof ctx.mod.roundId !== 'function') {
    return {
      fix: `roundId() is not exported.\n`
        + `    It returns an id for the round being played, so the record sheet can tell two\n`
        + `    identical results apart instead of dropping the second one. Use 'r' + a counter\n`
        + `    that changes when a round starts.`
    };
  }
  const a = freshInit(ctx, 9);
  const b = freshInit(ctx, 9);
  let ra, rb;
  try { ra = ctx.mod.roundId(a); rb = ctx.mod.roundId(b); } catch (e) {
    return { fix: `roundId() threw: ${e.message.split('\n')[0]}` };
  }
  if (typeof ra !== 'string' || !ra) {
    return { fix: `roundId() must return a non-empty string, not ${JSON.stringify(ra)}.` };
  }
  if (ra !== rb) {
    return {
      fix: `roundId() gave two different answers for two states built the same way\n`
        + `    (${JSON.stringify(ra)} and ${JSON.stringify(rb)}).\n`
        + `    It has to be stable while a round is being played, and only change when a new\n`
        + `    round starts.`
    };
  }
// And it must actually move, or every round is "the same round" forever and
  // the record sheet drops every result after the first. A game with no way to
  // start a new round in any scenario cannot be asked this, so only ask when
  // one exists — demanding a change from a game that never starts a new round
  // would push a builder into inventing a counter nobody asked for.
  const restart = (ctx.card.scenarios || []).find((s) =>
    (s.steps || []).some((st) => {
      const a = (typeof st === 'string' ? st : (st.action && st.action.a)) || st;
      return a === 'reset' || a === 'next' || a === 'again' || a === 'newgame' || a === 'restart';
    }));
  if (restart) {
    const before = ctx.mod.roundId(freshInit(ctx, ctx.card.seed || 12345));
    const after = ctx.mod.roundId(replay(ctx, restart));
    if (after === before) {
      return {
        fix: `roundId() returned ${JSON.stringify(after)} before and after a game was reset.\n`
          + `    It has to change when a new round starts, or the record sheet throws away every\n`
          + `    result after the first one — two players scoring 3 both get written as one row.`
      };
    }
  }
  return null;
});

check('determinism', 'the same seed always plays the same game', async (ctx) => {
  const sc = (ctx.card.scenarios || []).find((s) => (s.steps || []).length);
  if (!sc) return null;
  const play = () => ctx.mod.summarize(replay(ctx, sc), nameOf);
  const one = play();
  const two = play();
  if (one !== two) {
    return {
      fix: `The same scenario played twice gave two different results\n`
        + `    (${JSON.stringify(one)} then ${JSON.stringify(two)}).\n`
        + `    Use ctx.rng for every random choice. Math.random() is not reproducible, which is\n`
        + `    why the hub hands you ctx.rng instead.`
    };
  }
  return null;
});

check('no-leaks', 'project() does not leak what the card hides', async (ctx) => {
  const hidden = ctx.card.hidden || [];
  if (!hidden.length) return null;
  const st = freshInit(ctx, ctx.card.seed || 12345);
  let view;
  try { view = ctx.mod.project(st, 'p1', fakeApi('p1')); } catch (e) {
    return { fix: `project() threw: ${e.message.split('\n')[0]}` };
  }
  const leaked = hidden.filter((d) => getPath(view, d) !== undefined);
  if (leaked.length) {
    return {
      fix: `project() is sending ${leaked.join(', ')} to the player, but the card says it is\n`
        + `    hidden. Anything a player must not see has to be stripped in project() — the UI\n`
        + `    paints whatever you hand it, and another player reads the same snapshot.\n`
        + `    Build the view field by field instead of spreading all of state into it.`
    };
  }
  return null;
});

// ------------------------------------------------------------------- run ----

// `root` is injectable so the gate's own fixtures — deliberately broken games —
// can be judged from tests/gate_fixtures/ without being shipped in games/.
async function checkOne(id, root) {
  const base = root || ROOT;
  const cardRes = loadCard(id, base);
  if (cardRes.error) return { fatal: cardRes.error };

  const srcFile = path.join(base, 'games', id, 'index.js');
  if (!fs.existsSync(srcFile)) return { fatal: `no game at games/${id}/index.js` };

  currentCard = cardRes;
  const ctx = { id, card: cardRes, src: fs.readFileSync(srcFile, 'utf8'), srcFile, mod: null };

  const failures = [];
  for (const c of checks) {
    let res = null;
    try {
      res = await c.fn(ctx);
    } catch (e) {
      // A check that blows up is itself the finding. Say so, do not hide it.
      res = { fix: `The gate's own "${c.title}" check threw: ${e.message}\n    This is a bug in the gate, not in the game.` };
    }
    if (res) failures.push({ id: c.id, title: c.title, fix: res.fix });
    // If the module did not load there is no game to check, and running the
    // other fourteen against null would report fourteen invented failures on
    // top of the one that matters. A file that cannot be imported is the whole
    // story; stop there.
    if (c.id === 'load' && res) break;
  }
  return { failures, card: cardRes };
}

function report(id, failures, color, verbose) {
  const G = process.stdout.isTTY;
  const red = (s) => (G ? `\x1b[31m${s}\x1b[0m` : s);
  const dim = (s) => (G ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = (s) => (G ? `\x1b[1m${s}\x1b[0m` : s);

  console.log('');
  console.log(bold(`FAIL`) + `  gate:games/${id}`);
  if (!failures.length) return;
  // First-failure-only is the default, because a wall of red is noise to a
  // weak model. --verbose shows everything, which is what a human debugging the
  // gate itself needs.
  const shown = verbose ? failures : [failures[0]];
  for (const f of shown) {
    console.log('');
    console.log(dim(`  ✗ ${f.id} — ${f.title}`));
    for (const line of f.fix.split('\n')) console.log('  ' + (line.startsWith('    ') ? line.slice(4) : line));
  }
  console.log('');
  const rest = failures.length - shown.length;
  if (rest > 0) {
    console.log(dim(`  ${rest} other check${rest === 1 ? '' : 's'} also failed.`));
    console.log(dim(`  Fix this one and run the gate again.`));
    console.log('');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const verbose = argv.includes('--verbose') || argv.includes('-v');
  const args = argv.filter((a) => a !== '--verbose' && a !== '-v');
  if (!args.length) {
    console.error('usage: node scripts/check-game.mjs <id> [--verbose] | --all [--verbose]');
    process.exit(2);
  }
  const ids = args[0] === '--all' ? gameIds() : args;
  let worst = 0;
  for (const id of ids) {
    const { fatal, failures } = await checkOne(id);
    if (fatal) {
      console.error(`FAIL  gate:games/${id}\n\n  ${fatal}\n`);
      worst = 2;
      continue;
    }
    if (failures.length) { report(id, failures, null, verbose); worst = 1; }
    else {
      const G = process.stdout.isTTY;
      console.log(`${G ? '\x1b[32mPASS\x1b[0m' : 'PASS'}  gate:games/${id}`);
    }
  }
  process.exit(worst);
}

function gameIds() {
  const dir = path.join(ROOT, 'games');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'scenarios.json'))).sort();
}

// Exported so tests/gate_test.mjs can judge the gate itself. Running this file
// directly is still the normal path.
export { checkOne, gameIds, checks as GATE_CHECKS, ROOT as GATE_ROOT };

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();