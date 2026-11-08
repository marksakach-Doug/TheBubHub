// Blight's drawing engine: wavy, tapered, self-avoiding limbs for trees, card-back roots,
// borders and the background root system. Pure geometry in, SVG path text out.
//
// Everything lives inside makeTrees() on purpose, exactly like MiniGo's makeEngine(): index.js
// turns makeTrees.toString() into a Web Worker's source, so this function has to be completely
// self-contained — no imports, no outer variables, no template literals, no import.meta.
// tests/blight_trees.mjs runs it in an empty VM context to prove that.
//
// Determinism is the rule that matters here. A card's art is drawn on EVERY player's screen from
// the same seed, so the result must be a pure function of (seed, kind, candidates). That is why
// art() searches a FIXED number of candidates rather than "as many as fit in N milliseconds" as
// MiniGo's bot does: a bot move is computed once and sent through reduce(), a picture is not.

export function makeTrees() {
  'use strict';
  var TAU = Math.PI * 2;
  function f1(v) { return Math.round(v * 10) / 10; }
  function seeded(s) {
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    var h = 2166136261, s = String(str);
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // ---------- limbs ----------
  function build(seed, P) {
    var r = seeded(seed), occ = {}, br = [];
    var ck = function (x, y) { return (x / P.cs | 0) * 10000 + (y / P.cs | 0); };
    var q = [{ x: P.sx, y: P.sy, a: P.sa + (r() - .5) * .3, len: P.len, w: P.w, d: 0 }];
    while (q.length && br.length < P.cap) {
      var o = q.shift(), st = P.step, n = Math.ceil(o.len / st);
      var A = (.35 + r() * .7) * P.wave, k = TAU / (P.wl * (.6 + r() * 1.2)), ph = r() * TAU;
      var x = o.x, y = o.y, wob = 0, X = [x], Y = [y], H = [];
      for (var i = 1; i <= n; i++) {
        var s = i * st; wob += (r() - .5) * P.noise;
        var h = o.a + wob + A * Math.sin(k * s + ph) * Math.min(1, s / 20);
        x += Math.cos(h) * st; y += Math.sin(h) * st;
        if (x < P.x0 || x > P.x1 || y < P.y0 || y > P.y1) break;
        if (P.cs && s > P.grace && occ[ck(x, y)]) break;
        X.push(x); Y.push(y); H.push(h);
      }
      var m = X.length - 1; if (m < 2) continue;
      if (P.cs) for (var j = 0; j <= m; j++) occ[ck(X[j], Y[j])] = 1;
      var w1 = Math.max(.5, o.w * .8), b = { X: X, Y: Y, H: H, w0: o.w, w1: w1, d: o.d, kids: 0 };
      br.push(b);
      if (o.d < P.maxd) {
        var e = H[m - 1], sp = (.3 + r() * .3) * P.spread, dir = r() < .5 ? 1 : -1, cw = w1 * .88;
        var add = function (x, y, a, len) {
          if (len >= P.minlen) { q.push({ x: x, y: y, a: a, len: len, w: Math.max(.5, cw), d: o.d + 1 }); b.kids++; }
        };
        add(X[m], Y[m], e + dir * sp * .35, o.len * P.persist * (.88 + r() * .24));
        if (r() < P.fork) add(X[m], Y[m], e - dir * (sp + .25 + r() * .45), o.len * (.6 + r() * .18));
        var ns = Math.floor(P.sides + r());
        for (var u = 0; u < ns; u++) {
          var t = .25 + r() * .6, kk = Math.max(1, Math.min(m - 1, Math.round(t * m)));
          add(X[kk], Y[kk], H[kk - 1] + (r() < .5 ? -1 : 1) * (.5 + r() * .7) * P.spread, o.len * (.4 + r() * .25));
        }
      }
    }
    return br;
  }
  function poly(b) {
    var n = b.X.length - 1, L = '', R = '';
    for (var i = 0; i <= n; i++) {
      var h = i == 0 ? b.H[0] : i == n ? b.H[n - 1] : (b.H[i - 1] + b.H[i]) / 2;
      var hw = (b.w0 + (b.w1 - b.w0) * i / n) / 2 * (i == n ? .15 : 1), nx = -Math.sin(h) * hw, ny = Math.cos(h) * hw;
      L += (i ? 'L' : 'M') + f1(b.X[i] + nx) + ' ' + f1(b.Y[i] + ny);
      R = 'L' + f1(b.X[i] - nx) + ' ' + f1(b.Y[i] - ny) + R;
    }
    return L + R + 'Z';
  }

  // ---------- a wobbling limb around a box or ellipse, with twigs growing outward ----------
  // dens = twig density 0..1 (0 = a clean wobbly outline, 1 = the full set of tendrils).
  function border(seed, w, h, ell, key, dens) {
    dens = dens == null ? 1 : dens;
    var r = seeded(seed), m = 14, pts = [], mn = Math.min(w, h);
    var tl = Math.min(36, Math.max(10, mn * .3)), thk = 2 + mn / 150, i;
    if (ell) {
      var a = w / 2, bb = h / 2, n = Math.max(24, Math.round(Math.PI * (a + bb) / 3));
      for (i = 0; i < n; i++) {
        var t = i / n * TAU, c = Math.cos(t), s = Math.sin(t), l = Math.hypot(c / a, s / bb);
        pts.push([a + a * c, bb + bb * s, c / a / l, s / bb / l]);
      }
    } else {
      var sides = [[0, 0, 1, 0, 0, -1], [w, 0, 0, 1, 1, 0], [w, h, -1, 0, 0, 1], [0, h, 0, -1, -1, 0]];
      for (var z = 0; z < 4; z++) {
        var sd = sides[z], L = sd[2] ? w : h;
        for (var q = 0; q < L; q += 3) pts.push([sd[0] + sd[2] * q, sd[1] + sd[3] * q, sd[4], sd[5]]);
      }
    }
    var N = pts.length, k = TAU * (2 + r() * 3), ph = r() * TAU, k2 = TAU * (7 + r() * 5), ph2 = r() * TAU, A = .7 + r() * .7, O = [], I = [];
    for (i = 0; i < N; i++) {
      var p = pts[i], tt = i / N, off = A * Math.sin(k * tt + ph) + .5 * Math.sin(k2 * tt + ph2);
      var hw = thk * (.8 + .4 * Math.sin(k2 * tt * .7 + ph)) / 2;
      O.push(f1(p[0] + p[2] * (off + hw)) + ' ' + f1(p[1] + p[3] * (off + hw)));
      I.push(f1(p[0] + p[2] * (off - hw)) + ' ' + f1(p[1] + p[3] * (off - hw)));
    }
    var tw = '', step = Math.max(2, Math.round(tl * 1.5 / 3));
    for (i = 0; i < N; i += step) {
      if (dens <= 0 || r() < 1 - .45 * dens) continue;
      var pp = pts[i];
      var T = build(hash(seed + ':' + i), { len: tl * (.6 + r() * .8), w: 1.9, fork: .5, sides: .7, spread: .9, wave: .9, wl: 26, noise: .1, persist: .85, minlen: 5, maxd: 2, cap: 5, sx: pp[0], sy: pp[1], sa: Math.atan2(pp[3], pp[2]) + (r() - .5) * 1.1, x0: -m + 1, x1: w + m - 1, y0: -m + 1, y1: h + m - 1, step: 2, grace: 99, cs: 0 });
      for (var y = 0; y < T.length; y++) tw += poly(T[y]);
    }
    return '<svg class="bd" data-k="' + key + '" width="' + (w + 2 * m) + '" height="' + (h + 2 * m) + '" viewBox="' + (-m) + ' ' + (-m) + ' ' + (w + 2 * m) + ' ' + (h + 2 * m) + '"><path fill-rule="evenodd" d="M' + O.join('L') + 'ZM' + I.join('L') + 'Z"/><path d="' + tw + '"/></svg>';
  }

  // borderDOM: the same wobbly outline as border(), returned as a DOM element so a
  // game can render it without innerHTML.
  function borderDOM(seed, w, h, ell, key, dens) {
    dens = dens == null ? 1 : dens;
    var r = seeded(seed), mm = 14, pts = [], mn = Math.min(w, h);
    var tl = Math.min(36, Math.max(10, mn * .3)), thk = 2 + mn / 150, i;
    if (ell) {
      var a = w / 2, bb = h / 2, n = Math.max(24, Math.round(Math.PI * (a + bb) / 3));
      for (i = 0; i < n; i++) {
        var t = i / n * TAU, c = Math.cos(t), s = Math.sin(t), l = Math.hypot(c / a, s / bb);
        pts.push([a + a * c, bb + bb * s, c / a / l, s / bb / l]);
      }
    } else {
      var sides = [[0, 0, 1, 0, 0, -1], [w, 0, 0, 1, 1, 0], [w, h, -1, 0, 0, 1], [0, h, 0, -1, -1, 0]];
      for (var z = 0; z < 4; z++) {
        var sd = sides[z], L = sd[2] ? w : h;
        for (var q = 0; q < L; q += 3) pts.push([sd[0] + sd[2] * q, sd[1] + sd[3] * q, sd[4], sd[5]]);
      }
    }
    var N = pts.length, k = TAU * (2 + r() * 3), ph = r() * TAU, k2 = TAU * (7 + r() * 5), ph2 = r() * TAU, A = .7 + r() * .7, O = [], I = [];
    for (i = 0; i < N; i++) {
      var p = pts[i], tt = i / N, off = A * Math.sin(k * tt + ph) + .5 * Math.sin(k2 * tt + ph2);
      var hw = thk * (.8 + .4 * Math.sin(k2 * tt * .7 + ph)) / 2;
      O.push(f1(p[0] + p[2] * (off + hw)) + ' ' + f1(p[1] + p[3] * (off + hw)));
      I.push(f1(p[0] + p[2] * (off - hw)) + ' ' + f1(p[1] + p[3] * (off - hw)));
    }
    var tw = '', step = Math.max(2, Math.round(tl * 1.5 / 3));
    for (i = 0; i < N; i += step) {
      if (dens <= 0 || r() < 1 - .45 * dens) continue;
      var pp = pts[i];
      var T = build(hash(seed + ':' + i), { len: tl * (.6 + r() * .8), w: 1.9, fork: .5, sides: .7, spread: .9, wave: .9, wl: 26, noise: .1, persist: .85, minlen: 5, maxd: 2, cap: 5, sx: pp[0], sy: pp[1], sa: Math.atan2(pp[3], pp[2]) + (r() - .5) * 1.1, x0: -mm + 1, x1: w + mm - 1, y0: -mm + 1, y1: h + mm - 1, step: 2, grace: 99, cs: 0 });
      for (var y = 0; y < T.length; y++) tw += poly(T[y]);
    }
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bd');
    svg.setAttribute('data-k', key);
    svg.setAttribute('width', w + 2 * mm);
    svg.setAttribute('height', h + 2 * mm);
    svg.setAttribute('viewBox', -mm + ' ' + -mm + ' ' + (w + 2 * mm) + ' ' + (h + 2 * mm));
    var p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p1.setAttribute('fill-rule', 'evenodd');
    p1.setAttribute('d', 'M' + O.join('L') + 'ZM' + I.join('L') + 'Z');
    svg.appendChild(p1);
    if (tw) {
      var p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p2.setAttribute('d', tw);
      svg.appendChild(p2);
    }
    return svg;
  }


  // ---------- card art ----------
  // A living card is ONE flower colour (shades and tints of it) on healthy greens. The dark, jagged
  // charcoal look belongs to the Dead Tree alone, so a reveal reads at a glance.
  var BLOOMS = [
    { n: 'Crimson',        c: '#c8102e', ctr: '#ffe9a8' },
    { n: 'Marigold',       c: '#f2a900', ctr: '#7a3e00' },
    { n: 'Cobalt violet',  c: '#6a40c9', ctr: '#ffe27a' },
    { n: 'Sunburst yellow', c: '#ffd60a', ctr: '#8a4b08' },
    { n: 'Coral pink',     c: '#ff6f61', ctr: '#fff1b8' }
  ];
  var GREENS = ['#2e8b57', '#4caf50', '#7cb342', '#1b9a7a', '#9ccc3c'];
  function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); }
  // v < 0 darkens towards black, v > 0 lightens towards white; |v| is the mix amount (0..1).
  function shade(hex, v) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    var t = v < 0 ? 0 : 255, k = Math.abs(v);
    return '#' + hex2(r + (t - r) * k) + hex2(g + (t - g) * k) + hex2(b + (t - b) * k);
  }

  function params(c, r) {
    var dead = c.k === 'D';
    var P = dead
      ? { len: 24 + r() * 8, w: 5 + r() * 2, fork: .45 + r() * .35, sides: .5 + r() * .8, spread: .7 + r() * .6, wave: .5 + r() * .9, wl: 60 + r() * 80, noise: .1, persist: .8 + r() * .08, minlen: 7, maxd: 5, cap: 34 }
      : { len: 22 + r() * 8, w: 3.8 + r() * 1.6, fork: .35 + r() * .3, sides: .4 + r() * .7, spread: .7 + r() * .5, wave: .4 + r() * .7, wl: 70 + r() * 70, noise: .08, persist: .82, minlen: 7, maxd: 4, cap: 24 };
    P.sx = 50; P.sy = 139; P.sa = -Math.PI / 2; P.x0 = 5; P.x1 = 95; P.y0 = 6; P.y1 = 140; P.step = 2.5; P.grace = 8; P.cs = 5;
    return P;
  }

  // The generator draws inside a 100 x 140 card. This measures what it really drew (limbs, leaf tips,
  // petals) and returns the scale + shift that makes that fill most of the card, base on the bottom edge.
  // Applied as one transform on the art group, so the geometry itself is never touched.
  var FILL_W = 86, FILL_H = 122, MAXSCALE = 2.4;      // 86/100 and 122/140: the limiting side lands near 87%
  function fit(art, T) {
    var x0 = 999, x1 = -999, y0 = 999, y1 = -999, i, j;
    function pt(x, y, pad) { if (x - pad < x0) x0 = x - pad; if (x + pad > x1) x1 = x + pad; if (y - pad < y0) y0 = y - pad; if (y + pad > y1) y1 = y + pad; }
    for (i = 0; i < T.length; i++) {
      var b = T[i], m = b.X.length - 1;
      for (j = 0; j <= m; j++) pt(b.X[j], b.Y[j], (b.w0 + (b.w1 - b.w0) * j / m) / 2);
    }
    for (i = 0; i < art.lv.length; i++) {            // a leaf points 13 units out along its own angle
      var l = art.lv[i], a = l.a / 57.2958;
      pt(l.x, l.y, 3.6 * l.s);
      pt(l.x + Math.sin(a) * 13 * l.s, l.y - Math.cos(a) * 13 * l.s, 3.6 * l.s);
    }
    for (i = 0; i < art.fl.length; i++) pt(art.fl[i].x, art.fl[i].y, 5.4 * art.fl[i].s);
    var bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    var s = Math.min(FILL_W / bw, FILL_H / bh, MAXSCALE);
    art.tf = { s: Math.round(s * 1000) / 1000, x: Math.round((50 - s * (x0 + x1) / 2) * 10) / 10, y: Math.round((139 - s * y1) * 10) / 10 };
    art.fill = { w: Math.round(bw * s) / 100, h: Math.round(bh * s) / 140 };      // share of the card face, for tests
  }

  // One tree, one draw: the original geometry, now with its own colour stream and a fit-to-card scale. c = { s: seed, k: 'P' | 'D' }.
  function draw(c) {
    var r = seeded(c.s ^ 0x9e3779b9), dead = c.k === 'D';
    var rc = seeded(c.s ^ 0x7f4a7c15);                       // colours only: never touches the geometry stream
    var bloom = BLOOMS[rc() * BLOOMS.length | 0];
    var P = params(c, r);
    var T = build(c.s, P), art = { br: [], lv: [], fl: [], total: 0 }, i;
    for (i = 0; i < T.length; i++) {
      var b = T[i]; b.dl = b.d * .28;
      art.br.push({ d: poly(b), ox: f1(b.X[0]), oy: f1(b.Y[0]), dl: b.dl, dp: b.d });
      art.total = Math.max(art.total, b.dl);
    }
    if (!dead) {
      // r() is still consumed exactly as before so every leaf and flower keeps its place; only the colour changes.
      var lc = function () { r(); r(); return shade(GREENS[rc() * GREENS.length | 0], (rc() - .5) * .22); };
      for (i = 0; i < T.length; i++) {
        var br = T[i], m = br.X.length - 1;
        if (br.d >= 1) {
          for (var j = Math.ceil(m * .35), sd = r() < .5 ? 1 : -1; j <= m && art.lv.length < 44; j += 2, sd = -sd) {
            art.lv.push({ x: f1(br.X[j]), y: f1(br.Y[j]), a: Math.round((br.H[j - 1] + sd * (.8 + r() * .5)) * 57.3 + 90), s: f1(.7 + r() * .6), c: lc(), dl: br.dl + .25 + j / m * .3 });
          }
        }
        if (br.kids === 0 && art.fl.length < 7 && r() < .75) {
          r();
          art.fl.push({ x: f1(br.X[m]), y: f1(br.Y[m]), a: Math.floor(r() * 72), s: f1(1.5 + r() * .8), c: shade(bloom.c, (rc() - .45) * .5), c2: bloom.ctr, dl: br.dl + .5 });
        }
      }
      for (i = 0; i < art.lv.length; i++) art.total = Math.max(art.total, art.lv[i].dl);
      for (i = 0; i < art.fl.length; i++) art.total = Math.max(art.total, art.fl[i].dl);
    }
    art.total += .7;
    art.hue = dead ? '' : bloom.n;
    fit(art, T);
    art.T = T;                       // kept for scoring; stripped before the art leaves the engine
    return art;
  }

  // ---------- card-back roots and the table's background roots ----------
  function roots(c) {
    var r = seeded(c.s ^ 0x51ed270b);
    var T = build(c.s ^ 7, { len: 50 + r() * 14, w: 3.2, fork: .4, sides: .6, spread: .9, wave: .6, wl: 60, noise: .1, persist: .85, minlen: 9, maxd: 2, cap: 8, sx: 50 + (r() - .5) * 30, sy: 140, sa: -Math.PI / 2, x0: 4, x1: 96, y0: 6, y1: 141, step: 3, grace: 8, cs: 5 });
    var out = [];
    for (var i = 0; i < T.length; i++) out.push({ d: poly(T[i]), ox: f1(T[i].X[0]), oy: f1(T[i].Y[0]), dl: T[i].d * .22 });
    return out;
  }
  // Nine roots running in from the rim of the table's ellipse. first=true adds the grow-in animation.
  function bgroots(w, h, first) {
    var cx = w / 2, cy = h / 2, a = w * .45, b = h * .39, s = '';
    for (var i = 0; i < 9; i++) {
      var t0 = (i / 9 + .04) * TAU, c = Math.cos(t0), sn = Math.sin(t0);
      var T = build(1000 + i, { len: Math.min(w, h) * .3, w: 10, fork: .5, sides: 1.1, spread: .9, wave: .6, wl: 70, noise: .12, persist: .85, minlen: 12, maxd: 3, cap: 10, sx: cx + a * c, sy: cy + b * sn, sa: Math.atan2(sn / b, c / a) + (i % 3 - 1) * .25, x0: -20, x1: w + 20, y0: -20, y1: h + 60, step: 6, grace: 40, cs: 10 });
      for (var j = 0; j < T.length; j++) {
        var br = T[j];
        s += '<path d="' + poly(br) + '"' + (first ? ' class="gr" style="transform-origin:' + f1(br.X[0]) + 'px ' + f1(br.Y[0]) + 'px;animation-delay:' + (.2 + br.d * .4 + i * .08).toFixed(2) + 's"' : '') + '/>';
      }
    }
    return s;
  }

  // bgrootsDOM: the same nine background roots as bgroots(), returned as a DOM
  // element so a game can render it without innerHTML.
  function bgrootsDOM(w, h, first) {
    var cx = w / 2, cy = h / 2, a = w * .45, b = h * .39, svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'rt');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 9; i++) {
      var t0 = (i / 9 + .04) * TAU, c = Math.cos(t0), sn = Math.sin(t0);
      var T = build(1000 + i, { len: Math.min(w, h) * .3, w: 10, fork: .5, sides: 1.1, spread: .9, wave: .6, wl: 70, noise: .12, persist: .85, minlen: 12, maxd: 3, cap: 10, sx: cx + a * c, sy: cy + b * sn, sa: Math.atan2(sn / b, c / a) + (i % 3 - 1) * .25, x0: -20, x1: w + 20, y0: -20, y1: h + 60, step: 6, grace: 40, cs: 10 });
      for (var j = 0; j < T.length; j++) {
        var br = T[j];
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', poly(br));
        if (first) p.setAttribute('class', 'gr');
        p.setAttribute('style', 'transform-origin:' + f1(br.X[0]) + 'px ' + f1(br.Y[0]) + 'px;animation-delay:' + (.2 + br.d * .4 + i * .08).toFixed(2) + 's');
        svg.appendChild(p);
      }
    }
    return svg;
  }


  // ---------- is this a good-looking tree? ----------
  // Plain geometry, no taste: where the crown reaches, whether it leans, how wide it is, whether the
  // card is left empty, and (living trees) whether there are enough leaves and flowers that are not
  // piled on one another. Every term is 0..1 and the score is their geometric mean, so a tree that
  // fails badly at any one thing cannot be rescued by being good at the others.
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function terms(a, dead) {
    var T = a.T, i, j, top = 999, mass = 0, mx = 0, ink = 0, minX = 999, maxX = -999;
    for (i = 0; i < T.length; i++) {
      var b = T[i], m = b.X.length - 1;
      for (j = 0; j <= m; j++) {
        var w = b.w0 + (b.w1 - b.w0) * j / m, y = b.Y[j], x = b.X[j];
        if (y - w / 2 < top) top = y - w / 2;
        ink += w * 2.5;
        if (y < 112) { mass += w; mx += w * x; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      }
    }
    var cx = mass ? mx / mass : 50, width = mass ? maxX - minX : 0, height = 139 - top;
    var t = {};
    t.reach = clamp01((height - 60) / ((dead ? 100 : 95) - 60));          // does it grow up the card, or crawl?
    // Does the mass sit over the trunk? A dead tree is allowed to lean — that is its character.
    t.lean = dead ? clamp01(1 - Math.max(0, Math.abs(cx - 50) - 13) / 22) : clamp01(1 - Math.max(0, Math.abs(cx - 50) - 7) / 16);
    t.width = clamp01(width / 30) * clamp01((96 - width) / 14);          // not a single stick, not wall to wall
    t.aspect = clamp01((height / Math.max(width, 1)) / 1.1);             // taller than it is wide
    t.ink = clamp01(ink / (dead ? 330 : 250));                           // something is actually drawn
    if (!dead) {
      var lv = a.lv, fl = a.fl, over = 0;
      for (i = 0; i < fl.length; i++) for (j = i + 1; j < fl.length; j++) {
        if (Math.hypot(fl[i].x - fl[j].x, fl[i].y - fl[j].y) < 5.5) over++;
      }
      t.leaves = clamp01(lv.length / 16);
      t.flowers = clamp01(fl.length / 3);
      t.clump = clamp01(1 - over * .2);
    } else {
      t.limbs = clamp01(T.length / 9);                                   // gnarled, not a lone twig
    }
    return t;
  }
  function score(a, dead) {
    var t = terms(a, dead), s = 0, n = 0, mn = 1, k;
    for (k in t) { s += Math.log(Math.max(.03, t[k])); n++; if (t[k] < mn) mn = t[k]; }
    var g = Math.exp(s / n);
    return mn < .3 ? g * mn / .3 : g;      // one catastrophic failure cannot hide behind seven good terms
  }

  // The floor. A tree below it is not worth showing; a tree at or above it is shown as drawn.
  var FLOOR = 0.62, MAXTRY = 24;

  // The public face. Candidate 0 is the card's own seed — exactly the tree the plain generator draws,
  // so every card that is already good looks as it always did. Only a card that fails the floor is
  // redrawn from the next deterministic seed (same on every screen), up to MAXTRY times; if none
  // passes, the best candidate seen wins. The search is fixed-size, never time-boxed.
  function art(c, floor, tries) {
    floor = floor == null ? FLOOR : floor; tries = tries || MAXTRY;
    var dead = c.k === 'D', best = null, bq = -1;
    for (var i = 0; i < tries; i++) {
      var cand = { s: i === 0 ? c.s : hash(c.s + ':' + i), k: c.k };
      var a = draw(cand), q = score(a, dead);
      if (q > bq) { bq = q; best = a; best.n = i; }
      if (q >= floor) break;
    }
    best.q = Math.round(bq * 1000) / 1000;
    delete best.T;
    return best;
  }

  // Swirling inward spiral vines for the full-screen victory overlay (3.5x scale).
  function victoryDOM(seed, w, h, leafPath, petPath) {
    var r = seeded(seed ^ 0x5f3759df), rc = seeded(seed ^ 0x7f4a7c15);
    var bloom = BLOOMS[rc() * BLOOMS.length | 0];
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'vic-svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var cx = w / 2, cy = h / 2, minD = Math.min(w, h) * 0.22, maxD = Math.hypot(cx, cy);
    var corners = [[0, 0], [w, 0], [w, h], [0, h], [w * 0.5, 0], [w * 0.5, h], [0, h * 0.5], [w, h * 0.5]];
    for (var v = 0; v < corners.length; v++) {
      var sx = corners[v][0], sy = corners[v][1];
      var baseA = Math.atan2(cy - sy, cx - sx) + 0.65; // spiral tangent inward
      var q = [{ x: sx, y: sy, a: baseA, len: maxD * 0.85, w: 15, d: 0, dl: v * 0.12 }];
      while (q.length) {
        var o = q.shift(), st = 8, n = Math.ceil(o.len / st);
        var x = o.x, y = o.y, X = [x], Y = [y], H = [], wob = 0;
        for (var i = 1; i <= n; i++) {
          var dx = cx - x, dy = cy - y, dist = Math.hypot(dx, dy);
          if (dist < minD) break; // frame the central banner without covering it
          var inwardA = Math.atan2(dy, dx) + 0.58; // bezier/spiral curve around center
          wob += (r() - 0.5) * 0.14;
          var hAng = inwardA + wob + 0.25 * Math.sin(i * 0.18 + v);
          x += Math.cos(hAng) * st; y += Math.sin(hAng) * st;
          X.push(x); Y.push(y); H.push(hAng);
        }
        var m = X.length - 1; if (m < 2) continue;
        var br = { X: X, Y: Y, H: H, w0: o.w, w1: Math.max(2, o.w * 0.55) };
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', poly(br));
        p.setAttribute('class', 'gr stem-p');
        p.setAttribute('style', 'transform-origin:' + f1(X[0]) + 'px ' + f1(Y[0]) + 'px;animation-delay:' + o.dl.toFixed(2) + 's');
        svg.appendChild(p);
        if (o.d < 2) {
          var mid = Math.floor(m * (0.35 + r() * 0.35));
          q.push({ x: X[mid], y: Y[mid], a: H[mid - 1] + (r() < 0.5 ? -0.7 : 0.7), len: o.len * 0.55, w: o.w * 0.65, d: o.d + 1, dl: o.dl + 0.25 });
        }
        for (var j = 2; j <= m; j += 3) {
          var lScale = f1(2.8 + r() * 1.4), lAng = Math.round((H[j - 1] + (j % 2 ? 0.9 : -0.9)) * 57.3 + 90);
          var lg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          lg.setAttribute('transform', 'translate(' + f1(X[j]) + ' ' + f1(Y[j]) + ') rotate(' + lAng + ') scale(' + lScale + ')');
          var lp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          lp.setAttribute('d', leafPath);
          lp.setAttribute('style', 'fill:' + shade(GREENS[rc() * GREENS.length | 0], (rc() - 0.5) * 0.2) + ';animation:gr .6s cubic-bezier(.2,.9,.3,1.15) ' + (o.dl + j * 0.03).toFixed(2) + 's both;transform-origin:0 0');
          lg.appendChild(lp); svg.appendChild(lg);
        }
        var fg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        fg.setAttribute('transform', 'translate(' + f1(X[m]) + ' ' + f1(Y[m]) + ') rotate(' + Math.floor(r() * 72) + ') scale(' + f1(3.2 + r() * 1.0) + ')');
        var fin = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        fin.setAttribute('class', 'gr'); fin.setAttribute('style', 'animation-delay:' + (o.dl + 0.45).toFixed(2) + 's');
        var fp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fp.setAttribute('d', petPath); fp.setAttribute('style', 'fill:' + shade(bloom.c, (rc() - 0.45) * 0.4));
        var fc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        fc.setAttribute('r', '1.5'); fc.setAttribute('style', 'fill:' + bloom.ctr);
        fin.appendChild(fp); fin.appendChild(fc); fg.appendChild(fin); svg.appendChild(fg);
      }
    }
    return svg;
  }

  return { hash: hash, seeded: seeded, build: build, poly: poly, border: border, borderDOM: borderDOM, draw: draw, score: score, terms: terms, art: art, roots: roots, bgroots: bgroots, bgrootsDOM: bgrootsDOM, TAU: TAU, FLOOR: FLOOR, MAXTRY: MAXTRY, BLOOMS: BLOOMS, GREENS: GREENS, shade: shade, victoryDOM: victoryDOM };
}

export const trees = makeTrees();
