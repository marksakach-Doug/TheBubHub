// Câu Phá — a Vietnamese sentence-building & absurd-picture grammar game (VietGames standalone, solo).
// Keeps the Bub Hub module contract (init/reduce/project/mount/summarize/roundId/prune) and is driven by ./harness.js.
// Zero English, zero visual cues on tiles: every tile is plain Vietnamese text.
// Submitting a sentence produces one of three outcomes from the interpreter:
//   1. 'goal'      (Đúng rồi!)     -> matches the mục tiêu picture, +1 star, advances the growing chain.
//   2. 'absurd'    (Câu phá! +½)   -> grammatically valid Vietnamese (swapped roles or swapped adjectives), draws the absurd scene, +0.5 star bonus!
//   3. 'gibberish' (Sai rồi! -1❤️) -> tiles turn red and shake violently, then the misplaced grammar tile WHIPS in a high arc into its valid syntactic slot.

const LW=640,LH=360,GY=270,INK='#223',EF='"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const cl=(v,a,b)=>v<a?a:v>b?b:v;
function mb(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hh(i,s){let n=Math.imul(i+7,374761393)^Math.imul(s+3,668265263);n=Math.imul(n^n>>>13,1274126177);n^=n>>>16;return(n>>>0)/4294967296}

// ===== Hand-drawn sprites (generated from the Design canvas SVGs; replaces emoji) =====
// Each sprite: vb = square viewBox size, gy = ground line (creatures/foods), o = draw ops.
// ops: p=path(d) e=ellipse[cx,cy,rx,ry] r=rect[x,y,w,h,rx] x=text; f=fill s=stroke(0=none) w=lineWidth o=opacity m=matrix
const SPR={"mèo":{"vb":120,"o":[{"t":"p","d":"M92 84q22-6 14-34","w":9.0},{"t":"p","d":"M92 84q22-6 14-34","s":"#f2a65a","w":5.0},{"t":"e","a":[60.0,84.0,28.0,24.0],"f":"#f2a65a"},{"t":"p","d":"M36 34l4-20 16 12zM84 34l-4-20-16 12z","f":"#f2a65a"},{"t":"e","a":[60.0,52.0,28.0,24.0],"f":"#f2a65a"},{"t":"p","d":"M52 30v8M60 28v8M68 30v8","w":3.0},{"t":"e","a":[49.0,50.0,7.0,7.0],"f":"#fff","w":3.0},{"t":"e","a":[71.0,50.0,7.0,7.0],"f":"#fff","w":3.0},{"t":"e","a":[50.0,52.0,3.0,3.0],"f":"#223","s":0},{"t":"e","a":[70.0,52.0,3.0,3.0],"f":"#223","s":0},{"t":"p","d":"M56 60h8l-4 4z","f":"#ff8aa0","w":2.0},{"t":"p","d":"M30 58l-14-3M30 64l-14 4M90 58l14-3M90 64l14 4M52 68q8 6 16 0","w":2.5}],"gy":110},"chó":{"vb":120,"o":[{"t":"e","a":[60.0,86.0,28.0,24.0],"f":"#c49a6c"},{"t":"e","a":[32.0,50.0,11.0,20.0],"f":"#7a4b27","m":[0.9781,0.2079,-0.2079,0.9781,11.0949,-5.5606]},{"t":"e","a":[88.0,50.0,11.0,20.0],"f":"#7a4b27","m":[0.9781,-0.2079,0.2079,0.9781,-8.4726,19.3888]},{"t":"e","a":[60.0,52.0,26.0,26.0],"f":"#c49a6c"},{"t":"e","a":[60.0,64.0,14.0,10.0],"f":"#ecd5ae"},{"t":"e","a":[60.0,59.0,6.0,4.0],"f":"#223"},{"t":"e","a":[48.0,46.0,6.0,6.0],"f":"#fff","w":3.0},{"t":"e","a":[72.0,46.0,6.0,6.0],"f":"#fff","w":3.0},{"t":"e","a":[49.0,48.0,2.6,2.6],"f":"#223","s":0},{"t":"e","a":[71.0,48.0,2.6,2.6],"f":"#223","s":0},{"t":"p","d":"M54 70q6 4 12 0v8q-6 6-12 0z","f":"#ff7a9a","w":3.0}],"gy":110},"voi":{"vb":120,"o":[{"t":"e","a":[60.0,88.0,32.0,24.0],"f":"#9aa7b4"},{"t":"e","a":[26.0,54.0,19.0,19.0],"f":"#b8c3cd"},{"t":"e","a":[94.0,54.0,19.0,19.0],"f":"#b8c3cd"},{"t":"e","a":[60.0,54.0,26.0,26.0],"f":"#9aa7b4"},{"t":"p","d":"M60 62q0 30-20 30q-6 0-6-8","w":16.0},{"t":"p","d":"M60 62q0 30-20 30q-6 0-6-8","s":"#9aa7b4","w":9.0},{"t":"e","a":[49.0,48.0,6.0,6.0],"f":"#fff","w":3.0},{"t":"e","a":[71.0,48.0,6.0,6.0],"f":"#fff","w":3.0},{"t":"e","a":[50.0,50.0,2.6,2.6],"f":"#223","s":0},{"t":"e","a":[70.0,50.0,2.6,2.6],"f":"#223","s":0}],"gy":110},"rắn":{"vb":120,"o":[{"t":"p","d":"M14 102Q56 108 58 84T92 68Q108 62 104 46","w":24.0},{"t":"p","d":"M14 102Q56 108 58 84T92 68Q108 62 104 46","s":"#5cb85c","w":16.0},{"t":"e","a":[104.0,38.0,16.0,16.0],"f":"#5cb85c"},{"t":"e","a":[98.0,34.0,5.5,5.5],"f":"#fff","w":3.0},{"t":"e","a":[111.0,34.0,5.5,5.5],"f":"#fff","w":3.0},{"t":"e","a":[99.0,35.0,2.4,2.4],"f":"#223","s":0},{"t":"e","a":[110.0,35.0,2.4,2.4],"f":"#223","s":0},{"t":"p","d":"M104 52v10l-4 4m4-4l4 4","s":"#e11d48","w":3.0}],"gy":110},"rồng":{"vb":120,"o":[{"t":"p","d":"M38 72l-28-26 6 32zM82 72l28-26-6 32z","f":"#81c784"},{"t":"e","a":[60.0,84.0,26.0,24.0],"f":"#4caf50"},{"t":"p","d":"M46 32l-4-16 12 8zM74 32l4-16-12 8z","f":"#ffd166"},{"t":"e","a":[60.0,50.0,22.0,22.0],"f":"#4caf50"},{"t":"e","a":[60.0,60.0,13.0,9.0],"f":"#a5d6a7"},{"t":"e","a":[50.0,44.0,6.0,6.0],"f":"#fff","w":3.0},{"t":"e","a":[70.0,44.0,6.0,6.0],"f":"#fff","w":3.0},{"t":"e","a":[51.0,46.0,2.6,2.6],"f":"#223","s":0},{"t":"e","a":[69.0,46.0,2.6,2.6],"f":"#223","s":0},{"t":"p","d":"M80 62q20-6 30 4q-12 2-12 10q-10-6-18-6z","f":"#ff7a3d","w":3.0}],"gy":110},"thỏ":{"vb":120,"o":[{"t":"e","a":[90.0,98.0,8.0,8.0],"f":"#fff"},{"t":"e","a":[60.0,88.0,26.0,22.0],"f":"#e2e8f0"},{"t":"e","a":[46.0,24.0,9.0,22.0],"f":"#e2e8f0"},{"t":"e","a":[74.0,24.0,9.0,22.0],"f":"#e2e8f0"},{"t":"e","a":[46.0,26.0,4.0,15.0],"f":"#ffb3c6","s":0},{"t":"e","a":[74.0,26.0,4.0,15.0],"f":"#ffb3c6","s":0},{"t":"e","a":[60.0,58.0,24.0,24.0],"f":"#e2e8f0"},{"t":"e","a":[50.0,54.0,6.0,6.0],"f":"#fff","w":3.0},{"t":"e","a":[70.0,54.0,6.0,6.0],"f":"#fff","w":3.0},{"t":"e","a":[51.0,56.0,2.6,2.6],"f":"#223","s":0},{"t":"e","a":[69.0,56.0,2.6,2.6],"f":"#223","s":0},{"t":"p","d":"M57 63h6l-3 4z","f":"#ff8aa0","w":2.0},{"t":"r","a":[55.0,68.0,10.0,9.0,2.0],"f":"#fff","w":3.0}],"gy":110},"chim":{"vb":120,"o":[{"t":"p","d":"M50 100v10M68 100v10","s":"#ffb020"},{"t":"e","a":[58.0,70.0,32.0,32.0],"f":"#60a5fa"},{"t":"e","a":[52.0,80.0,20.0,17.0],"f":"#dbeafe","s":0},{"t":"p","d":"M72 64q24 4 18 28q-24 0-18-28z","f":"#3b82f6"},{"t":"p","d":"M30 62l-20 8 20 8z","f":"#ffb020"},{"t":"p","d":"M52 40q-4-14 8-12q4 8-4 14","f":"#3b82f6"},{"t":"e","a":[46.0,58.0,7.0,7.0],"f":"#fff","w":3.0},{"t":"e","a":[44.0,59.0,3.0,3.0],"f":"#223","s":0}],"gy":110},"cua":{"vb":120,"o":[{"t":"p","d":"M32 70L22 56M88 70l10-14M30 90l-14 8M34 98l-8 12M90 90l14 8M86 98l8 12","w":5.0},{"t":"e","a":[20.0,46.0,13.0,13.0],"f":"#ef4444"},{"t":"e","a":[100.0,46.0,13.0,13.0],"f":"#ef4444"},{"t":"e","a":[60.0,80.0,36.0,22.0],"f":"#ef4444"},{"t":"p","d":"M48 62v-14M72 62v-14"},{"t":"e","a":[48.0,42.0,8.0,8.0],"f":"#fff","w":3.0},{"t":"e","a":[72.0,42.0,8.0,8.0],"f":"#fff","w":3.0},{"t":"e","a":[49.0,44.0,3.0,3.0],"f":"#223","s":0},{"t":"e","a":[71.0,44.0,3.0,3.0],"f":"#223","s":0},{"t":"p","d":"M50 82q10 8 20 0","w":3.0}],"gy":110},"gà":{"vb":120,"o":[{"t":"p","d":"M46 100v12M68 100v12","s":"#ffb020"},{"t":"p","d":"M84 62q20 0 18 16q-16-2-18-16z","f":"#fff"},{"t":"e","a":[60.0,80.0,30.0,24.0],"f":"#fff"},{"t":"p","d":"M58 76q22 0 22 18q-22 2-22-18z","f":"#e5e7eb"},{"t":"e","a":[46.0,48.0,19.0,19.0],"f":"#fff"},{"t":"p","d":"M38 32q0-14 8-6q2-10 8-2q6-2 4 10z","f":"#ef4444"},{"t":"p","d":"M28 48l-16 4 16 6z","f":"#ffb020"},{"t":"p","d":"M32 60q2 10 8 4z","f":"#ef4444","w":2.5},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[1,0,0,1,45.0,44.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[1,0,0,1,45.0,44.0]}],"gy":110},"lợn":{"vb":120,"o":[{"t":"p","d":"M90 86q14-4 8-14q-8-4-6 2"},{"t":"e","a":[60.0,88.0,30.0,22.0],"f":"#f9a8c9"},{"t":"p","d":"M38 38l-8-20 18 8zM82 38l8-20-18 8z","f":"#f58bb5"},{"t":"e","a":[60.0,58.0,26.0,26.0],"f":"#f9a8c9"},{"t":"e","a":[60.0,68.0,14.0,10.0],"f":"#f58bb5"},{"t":"e","a":[55.0,68.0,2.2,2.2],"f":"#223","s":0},{"t":"e","a":[65.0,68.0,2.2,2.2],"f":"#223","s":0},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[1,0,0,1,46.0,52.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[1,0,0,1,46.0,52.0]},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[1,0,0,1,74.0,52.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[1,0,0,1,74.0,52.0]}],"gy":110},"hạc":{"vb":120,"o":[{"t":"p","d":"M54 98v20M66 98v16"},{"t":"p","d":"M78 76Q98 60 80 40Q66 24 70 16","w":15.0},{"t":"p","d":"M78 76Q98 60 80 40Q66 24 70 16","s":"#f4a4c0","w":8.0},{"t":"e","a":[58.0,82.0,30.0,20.0],"f":"#f4a4c0"},{"t":"p","d":"M40 80q18 14 36-2q-18-4-36 2z","f":"#f78fb3"},{"t":"e","a":[68.0,16.0,9.0,9.0],"f":"#f4a4c0"},{"t":"p","d":"M74 14l18 8-16 4z","f":"#ffd9b0"},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[0.6,0.0,0.0,0.6,66.0,14.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[0.6,0.0,0.0,0.6,66.0,14.0]}],"gy":110},"quạ":{"vb":120,"o":[{"t":"p","d":"M52 100v12M68 100v12"},{"t":"p","d":"M84 84l22 10-24 2z","f":"#475569"},{"t":"e","a":[60.0,76.0,30.0,30.0],"f":"#475569"},{"t":"p","d":"M60 70q24 0 22 22q-24 4-22-22z","f":"#334155"},{"t":"e","a":[44.0,48.0,20.0,20.0],"f":"#475569"},{"t":"p","d":"M26 46l-20 8 22 8z","f":"#94a3b8"},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[1,0,0,1,44.0,42.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[1,0,0,1,44.0,42.0]}],"gy":110},"khỉ":{"vb":120,"o":[{"t":"p","d":"M90 92q26-6 16-34","w":9.0},{"t":"p","d":"M90 92q26-6 16-34","s":"#a0693a","w":5.0},{"t":"e","a":[60.0,88.0,26.0,22.0],"f":"#a0693a"},{"t":"e","a":[30.0,50.0,10.0,10.0],"f":"#a0693a"},{"t":"e","a":[90.0,50.0,10.0,10.0],"f":"#a0693a"},{"t":"e","a":[60.0,54.0,26.0,26.0],"f":"#a0693a"},{"t":"e","a":[60.0,62.0,18.0,15.0],"f":"#f1c9a0","s":0},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[1,0,0,1,50.0,52.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[1,0,0,1,50.0,52.0]},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[1,0,0,1,70.0,52.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[1,0,0,1,70.0,52.0]},{"t":"p","d":"M52 68q8 6 16 0","w":3.0}],"gy":110},"sâu":{"vb":120,"o":[{"t":"e","a":[18.0,96.0,15.0,15.0],"f":"#84cc16"},{"t":"e","a":[38.0,90.0,15.0,15.0],"f":"#84cc16"},{"t":"e","a":[58.0,96.0,15.0,15.0],"f":"#84cc16"},{"t":"e","a":[78.0,90.0,15.0,15.0],"f":"#84cc16"},{"t":"e","a":[96.0,76.0,18.0,18.0],"f":"#a3e635"},{"t":"p","d":"M90 60q-4-10-10-12M102 60q4-10 10-12","w":3.0},{"t":"e","a":[80.0,48.0,3.0,3.0],"f":"#223"},{"t":"e","a":[112.0,48.0,3.0,3.0],"f":"#223"},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[1,0,0,1,90.0,74.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[1,0,0,1,90.0,74.0]},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[1,0,0,1,104.0,74.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[1,0,0,1,104.0,74.0]},{"t":"p","d":"M90 86q6 5 12 0","w":3.0}],"gy":110},"bạn":{"vb":120,"o":[{"t":"p","d":"M48 88v20M72 88v20","w":9.0},{"t":"e","a":[44.0,110.0,9.0,5.0],"f":"#223"},{"t":"e","a":[76.0,110.0,9.0,5.0],"f":"#223"},{"t":"p","d":"M42 74l-12 18M78 74l12 18","w":8.0},{"t":"r","a":[40.0,64.0,40.0,32.0,10.0],"f":"#60a5fa"},{"t":"e","a":[60.0,42.0,22.0,22.0],"f":"#ffd9b0"},{"t":"p","d":"M38 40q0-24 22-24t22 24q-10-12-22-10t-22 10z","f":"#3b2a20"},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[0.8,0.0,0.0,0.8,51.0,46.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[0.8,0.0,0.0,0.8,51.0,46.0]},{"t":"e","a":[0,0,6,6],"f":"#fff","w":3,"m":[0.8,0.0,0.0,0.8,69.0,46.0]},{"t":"e","a":[1,2,2.6,2.6],"f":"#223","s":0,"m":[0.8,0.0,0.0,0.8,69.0,46.0]},{"t":"p","d":"M52 55q8 6 16 0","w":3.0}],"gy":110},"táo":{"vb":120,"o":[{"t":"p","d":"M60 40Q36 28 28 52Q22 82 46 100Q56 106 60 100Q64 106 74 100Q98 82 92 52Q84 28 60 40z","f":"#ef4444"},{"t":"p","d":"M60 40q0-14 8-20"},{"t":"p","d":"M62 30q10-12 22-6q-6 12-22 6z","f":"#4ade80","w":3.0},{"t":"p","d":"M40 56q2-8 8-10","s":"#fff","o":0.7}],"gy":108},"dừa":{"vb":120,"o":[{"t":"p","d":"M62 38L86 8","f":"#000","w":10.0},{"t":"p","d":"M62 38L86 8","f":"#000","s":"#ff6b9d","w":5.0},{"t":"p","d":"M28 70Q24 100 44 106Q60 112 76 106Q96 100 92 70Q92 56 60 52Q28 56 28 70z","f":"#8bc34a"},{"t":"p","d":"M34 70Q60 82 86 70L74 40Q60 34 46 40z","f":"#f6efd0"},{"t":"e","a":[60.0,40.0,10.0,4.0],"f":"#5b4a2a","w":3.0},{"t":"p","d":"M44 90q-2 8 4 12M76 90q2 8-4 12","s":"#5f8f2a","w":3.0},{"t":"p","d":"M36 72q-2 8 2 14","s":"#fff","o":0.6}],"gy":108},"bắp":{"vb":120,"o":[{"t":"p","d":"M60 110Q24 100 26 46Q42 70 60 110z","f":"#4ade80"},{"t":"p","d":"M60 110Q96 100 94 46Q78 70 60 110z","f":"#4ade80"},{"t":"e","a":[60.0,62.0,22.0,46.0],"f":"#facc15"},{"t":"p","d":"M52 24v76M60 18v88M68 24v76M40 40h40M38 56h44M38 72h44M40 88h40","s":"#c99a00","w":1.5}],"gy":108},"hạt":{"vb":120,"o":[{"t":"p","d":"M60 22q32 6 36 46q-4 34-36 36q-32-2-36-36q4-40 36-46z","f":"#b45309"},{"t":"p","d":"M24 62q36-20 72 0q0-36-36-40q-36 4-36 40z","f":"#78350f"},{"t":"p","d":"M52 22l8-12 8 12"},{"t":"p","d":"M40 84q4 8 12 10","s":"#fff","o":0.5}],"gy":108},"dứa":{"vb":120,"o":[{"t":"p","d":"M60 46L38 14l18 10 4-18 4 18 18-10z","f":"#4ade80"},{"t":"e","a":[60.0,76.0,28.0,34.0],"f":"#eab308"},{"t":"cb"},{"t":"p","d":"M30 50l50 50M30 66l50 50M30 34l50 50M90 50L40 100M90 66L40 116M90 34L40 84","s":"#b45309","w":2.0},{"t":"ce"},{"t":"e","a":[60.0,76.0,28.0,34.0]}],"gy":108},"tim":{"vb":48,"o":[{"t":"p","d":"M24 41C5 28 7 11 17 11c5 0 7 3 7 6 0-3 2-6 7-6 10 0 12 17-7 30z","f":"#ff4d6d"}]},"tim mất":{"vb":48,"o":[{"t":"p","d":"M24 41C5 28 7 11 17 11c5 0 7 3 7 6 0-3 2-6 7-6 10 0 12 17-7 30z","f":"#4b5563"}]},"sao":{"vb":48,"o":[{"t":"p","d":"M24 5l5.5 12 13 1.5-9.7 9 2.7 13L24 33.500 12.5 40.500l2.7-13-9.7-9 13-1.5z","f":"#ffd166"}]},"ngủ":{"vb":48,"o":[{"t":"x","a":[6.0,40.0,32.0],"an":"start","f":"#8ec5ff","w":2.0,"s_":"Z"},{"t":"x","a":[28.0,22.0,20.0],"an":"start","f":"#8ec5ff","w":1.5,"s_":"z"}]},"nốt nhạc":{"vb":48,"o":[{"t":"p","d":"M18 36V10l20-4v26"},{"t":"e","a":[13.0,36.0,7.0,5.0],"f":"#223"},{"t":"e","a":[33.0,32.0,7.0,5.0],"f":"#223"}]},"lấp lánh":{"vb":48,"o":[{"t":"p","d":"M24 4q2 18 20 20q-18 2-20 20q-2-18-20-20q18-2 20-20z","f":"#ffe27a"}]},"chuông":{"vb":48,"o":[{"t":"p","d":"M10 34q4-4 4-14q0-10 10-10t10 10q0 10 4 14z","f":"#ffd166"},{"t":"e","a":[24.0,38.0,4.0,4.0],"f":"#223"}]},"lửa":{"vb":48,"o":[{"t":"p","d":"M24 4q4 10 12 16q6 8 0 18q-6 8-12 8t-12-8q-6-10 2-18q2 6 6 6q-2-12 4-22z","f":"#ff7a3d"},{"t":"p","d":"M24 26q6 6 4 12q-2 4-4 4t-4-4q-2-6 4-12z","f":"#ffd166","s":0}]},"tia chớp":{"vb":48,"o":[{"t":"p","d":"M28 3L10 27h12l-4 18L38 20H26z","f":"#ffd166"}]},"đồng hồ cát":{"vb":48,"o":[{"t":"p","d":"M12 6h24M12 42h24M14 6q0 14 10 18q-10 4-10 18M34 6q0 14-10 18q10 4 10 18"},{"t":"p","d":"M18 38h12l-6-8z","f":"#ffd166","s":0}]},"răng":{"vb":48,"o":[{"t":"p","d":"M8 12h32v4H8z","f":"#7a2230"},{"t":"p","d":"M10 16h12l-6 20zM26 16h12l-6 20z","f":"#fff"}]},"hỏi":{"vb":48,"o":[{"t":"e","a":[24.0,24.0,19.0,19.0],"f":"#ffd166"},{"t":"x","a":[24.0,34.0,30.0],"an":"middle","f":"#223","s":0,"s_":"?"}]},"dấu chân":{"vb":48,"o":[{"t":"e","a":[24.0,31.0,10.0,8.0],"f":"#7c5a3a","w":2.5},{"t":"e","a":[12.0,20.0,4.0,4.0],"f":"#7c5a3a","w":2.5},{"t":"e","a":[20.0,12.0,4.0,4.0],"f":"#7c5a3a","w":2.5},{"t":"e","a":[28.0,12.0,4.0,4.0],"f":"#7c5a3a","w":2.5},{"t":"e","a":[36.0,20.0,4.0,4.0],"f":"#7c5a3a","w":2.5}]},"giận":{"vb":48,"o":[{"t":"p","d":"M10 20q10-4 10-14M28 6q0 10 10 14M10 28q10 4 10 14M28 42q0-10 10-14","s":"#e11d48","w":5.0}]},"giọt nước":{"vb":48,"o":[{"t":"p","d":"M24 5q16 20 14 28q-2 10-14 10t-14-10q-2-8 14-28z","f":"#6ec6ff"}]},"mây":{"vb":48,"o":[{"t":"p","d":"M12 38q-8 0-8-8t9-8q2-10 12-10t11 10q10 0 10 8t-8 8z","f":"#fff"}]},"kính lúp":{"vb":48,"o":[{"t":"e","a":[20.0,20.0,14.0,14.0],"f":"#cfeaff"},{"t":"p","d":"M13 14q3-5 8-5","s":"#fff","w":3.0},{"t":"p","d":"M30 30l14 14","f":"#000","w":9.0},{"t":"p","d":"M30 30l14 14","f":"#000","s":"#a06f40"}]},"cưa":{"vb":48,"o":[{"t":"p","d":"M36 12l8-4 3 7-8 4z","f":"#a06f40"},{"t":"p","d":"M5 30l32-17 4 9-32 17z","f":"#cbd5e1"},{"t":"p","d":"M8 40l4 3 3-4 4 3 3-4 4 3 3-4 4 3","w":2.5}]},"kéo":{"vb":48,"o":[{"t":"p","d":"M10 6l20 26M38 6L18 32","s":"#cbd5e1","w":6.0},{"t":"p","d":"M10 6l20 26M38 6L18 32","w":1.5},{"t":"e","a":[13.0,39.0,7.0,7.0],"f":"#ef4444"},{"t":"e","a":[35.0,39.0,7.0,7.0],"f":"#ef4444"}]},"muỗng":{"vb":48,"o":[{"t":"e","a":[14.0,14.0,9.0,12.0],"f":"#e5e7eb","m":[0.7071,-0.7071,0.7071,0.7071,-5.799,14.0]},{"t":"p","d":"M20 20l22 22","f":"#000","w":8.0},{"t":"p","d":"M20 20l22 22","f":"#000","s":"#e5e7eb"}]},"trống":{"vb":48,"o":[{"t":"p","d":"M6 18v18q0 7 18 7t18-7V18z","f":"#ef4444"},{"t":"e","a":[24.0,18.0,18.0,7.0],"f":"#fde68a"},{"t":"p","d":"M14 4l11 12M36 4L26 15","w":3.5}]},"tay chỉ":{"vb":48,"o":[{"t":"r","a":[22.0,14.0,23.0,9.0,4.5],"f":"#ffd9b0"},{"t":"r","a":[4.0,12.0,24.0,26.0,9.0],"f":"#ffd9b0"},{"t":"p","d":"M12 28h11M12 33h11","w":2.5}]},"mắt":{"vb":48,"o":[{"t":"e","a":[14.0,24.0,10.0,14.0],"f":"#fff"},{"t":"e","a":[34.0,24.0,10.0,14.0],"f":"#fff"},{"t":"e","a":[18.0,27.0,4.5,4.5],"f":"#223","s":0},{"t":"e","a":[38.0,27.0,4.5,4.5],"f":"#223","s":0}]},"bóng đèn":{"vb":48,"o":[{"t":"p","d":"M24 4q14 0 14 14q0 8-7 14v6H17v-6q-7-6-7-14Q10 4 24 4z","f":"#ffe27a"},{"t":"p","d":"M18 40h12M20 44h8","w":3.0}]},"khói":{"vb":48,"o":[{"t":"p","d":"M12 34q-8 0-8-7t8-7q2-9 12-9t11 9q9 0 9 7t-9 7z","f":"#e5e7eb"},{"t":"p","d":"M2 42h14M6 46h12","w":3.0}]},"sóng":{"vb":48,"o":[{"t":"p","d":"M2 26q8-12 16 0t14 0t14-2v20H2z","f":"#6ec6ff"},{"t":"p","d":"M8 34q6-4 12 0M26 36q6-4 12 0","s":"#fff","w":2.5}]},"người múa":{"vb":48,"o":[{"t":"e","a":[24.0,9.0,6.0,6.0],"f":"#ffd9b0"},{"t":"p","d":"M24 16l-12 20h24z","f":"#ec4899"},{"t":"p","d":"M20 20L7 10M28 20l13-10M18 36l-5 10M30 36l7 9"}]},"cười lớn":{"vb":48,"o":[{"t":"e","a":[24.0,24.0,19.0,19.0],"f":"#ffd54a"},{"t":"p","d":"M12 20q4-5 9 0M27 20q4-5 9 0","w":3.0},{"t":"p","d":"M12 28q12 14 24 0z","f":"#7a2230","w":3.0},{"t":"e","a":[7.0,30.0,3.0,4.5],"f":"#6ec6ff","w":2.0},{"t":"e","a":[41.0,30.0,3.0,4.5],"f":"#6ec6ff","w":2.0}]},"cười toe":{"vb":48,"o":[{"t":"e","a":[24.0,24.0,19.0,19.0],"f":"#ffd54a"},{"t":"p","d":"M12 17l8 5-8 5M36 17l-8 5 8 5","w":3.0},{"t":"p","d":"M12 29q12 13 24 0z","f":"#7a2230","w":3.0}]},"hài lòng":{"vb":48,"o":[{"t":"e","a":[24.0,24.0,19.0,19.0],"f":"#ffd54a"},{"t":"p","d":"M12 22q4 4 9 0M27 22q4 4 9 0","w":3.0},{"t":"p","d":"M17 31q7 5 14 0","w":3.0},{"t":"e","a":[12.0,29.0,3.5,3.5],"f":"#ff9ab0","s":0},{"t":"e","a":[36.0,29.0,3.5,3.5],"f":"#ff9ab0","s":0}]},"ngựa":{"vb":120,"gy":110,"o":[{"t":"p","d":"M30 74q-22 6-18 34","f":null,"w":9,"s":"#223"},{"t":"p","d":"M30 74q-22 6-18 34","f":null,"w":5,"s":"#5a3a1a"},{"t":"p","d":"M38 96v14M52 98v12M72 98v12M84 96v14","f":null,"w":7},{"t":"e","a":[58,82,32,22],"f":"#a0693a"},{"t":"p","d":"M70 72L78 36Q82 20 96 22L112 44Q114 54 104 56L94 54L92 72z","f":"#a0693a"},{"t":"p","d":"M80 22l2-12 8 10z","f":"#a0693a"},{"t":"p","d":"M78 30q-14 10-10 34","f":null,"w":8,"s":"#5a3a1a"},{"t":"e","a":[92,34,6,6],"f":"#fff","w":3},{"t":"e","a":[93,36,2.6,2.6],"f":"#223","s":0},{"t":"e","a":[107,49,2,2],"f":"#223","s":0}]},"hoa":{"vb":48,"o":[{"t":"e","a":[24,11,8,8],"f":"#ec4899","w":3},{"t":"e","a":[36,20,8,8],"f":"#ec4899","w":3},{"t":"e","a":[31,35,8,8],"f":"#ec4899","w":3},{"t":"e","a":[17,35,8,8],"f":"#ec4899","w":3},{"t":"e","a":[12,20,8,8],"f":"#ec4899","w":3},{"t":"e","a":[24,24,6,6],"f":"#ffd54a","w":3}]},"hoaxanh":{"vb":48,"o":[{"t":"e","a":[24,11,8,8],"f":"#34d399","w":3},{"t":"e","a":[36,20,8,8],"f":"#34d399","w":3},{"t":"e","a":[31,35,8,8],"f":"#34d399","w":3},{"t":"e","a":[17,35,8,8],"f":"#34d399","w":3},{"t":"e","a":[12,20,8,8],"f":"#34d399","w":3},{"t":"e","a":[24,24,6,6],"f":"#ffd54a","w":3}]},"cane":{"vb":48,"o":[{"t":"p","d":"M30 44V14q0-8-8-8","f":null,"w":9},{"t":"p","d":"M30 44V14q0-8-8-8","f":null,"w":4,"s":"#a06f40"}]},"sprout":{"vb":48,"o":[{"t":"p","d":"M24 44V26","f":null,"w":4},{"t":"e","a":[14,22,11,5],"f":"#22a55a","w":3,"m":[0.9063,-0.4226,0.4226,0.9063,-7.9859,7.9779]},{"t":"e","a":[34,22,11,5],"f":"#22a55a","w":3,"m":[0.9063,0.4226,-0.4226,0.9063,12.4831,-12.3078]}]},"pho":{"vb":48,"o":[{"t":"p","d":"M6 22h36q-2 18-18 22q-16-4-18-22z","f":"#fbfdff"},{"t":"e","a":[24,22,18,5],"f":"#fde68a"},{"t":"p","d":"M12 20q4-6 8 0M22 18q4-6 8 0M30 20q4-6 6 0","f":null,"w":2.5,"s":"#f59e0b"},{"t":"p","d":"M8 30h32","f":null,"w":4,"s":"#dc2626"}]}};
const EMS={"😺":"mèo","😺️":"mèo","😾":"mèo","😾️":"mèo","🐶":"chó","🐶️":"chó","🐘":"voi","🐘️":"voi","🐍":"rắn","🐍️":"rắn","🐴":"ngựa","🐴️":"ngựa","🐔":"gà","🐔️":"gà","🐷":"lợn","🐷️":"lợn","🦩":"hạc","🦩️":"hạc","🐰":"thỏ","🐰️":"thỏ","🐉":"rồng","🐉️":"rồng","🐦‍⬛":"quạ","🐦‍⬛️":"quạ","🐦":"chim","🐦️":"chim","🐵":"khỉ","🐵️":"khỉ","🦀":"cua","🦀️":"cua","🐛":"sâu","🐛️":"sâu","😣":"bạn","😣️":"bạn","🧒":"bạn","🧒️":"bạn","🍎":"táo","🍎️":"táo","🥥":"dừa","🥥️":"dừa","🌽":"bắp","🌽️":"bắp","🌰":"hạt","🌰️":"hạt","🍍":"dứa","🍍️":"dứa","🍜":"pho","🍜️":"pho","🔥":"lửa","🔥️":"lửa","🌺":"hoa","🌺️":"hoa","💠":"hoaxanh","💠️":"hoaxanh","🔍":"kính lúp","🔍️":"kính lúp","🪚":"cưa","🪚️":"cưa","✂":"kéo","✂️":"kéo","🥄":"muỗng","🥄️":"muỗng","🥁":"trống","🥁️":"trống","👉":"tay chỉ","👉️":"tay chỉ","👀":"mắt","👀️":"mắt","💡":"bóng đèn","💡️":"bóng đèn","💨":"khói","💨️":"khói","🌊":"sóng","🌊️":"sóng","💃":"người múa","💃️":"người múa","😂":"cười lớn","😂️":"cười lớn","😆":"cười toe","😆️":"cười toe","😌":"hài lòng","😌️":"hài lòng","💤":"ngủ","💤️":"ngủ","🎵":"nốt nhạc","🎵️":"nốt nhạc","🎶":"nốt nhạc","🎶️":"nốt nhạc","✨":"lấp lánh","✨️":"lấp lánh","🔔":"chuông","🔔️":"chuông","⚡":"tia chớp","⚡️":"tia chớp","⏳":"đồng hồ cát","⏳️":"đồng hồ cát","🦷":"răng","🦷️":"răng","❓":"hỏi","❓️":"hỏi","❔":"hỏi","❔️":"hỏi","🐾":"dấu chân","🐾️":"dấu chân","💢":"giận","💢️":"giận","💦":"giọt nước","💦️":"giọt nước","🦯":"cane","🦯️":"cane","🌿":"sprout","🌿️":"sprout"};
const EYES={"mèo":[[49,50],[71,50]],"chó":[[48,46],[72,46]],"voi":[[49,48],[71,48]],"rắn":[[98,34],[111,34]],"ngựa":[[92,34]],"gà":[[45,44]],"lợn":[[46,52],[74,52]],"hạc":[[66,14]],"thỏ":[[50,54],[70,54]],"rồng":[[50,44],[70,44]],"quạ":[[44,42]],"chim":[[46,58]],"khỉ":[[50,52],[70,52]],"cua":[[48,42],[72,42]],"sâu":[[90,74],[104,74]],"bạn":[[51,46],[69,46]]};
const FACE={"gà":-1,"chim":-1,"quạ":-1,"hạc":1,"rắn":1,"rồng":1,"ngựa":1,"sâu":1};

// ===== Lexicon (used by interpreter & scene renderer only — NEVER shown on tiles) =====
const LEX={
  // Animate nouns
  mèo:{r:'N',anim:1,em:'😺',ang:'😾',col:'#f2a65a',tail:1},
  chó:{r:'N',anim:1,em:'🐶',ang:'🐶',col:'#c49a6c',tail:1},
  voi:{r:'N',anim:1,em:'🐘',ang:'🐘',col:'#9aa7b4',tail:1},
  rắn:{r:'N',anim:1,em:'🐍',ang:'🐍',col:'#5cb85c',sn:1},
  ngựa:{r:'N',anim:1,em:'🐴',ang:'🐴',col:'#a0693a',tail:1},
  gà:{r:'N',anim:1,em:'🐔',ang:'🐔',col:'#f5f5f5',wing:1},
  lợn:{r:'N',anim:1,em:'🐷',ang:'🐷',col:'#f9a8c9',tail:1},
  hạc:{r:'N',anim:1,em:'🦩',ang:'🦩',col:'#f4a4c0',wing:1},
  thỏ:{r:'N',anim:1,em:'🐰',ang:'🐰',col:'#e2e8f0',tail:1},
  rồng:{r:'N',anim:1,em:'🐉',ang:'🐉',col:'#4caf50',wing:1,tail:1},
  quạ:{r:'N',anim:1,em:'🐦‍⬛',ang:'🐦‍⬛',col:'#475569',wing:1},
  chim:{r:'N',anim:1,em:'🐦',ang:'🐦',col:'#60a5fa',wing:1},
  khỉ:{r:'N',anim:1,em:'🐵',ang:'🐵',col:'#a0693a',tail:1},
  cua:{r:'N',anim:1,em:'🦀',ang:'🦀',col:'#ef4444'},
  sâu:{r:'N',anim:1,em:'🐛',ang:'🐛',col:'#84cc16',sn:1},
  bạn:{r:'N',anim:1,em:'🧒',ang:'😣',col:'#60a5fa',human:1},
  // Inanimate / food / object nouns
  cơm:{r:'N',anim:0,em:'🍚',col:'#fffefa',food:'rice'},
  phở:{r:'N',anim:0,em:'🍜',col:'#fde68a',food:'pho'},
  táo:{r:'N',anim:0,em:'🍎',col:'#ef4444',food:'round'},
  dừa:{r:'N',anim:0,em:'🥥',col:'#78350f',food:'round'},
  bắp:{r:'N',anim:0,em:'🌽',col:'#facc15',food:'corn'},
  hạt:{r:'N',anim:0,em:'🌰',col:'#b45309',food:'seed'},
  dứa:{r:'N',anim:0,em:'🍍',col:'#eab308',food:'round'},
  lửa:{r:'N',anim:0,em:'🔥',col:'#f97316',food:'fire'},
  sách:{r:'N',anim:0,em:'📖',col:'#3b82f6',prop:'book'},
  tre:{r:'N',anim:0,em:'🎍',col:'#22c55e',prop:'bamboo'},
  ghế:{r:'N',anim:0,em:'🪑',col:'#b45309',prop:'chair'},
  hoa:{r:'N',anim:0,em:'🌺',col:'#ec4899',prop:'flower'},
  // Intransitive verbs
  ngủ:{r:'VI'},hát:{r:'VI'},cười:{r:'VI'},bơi:{r:'VI'},múa:{r:'VI'},lặn:{r:'VI'},
  // Transitive verbs
  ăn:{r:'VT'},bắt:{r:'VT'},đá:{r:'VT'},đọc:{r:'VT'},cưa:{r:'VT'},ngồi:{r:'VT'},cắt:{r:'VT'},
  // Adjectives (post-nominal)
  lớn:{r:'ADJ'},già:{r:'ADJ'},xanh:{r:'ADJ'},
  // Aspect markers
  đang:{r:'PRE'},chưa:{r:'PRE'},rồi:{r:'POST'}
};

// ===== 4 Sets × 4 Growing Chains (4 stages per chain = 16 stages per set, 64 total) =====
export const SETS=[
  {n:'Nhà Bếp',bg:0,chains:[
    ['mèo ngủ','mèo ăn cơm','mèo ăn cơm rồi','mèo lớn ăn cơm rồi'],
    ['chó ngủ','chó ăn phở','chó ăn phở rồi','chó lớn ăn phở rồi'],
    ['gà múa','gà ăn bắp','gà chưa ăn bắp','gà lớn chưa ăn bắp'],
    ['ngựa ngủ','ngựa đá chó','ngựa đang đá chó','ngựa lớn đang đá chó']
  ]},
  {n:'Rừng Xanh',bg:1,chains:[
    ['voi ngủ','voi ăn táo','voi lớn ăn táo','voi lớn ăn táo xanh'],
    ['khỉ cười','khỉ ăn dừa','khỉ ăn dừa rồi','khỉ già ăn dừa rồi'],
    ['chim hát','chim ăn hạt','chim đang ăn hạt','chim xanh đang ăn hạt'],
    ['quạ lặn','quạ bắt sâu','quạ đang bắt sâu','quạ lớn đang bắt sâu']
  ]},
  {n:'Đầm Lầy',bg:2,chains:[
    ['rắn bơi','rắn ăn thỏ','rắn lớn ăn thỏ','rắn lớn ăn thỏ rồi'],
    ['hạc ngủ','hạc bắt cua','hạc già bắt cua','hạc già đang bắt cua'],
    ['lợn lặn','lợn ăn dứa','lợn ăn dứa rồi','lợn già ăn dứa rồi'],
    ['rồng ngủ','rồng ăn lửa','rồng ăn lửa rồi','rồng lớn ăn lửa rồi']
  ]},
  {n:'Sân Nhà',bg:3,chains:[
    ['bạn hát','bạn đọc sách','bạn đọc sách rồi','bạn đọc sách lớn rồi'],
    ['bạn cười','bạn cưa tre','bạn cưa tre rồi','bạn cưa tre xanh rồi'],
    ['bạn ngủ','bạn ngồi ghế','bạn ngồi ghế rồi','bạn ngồi ghế lớn rồi'],
    ['bạn múa','bạn cắt hoa','bạn cắt hoa rồi','bạn cắt hoa xanh rồi']
  ]}
];
const STAGES_PER_SET=16,LIVES_START=9,LIVES_MAX=15;

export const meta={
  id:'caupha',
  title:'Câu Phá',
  players:'solo',
  color:'#ff6b6b',
  icon:'🤪',
  desc:'Xếp các từ tiếng Việt để tạo đúng bức tranh mục tiêu — hoặc khám phá những câu phá kỳ quặc!',
  soloable:true
};

// ===== Interpreter: words[] -> meaning object =====
export function parseSentence(words){
  const n=words.length,tok=words.map(w=>({w,...(LEX[w]||{r:'?'})}));
  // Special 2-word valid reversals from the scaffold ('cười khỉ', 'cười bạn', 'múa gà', 'múa bạn')
  if(n===2&&(tok[0].w==='cười'||tok[0].w==='múa')&&tok[1].r==='N'){
    return{kind:'valid',subj:{noun:'bạn',adj:null,offscreen:1},verb:tok[0].w,obj:{noun:tok[1].w,adj:null},aspect:'bare'};
  }
  let i=0;
  function takeNP(){
    if(i>=n||tok[i].r!=='N')return null;
    const np={noun:tok[i].w,adj:null};i++;
    if(i<n&&tok[i].r==='ADJ'){np.adj=tok[i].w;i++}
    return np;
  }
  const subj=takeNP();
  if(!subj)return{kind:'gibberish'};
  let aspect='bare';
  if(i<n&&tok[i].r==='PRE'){aspect=tok[i].w;i++}
  if(i>=n||(tok[i].r!=='VI'&&tok[i].r!=='VT'))return{kind:'gibberish'};
  const verb=tok[i];i++;
  let obj=null;
  if(verb.r==='VT'){
    obj=takeNP();
    if(!obj||obj.noun===subj.noun)return{kind:'gibberish'};
  }
  if(i<n&&tok[i].r==='POST'){
    if(aspect!=='bare')return{kind:'gibberish'};
    aspect='rồi';i++;
  }
  if(i!==n)return{kind:'gibberish'};
  return{kind:'valid',subj,verb:verb.w,obj,aspect};
}

// ===== Whip-into-place syntax corrector (fixes 1 syntax rule, never hands out the goal order) =====
export function computeWhip(words,goalWords){
  const w=words.slice(),n=w.length,roles=w.map(x=>(LEX[x]&&LEX[x].r)||'?');
  if(n===2)return{next:w,from:0,to:0,bad:[0,1],bounce:true};
  const mv=(arr,f,t)=>{const a=arr.slice(),it=a.splice(f,1)[0];a.splice(t,0,it);return a};
  let cand=null,moved=null,bad=[];

  // 1. 'rồi' (POST) must sit at the very end
  const pIdx=roles.indexOf('POST');
  if(pIdx>=0&&pIdx!==n-1){
    moved=w[pIdx];cand=mv(w,pIdx,n-1);bad=[pIdx];
  }
  // 2. Adjective (ADJ) before Noun or stranded away from a Noun
  if(!cand){
    for(let i=0;i<n;i++){
      if(roles[i]==='ADJ'&&(i===0||roles[i-1]!=='N')){
        moved=w[i];bad=[i];
        if(i+1<n&&roles[i+1]==='N'){bad=[i,i+1];cand=mv(w,i,i+1)}
        else{
          const tmp=w.slice();tmp.splice(i,1);
          const ni=tmp.findIndex(x=>LEX[x]&&LEX[x].r==='N');
          tmp.splice(ni>=0?ni+1:0,0,moved);cand=tmp;
        }
        break;
      }
    }
  }
  // 3. 'đang' / 'chưa' (PRE) must sit right before the Verb
  if(!cand){
    const preIdx=roles.indexOf('PRE'),vIdx=roles.findIndex(r=>r==='VI'||r==='VT');
    if(preIdx>=0&&vIdx>=0&&preIdx+1!==vIdx){
      moved=w[preIdx];bad=[preIdx];
      const tmp=w.slice();tmp.splice(preIdx,1);
      const vn=tmp.findIndex(x=>LEX[x]&&(LEX[x].r==='VI'||LEX[x].r==='VT'));
      tmp.splice(vn>=0?vn:0,0,moved);cand=tmp;
    }
  }
  // 4. Verb at start or end (two nouns on the same side of the verb)
  if(!cand){
    const vIdx=roles.findIndex(r=>r==='VI'||r==='VT');
    moved=w[vIdx>=0?vIdx:0];bad=[vIdx>=0?vIdx:0];
    const nouns=w.filter(x=>LEX[x]&&LEX[x].r==='N');
    const adjs=w.filter(x=>LEX[x]&&LEX[x].r==='ADJ');
    const pres=w.filter(x=>LEX[x]&&LEX[x].r==='PRE');
    const posts=w.filter(x=>LEX[x]&&LEX[x].r==='POST');
    const np1=nouns[0]?[nouns[0]]:[],np2=nouns[1]?[nouns[1]]:[];
    if(adjs.length===1)np1.push(adjs[0]);
    else if(adjs.length>=2){np1.push(adjs[0]);np2.push(adjs[1])}
    cand=[...np1,...pres,moved,...np2,...posts];
  }
  // Never let a syntax whip hand the player the exact winning goal sentence
  if(cand.join(' ')===goalWords.join(' ')){
    const ni=[];cand.forEach((x,idx)=>{if(LEX[x]&&LEX[x].r==='N')ni.push(idx)});
    if(ni.length>=2){const t=cand[ni[0]];cand[ni[0]]=cand[ni[1]];cand[ni[1]]=t}
  }
  const from=w.indexOf(moved),to=cand.indexOf(moved);
  return{next:cand,from:from>=0?from:0,to:to>=0?to:0,bad:bad.length?bad:[0],bounce:false};
}

// Scramble goal words so the starting rail is never already solved (and prefers gibberish so they must arrange)
function scrambleGoal(goalWords,R){
  const n=goalWords.length;
  if(n===2)return[goalWords[1],goalWords[0]];
  let best=goalWords.slice().reverse();
  for(let k=0;k<24;k++){
    const a=goalWords.slice();
    for(let i=n-1;i>0;i--){const j=Math.floor(R()*(i+1));[a[i],a[j]]=[a[j],a[i]]}
    if(a.join(' ')===goalWords.join(' '))continue;
    best=a;
    if(parseSentence(a).kind==='gibberish')return a;
  }
  return best;
}

// ===== Bub Hub Module Contract =====
const freshRun=()=>({phase:'idle',set:0,level:0,lives:LIVES_START,halfStars:0,seed:0,seq:0,deaths:0,resets:0,cleared:0});
export function init(ctx){
  const runs={};((ctx&&ctx.atTable)||[]).forEach(p=>{if(p&&p.id&&!p.spectator)runs[p.id]=freshRun()});
  return{v:1,runs,done:null,n:0};
}
export function reduce(state,a,ctx){
  const id=ctx&&ctx.from&&ctx.from.id;
  if(!id)return{error:'Unknown sender.'};
  if(!a||typeof a.a!=='string')return{error:'Unknown action.'};
  if(a.a==='join')return state.runs[id]?state:{...state,runs:{...state.runs,[id]:freshRun()}};
  const r=state.runs[id];
  if(!r)return{error:'You are watching — not seated.'};
  const put=(nr,extra)=>({...state,...(extra||{}),runs:{...state.runs,[id]:nr}});
  if(a.a==='start'){
    if(r.phase==='play')return state;
    const rng=(ctx&&ctx.rng)||Math.random;
    return put({...freshRun(),phase:'play',seed:Math.floor(rng()*4294967296),seq:r.seq+1});
  }
  if(r.phase!=='play'||a.seq!==r.seq)return state;
  if(a.a==='absurd'){
    const hs=(r.halfStars||0)+1;
    const bonusLife=hs%2===0?1:0;
    return put({...r,halfStars:hs,lives:Math.min(LIVES_MAX,r.lives+bonusLife),seq:r.seq+1});
  }
  if(a.a==='die'){
    const lives=r.lives-1;
    if(lives>0)return put({...r,lives,seq:r.seq+1,deaths:r.deaths+1});
    return put({...r,lives:LIVES_START,level:0,seq:r.seq+1,deaths:r.deaths+1,resets:r.resets+1});
  }
  if(a.a==='clear'){
    const chainDone=(r.level+1)%4===0;
    const lives=chainDone?Math.min(LIVES_MAX,r.lives+1):r.lives;
    if(r.level+1<STAGES_PER_SET)return put({...r,lives,level:r.level+1,seq:r.seq+1,cleared:r.cleared+1});
    const won=r.set+1>=SETS.length,n=state.n+1;
    const nr=won?{...r,phase:'won',lives,seq:r.seq+1,cleared:r.cleared+1}
               :{...r,set:r.set+1,level:0,lives:Math.max(lives,LIVES_START),seq:r.seq+1,cleared:r.cleared+1};
    return put(nr,{n,done:{n,id,set:r.set,won,lives:nr.lives,halfStars:nr.halfStars}});
  }
  return{error:'Unknown action.'};
}
export function project(state,playerId){
  return{v:state.v,you:playerId,run:state.runs[playerId]||null,done:state.done,
    others:Object.keys(state.runs).filter(k=>k!==playerId).map(k=>({id:k,set:state.runs[k].set,level:state.runs[k].level,phase:state.runs[k].phase}))};
}
export function summarize(state,nameOf){
  const d=state.done;if(!d)return null;
  return d.won?`${nameOf(d.id)} cleared all ${SETS.length} sets of ${meta.title}`:`${nameOf(d.id)} cleared set ${d.set+1} (${SETS[d.set].n}) of ${meta.title}`;
}
export function roundId(state){return 'd'+(state.done?state.done.n:0)}
export function prune(state,goneId){
  if(!state.runs[goneId])return state;
  const runs={...state.runs};delete runs[goneId];return{...state,runs};
}

// ===== Mount & Interactive Canvas Engine =====
export function mount(root,api){
  const G={
    mode:'wait',set:0,lv:0,seed:0,seq:-1,resets:null,lives:LIVES_START,halfStars:0,
    t:0,shake:0,hp:3,goalWords:[],goalParsed:null,words:[],tiles:[],
    cur:0,held:-1,dragIdx:-1,dragX:0,dragY:0,
    shownParsed:null,verdict:'',verdictCol:'#fff',verdictT:0,
    foundAbsurd:{},whip:null,zoomGoal:1.15,peekGoal:0,
    clearT:0,waitT:0,out:null,lastOut:null,starting:0,joined:0,spec:false
  };
  let parts=[],pops=[],dead=false;
  const queue=o=>{G.out=G.lastOut=o};

  // ===== WebAudio synth + optional ../assets/caupha/ hooks =====
  let AC=null;
  function tone(f,d,f1,v,type){try{
    AC=AC||new(window.AudioContext||window.webkitAudioContext)();
    if(AC.state==='suspended')AC.resume();
    const t=AC.currentTime,o=AC.createOscillator(),g=AC.createGain();
    o.type=type||'sine';o.frequency.setValueAtTime(f,t);
    if(f1)o.frequency.exponentialRampToValueAtTime(f1,t+d);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(v||.12,t+.02);
    g.gain.exponentialRampToValueAtTime(.0001,t+d);
    o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+d+.04);
  }catch(e){}}
  function puff(x,y,n,c){for(let i=0;i<n;i++)parts.push({x,y,vx:(Math.random()-.5)*150,vy:-Math.random()*110-20,t:0,l:.4+Math.random()*.25,c:c||'#fff'})}
  const pop=(s,x,y,sz,col)=>pops.push({s,x,y,t:G.t,sz:sz||22,col:col||'#fff'});

  // ===== DOM & Shadow Root Setup =====
  const css=document.createElement('style');
  css.textContent=`:host{display:block}
  .w{display:flex;flex-direction:column;align-items:center;gap:8px;padding:4px;outline:none;user-select:none;-webkit-user-select:none;touch-action:none}
  canvas{display:block;width:min(100%,calc((100vh - 140px)*1.7778),1000px);aspect-ratio:16/9;border-radius:12px;background:#0f172a;box-shadow:0 4px 24px rgba(0,0,0,.4);cursor:pointer}
  .bar{display:flex;justify-content:space-between;width:min(100%,1000px)}
  .g{display:flex;gap:6px}
  button{min-width:56px;height:52px;padding:0 14px;font-size:20px;font-weight:bold;border:0;border-radius:12px;background:rgba(255,255,255,.22);color:#fff;touch-action:none;cursor:pointer}
  button.act{background:#22c55e;color:#0f172a}
  button:active{background:rgba(255,255,255,.5)}`;
  const wrap=document.createElement('div');wrap.className='w';wrap.tabIndex=0;
  const cv=document.createElement('canvas');cv.width=LW;cv.height=LH;cv.setAttribute('aria-label','Câu Phá');
  const bar=document.createElement('div');bar.className='bar';
  bar.innerHTML='<div class="g"><button data-k="left">◀</button><button data-k="right">▶</button></div><div class="g"><button data-k="swap">⇅</button><button class="act" data-k="act">⚡</button></div>';
  wrap.append(cv,bar);root.append(css,wrap);
  const ctx=cv.getContext('2d');
  let S=1,DPR=1,cw=0;
  function fit(){const w=cv.clientWidth||LW;if(w===cw)return;cw=w;DPR=window.devicePixelRatio||1;S=w/LW;cv.width=Math.round(LW*S*DPR);cv.height=Math.round(LH*S*DPR)}

  // ===== Tile Layout & Physics =====
  function layoutTargets(words){
    ctx.font='bold 21px system-ui,sans-serif';
    const ws=words.map(w=>Math.max(54,ctx.measureText(w).width+26));
    const gap=8,tot=ws.reduce((a,b)=>a+b,0)+gap*(words.length-1);
    let x=365-tot/2;
    return words.map((w,i)=>{const cx=x+ws[i]/2;x+=ws[i]+gap;return{w,cx,cy:32,tw:ws[i]}});
  }
  function syncTiles(snap){
    const tgt=layoutTargets(G.words);
    if(snap||G.tiles.length!==G.words.length){
      G.tiles=tgt.map((t,i)=>({w:t.w,x:t.cx,y:t.cy,tx:t.cx,ty:t.cy,tw:t.tw,rot:0,red:0,shk:0,arcY:0,idx:i}));
    }else{
      tgt.forEach((t,i)=>{
        let tile=G.tiles[i];
        tile.w=t.w;tile.tx=t.cx;tile.ty=t.cy;tile.tw=t.tw;tile.idx=i;
      });
    }
  }

  // ===== Stage Initialization =====
  function startStage(){
    const chainIdx=Math.floor(G.lv/4),stepIdx=G.lv%4;
    const goalStr=SETS[G.set].chains[chainIdx][stepIdx];
    const R=mb(G.seed*31+G.set*997+G.lv*131+7);
    G.mode='play';G.hp=3;G.goalWords=goalStr.split(' ');
    G.goalParsed=parseSentence(G.goalWords);
    G.words=scrambleGoal(G.goalWords,R);
    G.cur=0;G.held=-1;G.dragIdx=-1;
    G.shownParsed=null;G.verdict='';G.verdictT=0;
    G.foundAbsurd={};G.whip=null;
    G.zoomGoal=1.15;G.peekGoal=0;G.starting=0;
    syncTiles(true);
    // Drop-in animation from above for the newly added word
    G.tiles.forEach((t,i)=>{t.y=-30-i*12});
  }
  function applyRun(r){
    if(G.spec){G.mode='watch';return}
    if(!r){G.mode='wait';return}
    G.lives=r.lives;G.halfStars=r.halfStars||0;
    if(r.phase==='idle'){G.mode='title';G.starting=0;G.resets=null;G.seq=-1;G.seed=0;return}
    if(r.phase==='won'){G.mode='end';G.starting=0;G.resets=null;G.seq=-1;G.seed=0;return}
    const inStage=G.mode==='play'||G.mode==='clear'||G.mode==='wait';
    if(inStage&&G.set===r.set&&G.lv===r.level&&G.seed===r.seed&&G.seq>=0){
      G.seq=r.seq;
      if(G.mode==='wait')G.mode='play';
      return;
    }
    G.set=r.set;G.lv=r.level;G.seed=r.seed;G.seq=r.seq;G.resets=r.resets;
    startStage();
  }
  function startRun(){if(G.spec||G.starting||(G.mode!=='title'&&G.mode!=='end'))return;G.starting=1;queue({a:'start'})}

  // ===== Tile Swapping & Sentence Submission =====
  function swapWords(i,j){
    if(i===j||i<0||j<0||i>=G.words.length||j>=G.words.length||G.whip||G.mode!=='play')return;
    const tmpW=G.words[i];G.words[i]=G.words[j];G.words[j]=tmpW;
    const tmpT=G.tiles[i];G.tiles[i]=G.tiles[j];G.tiles[j]=tmpT;
    syncTiles(false);
    // Give swapped tiles a snappy little arc hop
    G.tiles[i].arcY=-18;G.tiles[j].arcY=18;
    tone(440,.06,620,.08);
  }

  function checkSentence(){
    if(G.mode!=='play'||G.whip)return;
    const curStr=G.words.join(' '),goalStr=G.goalWords.join(' ');
    const parsed=parseSentence(G.words);
    G.shownParsed=parsed;

    // 1. Exact Goal Match!
    if(curStr===goalStr){
      G.verdict='Đúng rồi!';G.verdictCol='#7CFC9A';G.verdictT=2.4;
      G.mode='clear';G.clearT=2.1;
      puff(320,200,24,'#7CFC9A');pop('⭐',320,120,34);
      tone(523,.12,659,.14);api.setTimeout(()=>tone(659,.12,784,.14),110);api.setTimeout(()=>tone(784,.22,1046,.16),220);
      return;
    }

    // 2. Grammatically Valid Absurd / Swapped Sentence (Câu phá!)
    if(parsed.kind==='valid'){
      const key=curStr;
      if(!G.foundAbsurd[key]){
        G.foundAbsurd[key]=1;
        G.verdict='Câu phá! +½ ⭐';G.verdictCol='#ffd166';G.verdictT=2.6;
        puff(320,190,18,'#ffd166');pop('🤪 +½',540,56,22,'#ffd166');
        tone(340,.12,680,.14,'triangle');api.setTimeout(()=>tone(680,.16,480,.14,'triangle'),110);
        queue({a:'absurd',seq:G.seq});
      }else{
        G.verdict='Câu phá!';G.verdictCol='#ffd166';G.verdictT=1.8;
        tone(420,.1,360,.1,'triangle');
      }
      return;
    }

    // 3. Ungrammatical / Gibberish -> Turn Red + Shake + Whip Into Place!
    G.hp--;
    G.verdict='Sai rồi!';G.verdictCol='#ff5a5f';G.verdictT=2.0;
    G.shake=.38;
    pop('−1 ❤️',554,50,20,'#ff6b6b');
    tone(190,.24,105,.18,'sawtooth');

    const wInfo=computeWhip(G.words,G.goalWords);
    G.tiles.forEach((t,idx)=>{
      t.red=1;
      t.shk=wInfo.bad.includes(idx)?1:.55;
    });

    if(G.hp<=0){
      G.whip={phase:'die',t:0};
      return;
    }

    // Start 2-phase red-shake -> whip-arc correction
    G.whip={
      phase:'shake',t:0,
      from:wInfo.from,to:wInfo.to,
      nextWords:wInfo.next,
      bounce:wInfo.bounce
    };
  }

  // ===== Drawing Helpers =====
  const rr=(x,y,w,h,r)=>{ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):ctx.rect(x,y,w,h)};
  // Draw a hand-drawn sprite. box = sprite height in px; o.g anchors the ground line at (x,y), else centred.
  function spr(name,x,y,box,o,cb){
    const S=SPR[name];if(!S)return false;o=o||{};
    const vb=S.vb,k=box/vb;
    ctx.save();ctx.translate(x,y);
    if(o.rot)ctx.rotate(o.rot);
    if(o.flip)ctx.scale(-1,1);
    if(o.a!==undefined)ctx.globalAlpha=o.a;
    ctx.scale(k,k);
    if(o.g)ctx.translate(-vb/2,-S.gy);else ctx.translate(-vb/2,-vb/2);
    ctx.lineJoin='round';ctx.lineCap='round';
    for(const p of S.o){
      if(p.t==='cb'){ctx.save();ctx.beginPath();ctx.ellipse(60,76,28,34,0,0,7);ctx.clip();continue}
      if(p.t==='ce'){ctx.restore();continue}
      ctx.save();
      if(p.m)ctx.transform(p.m[0],p.m[1],p.m[2],p.m[3],p.m[4],p.m[5]);
      if(p.o!==undefined)ctx.globalAlpha*=p.o;
      const st=p.s===0?null:(p.s||INK),lw=p.w||4;
      ctx.lineWidth=lw;
      if(p.t==='x'){
        ctx.font='bold '+p.a[2]+'px system-ui,sans-serif';ctx.textAlign=p.an==='middle'?'center':'left';ctx.textBaseline='alphabetic';
        if(st){ctx.strokeStyle=st;ctx.strokeText(p.s_,p.a[0],p.a[1])}
        if(p.f){ctx.fillStyle=p.f;ctx.fillText(p.s_,p.a[0],p.a[1])}
      }else{
        ctx.beginPath();
        if(p.t==='p'){p._p=p._p||new Path2D(p.d)}
        else if(p.t==='e')ctx.ellipse(p.a[0],p.a[1],p.a[2],p.a[3],0,0,7);
        else if(ctx.roundRect)ctx.roundRect(p.a[0],p.a[1],p.a[2],p.a[3],p.a[4]);else ctx.rect(p.a[0],p.a[1],p.a[2],p.a[3]);
        if(p.f){ctx.fillStyle=p.f;p.t==='p'?ctx.fill(p._p):ctx.fill()}
        if(st){ctx.strokeStyle=st;p.t==='p'?ctx.stroke(p._p):ctx.stroke()}
      }
      ctx.restore();
    }
    if(cb)cb(vb);
    ctx.restore();return true;
  }
  // em(): emoji call sites now draw a hand-drawn sprite when one exists (pass {raw:1} to force the emoji).
  function em(s,x,y,sz,o){
    o=o||{};
    const n=!o.raw&&EMS[s];
    if(n&&SPR[n]){spr(n,x,y,sz*(SPR[n].vb===120?1.7:1.15),{rot:o.rot,flip:o.flip,a:o.a});return}
    ctx.save();ctx.translate(x,y);
    if(o.rot)ctx.rotate(o.rot);if(o.flip)ctx.scale(-1,1);
    if(o.a!==undefined)ctx.globalAlpha=o.a;
    ctx.font=sz+'px '+EF;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#000';ctx.fillText(s,0,0);ctx.restore();
  }
  function txt(s,x,y,sz,al,fill){
    ctx.font='bold '+sz+'px system-ui,sans-serif';ctx.textAlign=al||'center';ctx.textBaseline='middle';
    ctx.lineWidth=Math.max(3,sz/6);ctx.lineJoin='round';
    ctx.strokeStyle='rgba(0,0,0,.78)';ctx.strokeText(s,x,y);
    ctx.fillStyle=fill||'#fff';ctx.fillText(s,x,y);
  }

  // ===== Backdrops (4 Sets) =====
  function drawBackdrop(bgIdx){
    if(bgIdx===0){ // Nhà Bếp (from scene-prototype.html)
      const g=ctx.createLinearGradient(0,0,0,GY);g.addColorStop(0,'#ffe9c7');g.addColorStop(1,'#ffd7a0');
      ctx.fillStyle=g;ctx.fillRect(0,0,LW,GY);
      ctx.strokeStyle='rgba(120,70,20,.12)';ctx.lineWidth=1;
      for(let x=0;x<=LW;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,GY);ctx.stroke()}
      for(let y=0;y<=GY;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(LW,y);ctx.stroke()}
      ctx.fillStyle='#8fd3ff';rr(462,72,104,78,6);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=4;ctx.stroke();
      ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(514,72);ctx.lineTo(514,150);ctx.moveTo(462,111);ctx.lineTo(566,111);ctx.stroke();
      em('☀️',490,92,24);em('☁️',545,128,20);
      ctx.fillStyle='#e0566b';ctx.fillRect(456,66,12,92);ctx.fillRect(560,66,12,92);
      ctx.fillStyle='#8b5a2b';ctx.fillRect(26,176,150,7);em('🍳',54,160,26);em('🥣',100,162,24);em('🧂',142,164,19);
      ctx.fillStyle='#b9824f';ctx.fillRect(0,GY,LW,LH-GY);
      ctx.fillStyle='#a06f40';ctx.fillRect(0,GY,LW,6);
    }else if(bgIdx===1){ // Rừng Xanh
      const g=ctx.createLinearGradient(0,0,0,GY);g.addColorStop(0,'#bae6fd');g.addColorStop(1,'#dcfce7');
      ctx.fillStyle=g;ctx.fillRect(0,0,LW,GY);
      ctx.fillStyle='#86efac';ctx.beginPath();ctx.arc(160,GY,190,Math.PI,0);ctx.arc(480,GY,210,Math.PI,0);ctx.fill();
      em('🌳',84,GY-38,68);em('🌴',556,GY-42,72);em('☁️',490,82,36);
      ctx.fillStyle='#4ade80';ctx.fillRect(0,GY,LW,10);
      ctx.fillStyle='#65a30d';ctx.fillRect(0,GY+10,LW,LH-GY-10);
    }else if(bgIdx===2){ // Đầm Lầy
      const g=ctx.createLinearGradient(0,0,0,GY);g.addColorStop(0,'#fed7aa');g.addColorStop(1,'#fef08a');
      ctx.fillStyle=g;ctx.fillRect(0,0,LW,GY);
      ctx.fillStyle='#94a3b8';ctx.beginPath();ctx.moveTo(40,GY);ctx.quadraticCurveTo(110,120,180,GY);ctx.moveTo(440,GY);ctx.quadraticCurveTo(520,110,600,GY);ctx.fill();
      em('🌾',64,GY-22,40);em('🌾',576,GY-22,40);em('🪷',180,GY+36,28);em('🪷',480,GY+42,28);
      ctx.fillStyle='#38bdf8';ctx.fillRect(0,GY,LW,LH-GY);
      ctx.fillStyle='#d97706';rr(140,GY-6,360,26,8);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=3;ctx.stroke();
    }else{ // Sân Nhà
      const g=ctx.createLinearGradient(0,0,0,GY);g.addColorStop(0,'#ede9fe');g.addColorStop(1,'#fae8ff');
      ctx.fillStyle=g;ctx.fillRect(0,0,LW,GY);
      ctx.fillStyle='#fef3c7';rr(456,68,110,84,8);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=3.5;ctx.stroke();
      em('🏮',110,88,36);em('🪴',58,GY-24,42);
      ctx.fillStyle='#d97706';ctx.fillRect(0,GY,LW,LH-GY);
      ctx.fillStyle='#b45309';ctx.fillRect(0,GY,LW,6);
    }
  }

  // ===== Porcelain Bowl (from scene-prototype.html) =====
  function bowl(x,y,w,h,empty,kind){
    const path=()=>{ctx.beginPath();ctx.moveTo(x-w/2,y-h);ctx.bezierCurveTo(x-w/2,y-h*.15,x-w*.26,y,x,y);ctx.bezierCurveTo(x+w*.26,y,x+w/2,y-h*.15,x+w/2,y-h);ctx.closePath()};
    if(!empty){
      ctx.fillStyle=kind==='pho'?'#fde68a':'#ffffff';
      ctx.beginPath();ctx.ellipse(x,y-h+2,w*.46,h*.42,0,Math.PI,0);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.stroke();
      if(kind==='pho'){
        ctx.strokeStyle='#f59e0b';ctx.lineWidth=2;
        for(let i=-2;i<=2;i++){ctx.beginPath();ctx.arc(x+i*8,y-h-2,6,0,Math.PI);ctx.stroke()}
      }
    }else{
      ctx.fillStyle='#cfd8e6';ctx.beginPath();ctx.ellipse(x,y-h,w/2,h*.2,0,0,7);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.stroke();
      ctx.fillStyle='#fff';for(let i=0;i<5;i++){ctx.beginPath();ctx.ellipse(x-w*.25+i*w*.12,y-h+hh(i,3)*4-1,3,1.4,hh(i,4)*3,0,7);ctx.fill()}
    }
    path();ctx.fillStyle='#fbfdff';ctx.fill();
    ctx.save();path();ctx.clip();ctx.fillStyle=kind==='pho'?'#dc2626':'#3b6fb6';ctx.fillRect(x-w/2,y-h*.7,w,h*.18);
    ctx.fillStyle='#fff';for(let i=0;i<9;i++)ctx.fillRect(x-w/2+4+i*(w/9),y-h*.66,w/20,h*.07);ctx.restore();
    path();ctx.strokeStyle=INK;ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle='#e0e8f2';rr(x-w*.17,y-3,w*.34,6,3);ctx.fill();ctx.stroke();
  }

  // ===== Universal Creature Renderer (hand-drawn full-body sprites) =====
  function drawActor(x,y,np,o){
    o=o||{};
    const info=LEX[np.noun]||LEX.mèo;
    if(!SPR[np.noun]||!EYES[np.noun])return drawActorLegacy(x,y,np,o);
    const isBig=np.adj==='lớn',isOld=np.adj==='già',isGreen=np.adj==='xanh';
    // lớn = the WHOLE body is bigger (1.52x vs a plain .86x), shadow included
    const sc=(o.baseScale||1.85)*(isBig?1.52:.86);
    const f=o.dir||1,t=G.t,fc=FACE[np.noun]||0,eyes=EYES[np.noun];
    ctx.save();ctx.translate(x,y);
    ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.ellipse(0,3,22*sc,4.5*sc,0,0,7);ctx.fill();
    ctx.scale(sc,sc);
    if(o.rot)ctx.rotate(o.rot);
    if(isGreen){
      ctx.save();ctx.strokeStyle='#10b981';ctx.lineWidth=2.5;ctx.setLineDash([4,3]);
      ctx.beginPath();ctx.ellipse(0,-27,28,32,0,0,7);ctx.stroke();ctx.restore();
    }
    ctx.save();
    if(o.active&&!o.sleep)ctx.translate(0,-Math.abs(Math.sin(t*9))*4);
    if(o.kick){ctx.translate(f*4,0);ctx.rotate(-f*.16)}
    if(o.full)ctx.scale(1.16,.98);
    spr(np.noun,0,0,66,{g:1,flip:fc!==0&&fc!==f},()=>{
      ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle=INK;
      if(o.sleep){
        eyes.forEach(e=>{ctx.fillStyle=info.col||'#ddd';ctx.beginPath();ctx.arc(e[0],e[1],7.5,0,7);ctx.fill();
          ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(e[0]-6,e[1]);ctx.quadraticCurveTo(e[0],e[1]+6,e[0]+6,e[1]);ctx.stroke()});
      }else if(o.angry){
        ctx.lineWidth=4;
        eyes.forEach((e,i)=>{const s=i===0?1:-1;ctx.beginPath();ctx.moveTo(e[0]-s*9,e[1]-10);ctx.lineTo(e[0]+s*6,e[1]-3);ctx.stroke()});
      }
      if(o.full){ctx.fillStyle='rgba(255,255,255,.45)';ctx.beginPath();ctx.ellipse(60,88,15,11,0,0,7);ctx.fill()}
      if(o.emptyBelly){ctx.save();ctx.strokeStyle='#ef4444';ctx.lineWidth=2.5;ctx.setLineDash([4,3]);ctx.beginPath();ctx.arc(60,88,13,0,7);ctx.stroke();ctx.restore()}
    });
    ctx.restore();
    if(o.sleep)em('💤',f*18,-62,15);
    if(isOld){
      ctx.fillStyle='#ffffff';ctx.strokeStyle=INK;ctx.lineWidth=1.8;
      ctx.beginPath();ctx.arc(0,-52,8,Math.PI,0);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(-6,-26);ctx.lineTo(6,-26);ctx.lineTo(0,-12);ctx.closePath();ctx.fill();ctx.stroke();
      em('🦯',f*24,-16,24);
    }
    if(isGreen)em('🌿',0,-64,20);
    if(o.tool)em(o.tool,f*24,-26,22);
    ctx.restore();
  }

  // ===== Legacy emoji-head actor (fallback only) =====
  function drawActorLegacy(x,y,np,o){
    o=o||{};
    const info=LEX[np.noun]||LEX.mèo;
    const isBig=np.adj==='lớn',isOld=np.adj==='già',isGreen=np.adj==='xanh';
    const sc=(o.baseScale||1.85)*(isBig?1.52:.86);
    const col=isGreen?'#2ecc71':info.col;
    const f=o.dir||1,t=G.t;
    ctx.save();ctx.translate(x,y);
    // Ground shadow
    ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.ellipse(0,3,22*sc,4.5*sc,0,0,7);ctx.fill();
    ctx.scale(sc,sc);
    if(o.rot)ctx.rotate(o.rot);
    ctx.lineCap='round';ctx.strokeStyle=INK;ctx.lineWidth=3;

    // Green aura ring when 'xanh' is applied so color is unmistakable
    if(isGreen){
      ctx.save();ctx.strokeStyle='#10b981';ctx.lineWidth=2.5;ctx.setLineDash([4,3]);
      ctx.beginPath();ctx.ellipse(0,-24,26,28,0,0,7);ctx.stroke();ctx.restore();
    }

    // Tail or wings
    if(info.tail){
      ctx.beginPath();ctx.moveTo(-f*12,-14);ctx.quadraticCurveTo(-f*32,-22+Math.sin(t*5)*4,-f*28,-42);
      ctx.lineWidth=5;ctx.strokeStyle=col;ctx.stroke();ctx.lineWidth=3;ctx.strokeStyle=INK;
    }
    if(info.wing){
      const w=Math.sin(t*(o.active?16:4))*.35;
      ctx.fillStyle=col;
      for(const s of[-1,1]){ctx.beginPath();ctx.ellipse(s*15,-24,7,13,s*(.4+w),0,7);ctx.fill();ctx.stroke()}
    }

    // Legs
    const kick=o.kick?f*14:0,walk=o.active?Math.sin(t*14)*5:0;
    ctx.beginPath();ctx.moveTo(-8,-10);ctx.lineTo(-9-walk,0);ctx.moveTo(8,-10);ctx.lineTo(9+walk+kick,kick?-12:0);ctx.stroke();

    // Body / Torso (inflates when full / 'rồi')
    const rx=o.full?23:15,ry=o.full?21:16;
    ctx.fillStyle=col;ctx.beginPath();ctx.ellipse(0,-21,rx,ry,0,0,7);ctx.fill();ctx.stroke();
    if(o.full){
      ctx.fillStyle='#ffe1bd';ctx.beginPath();ctx.ellipse(0,-18,14,13,0,0,7);ctx.fill();
    }
    if(o.emptyBelly){
      ctx.save();ctx.strokeStyle='#ef4444';ctx.lineWidth=1.8;ctx.setLineDash([3,2]);
      ctx.beginPath();ctx.arc(0,-19,9,0,7);ctx.stroke();ctx.restore();
    }

    // Arms
    ctx.beginPath();
    if(o.full){
      ctx.moveTo(-14,-22);ctx.quadraticCurveTo(-24,-10,-10,-12);
      ctx.moveTo(14,-22);ctx.quadraticCurveTo(24,-10,10,-12);
    }else{
      ctx.moveTo(-12,-24);ctx.lineTo(-18,-14+walk);
      ctx.moveTo(12,-24);ctx.lineTo(18+f*6,-16-walk);
    }
    ctx.stroke();
    if(isBig)em('💪',-f*20,-26,15);

    // Head
    if(o.sleep){
      em(info.em,0,-43,32,{flip:f<0});
      em('💤',f*18,-58,15);
    }else{
      em(o.angry?info.ang:info.em,0,-43,32,{flip:f<0});
    }

    // Adjective cues: 'già' (white hair tuft, long white beard, cane) & 'xanh' (green leaf sprout)
    if(isOld){
      ctx.fillStyle='#ffffff';ctx.strokeStyle=INK;ctx.lineWidth=1.8;
      ctx.beginPath();ctx.arc(0,-56,9,Math.PI,0);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(-7,-33);ctx.lineTo(7,-33);ctx.lineTo(0,-17);ctx.closePath();ctx.fill();ctx.stroke();
      em('🦯',f*22,-12,21);
    }
    if(isGreen){
      em('🌿',0,-61,18);
    }
    if(o.tool)em(o.tool,f*22,-24,20);
    ctx.restore();
  }

  // ===== Passive Food / Object Prop Renderer =====
  function drawProp(x,y,np,o){
    o=o||{};
    const info=LEX[np.noun]||LEX.cơm;
    const isBig=np.adj==='lớn',isOld=np.adj==='già',isGreen=np.adj==='xanh';
    const sc=(o.baseScale||1.8)*(isBig?1.55:.85);
    const done=!!o.done;
    ctx.save();ctx.translate(x,y);
    ctx.fillStyle='rgba(0,0,0,.18)';ctx.beginPath();ctx.ellipse(0,3,22*sc,4*sc,0,0,7);ctx.fill();
    ctx.scale(sc,sc);

    if(info.food==='rice'||info.food==='pho'){
      bowl(0,0,46,24,done,info.food);
    }else if(np.noun==='lửa'){
      ctx.fillStyle='#78350f';ctx.fillRect(-16,-5,32,6);
      if(!done)em('🔥',0,-22,34);else em('💨',0,-16,20);
    }else if(np.noun==='sách'){
      ctx.fillStyle=isGreen?'#10b981':'#3b82f6';
      rr(-18,-26,36,24,4);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.stroke();
      if(!done){ctx.fillStyle='#fff';ctx.fillRect(-14,-23,12,18);ctx.fillRect(2,-23,12,18)}
      else em('💡',0,-38,18);
    }else if(np.noun==='tre'){
      ctx.strokeStyle=isGreen?'#10b981':'#16a34a';ctx.lineWidth=9;
      if(!done){
        ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-48);ctx.stroke();
        ctx.strokeStyle='#bbf7d0';ctx.lineWidth=2;
        for(const yy of[-14,-28,-40]){ctx.beginPath();ctx.moveTo(-5,yy);ctx.lineTo(5,yy);ctx.stroke()}
      }else{
        ctx.beginPath();ctx.moveTo(-18,-4);ctx.lineTo(-4,-18);ctx.moveTo(4,-4);ctx.lineTo(20,-14);ctx.stroke();
      }
    }else if(np.noun==='ghế'){
      ctx.strokeStyle=isGreen?'#10b981':'#92400e';ctx.lineWidth=4.5;
      ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(-12,-34);ctx.moveTo(12,0);ctx.lineTo(12,-16);
      ctx.moveTo(-14,-16);ctx.lineTo(14,-16);ctx.stroke();
    }else if(np.noun==='hoa'){
      ctx.fillStyle='#b45309';ctx.beginPath();ctx.moveTo(-10,0);ctx.lineTo(10,0);ctx.lineTo(13,-14);ctx.lineTo(-13,-14);ctx.closePath();ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=2;ctx.stroke();
      if(!done)em(isGreen?'💠':'🌺',0,-28,26);
      else{em(isGreen?'💠':'🌺',-16,-6,20,{rot:.6});em('✂️',14,-18,18)}
    }else{
      // Plate with fruit/seed/corn
      ctx.fillStyle='#f8fafc';ctx.strokeStyle=INK;ctx.lineWidth=2.5;
      ctx.beginPath();ctx.ellipse(0,-3,24,6,0,0,7);ctx.fill();ctx.stroke();
      if(!done){
        if(isGreen){
          ctx.fillStyle='#2ecc71';ctx.beginPath();ctx.arc(0,-17,14,0,7);ctx.fill();ctx.stroke();
        }
        em(info.em,0,-18,28);
      }else{
        for(let i=-1;i<=1;i++){ctx.fillStyle='#b45309';ctx.beginPath();ctx.arc(i*7,-4,2,0,7);ctx.fill()}
      }
    }
    if(isOld){
      ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(-5,-12);ctx.lineTo(5,-12);ctx.lineTo(0,-2);ctx.fill();
      em('🦯',18,-12,18);
    }
    if(isGreen)em('🌿',0,-40,16);
    ctx.restore();
  }

  // ===== Generalized Living-Object / Monster Swallowed Scene (from riceEatsCat in scene-prototype.html) =====
  function drawLivingObjectEat(subj,obj,aspect){
    const sInfo=LEX[subj.noun]||LEX.cơm,oInfo=LEX[obj.noun]||LEX.mèo;
    const isBig=subj.adj==='lớn',isGreen=subj.adj==='xanh',isOld=subj.adj==='già';
    const sc=isBig?1.22:.92;
    const x=320,y=GY+34;
    ctx.save();ctx.translate(x,y);ctx.scale(sc,sc);
    ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.ellipse(0,3,88,9,0,0,7);ctx.fill();

    if(aspect==='rồi'){
      // Collar + bell left on the floor (evidence of 'rồi')
      ctx.strokeStyle='#d33';ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(-132,-6,19,6,0,0,7);ctx.stroke();em('🔔',-132,-12,19);
    }
    // Stub legs + feet
    ctx.lineCap='round';ctx.strokeStyle=INK;ctx.lineWidth=4;
    for(const s of[-28,28]){
      ctx.beginPath();ctx.moveTo(s,-10);ctx.lineTo(s*1.1,-1);ctx.stroke();
      ctx.fillStyle=INK;ctx.beginPath();ctx.ellipse(s*1.25,0,10,4.5,0,0,7);ctx.fill();
    }
    const cx=0,cy=-118,rx=70,ry=74;
    ctx.fillStyle=isGreen?'#4ade80':(sInfo.col||'#fffefa');
    ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,7);ctx.fill();
    ctx.strokeStyle=INK;ctx.lineWidth=3.5;ctx.stroke();

    // Grain texture for rice, or badge icon for fruit/food
    if(subj.noun==='cơm'){
      for(let i=0;i<75;i++){
        const a=hh(i,11)*6.283,r=Math.sqrt(hh(i,12)),gx=cx+Math.cos(a)*r*(rx-8),gy=cy+Math.sin(a)*r*(ry-8);
        if(Math.hypot(gx/52,(gy-(cy+22))/46)<1.1||Math.hypot(gx/54,(gy-(cy-34))/28)<1)continue;
        ctx.fillStyle='#fffefa';ctx.strokeStyle='rgba(150,130,90,.55)';ctx.lineWidth=1;
        ctx.beginPath();ctx.ellipse(gx,gy,5.5,2.4,hh(i,13)*3.14,0,7);ctx.fill();ctx.stroke();
      }
    }else{
      em(sInfo.em,0,cy-68,34);
    }
    if(isGreen)em('🌿',24,cy-76,24);
    if(isOld)em('🦯',86,-22,36);

    if(aspect==='rồi'){
      // See-through belly window with the swallowed creature pressing out of it
      const victimScale=obj.adj==='lớn'?1.28:.92;
      ctx.save();ctx.beginPath();ctx.ellipse(cx,cy+22,45,39,0,0,7);ctx.clip();
      ctx.fillStyle=obj.adj==='xanh'?'rgba(46,204,113,.5)':'rgba(214,170,120,.55)';
      ctx.fillRect(cx-60,cy-40,120,110);
      em(oInfo.ang||oInfo.em,cx,cy+24,Math.round(44*victimScale),{a:.92,rot:-.12});
      if(obj.adj==='xanh')em('🌿',cx,cy-2,18);
      if(obj.adj==='già')em('🦯',cx+22,cy+30,20);
      em('🐾',cx-26,cy+44,15,{a:.8,rot:-.4});em('🐾',cx+28,cy+40,15,{a:.8,rot:.4});
      ctx.restore();
      ctx.strokeStyle=INK;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(cx,cy+22,45,39,0,0,7);ctx.stroke();
      // Content face + burp bubble 'ợ!'
      ctx.strokeStyle=INK;ctx.lineWidth=3.5;
      for(const s of[-1,1]){ctx.beginPath();ctx.arc(cx+s*26,cy-48,9,Math.PI*1.1,Math.PI*1.9);ctx.stroke()}
      ctx.fillStyle='rgba(255,120,140,.55)';
      for(const s of[-1,1]){ctx.beginPath();ctx.arc(cx+s*46,cy-34,8,0,7);ctx.fill()}
      ctx.fillStyle='#7a2230';ctx.beginPath();ctx.ellipse(cx,cy-28,7,6.5,0,0,7);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.stroke();
      // Arms patting belly
      ctx.strokeStyle=INK;ctx.lineWidth=4;
      for(const s of[-1,1]){
        ctx.beginPath();ctx.moveTo(cx+s*(rx-2),cy+2);ctx.quadraticCurveTo(cx+s*(rx+16),cy+40,cx+s*42,cy+52);ctx.stroke();
        ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(cx+s*42,cy+52,6.5,0,7);ctx.fill();ctx.stroke();
      }
      if(subj.noun==='cơm'||subj.noun==='phở')bowl(0,-8,134,58,false,sInfo.food);
      em('💢',cx+60,cy+14,22);em('💢',cx-62,cy+20,16);
      ctx.save();ctx.translate(cx+82,cy-72);rr(0,-16,52,28,12);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=2.5;ctx.strokeStyle=INK;ctx.stroke();
      ctx.font='bold 17px system-ui,sans-serif';ctx.fillStyle=INK;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('ợ!',26,-2);
      ctx.restore();
    }else{
      // Non-'rồi': Living food monster chasing/chomping the creature on the right!
      ctx.fillStyle='#7a2230';ctx.beginPath();ctx.ellipse(cx+18,cy-18,22,18,0,0,7);ctx.fill();ctx.stroke();
      em('🦷',cx+12,cy-28,16);em('🦷',cx+24,cy-28,16);
      if(aspect==='chưa')em('⏳',cx,cy-95,30);
      if(aspect==='đang')em('⚡',cx-55,cy-60,26);
      ctx.restore();
      drawActor(470,GY+30,obj,{dir:-1,angry:true,active:aspect==='đang'});
      return;
    }
    ctx.restore();
  }

  // ===== Master Scene Renderer: parsed sentence -> picture =====
  function renderSceneContent(parsed,bgIdx){
    drawBackdrop(bgIdx);
    if(!parsed||parsed.kind==='gibberish'){
      G.words.forEach((w,i)=>{
        const x=200+i*66+hh(i,9)*10,y=GY-14-hh(i,5)*6;
        ctx.save();ctx.translate(x,y);ctx.rotate((hh(i,6)-.5)*1.1);
        rr(-30,-15,60,30,7);ctx.fillStyle='#fffdf7';ctx.fill();ctx.lineWidth=2.5;ctx.strokeStyle=INK;ctx.stroke();
        ctx.font='bold 16px system-ui';ctx.fillStyle=INK;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(w,0,1);
        ctx.restore();
      });
      em('❓',320,152,60);em('❔',250,124,28,{rot:-.3});em('❔',392,126,28,{rot:.3});
      txt('Hmm?',320,210,24);
      return;
    }

    const{subj,verb,obj,aspect}=parsed;
    const sLex=LEX[subj.noun]||LEX.mèo;

    // 1. Intransitive verbs (ngủ, hát, cười, bơi, múa, lặn)
    if(!obj){
      const bob=verb==='múa'||verb==='bơi'||verb==='lặn'?Math.sin(G.t*8)*8:0;
      drawActor(320,GY+32+bob,subj,{sleep:verb==='ngủ',active:verb!=='ngủ'});
      if(verb==='hát'){em('🎵',250,145,26);em('🎶',385,135,26)}
      else if(verb==='cười'){em('😂',255,140,26);em('😆',385,140,26)}
      else if(verb==='bơi'||verb==='lặn'){em('💦',250,185,26);em('🌊',385,215,28)}
      else if(verb==='múa'){em('✨',245,145,24);em('💃',390,145,24)}
      return;
    }

    // Special 2-word offscreen agent ('cười khỉ', 'múa gà')
    if(subj.offscreen){
      drawActor(360,GY+32,obj,{dir:-1,angry:true});
      em(verb==='cười'?'😂':'🥁',210,175,52);em('👉',265,185,32);
      return;
    }

    // 2. Inanimate object eating a creature ('cơm ăn mèo rồi', 'táo lớn ăn voi', etc.)
    if(verb==='ăn'&&!sLex.anim){
      drawLivingObjectEat(subj,obj,aspect);
      return;
    }

    // 3. Inanimate object acting on a person ('sách đọc bạn', 'tre cưa bạn', 'ghế ngồi bạn', 'hoa cắt bạn')
    if(!sLex.anim){
      if(verb==='ngồi'){
        // Chair sitting on top of the flattened friend!
        drawActor(320,GY+34,obj,{rot:1.55,angry:true});
        drawProp(320,GY-12,subj,{done:false,baseScale:2.1});
      }else{
        const tool={đọc:'🔍',cưa:'🪚',cắt:'✂️'}[verb]||'💥';
        drawProp(245,GY+30,subj,{done:false,baseScale:2.1});
        em('👀',245,GY-32,22);em(tool,310,GY-18,32);
        drawActor(410,GY+32,obj,{dir:-1,angry:true});
      }
      if(aspect==='rồi'){em('✨',210,130,24);em('✨',430,130,24)}
      return;
    }

    // 4. Standard Animate Subject + Transitive Verb + Object
    const isDone=aspect==='rồi',isProg=aspect==='đang',isNotYet=aspect==='chưa';
    const oLex=LEX[obj.noun]||LEX.cơm;

    if(verb==='ăn'){
      drawActor(255,GY+34,subj,{
        dir:1,full:isDone,emptyBelly:isNotYet,active:isProg,
        tool:isProg?'🥄':null
      });
      if(oLex.anim){
        // Predator-prey ('rắn ăn thỏ' / 'thỏ ăn rắn')
        if(!isDone){
          drawActor(415,GY+34,obj,{dir:-1,angry:true,active:isProg});
        }else{
          em('🔔',415,GY+26,22);em('🐾',445,GY+28,18);
        }
      }else{
        drawProp(415,GY+34,obj,{done:isDone});
      }
    }else if(verb==='ngồi'){
      if(isDone){
        drawProp(320,GY+34,obj,{done:false});
        drawActor(320,GY+4,subj,{dir:1});
      }else{
        drawActor(245,GY+34,subj,{dir:1,active:isProg});
        drawProp(405,GY+34,obj,{done:false});
      }
    }else{
      const toolMap={bắt:'🕸️',đá:'💥',đọc:'👓',cưa:'🪚',cắt:'✂️'};
      drawActor(245,GY+34,subj,{
        dir:1,active:isProg,kick:verb==='đá'&&(isProg||!isNotYet),
        tool:!isNotYet?toolMap[verb]:null
      });
      if(oLex.anim){
        drawActor(415,GY+34,obj,{dir:-1,angry:true,rot:verb==='đá'&&isDone?.45:0});
        if(verb==='bắt'&&isDone){
          ctx.strokeStyle='#475569';ctx.lineWidth=2.5;ctx.strokeRect(375,GY-55,80,90);
        }
      }else{
        drawProp(415,GY+34,obj,{done:isDone});
      }
    }

    // Aspect markers visual overlays (100% non-verbal)
    if(isDone){
      em('✨',200,135,24);em('✨',385,128,22);em('😌',255,112,20);
    }else if(isProg){
      em('⚡',330,135,26);em('💦',205,155,20);em('💨',195,215,20);
    }else if(isNotYet){
      em('⏳',330,122,32);em('💭',295,142,22);
    }
  }

  // ===== Goal Card (Top-Left Mục Tiêu Thumbnail + Smooth Intro Zoom) =====
  function drawGoalCard(){
    const z=Math.max(G.zoomGoal,G.peekGoal?1:0);
    const t=cl(z,0,1);
    const x=10+(122-10)*t,y=10+(74-10)*t,w=176+(396-176)*t,h=112+(224-112)*t;
    ctx.save();
    if(t>0.02){ctx.fillStyle=`rgba(15,23,42,${t*.55})`;ctx.fillRect(0,0,LW,LH)}
    ctx.translate(x,y);
    rr(0,0,w,h,12);ctx.fillStyle='rgba(255,255,255,.95)';ctx.fill();
    ctx.lineWidth=3.5;ctx.strokeStyle=INK;ctx.stroke();
    ctx.save();rr(4,18,w-8,h-22,9);ctx.clip();
    ctx.translate(4,18);ctx.scale((w-8)/LW,(h-22)/LH);
    renderSceneContent(G.goalParsed,SETS[G.set].bg);
    ctx.restore();
    txt('mục tiêu',w/2,10,12,'center','#ffd166');
    ctx.restore();
  }

  // ===== Word Tiles Rail + Check Button =====
  function drawRail(){
    G.tiles.forEach((t,i)=>{
      const isCur=i===G.cur&&G.mode==='play',isHeld=i===G.held||i===G.dragIdx;
      const sx=t.shk>0?(Math.random()-.5)*12*t.shk:0;
      const sy=t.shk>0?(Math.random()-.5)*8*t.shk:0;
      const px=(i===G.dragIdx?G.dragX:t.x)+sx;
      const py=(i===G.dragIdx?G.dragY:t.y+t.arcY+(isHeld?-8:0))+sy;
      ctx.save();ctx.translate(px,py);
      ctx.rotate(t.rot+(t.shk>0?(Math.random()-.5)*.28*t.shk:0));
      ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=isHeld?12:6;ctx.shadowOffsetY=isHeld?6:3;
      rr(-t.tw/2,-17,t.tw,34,8);
      // Plain ivory tile (no part-of-speech color coding!); flashes crimson when wrong
      ctx.fillStyle=t.red>.05?`rgb(255,${Math.round(253-160*t.red)},${Math.round(247-160*t.red)})`:(isHeld?'#fef08a':'#fffdf7');
      ctx.fill();ctx.shadowColor='transparent';
      ctx.lineWidth=isCur||isHeld?3.5:3;
      ctx.strokeStyle=t.red>.05?'#d62828':(isHeld?'#ca8a04':(isCur?'#38bdf8':INK));
      ctx.stroke();
      ctx.font='bold 21px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle=INK;ctx.fillText(t.w,0,1);
      ctx.restore();
    });

    // On-canvas Check ('⚡') pill button on the bottom right
    if(G.mode==='play'&&!G.whip){
      ctx.save();ctx.translate(572,334);
      rr(-48,-18,96,36,10);ctx.fillStyle='#22c55e';ctx.fill();
      ctx.lineWidth=3;ctx.strokeStyle=INK;ctx.stroke();
      txt('⚡ Thử',0,1,16,'center','#fff');
      ctx.restore();
    }
  }

  function drawHud(){
    for(let i=0;i<3;i++)em(i<G.hp?'❤️':'🖤',548+i*26,22,20);
    em('🧒',548,46,15,{raw:1});txt('×'+G.lives,562,46,13,'left');
    if(G.halfStars>0){
      const stars=(G.halfStars/2).toFixed(G.halfStars%2?1:0);
      txt('🤪 '+stars+'⭐',548,66,13,'left','#ffd166');
    }
    txt(SETS[G.set].n+' · '+(G.lv+1)+'/'+STAGES_PER_SET,365,62,12,'center','#cbd5e1');

    if(G.verdictT>0){
      ctx.save();ctx.translate(365,92);ctx.rotate(G.verdict==='Đúng rồi!'?0:-.04);
      txt(G.verdict,0,0,34,'center',G.verdictCol);
      ctx.restore();
    }
    // Bottom Vietnamese-only sentence bar
    ctx.fillStyle='rgba(0,0,0,.58)';rr(76,316,432,36,12);ctx.fill();
    txt('“'+G.words.join(' ')+'”',292,334,18,'center','#fff');
  }

  function drawTitle(){
    const end=G.mode==='end';
    drawBackdrop(Math.floor(G.t/4)%4);
    ctx.fillStyle='rgba(15,23,42,.52)';ctx.fillRect(0,0,LW,LH);
    txt('Câu Phá',LW/2,end?82:102,end?48:62,'center','#ffd166');
    if(end){
      txt('hoàn thành!',LW/2,152,48,'center','#7CFC9A');
      txt('qua hết '+SETS.length+' bộ · 🤪 '+(G.halfStars/2)+'⭐',LW/2,204,18);
    }else{
      txt('mèo ăn cơm rồi   ·   cơm ăn mèo rồi',LW/2,168,20);
    }
    const prompt=G.mode==='watch'?'👁 đang xem':(end?'chạm hoặc nhấn phím bất kỳ để chơi lại':'chạm hoặc nhấn phím bất kỳ để chơi');
    ctx.globalAlpha=.65+.35*Math.sin(G.t*4);txt(prompt,LW/2,LH-62,18);ctx.globalAlpha=1;
    if(!end&&G.mode!=='watch')txt('chạm 2 từ để đổi chỗ   ·   ⚡ kiểm tra câu',LW/2,LH-28,13);
  }

  // ===== Simulation Step (60fps) =====
  function tick(dt){
    G.t+=dt;
    G.shake=Math.max(0,G.shake-dt);
    G.verdictT=Math.max(0,G.verdictT-dt);
    if(G.zoomGoal>0)G.zoomGoal=Math.max(0,G.zoomGoal-dt*.95);

    for(const s of parts){s.t+=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.vy+=240*dt}
    parts=parts.filter(s=>s.t<s.l);
    for(let i=pops.length-1;i>=0;i--)if(G.t-pops[i].t>1.4)pops.splice(i,1);

    // Tile spring physics & whip-into-place choreography
    G.tiles.forEach(t=>{
      t.x+=(t.tx-t.x)*Math.min(1,dt*16);
      t.y+=(t.ty-t.y)*Math.min(1,dt*16);
      t.arcY*=(1-Math.min(1,dt*10));
      t.rot*=(1-Math.min(1,dt*12));
      if(!G.whip){
        t.red=Math.max(0,t.red-dt*2.4);
        t.shk=Math.max(0,t.shk-dt*3.2);
      }
    });

    if(G.whip){
      const w=G.whip;w.t+=dt;
      if(w.phase==='die'){
        if(w.t>=.65){G.whip=null;queue({a:'die',seq:G.seq});G.mode='wait';G.waitT=0}
      }else if(w.phase==='shake'){
        // Phase 1 (0 - 0.42s): Violent crimson shake
        if(w.t>=.42){
          w.phase='arc';w.t=0;
          const movingTile=G.tiles[w.from];
          if(!w.bounce&&w.from!==w.to){
            G.words=w.nextWords.slice();
            const item=G.tiles.splice(w.from,1)[0];
            G.tiles.splice(w.to,0,item);
            syncTiles(false);
          }
          if(movingTile){
            movingTile.arcY=-68;
            movingTile.rot=(w.to>=w.from?1:-1)*.45;
            puff(movingTile.x,movingTile.y,12,'#ff6b6b');
          }
          tone(300,.11,920,.16,'triangle');
        }
      }else if(w.phase==='arc'){
        // Phase 2 (0.42 - 0.84s): High-speed whip snap into slot
        if(w.t>=.42){
          const landed=G.tiles[w.to];
          if(landed)puff(landed.tx,landed.ty,10,'#ffd166');
          tone(180,.07,90,.12);
          G.tiles.forEach(t=>{t.red=0;t.shk=0});
          G.whip=null;
        }
      }
    }

    if(G.mode==='clear'){
      G.clearT-=dt;
      if(G.clearT<=0){queue({a:'clear',seq:G.seq});G.mode='wait';G.waitT=0}
    }else if(G.mode==='wait'){
      G.waitT+=dt;
      if(G.waitT>2.5&&G.lastOut&&!G.out&&G.seq>=0){G.waitT=0;G.out=G.lastOut}
    }
  }

  function draw(){
    ctx.setTransform(S*DPR,0,0,S*DPR,0,0);
    if(G.shake>0)ctx.translate((Math.random()-.5)*G.shake*14,(Math.random()-.5)*G.shake*14);
    if(G.mode==='title'||G.mode==='end'||G.mode==='watch'||(G.mode==='wait'&&G.seq<0)){
      drawTitle();return;
    }
    // Main stage shows the last-submitted sentence (or neutral waiting room before first check)
    if(G.shownParsed)renderSceneContent(G.shownParsed,SETS[G.set].bg);
    else{
      drawBackdrop(SETS[G.set].bg);
      em('❓',320,175,54,{a:.35});
    }
    for(const s of parts){ctx.globalAlpha=1-s.t/s.l;ctx.fillStyle=s.c;ctx.beginPath();ctx.arc(s.x,s.y,3,0,7);ctx.fill()}
    ctx.globalAlpha=1;
    for(const q of pops){const a=G.t-q.t;ctx.globalAlpha=cl(1-a/1.4,0,1);txt(q.s,q.x,q.y-a*22,q.sz,'center',q.col)}
    ctx.globalAlpha=1;

    drawHud();
    drawRail();
    drawGoalCard();
  }

  // ===== Pointer & Keyboard Input =====
  function canvasPos(e){
    const r=cv.getBoundingClientRect();
    return{x:(e.clientX-r.left)*(LW/r.width),y:(e.clientY-r.top)*(LH/r.height)};
  }
  cv.addEventListener('pointerdown',e=>{
    try{wrap.focus({preventScroll:true})}catch(err){}
    if(G.mode==='title'||G.mode==='end'){startRun();return}
    if(G.mode!=='play'||G.whip)return;
    const p=canvasPos(e);
    if(G.zoomGoal>0.05){G.zoomGoal=0;return}
    // Tap top-left mục tiêu card to peek/zoom
    if(p.x>=10&&p.x<=186&&p.y>=10&&p.y<=122){G.peekGoal=G.peekGoal?0:1;return}
    G.peekGoal=0;
    // Tap on-canvas '⚡ Thử' button
    if(p.x>=520&&p.x<=624&&p.y>=312&&p.y<=354){checkSentence();return}
    // Tap or drag a word tile on the rail
    for(let i=0;i<G.tiles.length;i++){
      const t=G.tiles[i];
      if(Math.abs(p.x-t.x)<=t.tw/2+6&&Math.abs(p.y-t.y)<=26){
        G.cur=i;
        if(G.held>=0&&G.held!==i){swapWords(G.held,i);G.held=-1;return}
        G.held=G.held===i?-1:i;
        G.dragIdx=i;G.dragX=p.x;G.dragY=p.y;
        tone(520,.05,660,.06);
        return;
      }
    }
    G.held=-1;
  });
  cv.addEventListener('pointermove',e=>{
    if(G.dragIdx<0)return;
    const p=canvasPos(e);G.dragX=p.x;G.dragY=p.y;
    for(let i=0;i<G.tiles.length;i++){
      if(i!==G.dragIdx&&Math.abs(p.x-G.tiles[i].tx)<G.tiles[i].tw*.45){
        const from=G.dragIdx;
        swapWords(from,i);
        G.dragIdx=i;G.held=-1;break;
      }
    }
  });
  const endDrag=()=>{G.dragIdx=-1};
  cv.addEventListener('pointerup',endDrag);
  cv.addEventListener('pointercancel',endDrag);

  function doKey(k){
    if(G.mode==='title'||G.mode==='end'){startRun();return}
    if(G.mode!=='play'||G.whip)return;
    const n=G.words.length;
    if(k==='left'){
      if(G.held>=0&&G.held>0){swapWords(G.held,G.held-1);G.held--;G.cur=G.held}
      else G.cur=(G.cur+n-1)%n;
    }else if(k==='right'){
      if(G.held>=0&&G.held<n-1){swapWords(G.held,G.held+1);G.held++;G.cur=G.held}
      else G.cur=(G.cur+1)%n;
    }else if(k==='swap'){
      G.held=G.held===G.cur?-1:G.cur;
      tone(500,.05,640,.06);
    }else if(k==='act'){
      G.held=-1;checkSentence();
    }
  }
  const KM={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'swap',KeyW:'swap',ArrowDown:'swap',KeyS:'swap',Space:'swap',Enter:'act',KeyX:'act',KeyJ:'act'};
  wrap.addEventListener('keydown',e=>{
    if(e.code==='Escape')return;
    const k=KM[e.code];if(!k)return;
    e.preventDefault();doKey(k);
  });
  bar.querySelectorAll('button[data-k]').forEach(b=>{
    b.addEventListener('pointerdown',e=>{e.preventDefault();doKey(b.dataset.k)});
  });

  // ===== Single rAF Loop + End-of-Frame Intent Flush =====
  let running=false,last=0;
  function flushOut(){if(G.out){const o=G.out;G.out=null;api.send(o)}}
  function frame(now){
    if(dead)return;
    now=typeof now==='number'?now:performance.now();
    const dt=Math.min(1/30,Math.max(0,(now-last)/1000));last=now;
    fit();tick(dt);draw();
    api.raf(frame);
    flushOut();
  }
  function ensureLoop(){if(running)return;running=true;last=performance.now();api.raf(frame)}
  function update(view){
    if(dead||!view)return;
    G.spec=!!api.isSpectator;
    ensureLoop();
    if(!view.run){if(G.spec)G.mode='watch';else if(!G.joined){G.joined=1;queue({a:'join'})}return}
    applyRun(view.run);
  }
  function destroy(){dead=true;try{if(AC)AC.close()}catch(e){}}
  api.setTimeout(()=>{try{wrap.focus({preventScroll:true})}catch(e){}},80);
  if(api.__tt)api.__tt({G,SETS,LEX,parseSentence,computeWhip,swapWords,checkSentence,tick,draw});
  return{update,destroy};
}