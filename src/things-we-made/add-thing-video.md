# Adding a video to "Some Things Bubs Have Made"

Drop a video file into `src/things-we-made/` and it shows up automatically — no HTML wrapper, no `src/main.js` edit needed per video. The hub globs `./things-we-made/*.{html,mp4,webm,ogv}` and plays videos directly in the stage.

## 1. Convert the phone MOV (recommended)

iPhone MOV is often HEVC, which most browsers won't play. MP4 (H.264 + AAC) is the safest universal format.

```bash
ffmpeg -i src/things-we-made/IMG_4860.MOV -c:v libx264 -crf 23 -c:a aac -movflags +faststart src/things-we-made/IMG_4860.mp4
```

The menu title derives from the filename (`IMG_4860` → "Img 4860"). Use dashes/underscores for multi-word titles.

## 2. Verify

```bash
bun run dev
# open hub, dismiss the name modal, click the thing button, confirm the video loads and plays
```

## 3. Test + ship

```bash
bun run test --skip-browser   # offline; full suite needs Playwright + Chromium
git add src/things-we-made/
git commit -m "things: add IMG_4860 video"
git push                      # pushes main -> deploys to https://bubhub.us
```

## Never do
- Commit a raw `.mov` larger than ~100 MB (GitHub hard limit) — convert to MP4 first
- Push a video over ~20 MiB — Cloudflare Workers caps static assets at 25 MiB, so wrangler deploy will fail and the site stays on the last good deploy. Re-encode smaller (lower crf, 720p) if needed.
- Commit `dist/`, `node_modules/`, `.wrangler/`, or the Cloudflare token
- Regenerate `bun.lock` with anything but bun 1.2.15
- Add an `.html` wrapper per video (obsolete; the hub plays videos directly now)
