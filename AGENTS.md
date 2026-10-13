# AGENTS.md — working on Bub Hub

Read this before changing anything. It is the short version of what the long
`README.md` explains, plus the things that are easy to get wrong.

## What this is

A peer-to-peer arcade in the browser. The **hub** (`src/main.js`) owns identity,
rooms, chat, invites, seating, networking and the record sheet. A **game** is
just rules and pixels and must never do any of that itself.

Two kinds of game:

| | Module game (use this) | Legacy iframe game |
|---|---|---|
| Lives in | `games/<id>/index.js` | `public/<name>.html` |
| Registered by | dropping it in `games/` | one line in `public/games.js` |
| Reaches the hub via | `api.send()` → `reduce()` → `project()` | a `postMessage` bridge |
| Test it with | a `dev.html` harness | open the file |

`games/example/index.js` is a complete, commented reference. `games/dotreturn/`
is a real one with its own harness and tests.

## The loop

```bash
bun run test          # everything: syntax, secrets, record sentences, rules, play tests
bun run test:syntax   # offline, no browser needed
```

**Always run `bun run test` before you say you are done.** Eight suites; the
browser ones need Playwright + Chromium (`pip install playwright &&
playwright install chromium`). A new test belongs in `test.sh` in the same
commit as the code it covers — an unwired test is a test nobody runs.

To actually *play* a module game you are changing, use its harness:

```bash
bun run serve   # or: python3 -m http.server 5173
# http://localhost:5173/games/dotreturn/dev.html
```

That imports the real `index.js` behind a fake hub. Edit, hit F5, play. Copy
`games/dotreturn/dev.html` when you add a game. Two rules: never send anything
from inside `mount()` (the hub has not assigned the handle yet — send from the
first `update()`), and never let an intent sent mid-frame start a second
`requestAnimationFrame` loop.

## Deploying

Deployment is independent of git — `wrangler deploy` publishes `dist/` straight
to the live site, so a deploy does not need a commit and a commit does not deploy
anything.

```bash
bun install
bun run build
# verify dist/ BEFORE publishing: serve it and drive it with Playwright
(cd dist && python3 -m http.server 5180)
CLOUDFLARE_API_TOKEN="$(cat ~/.config/bubhub/cloudflare-token)" bunx wrangler deploy
```

**The credential lives at `~/.config/bubhub/cloudflare-token`, outside the repo,
and nowhere else.** Never write a token into a tracked file, never echo one, and
never paste one into chat or a commit. `tests/secrets_test.py` fails the suite if
one appears in anything git would commit; keep it that way.

The token has Workers Scripts: Edit. It does **not** have Zone → Cache Purge, so
after a deploy the edge can serve the previous `index.html` for up to a minute —
check again before assuming a deploy failed.

Deploying changes hashed asset filenames. Anyone holding a cached page needs
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>; `dist/` is gitignored.

## Gotchas that have actually bitten

- **Do not feature-detect `import.meta.glob` at runtime.** Vite replaces the
  call at build time, so any `typeof import.meta.glob === 'function'` guard is
  always false in production and every module game vanishes silently. The
  surrounding `try`/`catch` is the fallback for a non-Vite context.
- **A shadow root lives on `.stage-host`**, not on `#game-stage` —
  `document.querySelector('#game-stage .stage-host').shadowRoot`.
- **First visit shows a blocking name modal.** Any browser test against the hub
  shell has to dismiss it before it can click a game button.
- **The contract has no tick.** State changes only through `reduce()`. A
  continuous game integrates locally and asks the host for anything that must be
  agreed on — see the Dot Return note in the README.
- `python3 -m http.server` does **not** serve the hub (no `import.meta.glob`, and
  `public/` is not at the root). It does serve a game harness.

## Git

- One logical change per commit, in the repo's voice: a short lowercase subject
  (`registry: …`, `dotreturn: …`) and a body that says what broke and why.
- Never commit `dist/`, `node_modules/`, `.wrangler/` or credentials.
- `bun.lock` is committed — reproducible builds matter more than a tidy status.
- Do not commit or push unless asked. If asked to sync, the useful order is:
  work → `bun run test` → commit → push → deploy (only when deploying was asked
  for), and then verify the live site rather than trusting the deploy output.