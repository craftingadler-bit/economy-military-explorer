/* Statistics engine for the explorer.
 * Mirrors the notebook (Historical_War_Continent_Analysis.ipynb):
 *  - Pearson r with the conventional two-sided p (scipy.stats.pearsonr)
 *  - Spearman rho with average ranks for ties (scipy.stats.spearmanr)
 *  - between-entity means / within-entity demeaned correlations
 *  - leave-one-country-out via moment sums (leave_groups)
 *  - 1st/99th percentile trimming and winsorising (summarize_group)
 *  - two-way fixed effects with entity+year clustered SEs (fit_absorbed)
 * All functions take plain arrays / typed arrays and return plain objects.
 */
(function (root) {
  'use strict';
  const S = {};

  /* ---------- decoding of the exported columns ---------- */
  const TYPES = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array };
  S.decode = function (col) {
    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(col.b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new Uint8Array(Buffer.from(col.b64, 'base64'));
    }
    const T = TYPES[col.t];
    return new T(bytes.buffer, bytes.byteOffset, bytes.byteLength / T.BYTES_PER_ELEMENT);
  };

  /* ---------- special functions ---------- */
  const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61503916999185, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  function lnGamma(z) {
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < 8; i++) x += LANCZOS[i] / (z + i + 1);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function betacf(a, b, x) {
    const FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 20000; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }
  /* natural log of the regularized incomplete beta I_x(a,b) */
  function lnIncBeta(x, a, b) {
    if (x <= 0) return -Infinity;
    if (x >= 1) return 0;
    const lnFront = a * Math.log(x) + b * Math.log1p(-x) - (lnGamma(a) + lnGamma(b) - lnGamma(a + b));
    if (x < (a + 1) / (a + b + 2)) return lnFront + Math.log(betacf(a, b, x) / a);
    const other = Math.exp(lnFront) * betacf(b, a, 1 - x) / b; // I_{1-x}(b,a)
    return Math.log1p(-other);
  }
  /* two-sided p of Student t with df degrees of freedom, as {p, log10} */
  S.tTwoSided = function (t, df) {
    if (!isFinite(t) || df <= 0) return { p: NaN, log10: NaN };
    const x = df / (df + t * t);
    const ln = lnIncBeta(x, df / 2, 0.5);
    return { p: Math.exp(ln), log10: ln / Math.LN10 };
  };
  S.tQuantile975 = function (df) { // bisection on the two-sided tail = 0.05
    let lo = 0, hi = 50;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (S.tTwoSided(mid, df).p > 0.05) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };

  /* ---------- correlation basics ---------- */
  S.pearson = function (x, y) {
    const n = x.length;
    if (n < 3) return { n, r: NaN };
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    if (!(sxx > 1e-300) || !(syy > 1e-300)) return { n, r: NaN };
    const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
    const slope = sxy / sxx;
    return { n, r, slope, intercept: my - slope * mx, mx, my };
  };
  S.pValue = function (r, n) {
    if (!isFinite(r) || n < 3) return { p: NaN, log10: NaN };
    if (Math.abs(r) >= 1) return { p: 0, log10: -Infinity };
    const df = n - 2;
    return S.tTwoSided(r * Math.sqrt(df / (1 - r * r)), df);
  };
  S.ranks = function (v) {
    const n = v.length, sorted = Float64Array.from(v).sort(), out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const val = v[i];
      let lo = 0, hi = n;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < val) lo = m + 1; else hi = m; }
      const first = lo;
      hi = n;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= val) lo = m + 1; else hi = m; }
      out[i] = (first + lo + 1) / 2; // average rank, 1-based
    }
    return out;
  };
  S.spearman = function (x, y) {
    if (x.length < 3) return NaN;
    return S.pearson(S.ranks(x), S.ranks(y)).r;
  };
  S.correlate = function (x, y, withRho) {
    const base = S.pearson(x, y);
    const p = S.pValue(base.r, base.n);
    return Object.assign(base, { p: p.p, log10p: p.log10, rho: withRho === false ? NaN : S.spearman(x, y) });
  };

  /* ---------- percentiles, trimming, winsorising ---------- */
  S.quantiles = function (v, qs) {
    const s = Float64Array.from(v).sort(), n = s.length;
    return qs.map(q => {
      if (!n) return NaN;
      const pos = (n - 1) * q, lo = Math.floor(pos), frac = pos - lo;
      return lo + 1 < n ? s[lo] + frac * (s[lo + 1] - s[lo]) : s[lo];
    });
  };
  /* returns {keep: Uint8Array} for trim or {x, y} clipped for winsor */
  S.outlierBounds = function (x, y) {
    const [xl, xh] = S.quantiles(x, [0.01, 0.99]);
    const [yl, yh] = S.quantiles(y, [0.01, 0.99]);
    return { xl, xh, yl, yh };
  };

  /* ---------- between / within (entity = country or pair) ---------- */
  S.betweenWithin = function (x, y, ent, nEnt) {
    const n = x.length, cnt = new Float64Array(nEnt), sx = new Float64Array(nEnt), sy = new Float64Array(nEnt);
    for (let i = 0; i < n; i++) { const e = ent[i]; cnt[e]++; sx[e] += x[i]; sy[e] += y[i]; }
    const bx = [], by = [], bEnt = [];
    for (let e = 0; e < nEnt; e++) if (cnt[e] > 0) { bx.push(sx[e] / cnt[e]); by.push(sy[e] / cnt[e]); bEnt.push(e); }
    const wx = new Float64Array(n), wy = new Float64Array(n);
    for (let i = 0; i < n; i++) { const e = ent[i]; wx[i] = x[i] - sx[e] / cnt[e]; wy[i] = y[i] - sy[e] / cnt[e]; }
    return {
      between: S.pearson(bx, by), betweenRho: S.spearman(bx, by), betweenN: bx.length,
      within: S.pearson(wx, wy), withinRho: S.spearman(wx, wy),
      bx, by, bEnt, bCount: bEnt.map(e => cnt[e]), wx, wy,
    };
  };

  /* ---------- leave one country out (both pair roles) ---------- */
  function rFromMoments(n, sx, sy, sxx, syy, sxy) {
    const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
    if (n < 3 || vx <= 1e-12 * Math.max(1, sxx) || vy <= 1e-12 * Math.max(1, syy)) return NaN;
    return Math.max(-1, Math.min(1, (sxy - sx * sy / n) / Math.sqrt(vx * vy)));
  }
  S.leaveOneOut = function (x, y, e1, e2, nEnt) {
    const n = x.length;
    let mx = 0, my = 0, sdx = 0, sdy = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    for (let i = 0; i < n; i++) { sdx += (x[i] - mx) ** 2; sdy += (y[i] - my) ** 2; }
    sdx = Math.sqrt(sdx / n) || 1; sdy = Math.sqrt(sdy / n) || 1; // standardised like the notebook
    const M = [new Float64Array(nEnt), new Float64Array(nEnt), new Float64Array(nEnt),
      new Float64Array(nEnt), new Float64Array(nEnt), new Float64Array(nEnt)];
    let T0 = 0, T1 = 0, T2 = 0, T3 = 0, T4 = 0, T5 = 0;
    const add = (e, a, b) => { M[0][e]++; M[1][e] += a; M[2][e] += b; M[3][e] += a * a; M[4][e] += b * b; M[5][e] += a * b; };
    for (let i = 0; i < n; i++) {
      const a = (x[i] - mx) / sdx, b = (y[i] - my) / sdy;
      T0++; T1 += a; T2 += b; T3 += a * a; T4 += b * b; T5 += a * b;
      add(e1[i], a, b);
      if (e2) add(e2[i], a, b);
    }
    const base = rFromMoments(T0, T1, T2, T3, T4, T5), out = [];
    for (let e = 0; e < nEnt; e++) {
      if (!M[0][e]) continue;
      const r = rFromMoments(T0 - M[0][e], T1 - M[1][e], T2 - M[2][e], T3 - M[3][e], T4 - M[4][e], T5 - M[5][e]);
      out.push({ e, removed: M[0][e], remaining: T0 - M[0][e], r, delta: r - base });
    }
    out.sort((a, b) => (Math.abs(b.delta) || 0) - (Math.abs(a.delta) || 0));
    return { base, list: out };
  };

  /* ---------- two-way fixed effects, entity + year clustered (fit_absorbed) ---------- */
  function factorize(arr) {
    const map = new Map(), codes = new Int32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      let c = map.get(arr[i]);
      if (c === undefined) { c = map.size; map.set(arr[i], c); }
      codes[i] = c;
    }
    return { codes, k: map.size };
  }
  S.fixedEffects = function (x, y, ent, year) {
    const n = x.length;
    const E = factorize(ent), Y = factorize(year);
    if (n < 100 || E.k < 3 || Y.k < 3) return { status: 'too few observations or clusters', n };
    const cols = [Float64Array.from(y), Float64Array.from(x)];
    const groups = [E, Y];
    for (const z of cols) {
      let m = 0; for (let i = 0; i < n; i++) m += z[i]; m /= n;
      let sd = 0; for (let i = 0; i < n; i++) sd += (z[i] - m) ** 2; sd = Math.sqrt(sd / n) || 1;
      z.scale = sd; for (let i = 0; i < n; i++) z[i] /= sd;
    }
    let iterations = 0, converged = false;
    for (; iterations < 1000 && !converged; iterations++) {
      let change = 0;
      for (const g of groups) {
        const count = new Float64Array(g.k); for (let i = 0; i < n; i++) count[g.codes[i]]++;
        for (const z of cols) {
          const s = new Float64Array(g.k); for (let i = 0; i < n; i++) s[g.codes[i]] += z[i];
          for (let i = 0; i < n; i++) { const d = s[g.codes[i]] / count[g.codes[i]]; z[i] -= d; if (Math.abs(d) > change) change = Math.abs(d); }
        }
      }
      if (change < 1e-10) converged = true;
    }
    if (!converged) return { status: 'demeaning did not converge', n };
    const yy = cols[0].map(v => v * cols[0].scale), xx = cols[1].map(v => v * cols[1].scale);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxx += xx[i] * xx[i]; sxy += xx[i] * yy[i]; syy += yy[i] * yy[i]; }
    if (sxx <= 1e-12) return { status: 'no variation left after fixed effects', n };
    const beta = sxy / sxx, bread = 1 / sxx;
    const score = new Float64Array(n); let ssr = 0;
    for (let i = 0; i < n; i++) { const e = yy[i] - beta * xx[i]; score[i] = xx[i] * e; ssr += e * e; }
    // rank of the absorbed effects = entities + years - connected components
    const parent = new Int32Array(E.k + Y.k).map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < n; i++) { const a = find(E.codes[i]), b = find(E.k + Y.codes[i]); if (a !== b) parent[b] = a; }
    let comps = 0; for (let i = 0; i < parent.length; i++) if (find(i) === i) comps++;
    const k = 1 + E.k + Y.k - comps;
    const clusterVar = (codes, g) => {
      const s = new Float64Array(g); for (let i = 0; i < n; i++) s[codes[i]] += score[i];
      let q = 0; for (let j = 0; j < g; j++) q += s[j] * s[j];
      return bread * q * bread * (g / (g - 1)) * ((n - 1) / (n - k));
    };
    // joint entity-year clusters: each country-year (or pair-year) is its own cluster
    const joint = factorize(Array.from(E.codes, (c, i) => c * 100000 + Y.codes[i]));
    const variance = clusterVar(E.codes, E.k) + clusterVar(Y.codes, Y.k) - clusterVar(joint.codes, joint.k);
    const se = variance >= 0 ? Math.sqrt(variance) : NaN;
    const dof = Math.min(E.k, Y.k) - 1, t = beta / se, crit = S.tQuantile975(dof);
    return {
      status: 'computed', n, beta, se, t, dof, p: S.tTwoSided(t, dof).p,
      ciLow: beta - crit * se, ciHigh: beta + crit * se,
      entities: E.k, years: Y.k, withinR2: 1 - (syy - 2 * beta * sxy + beta * beta * sxx) / syy, iterations,
    };
  };

  /* ---------- small helpers ---------- */
  S.strength = function (r) { // thresholds from the course slides
    const a = Math.abs(r);
    if (!isFinite(a)) return 'n/a';
    if (a > 0.5) return 'strong';
    if (a > 0.3) return 'moderate';
    if (a > 0.1) return 'weak';
    return 'negligible';
  };

  root.Stats = S;
  if (typeof module !== 'undefined') module.exports = S;
})(typeof window !== 'undefined' ? window : globalThis);
