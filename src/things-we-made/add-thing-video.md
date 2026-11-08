# Adding a video to "Some Things Bubs Have Made"

Hub section reads `src/things-we-made/*.html` only — a raw .mov/.mp4 won't show up.
Use an HTML wrapper per video. Zero changes to src/main.js.

## 1. Convert the phone MOV (recommended)
ffmpeg -i src/things-we-made/IMG_4860.MOV -c:v libx264 -crf 23 -c:a aac -movflags +faststart src/things-we-made/IMG_4860.mp4

MOV plays if H.264; iPhone HEVC MOV may not work everywhere. MP4 H.264 is safest.

## 2. Create the wrapper src/things-we-made/IMG_4860.html
<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>IMG_4860</title>
<style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh}video{max-width:100%;max-height:100%;outline:none}</style>
<body><video src="./IMG_4860.mp4" controls autoplay playsinline></video></body>

Menu title derives from filename ("IMG_4860" → "Img 4860"). Use dashes for multi-word titles.

## 3. Verify
bun run dev
# open hub, dismiss name modal, click the thing button, confirm video plays

## 4. Test + ship
bun run test --skip-browser        # offline; full suite needs Playwright + Chromium
git add src/things-we-made/
git commit -m "things: add IMG_4860 video"
git push                           # pushes main -> deploys to https://bubhub.us

## Never do
- Edit src/main.js glob/thingTitle/openThing for this task
- Commit dist/, node_modules/, .wrangler/, or the Cloudflare token
- Regenerate bun.lock with anything but bun 1.2.15
