# Adding a thing to "Some Things Bubs Have Made"

Drop any supported file into `src/things-we-made/` (or a subfolder of it) and it shows up automatically as a menu button — no `src/main.js` edit, no HTML wrapper, no per-file setup. The hub globs `./things-we-made/**/*.{html,mp4,webm,ogv,svg,png,jpg,jpeg,webp,gif,mp3,wav,md}` and opens each in the stage. Subfolders become collapsible groups in the menu.

## What goes where

| File type | What shows up | Notes |
|---|---|---|
| `.md` | Plain text (poems, notes) | Filename becomes the title; line breaks preserved |
| `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | Image | Scaled to fit the stage frame |
| `.mp4`, `.webm`, `.ogv` | Video | Plays inline with controls |
| `.mp3`, `.wav` | Audio | Plays inline with controls; tracks in the same folder play through in name order |
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

Drop a `.md` file. Its filename becomes the menu title (`a-short-poem.md` → "A Short Poem"). Use dashes/underscores for multi-word titles. Standard Markdown (headings, lists, bold/italic, code, links, blockquotes) is rendered, in Courier Prime.

## Audio (songs, albums)

Drop `.mp3`/`.wav` files. Each becomes a track button that opens an audio player with controls. Tracks in the same folder play through in name order (Prev/Next and auto-advance on end). A folder also gets a "Play all" button that plays every audio file in that folder and its subfolders.

## Subfolders (albums)

Create a folder under `src/things-we-made/` and drop files into it. The folder shows up as a collapsible group in the menu (collapsed by default), with its own title derived from the folder name. Nest folders as deeply as you like (e.g. `src/things-we-made/album/disc-1/track.mp3`). Top-level files still appear at the top of the list.


## Never do
- Commit a raw `.mov` larger than ~100 MB (GitHub hard limit) — convert to MP4 first
- Push a video over ~20 MiB (Cloudflare Workers 25 MiB asset cap)
- Commit `dist/`, `node_modules/`, `.wrangler/`, or the Cloudflare token
- Regenerate `bun.lock` with anything but bun 1.2.15
- Add an `.html` wrapper per video/image/markdown (obsolete; the hub opens them directly)
