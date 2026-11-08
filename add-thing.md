# Adding a thing to "Some Things Bubs Have Made"

Drop any supported file into `src/things-we-made/` and it shows up automatically as a menu button — no `src/main.js` edit, no HTML wrapper, no per-file setup. The hub globs `./things-we-made/*.{html,mp4,webm,ogv,svg,png,jpg,jpeg,webp,gif,md}` and opens each in the stage.

## What goes where

| File type | What shows up | Notes |
|---|---|---|
| `.md` | Plain text (poems, notes) | Filename becomes the title; line breaks preserved |
| `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | Image | Scaled to fit the stage frame |
| `.mp4`, `.webm`, `.ogv` | Video | Plays inline with controls |
| `.html` | Iframe app | Legacy "thing" apps (the braid record, etc.) |

## Video: convert phone MOV first

iPhone MOV is often HEVC (won't play everywhere) and easily too large. Convert to MP4 (H.264 + AAC) and keep it under ~20 MiB — Cloudflare Workers caps static assets at 25 MiB, and `wrangler deploy` will fail over it, leaving the site on the last good deploy.

```bash
ffmpeg -i src/things-we-made/IN.MOV -c:v libx264 -crf 30 -vf scale=720:1280 -c:a aac -b:a 96k -movflags +faststart src/things-we-made/OUT.mp4
```

- Lower the resolution (`scale=720:1280`) or raise `-crf` (30–35) to shrink further.
- Keep the source `.MOV` on your disk only — it's gitignored (`src/things-we-made/*.mov`) so it never gets committed.

## Images

Drop `.png`/`.jpg`/`.webp`/`.gif`/`.svg` directly. Keep files reasonable (a few MB max) so the page stays snappy.

## Markdown (poems, notes)

Drop a `.md` file. Its filename becomes the menu title (`a-short-poem.md` → "A Short Poem"). Use dashes/underscores for multi-word titles. Line breaks are preserved, so it works well for poems.

## Curation mode (host sends guests to a thing)

When the host checks **Curation** and hosts a room, the lobby game buttons become "send everyone to this table" controls. Things now appear there too, so the host can send all guests to a video, image, or poem:

- Open the room, turn on **Curation**, and a **"Send guests to a thing"** group appears under the game tables with one button per thing.
- Clicking a thing opens it on the host, sets curation to that thing, and broadcasts it to every guest so they open the same thing.
- Click **Waiting screen — clear tables** to clear the curation (guests leave the thing).

Guests can't open tables while curated — the host drives what everyone sees.

## Verify

```bash
bun run dev
# open hub, dismiss the name modal, click your thing's button, confirm it opens
```

## Test + ship

```bash
bun run test --skip-browser   # offline; full suite needs Playwright + Chromium
git add src/things-we-made/
git commit -m "things: add <your thing>"
git push                      # pushes main -> deploys to https://bubhub.us
```

## Never do
- Commit a raw `.mov` larger than ~100 MB (GitHub hard limit) — convert to MP4 first
- Push a video over ~20 MiB (Cloudflare Workers 25 MiB asset cap)
- Commit `dist/`, `node_modules/`, `.wrangler/`, or the Cloudflare token
- Regenerate `bun.lock` with anything but bun 1.2.15
- Add an `.html` wrapper per video/image/markdown (obsolete; the hub opens them directly)
