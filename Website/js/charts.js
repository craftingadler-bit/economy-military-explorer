/* Canvas charts: scatter / density plot and the annual-correlation line.
 * Colors come from CSS custom properties, so both themes work without extra code.
 * With spec.transition a chart animates from its previous state to the new one. */
(function (root) {
  'use strict';
  const Charts = {};

  Charts.token = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };
  /* chart text grows with the root font size (larger on big screens and projectors) */
  Charts.scale = function () {
    return Math.max(1, (parseFloat(getComputedStyle(document.documentElement).fontSize) || 15) / 15);
  };

  function setupCanvas(canvas, width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /* ---------- animation helpers ---------- */
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  Charts.reduceMotion = reduceMotion;

  /* one running animation per canvas; every new draw cancels it */
  function stop(canvas) {
    const a = canvas._anim;
    if (a) { cancelAnimationFrame(a.raf); canvas._anim = null; }
    return a;
  }
  function animate(canvas, kind, dur, frame, done) {
    const a = canvas._anim = { kind, raf: 0, t0: performance.now(), cur: null };
    const tick = now => {
      if (canvas._anim !== a) return;
      const u = (now - a.t0) / dur;
      if (u >= 1) { canvas._anim = null; done(); return; }
      frame(clamp01(u), a);
      a.raf = requestAnimationFrame(tick);
    };
    frame(0, a); // first frame right away, so the cleared canvas never flashes
    a.raf = requestAnimationFrame(tick);
  }
  Charts.isAnimating = canvas => !!canvas._anim;
  Charts.stop = canvas => { if (canvas) stop(canvas); };
  function copyBitmap(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    if (src.width && src.height) c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }
  Charts.snapshot = copyBitmap;
  /* zoom between two ranges at a constant rate around the point that stays in place */
  function lerpRange(a, b, e) {
    const w0 = a[1] - a[0], w1 = b[1] - b[0];
    if (!(w0 > 0 && w1 > 0) || Math.abs(w1 / w0 - 1) < 1e-3) return [lerp(a[0], b[0], e), lerp(a[1], b[1], e)];
    const p = (b[0] * w0 - a[0] * w1) / (w0 - w1), w = w0 * Math.pow(w1 / w0, e), lo = p - (p - a[0]) * (w / w0);
    return [lo, lo + w];
  }
  const sameRange = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= 1e-7 * (Math.abs(a[1] - a[0]) + Math.abs(b[1] - b[0]) + 1e-12);

  /* ---------- ticks ---------- */
  Charts.niceTicks = function (lo, hi, count) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  };
  function logTicks(lo, hi) {
    const out = [], a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
    const mult = b - a <= 2 ? [1, 2, 5] : b - a <= 4 ? [1, 3] : [1];
    for (let e = a; e <= b; e++) for (const m of mult) { const v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(v); }
    return out;
  }

  Charts.extent = function (arr, logOnly) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (!isFinite(v) || (logOnly && v <= 0)) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    return [lo, hi];
  };
  function pad(domain, log) {
    let [lo, hi] = domain;
    if (!isFinite(lo)) return [0, 1];
    if (log) { const f = Math.pow(hi / lo, 0.04) || 1.1; return [lo / f, hi * f]; }
    if (hi === lo) { lo -= 1; hi += 1; }
    const p = (hi - lo) * 0.04;
    return [lo - p, hi + p];
  }

  /* marker shapes: a second cue next to color for each group */
  function drawMark(ctx, shape, x, y, r) {
    switch (shape) {
      case 'square': ctx.fillRect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76); return;
      case 'triangle': ctx.beginPath(); ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.15, y + r * 0.8); ctx.lineTo(x - r * 1.15, y + r * 0.8); ctx.closePath(); ctx.fill(); return;
      case 'triDown': ctx.beginPath(); ctx.moveTo(x, y + r * 1.25); ctx.lineTo(x + r * 1.15, y - r * 0.8); ctx.lineTo(x - r * 1.15, y - r * 0.8); ctx.closePath(); ctx.fill(); return;
      case 'diamond': ctx.beginPath(); ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.1, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.1, y); ctx.closePath(); ctx.fill(); return;
      case 'plus': ctx.fillRect(x - r * 1.25, y - r * 0.42, r * 2.5, r * 0.84); ctx.fillRect(x - r * 0.42, y - r * 1.25, r * 0.84, r * 2.5); return;
      case 'ring': ctx.beginPath(); ctx.arc(x, y, r * 0.95, 0, 6.2832); ctx.lineWidth = Math.max(1, r * 0.55); ctx.stroke(); return;
      case 'x': ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.lineWidth = Math.max(1, r * 0.6); ctx.stroke(); return;
      default: ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
  }

  /* ---------- scatter / density ----------
   * A frame holds everything needed to draw one state; a geometry maps data to pixels
   * for a given (possibly interpolated) domain. x is handled in "t space": log10 on a log axis. */
  const MAX_MORPH = 40000; // above this many points a transition cross-fades instead of moving each point

  function frameOf(spec) {
    const W = spec.width, H = spec.height, k = Charts.scale();
    const m = { l: Math.round(70 * k), r: 14, t: 12, b: Math.round(48 * k) };
    const xLog = !!spec.xLog, n = spec.x.length;
    // a zoomed view uses its exact bounds; otherwise add a little air around the data
    const xd = spec.exact ? spec.xDomain.slice() : pad(spec.xDomain, xLog), yd = spec.exact ? spec.yDomain.slice() : pad(spec.yDomain, false);
    const r = n < 1500 ? 3.2 : n < 8000 ? 2.4 : n < 40000 ? 1.8 : 1.3;
    const alpha = n < 1500 ? 0.8 : n < 8000 ? 0.55 : n < 40000 ? 0.35 : 0.22;
    const colored = !!spec.color, shaped = colored && n <= 20000;
    // colored groups on a dense chart get smaller, lighter marks, so the lines stay readable
    const calpha = n < 4000 ? Math.min(0.85, alpha + 0.2) : Math.min(0.7, alpha + 0.1);
    return {
      spec, W, H, k, m, iw: W - m.l - m.r, ih: H - m.t - m.b, xLog, n, xd, yd,
      txd: xLog ? [Math.log10(xd[0]), Math.log10(xd[1])] : xd.slice(),
      r, alpha, calpha, colored, shaped, pr: shaped ? (n < 4000 ? Math.max(r * 1.25, 2.2) : Math.max(r * 1.08, 2)) : r, rect: !shaped && n > 6000,
      focus: colored && spec.focus >= 0 ? spec.focus : -1,
    };
  }
  function geom(F, txd, yd) {
    const m = F.m, iw = F.iw, ih = F.ih;
    const sxT = t => m.l + (t - txd[0]) / (txd[1] - txd[0]) * iw;
    return {
      m, iw, ih, txd, yd, sxT,
      sx: F.xLog ? v => sxT(Math.log10(v)) : sxT,
      sy: v => m.t + ih - (v - yd[0]) / (yd[1] - yd[0]) * ih,
      inside: (px, py) => px >= m.l - 0.5 && px <= m.l + iw + 0.5 && py >= m.t - 0.5 && py <= m.t + ih + 0.5,
    };
  }
  function tOf(F) { // x values in t space, cached per frame
    if (!F._tx) { const x = F.spec.x, t = new Float64Array(F.n); for (let i = 0; i < F.n; i++) t[i] = F.xLog ? Math.log10(x[i]) : x[i]; F._tx = t; }
    return F._tx;
  }

  /* grid, ticks, zero lines and axis titles; o.x / o.y / o.titles switch parts off for cross-fades */
  function drawAxes(ctx, F, G, o = {}) {
    const spec = F.spec, k = F.k, m = G.m, iw = G.iw, ih = G.ih;
    const xd = F.xLog ? [Math.pow(10, G.txd[0]), Math.pow(10, G.txd[1])] : G.txd, yd = G.yd;
    const showX = o.x !== false, showY = o.y !== false;
    ctx.save();
    ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
    ctx.font = Math.round(12 * k) + 'px ' + Charts.token('--f-mono');
    let xt = [];
    if (showX) {
      xt = F.xLog ? logTicks(xd[0], xd[1]) : Charts.niceTicks(xd[0], xd[1], Math.max(3, Math.floor(iw / (110 * k))));
      if (F.xLog && xt.length < 3) xt = Charts.niceTicks(xd[0], xd[1], 4).filter(v => v > 0);
    }
    const yt = showY ? Charts.niceTicks(yd[0], yd[1], Math.max(3, Math.floor(ih / (60 * k)))) : [];
    ctx.lineWidth = 1; ctx.strokeStyle = Charts.token('--grid');
    ctx.beginPath();
    for (const t of xt) { const px = Math.round(G.sx(t)) + 0.5; ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ih); }
    for (const t of yt) { const py = Math.round(G.sy(t)) + 0.5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + iw, py); }
    ctx.stroke();
    ctx.fillStyle = Charts.token('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of xt) ctx.fillText(spec.xTick(t), G.sx(t), m.t + ih + 7);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of yt) ctx.fillText(spec.yTick(t), m.l - 8, G.sy(t));
    ctx.strokeStyle = Charts.token('--axis');
    if (showX) { ctx.beginPath(); ctx.moveTo(m.l, m.t + ih + 0.5); ctx.lineTo(m.l + iw, m.t + ih + 0.5); ctx.stroke(); }
    if (spec.zeroLines) {
      ctx.setLineDash([3, 3]); ctx.beginPath();
      if (showX && 0 > xd[0] && 0 < xd[1]) { const px = Math.round(G.sx(0)) + 0.5; ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ih); }
      if (showY && 0 > yd[0] && 0 < yd[1]) { const py = Math.round(G.sy(0)) + 0.5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + iw, py); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (o.titles !== false) {
      ctx.fillStyle = Charts.token('--ink-2'); ctx.font = '600 ' + Math.round(12.5 * k) + 'px ' + Charts.token('--f-body');
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(spec.xLabel, m.l + iw / 2, F.H - 4);
      ctx.save(); ctx.translate(Math.round(14 * k), m.t + ih / 2); ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'top'; ctx.fillText(spec.yLabel, 0, -2); ctx.restore();
    }
    ctx.restore();
  }

  /* context points (filtered out), drawn first and faint */
  function drawContext(ctx, F, G, alpha) {
    const c = F.spec.ctx;
    if (!c || !c.x.length || !(alpha > 0)) return;
    ctx.fillStyle = Charts.token('--ctx'); ctx.globalAlpha = 0.6 * alpha;
    const cr = Math.max(1.1, F.r - 0.6);
    for (let i = 0; i < c.x.length; i++) {
      const px = G.sx(c.x[i]), py = G.sy(c.y[i]);
      if (G.inside(px, py)) ctx.fillRect(px - cr, py - cr, 2 * cr, 2 * cr);
    }
    ctx.globalAlpha = 1;
  }

  function densityCounts(F, G) {
    const spec = F.spec, m = G.m, iw = G.iw, ih = G.ih;
    const cell = 5, cols = Math.ceil(iw / cell), rows = Math.ceil(ih / cell);
    const counts = new Uint32Array(cols * rows);
    let max = 0;
    for (let i = 0; i < F.n; i++) {
      const px = G.sx(spec.x[i]) - m.l, py = G.sy(spec.y[i]) - m.t;
      if (px < 0 || py < 0 || px > iw || py > ih) continue;
      const c = Math.min(cols - 1, Math.floor(px / cell)) + Math.min(rows - 1, Math.floor(py / cell)) * cols;
      if (++counts[c] > max) max = counts[c];
    }
    return { counts, cols, rows, max, cell };
  }

  /* data points or density cells in their final colors */
  function drawMarks(ctx, F, G, dens) {
    const spec = F.spec, n = F.n, m = G.m;
    if (spec.density) {
      const D = dens || densityCounts(F, G), ramp = spec.ramp, lmax = Math.log(D.max + 1);
      for (let c = 0; c < D.counts.length; c++) {
        if (!D.counts[c]) continue;
        const t = Math.log(D.counts[c] + 1) / lmax;
        ctx.fillStyle = ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
        ctx.fillRect(m.l + (c % D.cols) * D.cell, m.t + Math.floor(c / D.cols) * D.cell, D.cell - 0.6, D.cell - 0.6);
      }
      return;
    }
    const cats = spec.cats || [], r = F.r, base = Charts.token('--series-1'), grey = Charts.token('--ctx'), focus = F.focus;
    // grey first, then the largest group, so small groups stay visible on top; a focused group comes last
    const order = spec.color ? [255].concat(cats.map((c, k) => k).filter(k => k !== focus).sort((a, b) => cats[b].n - cats[a].n), focus >= 0 ? [focus] : []) : [null];
    for (const code of order) {
      const c = code === null || code === 255 ? null : cats[code], dim = focus >= 0 && c && code !== focus;
      ctx.fillStyle = ctx.strokeStyle = code === null ? base : code === 255 || dim ? grey : c.canvas;
      ctx.globalAlpha = code === 255 ? 0.7 : dim ? 0.5 : spec.color ? F.calpha : F.alpha;
      const shape = F.shaped && c ? c.shape : null;
      for (let i = 0; i < n; i++) {
        if (code !== null && spec.color[i] !== code) continue;
        const px = G.sx(spec.x[i]), py = G.sy(spec.y[i]);
        if (!G.inside(px, py)) continue;
        if (shape) drawMark(ctx, shape, px, py, F.pr);
        else if (n > 6000) ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
        else { ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1;
  }

  /* least-squares line, drawn only across the x range of its own data */
  function fitPath(ctx, G, xLog, slope, intercept, xa, xb) {
    const toT = v => (xLog ? Math.log10(v) : v);
    const a = xa !== undefined && isFinite(toT(xa)) ? Math.max(G.txd[0], toT(xa)) : G.txd[0];
    const b = xb !== undefined && isFinite(toT(xb)) ? Math.min(G.txd[1], toT(xb)) : G.txd[1];
    ctx.beginPath();
    if (!(b > a)) return;
    const steps = xLog ? 60 : 1;
    for (let s = 0; s <= steps; s++) {
      const t = a + (b - a) * s / steps, xv = xLog ? Math.pow(10, t) : t;
      const px = G.sxT(t), py = G.sy(intercept + slope * xv);
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }
  function strokeGroupLine(ctx, color, bold) { // surface halo for contrast
    ctx.strokeStyle = Charts.token('--surface'); ctx.lineWidth = bold ? 6.5 : 4.5; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = bold ? 3.4 : 2.2; ctx.stroke();
  }
  function strokeReg(ctx, dashed) { // dashed when groups have their own lines
    ctx.strokeStyle = Charts.token('--ink');
    if (dashed) { ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.lineWidth = 2; ctx.stroke(); }
  }
  function drawFits(ctx, F, G, alpha) {
    const spec = F.spec;
    if (!(alpha > 0)) return;
    const focus = F.focus === undefined ? -1 : F.focus;
    if (spec.lines) {
      const lines = focus >= 0 ? spec.lines.filter(l => l.cat !== focus).concat(spec.lines.filter(l => l.cat === focus)) : spec.lines;
      for (const l of lines) {
        const dim = focus >= 0 && l.cat !== focus;
        ctx.globalAlpha = alpha * (dim ? 0.2 : 1);
        fitPath(ctx, G, F.xLog, l.slope, l.intercept, l.x0, l.x1); strokeGroupLine(ctx, l.color, focus >= 0 && !dim);
      }
    }
    ctx.globalAlpha = alpha;
    if (spec.reg && isFinite(spec.reg.slope)) { fitPath(ctx, G, F.xLog, spec.reg.slope, spec.reg.intercept); strokeReg(ctx, !!spec.lines); }
    ctx.globalAlpha = 1;
  }

  /* highlighted entity (country path or pair) */
  function drawHi(ctx, F, G, alpha) {
    const h = F.spec.hi;
    if (!h || !h.x.length || !(alpha > 0)) return;
    const hx = h.x, hy = h.y, hc = h.color || Charts.token('--hi');
    if (h.line && hx.length > 1) {
      ctx.strokeStyle = hc; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85 * alpha; ctx.beginPath();
      for (let i = 0; i < hx.length; i++) { const px = G.sx(hx[i]), py = G.sy(hy[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hc; ctx.strokeStyle = Charts.token('--surface'); ctx.lineWidth = 1.5;
    const hr = hx.length > 400 ? 2.4 : 4;
    for (let i = 0; i < hx.length; i++) {
      ctx.beginPath(); ctx.arc(G.sx(hx[i]), G.sy(hy[i]), hr, 0, 6.2832); ctx.fill(); if (hr > 3) ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawStatic(ctx, F, G, dens) {
    ctx.fillStyle = Charts.token('--surface'); ctx.fillRect(0, 0, F.W, F.H);
    drawAxes(ctx, F, G);
    ctx.save();
    ctx.beginPath(); ctx.rect(G.m.l, G.m.t, G.iw, G.ih); ctx.clip();
    drawContext(ctx, F, G, 1);
    drawMarks(ctx, F, G, dens);
    drawFits(ctx, F, G, 1);
    drawHi(ctx, F, G, 1);
    ctx.restore();
  }

  /* hover lookup and pixel -> value mapping for the final state */
  function scatterApi(F, G, dens) {
    const spec = F.spec, m = G.m, iw = G.iw, ih = G.ih, n = F.n;
    const invert = (px, py) => {
      const t = G.txd[0] + (px - m.l) / iw * (G.txd[1] - G.txd[0]);
      return [F.xLog ? Math.pow(10, t) : t, G.yd[0] + (m.t + ih - py) / ih * (G.yd[1] - G.yd[0])];
    };
    let pick = () => null;
    if (spec.density) {
      pick = (px, py) => {
        if (!G.inside(px, py)) return null;
        const cxi = Math.floor((px - m.l) / dens.cell), cyi = Math.floor((py - m.t) / dens.cell);
        const count = dens.counts[cxi + cyi * dens.cols] || 0;
        if (!count) return null;
        const a = invert(m.l + cxi * dens.cell, m.t + (cyi + 1) * dens.cell), b = invert(m.l + (cxi + 1) * dens.cell, m.t + cyi * dens.cell);
        return { bin: { count, x0: a[0], x1: b[0], y0: a[1], y1: b[1] } };
      };
    } else {
      const B = 12, gcols = Math.ceil(F.W / B), buckets = new Map();
      for (let i = 0; i < n; i++) {
        const px = G.sx(spec.x[i]), py = G.sy(spec.y[i]);
        if (!G.inside(px, py)) continue;
        const key = Math.floor(px / B) + Math.floor(py / B) * gcols;
        let arr = buckets.get(key); if (!arr) buckets.set(key, arr = []); arr.push(i);
      }
      pick = (px, py) => {
        if (!G.inside(px, py)) return null;
        let best = -1, bd = 100;
        const bx = Math.floor(px / B), by = Math.floor(py / B);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const arr = buckets.get(bx + dx + (by + dy) * gcols); if (!arr) continue;
          for (const i of arr) {
            const d = (G.sx(spec.x[i]) - px) ** 2 + (G.sy(spec.y[i]) - py) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
        }
        return best >= 0 ? { i: best, px: G.sx(spec.x[best]), py: G.sy(spec.y[best]) } : null;
      };
    }
    return { pick, invert, sx: G.sx, sy: G.sy, margins: m, inner: { w: iw, h: ih }, domain: { x: F.xd, y: F.yd }, frame: F };
  }

  /* ---------- scatter transitions ----------
   * zoom:  same points, the axes glide to the new range
   * morph: every point moves from its old to its new place; removed points flash and fade,
   *        new ones grow in, rows fold into their country mean (and back) on a level switch
   * fade:  cross-fade of the whole bitmap (large or density charts, color or selection changes)
   * enter: first view of a hypothesis, points sweep in from left to right and the line draws itself */
  function transitionKind(A, B, tr) {
    if (reduceMotion()) return null;
    if (tr.enter) return !B.n ? null : B.spec.density || B.n > MAX_MORPH ? 'fade-in' : 'enter';
    if (!A || A.W !== B.W || A.H !== B.H) return null;
    if (A.facets) return 'fade';
    if (A.spec.dataId === B.spec.dataId) {
      if (!sameRange(A.txd, B.txd) || !sameRange(A.yd, B.yd)) return 'zoom';
      return A.spec.visId !== B.spec.visId ? 'fade' : null;
    }
    if (A.spec.density || B.spec.density || A.n + B.n > MAX_MORPH || !A.spec.keys || !B.spec.keys) return 'fade';
    if (A.spec.space !== B.spec.space && !(A.spec.space === 'rows' ? A.spec.parents : B.spec.parents)) return 'fade';
    return 'morph';
  }

  const MOVE = 0, ENTER = 1, EXIT = 2, GATHER = 3, SPREAD = 4, LATE = 5, FADE = 6;
  function makePlan(A, B, enter) {
    const NA = A.n, NB = B.n, cap = NA + NB;
    const kind = new Uint8Array(cap), from = new Int32Array(cap), to = new Int32Array(cap), pal = new Uint16Array(cap);
    const aF = new Float32Array(cap), aT = new Float32Array(cap);
    const palette = [], palIndex = new Map();
    const palOf = (color, shape) => {
      const key = color + '|' + (shape || '');
      let p = palIndex.get(key);
      if (p === undefined) { p = palette.length; palIndex.set(key, p); palette.push({ color, shape }); }
      return p;
    };
    const grey = Charts.token('--ctx'), hiC = Charts.token('--hi'), base = Charts.token('--series-1');
    const styleOf = (F, j) => {
      const c = F.spec.color ? F.spec.color[j] : null;
      if (c === null) return [base, null, F.alpha];
      if (c === 255) return [grey, null, 0.7];
      const cat = F.spec.cats[c];
      if (F.focus >= 0 && c !== F.focus) return [grey, F.shaped ? cat.shape : null, 0.5];
      return [cat.canvas, F.shaped ? cat.shape : null, F.calpha];
    };
    // register B's colors in the order of the final drawing, so the last frame matches it
    if (B.spec.color) {
      const cs = B.spec.cats, rest = cs.map((c, k) => k).filter(k => k !== B.focus).sort((a, b) => cs[b].n - cs[a].n);
      palOf(grey, null);
      if (B.focus >= 0) rest.forEach(k => palOf(grey, B.shaped ? cs[k].shape : null)); // dimmed groups behind the focused one
      rest.concat(B.focus >= 0 ? [B.focus] : []).forEach(k => palOf(cs[k].canvas, B.shaped ? cs[k].shape : null));
    }
    else palOf(base, null);
    let np = 0;
    const add = (k, i, j) => {
      kind[np] = k; from[np] = i; to[np] = j;
      const sa = i >= 0 ? styleOf(A, i) : null, sb = j >= 0 ? styleOf(B, j) : null;
      pal[np] = k === EXIT ? palOf(hiC, sa[1]) : k === FADE ? palOf(sa[0], sa[1]) : palOf(sb[0], sb[1]);
      aF[np] = sa ? sa[2] : 0; aT[np] = sb ? sb[2] : 0;
      np++;
    };
    const lookup = keys => {
      let mx = -1;
      for (let i = 0; i < keys.length; i++) if (keys[i] > mx) mx = keys[i];
      const L = new Int32Array(mx + 2).fill(-1);
      for (let i = 0; i < keys.length; i++) L[keys[i]] = i;
      return L;
    };
    const at = (L, key) => (key >= 0 && key < L.length ? L[key] : -1);
    const ka = A.spec.keys || [], kb = B.spec.keys;
    if (A.spec.space === B.spec.space) {
      const L = lookup(kb), hit = new Uint8Array(NB);
      for (let i = 0; i < NA; i++) { const j = at(L, ka[i]); if (j >= 0) { add(MOVE, i, j); hit[j] = 1; } else add(EXIT, i, -1); }
      for (let j = 0; j < NB; j++) if (!hit[j]) add(ENTER, -1, j);
    } else if (A.spec.space === 'rows') { // rows fold into their group mean
      const L = lookup(kb);
      for (let i = 0; i < NA; i++) { const j = at(L, A.spec.parents[i]); if (j >= 0) add(GATHER, i, j); else add(EXIT, i, -1); }
      for (let j = 0; j < NB; j++) add(LATE, -1, j);
    } else { // group means spread out into their rows
      const L = lookup(ka);
      for (let j = 0; j < NB; j++) { const i = at(L, B.spec.parents[j]); add(i >= 0 ? SPREAD : ENTER, i, j); }
      for (let i = 0; i < NA; i++) add(FADE, i, -1);
    }
    // positions in t space; a left-to-right stagger by target position
    const txA = tOf(A), txB = tOf(B), yA = A.spec.y, yB = B.spec.y;
    const fx = new Float64Array(np), fy = new Float64Array(np), tx = new Float64Array(np), ty = new Float64Array(np), delay = new Float32Array(np);
    const D = enter ? 0.42 : 0.16, w = B.txd[1] - B.txd[0];
    let exits = 0;
    for (let p = 0; p < np; p++) {
      const i = from[p], j = to[p];
      if (i >= 0) { fx[p] = txA[i]; fy[p] = yA[i]; }
      if (j >= 0) { tx[p] = txB[j]; ty[p] = yB[j]; delay[p] = D * clamp01((txB[j] - B.txd[0]) / w); }
      if (i < 0) { fx[p] = tx[p]; fy[p] = ty[p]; }
      if (j < 0) { tx[p] = fx[p]; ty[p] = fy[p]; exits++; }
    }
    // draw order: fading means, grey, the groups as in the final drawing, removed points on top
    const layer = k => (k === FADE ? 0 : k === EXIT ? 3 : 1);
    const order = Uint32Array.from({ length: np }, (_, p) => p).sort((p, q) => (layer(kind[p]) - layer(kind[q])) || (pal[p] - pal[q]));
    return { np, kind, from, to, pal, aF, aT, fx, fy, tx, ty, delay, D, order, palette, enterStart: exits ? 0.3 : 0 };
  }

  function drawParticles(ctx, A, B, P, u, G, GA, GB, screenX) {
    const { order, kind, pal, aF, aT, fx, fy, tx, ty, delay, D, palette } = P;
    const rA = A.pr, rB = B.pr;
    let cur = -1;
    for (let q = 0; q < order.length; q++) {
      const p = order[q], k = kind[p];
      let t = (u - delay[p]) / (1 - D);
      t = easeInOut(t < 0 ? 0 : t > 1 ? 1 : t);
      let x, y, a, r, rect;
      if (k === MOVE || k === GATHER || k === SPREAD) {
        x = screenX ? lerp(GA.sxT(fx[p]), GB.sxT(tx[p]), t) : G.sxT(lerp(fx[p], tx[p], t));
        y = G.sy(lerp(fy[p], ty[p], t));
        a = lerp(aF[p], aT[p], t); r = lerp(rA, rB, t); rect = B.rect;
        if (k === GATHER) a *= 1 - clamp01((t - 0.55) / 0.45);
        else if (k === SPREAD) { a = aT[p] * clamp01(t / 0.3); }
      } else if (k === ENTER || k === LATE) {
        const s0 = k === LATE ? 0.55 : P.enterStart;
        let t2 = clamp01((u - s0 - (k === LATE ? 0 : delay[p])) / (1 - s0 - (k === LATE ? 0 : D)));
        t2 = easeOut(t2);
        x = (screenX ? GB : G).sxT(tx[p]); y = G.sy(ty[p]);
        a = aT[p] * t2; r = rB * (0.35 + 0.65 * t2); rect = B.rect;
      } else if (k === EXIT) { // flash in the highlight color, then shrink away
        x = (screenX ? GA : G).sxT(fx[p]); y = G.sy(fy[p]); rect = A.rect;
        if (u < 0.22) { const s = easeOut(u / 0.22); a = lerp(aF[p], 0.95, s); r = rA * (1 + 0.55 * s); }
        else { const s = easeInOut((u - 0.22) / 0.78); a = 0.95 * (1 - s); r = rA * 1.55 * (1 - 0.6 * s); }
      } else { // FADE
        x = (screenX ? GA : G).sxT(fx[p]); y = G.sy(fy[p]); rect = A.rect;
        a = aF[p] * (1 - clamp01(u / 0.4)); r = rA;
      }
      if (a <= 0.004 || !G.inside(x, y)) continue;
      if (pal[p] !== cur) { cur = pal[p]; ctx.fillStyle = ctx.strokeStyle = palette[cur].color; }
      ctx.globalAlpha = a;
      const shape = palette[cur].shape;
      if (shape) drawMark(ctx, shape, x, y, r);
      else if (rect) ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      else { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  /* lines of the same group glide (their coefficients are interpolated); others fade */
  function drawMorphFits(ctx, A, B, u, e, G, GA, GB, sameLevel) {
    if (!sameLevel) { drawFits(ctx, A, GA, 1 - clamp01(u / 0.35)); drawFits(ctx, B, GB, clamp01((u - 0.55) / 0.45)); return; }
    const la = A.spec.lines || [], lb = B.spec.lines || [];
    for (const l of lb) {
      const o = la.find(c => c.key === l.key);
      ctx.globalAlpha = o ? 1 : e;
      if (o) fitPath(ctx, G, B.xLog, lerp(o.slope, l.slope, e), lerp(o.intercept, l.intercept, e), lerp(o.x0, l.x0, e), lerp(o.x1, l.x1, e));
      else fitPath(ctx, G, B.xLog, l.slope, l.intercept, l.x0, l.x1);
      strokeGroupLine(ctx, l.color);
    }
    for (const o of la) if (!lb.some(l => l.key === o.key)) { ctx.globalAlpha = 1 - e; fitPath(ctx, G, B.xLog, o.slope, o.intercept, o.x0, o.x1); strokeGroupLine(ctx, o.color); }
    const ra = A.spec.reg, rb = B.spec.reg, okA = !!(ra && isFinite(ra.slope)), okB = !!(rb && isFinite(rb.slope));
    if (okA && okB) { ctx.globalAlpha = 1; fitPath(ctx, G, B.xLog, lerp(ra.slope, rb.slope, e), lerp(ra.intercept, rb.intercept, e)); strokeReg(ctx, !!B.spec.lines); }
    else if (okA) { ctx.globalAlpha = 1 - e; fitPath(ctx, G, B.xLog, ra.slope, ra.intercept); strokeReg(ctx, !!A.spec.lines); }
    else if (okB) { ctx.globalAlpha = e; fitPath(ctx, G, B.xLog, rb.slope, rb.intercept); strokeReg(ctx, !!B.spec.lines); }
    ctx.globalAlpha = 1;
  }

  function drawMorph(ctx, A, B, P, u, enter, a) {
    const e = easeInOut(u), screenX = A.xLog !== B.xLog;
    const yd = lerpRange(A.yd, B.yd, e), txd = screenX ? B.txd : lerpRange(A.txd, B.txd, e);
    const G = geom(B, txd, yd), GA = screenX ? geom(A, A.txd, yd) : G, GB = screenX ? geom(B, B.txd, yd) : G;
    if (a && !screenX) a.cur = { txd, yd };
    ctx.fillStyle = Charts.token('--surface'); ctx.fillRect(0, 0, B.W, B.H);
    // changed axes: the old labels leave before the new ones arrive, so the two never blur into each other
    const sameAxes = A.spec.xLabel === B.spec.xLabel && A.spec.yLabel === B.spec.yLabel && !!A.spec.zeroLines === !!B.spec.zeroLines;
    const out = 1 - easeInOut(clamp01((u - 0.08) / 0.42)), inn = easeInOut(clamp01((u - 0.45) / 0.45));
    if (!screenX && sameAxes) drawAxes(ctx, B, G);
    else if (!screenX) { drawAxes(ctx, B, G, { titles: false }); drawAxes(ctx, A, G, { x: false, y: false, alpha: out }); drawAxes(ctx, B, G, { x: false, y: false, alpha: inn }); }
    else { drawAxes(ctx, B, G, { x: false, titles: false }); drawAxes(ctx, A, GA, { y: false, alpha: out }); drawAxes(ctx, B, GB, { y: false, alpha: inn }); }
    ctx.save();
    ctx.beginPath(); ctx.rect(G.m.l, G.m.t, G.iw, G.ih); ctx.clip();
    const sameLevel = !screenX && A.spec.level === B.spec.level;
    if (sameLevel) { drawContext(ctx, A, G, 1 - e); drawContext(ctx, B, G, e); }
    else drawContext(ctx, B, GB, clamp01((u - 0.5) / 0.5));
    drawParticles(ctx, A, B, P, u, G, GA, GB, screenX);
    if (enter) { // the line draws itself from left to right once the points have arrived
      const prog = easeInOut(clamp01((u - 0.38) / 0.62));
      if (prog > 0) { ctx.save(); ctx.beginPath(); ctx.rect(G.m.l, 0, G.iw * prog, B.H); ctx.clip(); drawFits(ctx, B, G, 1); ctx.restore(); }
    } else drawMorphFits(ctx, A, B, u, e, G, GA, GB, sameLevel);
    if (!enter) drawHi(ctx, A, GA, 1 - clamp01(u / 0.3));
    drawHi(ctx, B, GB, clamp01((u - 0.62) / 0.38));
    ctx.restore();
  }

  function emptyFrame(B) {
    return Object.assign({}, B, {
      n: 0, _tx: new Float64Array(0),
      spec: Object.assign({}, B.spec, { x: [], y: [], keys: [], parents: [], color: null, cats: null, reg: null, lines: null, ctx: null, hi: null }),
    });
  }

  /* bitmap cross-fade; base is the old picture (or the empty axes) */
  function runFade(canvas, ctx, B, base, dur, drawFinal) {
    const fin = document.createElement('canvas');
    fin.width = canvas.width; fin.height = canvas.height;
    const fctx = fin.getContext('2d');
    fctx.setTransform(canvas.width / B.W, 0, 0, canvas.height / B.H, 0, 0);
    drawFinal(fctx);
    const blit = (img, alpha) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(img, 0, 0); ctx.restore(); };
    animate(canvas, 'fade', dur, u => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore(); blit(base, 1); blit(fin, easeInOut(u)); },
      () => blit(fin, 1));
  }

  Charts.scatter = function (canvas, spec) {
    const running = stop(canvas);
    const B = frameOf(spec), G = geom(B, B.txd, B.yd);
    const tr = spec.transition || null;
    let A = tr && tr.from ? tr.from : null;
    const kind = tr ? transitionKind(A, B, tr) : null;
    // an interrupted zoom continues from where the axes are right now
    if (A && running && running.cur && (kind === 'zoom' || kind === 'morph') && A.xLog === B.xLog) A = Object.assign({}, A, { txd: running.cur.txd, yd: running.cur.yd });
    const old = kind === 'fade' ? tr.snap || copyBitmap(canvas) : null; // a re-rendered page hands over the old picture
    const ctx = setupCanvas(canvas, B.W, B.H);
    const dens = spec.density ? densityCounts(B, G) : null;
    const api = scatterApi(B, G, dens);
    const final = () => drawStatic(ctx, B, G, dens);
    if (!kind || (old && (old.width !== canvas.width || old.height !== canvas.height))) { final(); return api; }
    if (kind === 'zoom') {
      animate(canvas, kind, 520, (u, a) => {
        const e = easeInOut(u), txd = lerpRange(A.txd, B.txd, e), yd = lerpRange(A.yd, B.yd, e);
        a.cur = { txd, yd };
        drawStatic(ctx, B, geom(B, txd, yd));
      }, final);
    } else if (kind === 'morph' || kind === 'enter') {
      const enter = kind === 'enter', from = enter ? emptyFrame(B) : A;
      const P = makePlan(from, B, enter);
      const dur = enter ? 1150 : from.spec.space !== B.spec.space || from.spec.level !== B.spec.level ? 1050 : 780;
      animate(canvas, kind, dur, (u, a) => drawMorph(ctx, from, B, P, u, enter, a), final);
    } else if (kind === 'fade') {
      runFade(canvas, ctx, B, old, 300, c => drawStatic(c, B, G, dens));
    } else { // fade-in of a large chart: axes first, then the points
      const base = document.createElement('canvas');
      base.width = canvas.width; base.height = canvas.height;
      const bctx = base.getContext('2d');
      bctx.setTransform(canvas.width / B.W, 0, 0, canvas.height / B.H, 0, 0);
      bctx.fillStyle = Charts.token('--surface'); bctx.fillRect(0, 0, B.W, B.H); drawAxes(bctx, B, G);
      runFade(canvas, ctx, B, base, 700, c => drawStatic(c, B, G, dens));
    }
    return api;
  };

  /* ---------- small multiples ----------
   * One panel per colored group on shared axes: the group in its color, every other point grey
   * behind it, its own least-squares line and, dashed, the line of all points together. */
  Charts.facetLayout = function (width, count) {
    const s = Charts.scale();
    const m = { l: Math.round(64 * s), r: 12, t: 2, b: Math.round(46 * s) };
    const gap = Math.round(18 * s), head = Math.round(28 * s);
    const fits = c => (width - m.l - m.r - gap * (c - 1)) / c >= 170 * s;
    let cols = 1, best = Infinity;
    for (const c of [4, 3, 2, 1]) { // fewest empty cells, then more columns
      if (c > count || !fits(c)) continue;
      const empty = Math.ceil(count / c) * c - count;
      if (empty < best) { best = empty; cols = c; }
    }
    const rows = Math.ceil(count / cols), pw = (width - m.l - m.r - gap * (cols - 1)) / cols;
    const ph = Math.round(Math.max(140 * s, Math.min(250 * s, pw * 0.6)));
    return { cols, rows, m, gap, head, pw, ph, height: Math.round(m.t + rows * (head + ph) + (rows - 1) * gap + m.b) };
  };
  function panelAxes(ctx, G, spec, k, xLog, showX, showY) {
    const m = G.m, iw = G.iw, ih = G.ih;
    const xd = xLog ? [Math.pow(10, G.txd[0]), Math.pow(10, G.txd[1])] : G.txd, yd = G.yd;
    let xt = xLog ? logTicks(xd[0], xd[1]) : Charts.niceTicks(xd[0], xd[1], Math.max(2, Math.floor(iw / (95 * k))));
    if (xLog && xt.length < 2) xt = Charts.niceTicks(xd[0], xd[1], 3).filter(v => v > 0);
    while (xt.length > Math.max(2, Math.floor(iw / (58 * k)))) xt = xt.filter((v, i) => i % 2 === 0);
    const yt = Charts.niceTicks(yd[0], yd[1], Math.max(2, Math.floor(ih / (46 * k))));
    ctx.lineWidth = 1; ctx.strokeStyle = Charts.token('--grid'); ctx.beginPath();
    for (const t of xt) { const px = Math.round(G.sx(t)) + 0.5; ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ih); }
    for (const t of yt) { const py = Math.round(G.sy(t)) + 0.5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + iw, py); }
    ctx.stroke();
    ctx.strokeStyle = Charts.token('--axis'); ctx.beginPath(); ctx.moveTo(m.l, m.t + ih + 0.5); ctx.lineTo(m.l + iw, m.t + ih + 0.5); ctx.stroke();
    if (spec.zeroLines) {
      ctx.setLineDash([3, 3]); ctx.beginPath();
      if (0 > xd[0] && 0 < xd[1]) { const px = Math.round(G.sx(0)) + 0.5; ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ih); }
      if (0 > yd[0] && 0 < yd[1]) { const py = Math.round(G.sy(0)) + 0.5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + iw, py); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.font = Math.round(11 * k) + 'px ' + Charts.token('--f-mono'); ctx.fillStyle = Charts.token('--muted');
    if (showX) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; for (const t of xt) ctx.fillText(spec.xTick(t), G.sx(t), m.t + ih + 6); }
    if (showY) { ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; for (const t of yt) ctx.fillText(spec.yTick(t), m.l - 7, G.sy(t)); }
  }
  const fmtSigned = v => (isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(3) : 'n/a');

  Charts.facets = function (canvas, spec) {
    stop(canvas);
    const W = spec.width, k = Charts.scale(), cats = spec.cats, K = cats.length, L = Charts.facetLayout(W, K), H = L.height;
    const xLog = !!spec.xLog, n = spec.x.length, code = spec.color, focus = spec.focus >= 0 ? spec.focus : -1;
    const xd = spec.exact ? spec.xDomain.slice() : pad(spec.xDomain, xLog), yd = spec.exact ? spec.yDomain.slice() : pad(spec.yDomain, false);
    const txd = xLog ? [Math.log10(xd[0]), Math.log10(xd[1])] : xd.slice();
    const panels = cats.map((c, p) => {
      const col = p % L.cols, row = Math.floor(p / L.cols);
      const P = { m: { l: L.m.l + col * (L.pw + L.gap), t: L.m.t + row * (L.head + L.ph + L.gap) + L.head }, iw: L.pw, ih: L.ph, xLog };
      return { c, p, G: geom(P, txd, yd), showX: p + L.cols >= K, showY: col === 0 };
    });
    const sig = [spec.dataId, spec.visId, xd.join(), yd.join(), focus, W].join('|');
    const tr = spec.transition, from = tr && tr.from;
    const old = tr && !reduceMotion() && from && from.facets && from.W === W && from.H === H && from.sig !== sig ? tr.snap || copyBitmap(canvas) : null;
    const enter = tr && !reduceMotion() && (tr.enter || (from && (from.W !== W || from.H !== H || !from.facets)));
    const ctx = setupCanvas(canvas, W, H);
    const draw = c2d => {
      const surface = Charts.token('--surface'), grey = Charts.token('--ctx'), ink = Charts.token('--ink');
      c2d.fillStyle = surface; c2d.fillRect(0, 0, W, H);
      // shared axis titles
      c2d.fillStyle = Charts.token('--ink-2'); c2d.font = '600 ' + Math.round(12.5 * k) + 'px ' + Charts.token('--f-body');
      c2d.textAlign = 'center'; c2d.textBaseline = 'bottom';
      c2d.fillText(spec.xLabel, L.m.l + (W - L.m.l - L.m.r) / 2, H - 4);
      c2d.save(); c2d.translate(Math.round(14 * k), L.m.t + (H - L.m.t - L.m.b) / 2); c2d.rotate(-Math.PI / 2);
      c2d.textBaseline = 'top'; c2d.fillText(spec.yLabel, 0, -2); c2d.restore();
      const step = Math.max(1, Math.ceil(n / 12000)); // the grey context is thinned out on large samples
      for (const P of panels) {
        const G = P.G, c = P.c, dim = focus >= 0 && P.p !== focus;
        panelAxes(c2d, G, spec, k, xLog, P.showX, P.showY);
        // header: marker and name on the left, n and r on the right
        const hy = G.m.t - L.head / 2 - 1;
        c2d.globalAlpha = dim ? 0.45 : 1;
        c2d.fillStyle = c2d.strokeStyle = c.canvas;
        drawMark(c2d, c.shape, G.m.l + 5 * k, hy, 4 * k);
        c2d.textBaseline = 'middle'; c2d.textAlign = 'left';
        c2d.font = '650 ' + Math.round(13 * k) + 'px ' + Charts.token('--f-body'); c2d.fillStyle = ink;
        c2d.fillText(c.label, G.m.l + 14 * k, hy);
        const nameW = c2d.measureText(c.label).width;
        c2d.textAlign = 'right'; c2d.font = '600 ' + Math.round(12 * k) + 'px ' + Charts.token('--f-mono');
        const rText = 'r ' + fmtSigned(c.r), rW = c2d.measureText(rText).width;
        c2d.fillStyle = Charts.token(c.r < 0 ? '--neg-t' : '--pos-t');
        c2d.fillText(rText, G.m.l + G.iw, hy);
        c2d.font = Math.round(11 * k) + 'px ' + Charts.token('--f-mono'); c2d.fillStyle = Charts.token('--muted');
        const nText = 'n ' + c.n.toLocaleString('en-US') + ' · ';
        if (14 * k + nameW + 12 + c2d.measureText(nText).width + rW < G.iw) c2d.fillText(nText, G.m.l + G.iw - rW, hy);
        c2d.globalAlpha = 1;
        c2d.save(); c2d.beginPath(); c2d.rect(G.m.l, G.m.t, G.iw, G.ih); c2d.clip();
        // everyone else, faint
        c2d.fillStyle = grey; c2d.globalAlpha = 0.55;
        for (let i = 0; i < n; i += step) {
          if (code[i] === P.p) continue;
          const px = G.sx(spec.x[i]), py = G.sy(spec.y[i]);
          if (G.inside(px, py)) c2d.fillRect(px - 1.1, py - 1.1, 2.2, 2.2);
        }
        // the group itself
        const gn = c.n, r = gn < 600 ? 2.9 : gn < 3000 ? 2.2 : gn < 20000 ? 1.6 : 1.2;
        c2d.globalAlpha = (gn < 600 ? 0.85 : gn < 3000 ? 0.7 : gn < 20000 ? 0.5 : 0.3) * (dim ? 0.35 : 1);
        c2d.fillStyle = c2d.strokeStyle = c.canvas;
        const shape = gn <= 4000 ? c.shape : null;
        for (let i = 0; i < n; i++) {
          if (code[i] !== P.p) continue;
          const px = G.sx(spec.x[i]), py = G.sy(spec.y[i]);
          if (!G.inside(px, py)) continue;
          if (shape) drawMark(c2d, shape, px, py, r); else c2d.fillRect(px - r, py - r, 2 * r, 2 * r);
        }
        // dashed line of all points, then the group's own line
        c2d.globalAlpha = dim ? 0.3 : 0.6;
        if (spec.reg && isFinite(spec.reg.slope)) { fitPath(c2d, G, xLog, spec.reg.slope, spec.reg.intercept); strokeReg(c2d, true); }
        const own = (spec.lines || []).find(l => l.cat === P.p);
        c2d.globalAlpha = dim ? 0.35 : 1;
        if (own) { fitPath(c2d, G, xLog, own.slope, own.intercept, own.x0, own.x1); strokeGroupLine(c2d, own.color, true); }
        if (spec.hi && spec.hi.cat === P.p) drawHi(c2d, { spec }, G, 1);
        c2d.restore();
        c2d.globalAlpha = 1;
      }
    };
    // hover lookup: each point sits in the panel of its group
    const B = 12, gcols = Math.ceil(W / B), buckets = new Map(), px = new Float32Array(n), py = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const P = panels[code[i]];
      px[i] = NaN;
      if (!P) continue;
      const x = P.G.sx(spec.x[i]), y = P.G.sy(spec.y[i]);
      if (!P.G.inside(x, y)) continue;
      px[i] = x; py[i] = y;
      const key = Math.floor(x / B) + Math.floor(y / B) * gcols;
      let arr = buckets.get(key); if (!arr) buckets.set(key, arr = []); arr.push(i);
    }
    const pick = (x, y) => {
      let best = -1, bd = 100;
      const bx = Math.floor(x / B), by = Math.floor(y / B);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = buckets.get(bx + dx + (by + dy) * gcols); if (!arr) continue;
        for (const i of arr) { const d = (px[i] - x) ** 2 + (py[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
      }
      return best >= 0 ? { i: best, px: px[best], py: py[best] } : null;
    };
    const G0 = panels[0].G;
    const api = {
      pick, sx: G0.sx, sy: G0.sy, margins: G0.m, inner: { w: G0.iw, h: G0.ih }, domain: { x: xd, y: yd }, height: H,
      invert: (x, y) => { const t = txd[0] + (x - G0.m.l) / G0.iw * (txd[1] - txd[0]); return [xLog ? Math.pow(10, t) : t, yd[0] + (G0.m.t + G0.ih - y) / G0.ih * (yd[1] - yd[0])]; },
      frame: { facets: true, W, H, sig, spec: { dataId: spec.dataId, visId: spec.visId } },
    };
    if (old) runFade(canvas, ctx, { W, H }, old, 300, draw);
    else if (enter) {
      const base = document.createElement('canvas');
      base.width = canvas.width; base.height = canvas.height;
      const b = base.getContext('2d'); b.fillStyle = Charts.token('--surface'); b.fillRect(0, 0, base.width, base.height);
      runFade(canvas, ctx, { W, H }, base, 420, draw);
    } else draw(ctx);
    return api;
  };

  /* ---------- annual correlation line ---------- */
  function lineFrame(spec) {
    const W = spec.width, H = spec.height, k = Charts.scale();
    const m = { l: Math.round(46 * k), r: 12, t: 10, b: Math.round(28 * k) };
    const x0 = spec.xDomain[0], x1 = spec.xDomain[1];
    const vis = spec.points.filter(p => p.year >= x0 && p.year <= x1);
    let lo = Math.min(-0.1, ...vis.map(p => p.r)), hi = Math.max(0.1, ...vis.map(p => p.r));
    const ext = Math.max(Math.abs(lo), Math.abs(hi));
    lo = -Math.ceil(ext * 10) / 10; hi = -lo;
    return { spec, W, H, k, m, iw: W - m.l - m.r, ih: H - m.t - m.b, x0, x1, lo, hi, vis, points: spec.points, overall: spec.overall };
  }
  /* s: the (possibly interpolated) state: x0, x1, lo, hi, pts, overall, reveal (0..1) */
  function drawLine(ctx, L, s) {
    const m = L.m, iw = L.iw, ih = L.ih, k = L.k;
    ctx.fillStyle = Charts.token('--surface'); ctx.fillRect(0, 0, L.W, L.H);
    const sx = v => m.l + (v - s.x0) / Math.max(1e-9, s.x1 - s.x0) * iw, sy = v => m.t + ih - (v - s.lo) / (s.hi - s.lo) * ih;
    ctx.font = Math.round(11 * k) + 'px ' + Charts.token('--f-mono'); ctx.fillStyle = Charts.token('--muted');
    ctx.strokeStyle = Charts.token('--grid'); ctx.lineWidth = 1;
    const yt = Charts.niceTicks(s.lo, s.hi, 4);
    ctx.beginPath();
    for (const t of yt) { const py = Math.round(sy(t)) + 0.5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + iw, py); }
    ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of yt) ctx.fillText((t > 0 ? '+' : '') + t.toFixed(1), m.l - 6, sy(t));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xt = Charts.niceTicks(s.x0, s.x1, Math.max(3, Math.floor(iw / (80 * k)))).filter(t => Math.abs(t - Math.round(t)) < 1e-9);
    for (const t of xt) ctx.fillText(String(Math.round(t)), sx(t), m.t + ih + 6);
    ctx.strokeStyle = Charts.token('--axis'); ctx.beginPath();
    const zy = Math.round(sy(0)) + 0.5; ctx.moveTo(m.l, zy); ctx.lineTo(m.l + iw, zy); ctx.stroke();
    if (isFinite(s.overall)) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = Charts.token('--muted'); ctx.beginPath();
      const oy = sy(s.overall); ctx.moveTo(m.l, oy); ctx.lineTo(m.l + iw, oy); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t - 4, iw * (s.reveal === undefined ? 1 : s.reveal), ih + 8); ctx.clip();
    ctx.strokeStyle = Charts.token('--series-1'); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    let prev = null;
    for (const p of s.pts) {
      const px = sx(p.year), py = sy(p.r);
      if (prev !== null && p.year - prev === 1) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      prev = p.year;
    }
    ctx.stroke();
    ctx.fillStyle = Charts.token('--series-1');
    const inView = s.pts.filter(p => p.year >= s.x0 && p.year <= s.x1);
    if (inView.length < 25) for (const p of inView) { ctx.beginPath(); ctx.arc(sx(p.year), sy(p.r), 3, 0, 6.2832); ctx.fill(); }
    ctx.restore();
  }
  Charts.line = function (canvas, spec) {
    stop(canvas);
    const L = lineFrame(spec), m = L.m, iw = L.iw, ih = L.ih;
    const ctx = setupCanvas(canvas, L.W, L.H);
    const state = { x0: L.x0, x1: L.x1, lo: L.lo, hi: L.hi, pts: L.vis, overall: L.overall };
    if (!L.vis.length) {
      ctx.fillStyle = Charts.token('--surface'); ctx.fillRect(0, 0, L.W, L.H);
      ctx.fillStyle = Charts.token('--muted'); ctx.font = Math.round(13 * L.k) + 'px ' + Charts.token('--f-body');
      ctx.textAlign = 'center'; ctx.fillText('No year has at least 30 observations in this selection.', L.W / 2, L.H / 2);
      return { pick: () => null, invertX: () => NaN, margins: m, inner: { w: iw, h: ih }, frame: L };
    }
    const sx = v => m.l + (v - L.x0) / Math.max(1, L.x1 - L.x0) * iw, sy = v => m.t + ih - (v - L.lo) / (L.hi - L.lo) * ih;
    const api = {
      pick(px) {
        let best = null, bd = 1e9;
        for (const p of L.vis) { const d = Math.abs(sx(p.year) - px); if (d < bd) { bd = d; best = p; } }
        return bd < 20 ? Object.assign({ px: sx(best.year), py: sy(best.r) }, best) : null;
      },
      invertX: px => L.x0 + (px - m.l) / iw * (L.x1 - L.x0), // pixel -> year, for drag-to-zoom
      margins: m, inner: { w: iw, h: ih }, frame: L,
    };
    const tr = spec.transition, A = tr && tr.from;
    const final = () => drawLine(ctx, L, state);
    if (!tr || reduceMotion()) { final(); return api; }
    if (tr.reveal) { // the line draws itself from left to right
      animate(canvas, 'reveal', 1200, u => drawLine(ctx, L, Object.assign({}, state, { reveal: easeInOut(u) })), final);
      return api;
    }
    const same = A && A.points === L.points && A.x0 === L.x0 && A.x1 === L.x1 && A.overall === L.overall;
    if (!A || same || A.W !== L.W || A.H !== L.H || !A.vis.length) { final(); return api; }
    // years in both states glide to their new r, new years rise from zero, dropped years sink to it
    const years = new Map();
    for (const p of A.points) years.set(p.year, [p.r, NaN]);
    for (const p of L.points) { const v = years.get(p.year); if (v) v[1] = p.r; else years.set(p.year, [NaN, p.r]); }
    const union = [...years.keys()].sort((a, b) => a - b);
    animate(canvas, 'line', 700, u => {
      const e = easeInOut(u), xr = lerpRange([A.x0, A.x1], [L.x0, L.x1], e);
      const pts = union.map(year => { const [a, b] = years.get(year); return { year, r: lerp(isFinite(a) ? a : 0, isFinite(b) ? b : 0, e) }; });
      const ov = isFinite(A.overall) && isFinite(L.overall) ? lerp(A.overall, L.overall, e) : L.overall;
      drawLine(ctx, L, { x0: xr[0], x1: xr[1], lo: lerp(A.lo, L.lo, e), hi: lerp(A.hi, L.hi, e), pts, overall: ov });
    }, final);
    return api;
  };

  root.Charts = Charts;
})(window);
