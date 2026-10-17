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

`games/dotreturn/` is the one real module game, with its own harness and
tests — copy it to start a new one. The six exports every module game needs
(`meta`, `init`, `reduce`, `project`, `mount`, `summarize`, plus the optional
`roundId` and `prune`) are listed in the contract table above.

Two contract details worth knowing before you write rules: `ctx.from.host`
tells a reduce whether the sender hosts the table (a solo room has a host), so
gate anything the whole table shares on it; and export `prune(state, goneId)`
if your state keeps its own membership, or a player who leaves still holds a
seat — which deadlocks any round that waits for everyone.

**`games/hook/library.js` is a growing library, on purpose.** Its `PAIRS` array
is hand-curated: new pairs are pasted in from `games/hook/phrase-builder.html` as
they come up, and they ship straight to production. So nothing may depend on how
many there are — `dealPair()` shuffles whatever is in the list and the hook tests
read `PAIRS.length` instead of a number. Adding a batch of pairs is a content
change, not a code change: commit and push them, and do not touch the tests.

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

**The live site is <https://bubhub.us>. There is no thebubhub.com — if you ever
see that domain, it is a typo, not a deploy target.** Pushing to `main` is a
release: the Pages workflow publishes on every push, and a failed build means
the live site keeps serving the last good deployment. `wrangler.jsonc` holds the
Cloudflare Worker used by the manual path below; `thebubhub` there is the
*worker's name*, not a domain.

To publish without pushing:

```bash
bun install
bun run build
# verify dist/ BEFORE publishing: serve it and drive it with Playwright
(cd dist && python3 -m http.server 5180)
CLOUDFLARE_API_TOKEN="$(cat ~/.config/bubhub/cloudflare-token)" bunx wrangler deploy
```

### The lockfile is a contract with CI

CI runs `bun install --frozen-lockfile` with **bun 1.2.15** (pinned in
`.bun-version`). `bun install` writes `bun.lock` in whatever format the *local*
bun writes, and bun 1.3+ writes `lockfileVersion: 2`, which 1.2.15 cannot parse —
that is a hard build failure on every push, from a commit that changed no
dependencies. It happened here once already.

- Run `bun install` with the pinned bun (1.2.15 is the default `bun` on this
  machine; 1.4.3 is aliased `bun-1.4.3` and must **not** install in this repo).
- `tests/lockfile_test.py` fails the suite if `bun.lock`'s version drifts from
  the pin, and it runs the real `bun install --frozen-lockfile` to prove it.
- To regenerate: `rm bun.lock && bun install && git add bun.lock`.

**The credential lives at `~/.config/bubhub/cloudflare-token`, outside the repo,
and nowhere else.** Never write a token into a tracked file, never echo one, and
never paste one into chat or a commit. `tests/secrets_test.py` fails the suite if
one appears in anything git would commit; keep it that way. It carries Workers
Scripts: Edit and Zone → Cache Purge.

Deploying changes hashed asset filenames. Anyone holding a cached page needs
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>; `dist/` is gitignored.

## Gotchas that have actually bitten

- **Do not feature-detect `import.meta.glob` at runtime.** Vite replaces the
  call at build time, so any `typeof import.meta.glob === 'function'` guard is
  always false in production and every module game vanishes silently. The
  surrounding `try`/`catch` is the fallback for a non-Vite context.
- **Never regenerate `bun.lock` with a newer bun.** See the lockfile note above;
  it breaks the Workers build for every future push.
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
- `bun.lock` is committed — reproducible builds matter more than a tidy status,
  and it must stay in the format the pinned bun writes.
- Do not commit or push unless asked. Because pushing `main` deploys, ask
  whether to publish before you push — "commit this" is not "ship it". The order
  that works: work → `bun run test` → commit → (ask) → push → verify the live
  site rather than trusting the build output.