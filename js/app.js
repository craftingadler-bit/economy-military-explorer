/* Explorer app: routing, filters, live statistics and rendering. */
(function () {
  'use strict';
  const S = window.Stats, C = window.CONTENT, Charts = window.Charts;
  const META = window.APPDATA.meta, REF = window.APPDATA.reference;
  const ENT = META.entities, NENT = ENT.length;
  const CONT_INDEX = Object.fromEntries(C.CONTINENTS.map((c, i) => [c, i]));
  const entCont = Uint8Array.from(ENT, e => CONT_INDEX[e.continent] ?? CONT_INDEX.Unbekannt);
  const flag = v => (v === null || v === undefined ? 2 : v ? 1 : 0);
  const entElig = Uint8Array.from(ENT, e => (e.freq && e.freq.eligible ? 1 : 0));
  const entRule = {
    aboveMean: Uint8Array.from(ENT, e => flag(e.freq && e.freq.aboveMean)),
    aboveP90: Uint8Array.from(ENT, e => flag(e.freq && e.freq.aboveP90)),
    aboveCount: Uint8Array.from(ENT, e => flag(e.freq && e.freq.aboveCount)),
  };
  const ISO_INDEX = Object.fromEntries(ENT.map((e, i) => [e.iso3, i]));
  const HYP = Object.fromEntries(C.HYPOTHESES.map(h => [h.id, h]));
  const TOKEN = Object.fromEntries(C.HYPOTHESES.map(h => [h.token, h.id]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const app = $('#app');

  /* ---------- formatting ---------- */
  const fInt = new Intl.NumberFormat('en-US');
  const minus = s => s.replace(/^-/, '−');
  const fmtR = r => (isFinite(r) ? minus((r > 0 ? '+' : '') + r.toFixed(3)) : '–');
  const fmtR2 = r => (isFinite(r) ? minus((r > 0 ? '+' : '') + r.toFixed(2)) : '–');
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function fmtP(p, log10) {
    if (!isFinite(p) && !isFinite(log10)) return '–';
    if (isFinite(p) && p >= 0.001) return p.toFixed(3);
    if (!isFinite(log10) && p > 0) log10 = Math.log10(p);
    if (log10 < -300) return '< 10⁻³⁰⁰';
    const e = Math.floor(log10), mant = Math.pow(10, log10 - e);
    return mant.toFixed(2) + '×10' + String(e).split('').map(c => SUP[c]).join('');
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const contEn = i => C.CONTINENT_EN[C.CONTINENTS[i]];
  const entName = i => ENT[i].name;

  /* ---------- data loading ---------- */
  const datasets = {}, loading = {};
  function loadScript(name) {
    if (window.APPDATA[name]) return Promise.resolve();
    if (loading[name]) return loading[name];
    loading[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'data/' + name + '.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load data/' + name + '.js'));
      document.body.appendChild(s);
    });
    return loading[name];
  }
  function showLoading(text) { $('#loading-text').textContent = text; $('#loading').hidden = false; }
  function hideLoading() { $('#loading').hidden = true; }

  function prepareDataset(name) {
    if (datasets[name]) return datasets[name];
    const raw = window.APPDATA[name];
    const d = { name, n: raw.n, unit: raw.unit };
    for (const k in raw.cols) d[k] = S.decode(raw.cols[k]);
    if (d.unit === 'country') {
      d.c = Uint8Array.from(d.e, e => entCont[e]);
    } else {
      d.c1 = Uint8Array.from(d.e1, e => entCont[e]);
      d.c2 = Uint8Array.from(d.e2, e => entCont[e]);
      const map = new Map(); d.pair = new Uint32Array(d.n); d.pairEnts = [];
      for (let i = 0; i < d.n; i++) {
        const key = d.e1[i] * 1024 + d.e2[i];
        let p = map.get(key);
        if (p === undefined) { p = map.size; map.set(key, p); d.pairEnts.push([d.e1[i], d.e2[i]]); }
        d.pair[i] = p;
      }
      d.pairIndex = map;
      d.combo = new Uint8Array(d.n);
      for (let i = 0; i < d.n; i++) {
        const a = C.CONTINENTS[d.c1[i]], b = C.CONTINENTS[d.c2[i]];
        d.combo[i] = a <= b ? d.c1[i] * 8 + d.c2[i] : d.c2[i] * 8 + d.c1[i];
      }
    }
    datasets[name] = d;
    return d;
  }

  const hyps = {};
  function getHyp(id) {
    if (hyps[id]) return hyps[id];
    const cfg = HYP[id], d = prepareDataset(cfg.dataset);
    const X = d[cfg.x], Y = d[cfg.y];
    const rows = [];
    let yMin = 9999, yMax = 0, xPositive = true;
    for (let i = 0; i < d.n; i++) {
      if (!isFinite(X[i]) || !isFinite(Y[i])) continue;
      rows.push(i);
      if (d.year[i] < yMin) yMin = d.year[i];
      if (d.year[i] > yMax) yMax = d.year[i];
      if (X[i] <= 0) xPositive = false;
    }
    hyps[id] = { cfg, d, X, Y, rows: Uint32Array.from(rows), yearMin: yMin, yearMax: yMax, xPositive, pair: d.unit === 'pair' };
    return hyps[id];
  }

  /* ---------- state ---------- */
  const states = {};
  function defaultState(H) {
    return {
      continents: [], pairRule: 'any', war: [], freq: 'none', yearFrom: H.yearMin, yearTo: H.yearMax,
      countryMode: 'exclude', countries: [], outlier: 'full', noJumps: false,
      xLog: !!H.cfg.xLog && H.xPositive, yView: 'full', level: 'pooled', colorBy: 'auto', context: true,
      density: H.pair, group: H.cfg.groups[0], focus: null, select: null, tab: 'influence',
      table: { page: 0, sort: 'year', dir: 1, q: '' },
      zoom: null, lineZoom: null, split: false, focusKey: null,
    };
  }
  /* layout state shared by all hypotheses */
  const ui = { railCollapsed: window.innerWidth <= 860, zoomMode: 'box', expanded: false };
  function applyPreset(H, p) {
    const st = defaultState(H);
    for (const k of ['continents', 'pairRule', 'war', 'freq', 'outlier', 'level', 'colorBy', 'group', 'tab', 'countryMode', 'noJumps', 'yView', 'split']) {
      if (p[k] !== undefined) st[k] = Array.isArray(p[k]) ? p[k].slice() : p[k];
    }
    if (p.countries) st.countries = p.countries.map(iso => ISO_INDEX[iso]).filter(i => i !== undefined);
    if (p.focus) st.focus = p.focus.slice();
    if (p.select && ISO_INDEX[p.select] !== undefined) st.select = { type: 'country', e: ISO_INDEX[p.select] };
    return st;
  }
  function presetState(H, p) {
    const st = applyPreset(H, p);
    if (p.focus) st.focus = [p.focus[0], focusKeyFromPreset(H, p.focus)];
    return st;
  }

  /* ---------- steps: the path of intermediate results ----------
   * Every filter change adds a step with n and r, so the audience can follow
   * how the result moves (e.g. North America, then without the USA). */
  const trails = {};
  const FILTER_KEYS = ['continents', 'pairRule', 'war', 'freq', 'yearFrom', 'yearTo', 'countryMode', 'countries', 'outlier', 'noJumps', 'focus'];
  function snapshot(st) {
    const o = {};
    for (const k of FILTER_KEYS) o[k] = Array.isArray(st[k]) ? st[k].slice() : st[k];
    return o;
  }
  function signature(snap) { // the country mode only matters once countries are chosen
    return JSON.stringify(FILTER_KEYS.map(k => (k === 'countryMode' && !snap.countries.length ? 'exclude'
      : Array.isArray(snap[k]) && k !== 'focus' ? snap[k].slice().sort() : snap[k])));
  }
  function quickStats(H, st) { // n and Pearson r only, cheap enough to run several times per change
    const g = gather(H, filterRows(H, st, null), st.outlier);
    return { n: g.x.length, r: g.x.length >= 3 ? S.pearson(g.x, g.y).r : NaN };
  }
  const FREQ_SHORT = { none: 'all countries kept', reference: 'known war status only', aboveMean: 'war-prone countries dropped', aboveP90: 'top-10% war countries dropped', aboveCount: 'many-war countries dropped' };
  function describeChange(H, a, b) {
    const parts = [], iso = e => ENT[e].iso3;
    const diff = (x, y) => [x.filter(v => !y.includes(v)), y.filter(v => !x.includes(v))];
    const [cOut, cIn] = diff(a.continents, b.continents);
    if (!b.continents.length && a.continents.length) parts.push('all continents');
    else { cIn.forEach(c => parts.push(C.CONTINENT_EN[c])); cOut.forEach(c => parts.push('− ' + C.CONTINENT_EN[c])); }
    const wl = H.pair ? C.PAIR_WAR : C.COUNTRY_WAR, [wOut, wIn] = diff(a.war, b.war);
    if (!b.war.length && a.war.length) parts.push('any war status');
    else { wIn.forEach(w => parts.push(wl[w])); wOut.forEach(w => parts.push('− ' + wl[w])); }
    if (a.countryMode !== b.countryMode && b.countries.length) parts.push(b.countryMode === 'only' ? 'only these countries' : 'exclude instead');
    const [eOut, eIn] = diff(a.countries, b.countries);
    eIn.forEach(e => parts.push(b.countryMode === 'only' ? (b.countries.length === 1 ? 'only ' + iso(e) : '+ ' + iso(e)) : 'without ' + iso(e)));
    eOut.forEach(e => parts.push(b.countryMode === 'only' ? '− ' + iso(e) : iso(e) + ' back in'));
    if (a.freq !== b.freq) parts.push(FREQ_SHORT[b.freq]);
    if (a.yearFrom !== b.yearFrom || a.yearTo !== b.yearTo) parts.push(b.yearFrom + '–' + b.yearTo);
    if (a.outlier !== b.outlier) parts.push({ full: 'no outlier treatment', trim: 'trimmed 1–99%', winsor: 'winsorised' }[b.outlier]);
    if (a.noJumps !== b.noJumps) parts.push(b.noJumps ? 'jumps > ±100% dropped' : 'jumps kept');
    if (JSON.stringify(a.focus) !== JSON.stringify(b.focus)) parts.push(b.focus ? groupLabel(H, b.focus[0], b.focus[1]) : 'focus removed');
    if (a.pairRule !== b.pairRule) parts.push(b.pairRule === 'both' ? 'both countries in continent' : 'at least one country');
    if (!parts.length) return 'changed';
    const text = parts.length > 2 ? parts.slice(0, 2).join(', ') + ' …' : parts.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  function baseStep(H) {
    const snap = snapshot(defaultState(H)), ref = REF.baseline[H.cfg.id];
    return { snap, sig: signature(snap), label: 'Full sample', n: ref.n, r: ref.pearson_r, rho: ref.spearman_rho };
  }
  /* A prepared view starts with its own path: full sample, optional intermediate steps, the view itself. */
  function presetTrail(H, p, final) {
    const steps = [baseStep(H)];
    for (const patch of (p.steps || []).concat([null])) {
      const st = patch ? presetState(H, Object.assign({ h: p.h }, patch)) : final;
      const snap = snapshot(st), sig = signature(snap), prev = steps[steps.length - 1];
      if (sig === prev.sig) continue;
      const q = quickStats(H, st);
      steps.push({ snap, sig, label: describeChange(H, prev.snap, snap), n: q.n, r: q.r, rho: NaN });
    }
    trails[H.cfg.id] = { steps, cur: steps.length - 1 };
  }
  function recordStep(H, st, res) {
    const id = H.cfg.id;
    if (!trails[id]) trails[id] = { steps: [baseStep(H)], cur: 0 };
    const t = trails[id], snap = snapshot(st), sig = signature(snap), cur = t.steps[t.cur];
    if (cur.sig === sig) { Object.assign(cur, { snap, n: res.n, r: res.corr.r, rho: res.corr.rho }); return; }
    const base = t.steps[0];
    t.steps = t.steps.slice(0, t.cur + 1);
    t.steps.push({ snap, sig, label: sig === base.sig ? 'Full sample' : describeChange(H, cur.snap, snap), n: res.n, r: res.corr.r, rho: res.corr.rho });
    if (t.steps.length > 12) t.steps.splice(1, t.steps.length - 12); // keep the full sample as first step
    t.cur = t.steps.length - 1;
  }

  /* ---------- live values for each country in the country filter ---------- */
  function countryEffects(H, st, res) {
    if (!st.countries.length) return [];
    return st.countries.slice(0, 12).map(e => {
      const others = st.countries.filter(c => c !== e);
      if (st.countryMode === 'exclude') {
        const back = quickStats(H, Object.assign({}, st, { countries: others }));
        return { e, rows: back.n - res.n, rBack: back.r, effect: res.corr.r - back.r };
      }
      const own = quickStats(H, Object.assign({}, st, { countries: [e] }));
      const without = others.length ? quickStats(H, Object.assign({}, st, { countries: others })) : null;
      return { e, rows: own.n, own: own.r, rWithout: without ? without.r : NaN };
    });
  }

  /* ---------- grouping keys ---------- */
  const RELATION = ['Same continent', 'Different continents', 'Unknown'];
  const WINDOW = ['Neither at war in t−1 or t', 'One at war in t−1 or t', 'Both at war in t−1 or t', 'Unknown'];
  const NEXT = ['No war in the next 5 years', 'War in the next 5 years', 'Window unknown'];
  const BORDER = ['No shared border', 'Shared border', 'Unknown'];
  const LANG = ['No shared official language', 'Shared official language', 'Unknown'];
  function keyFn(H, dim) {
    const d = H.d;
    switch (dim) {
      case 'continent': return H.pair ? null : i => d.c[i];
      case 'combo': return i => d.combo[i];
      case 'relation': return i => (d.c1[i] === 6 || d.c2[i] === 6 ? 2 : d.c1[i] === d.c2[i] ? 0 : 1);
      case 'war': return i => d.war[i];
      case 'warWindow': return i => d.warWindow[i];
      case 'warNext': return i => d.warNext[i];
      case 'decade': return i => Math.floor(d.year[i] / 10) * 10;
      case 'border': return i => d.contig[i];
      case 'lang': return i => d.lang[i];
    }
    return null;
  }
  function groupLabel(H, dim, key) {
    switch (dim) {
      case 'continent': return contEn(key);
      case 'combo': return contEn(Math.floor(key / 8)) + ' / ' + contEn(key % 8);
      case 'relation': return RELATION[key];
      case 'war': return (H.pair ? C.PAIR_WAR : C.COUNTRY_WAR)[key];
      case 'warWindow': return WINDOW[key];
      case 'warNext': return NEXT[key];
      case 'decade': return key + 's';
      case 'border': return BORDER[key];
      case 'lang': return LANG[key];
    }
    return String(key);
  }
  function focusKeyFromPreset(H, focus) { // presets name combos in German like the notebook
    if (focus[0] !== 'combo' || typeof focus[1] === 'number') return focus[1];
    const [a, b] = focus[1].split(' / ').map(n => CONT_INDEX[n]);
    return a * 8 + b;
  }

  /* ---------- filtering ---------- */
  function filterRows(H, st, skip) {
    const d = H.d, rows = H.rows, out = new Uint32Array(rows.length);
    const unknown = H.pair ? 3 : 2;
    const contOn = st.continents.length && skip !== 'continent';
    const contMask = new Uint8Array(8); st.continents.forEach(c => { contMask[CONT_INDEX[c]] = 1; });
    const warOn = st.war.length && skip !== 'war';
    const warMask = new Uint8Array(4); st.war.forEach(w => { warMask[w] = 1; });
    const yearOn = skip !== 'decade';
    const cMask = new Uint8Array(NENT); st.countries.forEach(e => { cMask[e] = 1; });
    const cOn = st.countries.length > 0, only = st.countryMode === 'only';
    const freq = st.freq, rule = entRule[freq];
    const focus = st.focus && st.focus[0] !== skip ? st.focus : null;
    const fKey = focus ? keyFn(H, focus[0]) : null, fVal = focus ? focus[1] : null;
    let k = 0;
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      if (yearOn && (d.year[i] < st.yearFrom || d.year[i] > st.yearTo)) continue;
      if (warOn && !warMask[d.war[i]]) continue;
      if (H.pair) {
        const a = d.e1[i], b = d.e2[i];
        if (contOn) {
          const ia = contMask[d.c1[i]], ib = contMask[d.c2[i]];
          if (st.pairRule === 'both' ? !(ia && ib) : !(ia || ib)) continue;
        }
        if (cOn && (only ? !(cMask[a] || cMask[b]) : (cMask[a] || cMask[b]))) continue;
        if (freq !== 'none') {
          if (d.war[i] === unknown || !entElig[a] || !entElig[b]) continue;
          if (rule && (rule[a] !== 0 || rule[b] !== 0)) continue;
        }
        if (st.noJumps && !(Math.abs(d.g1[i]) <= 100 && Math.abs(d.g2[i]) <= 100)) continue;
      } else {
        const e = d.e[i];
        if (contOn && !contMask[d.c[i]]) continue;
        if (cOn && (only ? !cMask[e] : cMask[e])) continue;
        if (freq !== 'none') {
          if (d.war[i] === unknown || !entElig[e]) continue;
          if (rule && rule[e] !== 0) continue;
        }
      }
      if (fKey && fKey(i) !== fVal) continue;
      out[k++] = i;
    }
    return out.subarray(0, k);
  }

  function gather(H, rows, mode) {
    const n = rows.length; let x = new Float64Array(n), y = new Float64Array(n);
    for (let j = 0; j < n; j++) { x[j] = H.X[rows[j]]; y[j] = H.Y[rows[j]]; }
    if (mode === 'full' || n < 3) return { rows, x, y };
    const b = S.outlierBounds(x, y);
    if (mode === 'winsor') {
      for (let j = 0; j < n; j++) { x[j] = Math.min(b.xh, Math.max(b.xl, x[j])); y[j] = Math.min(b.yh, Math.max(b.yl, y[j])); }
      return { rows, x, y, bounds: b };
    }
    const keep = [];
    for (let j = 0; j < n; j++) if (x[j] >= b.xl && x[j] <= b.xh && y[j] >= b.yl && y[j] <= b.yh) keep.push(j);
    return { rows: Uint32Array.from(keep, j => rows[j]), x: Float64Array.from(keep, j => x[j]), y: Float64Array.from(keep, j => y[j]), bounds: b };
  }

  /* ---------- computation ---------- */
  function compute(H, st) {
    const t0 = performance.now();
    const d = H.d, base = gather(H, filterRows(H, st, null), st.outlier);
    const rows = base.rows, x = base.x, y = base.y, n = x.length;
    const res = { rows, x, y, n, corr: { n, r: NaN, rho: NaN, p: NaN } };
    const entMark = new Uint8Array(NENT); let countries = 0;
    let yMin = 9999, yMax = 0;
    for (let j = 0; j < n; j++) {
      const i = rows[j];
      if (d.year[i] < yMin) yMin = d.year[i]; if (d.year[i] > yMax) yMax = d.year[i];
      if (H.pair) { entMark[d.e1[i]] = 1; entMark[d.e2[i]] = 1; } else entMark[d.e[i]] = 1;
    }
    for (let e = 0; e < NENT; e++) countries += entMark[e];
    res.countries = countries; res.years = [yMin, yMax];
    if (n < 3) return res;
    res.corr = S.correlate(x, y);
    const ent = new Uint32Array(n), e1 = new Uint16Array(n), e2 = H.pair ? new Uint16Array(n) : null, yr = new Uint16Array(n);
    for (let j = 0; j < n; j++) {
      const i = rows[j]; yr[j] = d.year[i];
      if (H.pair) { ent[j] = d.pair[i]; e1[j] = d.e1[i]; e2[j] = d.e2[i]; } else { ent[j] = d.e[i]; e1[j] = d.e[i]; }
    }
    res.ent = ent; res.e1 = e1; res.e2 = e2; res.yr = yr;
    res.bw = S.betweenWithin(x, y, ent, H.pair ? d.pairEnts.length : NENT);
    res.pairs = H.pair ? res.bw.betweenN : 0;
    res.loo = S.leaveOneOut(x, y, e1, e2, NENT);
    if (!H.pair) {
      const mx = H.cfg.modelLog ? x.map(Math.log) : x;
      res.fe = S.fixedEffects(mx, y, Array.from(ent), Array.from(yr));
    }
    // annual correlations (moment sums, minimum 30 rows per year as in the notebook)
    const years = new Map();
    for (let j = 0; j < n; j++) {
      let m = years.get(yr[j]); if (!m) years.set(yr[j], m = [0, 0, 0, 0, 0, 0]);
      m[0]++; m[1] += x[j]; m[2] += y[j]; m[3] += x[j] * x[j]; m[4] += y[j] * y[j]; m[5] += x[j] * y[j];
    }
    res.annual = [];
    for (const [year, m] of [...years].sort((a, b) => a[0] - b[0])) {
      if (m[0] < 30) continue;
      const vx = m[3] - m[1] * m[1] / m[0], vy = m[4] - m[2] * m[2] / m[0];
      if (vx > 1e-12 && vy > 1e-12) res.annual.push({ year, n: m[0], r: (m[5] - m[1] * m[2] / m[0]) / Math.sqrt(vx * vy) });
    }
    // extreme cases: top and bottom 5 by X, Y and residual
    const a = res.corr.intercept, b = res.corr.slope;
    const resid = new Float64Array(n); for (let j = 0; j < n; j++) resid[j] = y[j] - (a + b * x[j]);
    const topK = (arr, k, desc) => {
      const out = [];
      for (let j = 0; j < arr.length; j++) {
        const v = arr[j];
        if (out.length < k) { out.push(j); out.sort((p, q) => desc ? arr[q] - arr[p] : arr[p] - arr[q]); continue; }
        const last = arr[out[k - 1]];
        if (desc ? v > last : v < last) { out[k - 1] = j; out.sort((p, q) => desc ? arr[q] - arr[p] : arr[p] - arr[q]); }
      }
      return out;
    };
    let ties = 0; const ymin = Math.min(...topK(y, 1, false).map(j => y[j]));
    for (let j = 0; j < n; j++) if (y[j] === ymin) ties++;
    res.extremes = {
      yHigh: topK(y, 5, true), yLow: topK(y, 5, false), xHigh: topK(x, 5, true), xLow: topK(x, 5, false),
      above: topK(resid, 5, true), below: topK(resid, 5, false), resid, yMinTies: ties, yMin: ymin,
    };
    res.ms = performance.now() - t0;
    return res;
  }

  function computeGroups(H, st) {
    const dim = st.group, rows = filterRows(H, st, dim), d = H.d;
    const buckets = new Map();
    const push = (k, i) => { let a = buckets.get(k); if (!a) buckets.set(k, a = []); a.push(i); };
    if (dim === 'continent' && H.pair) {
      for (const i of rows) { push(d.c1[i], i); if (d.c2[i] !== d.c1[i]) push(d.c2[i], i); }
    } else {
      const f = keyFn(H, dim);
      for (const i of rows) push(f(i), i);
    }
    const out = [];
    for (const [key, list] of buckets) {
      const g = gather(H, Uint32Array.from(list), st.outlier);
      const c = g.x.length >= 3 ? S.correlate(g.x, g.y) : { n: g.x.length, r: NaN, rho: NaN, p: NaN };
      out.push({ key, label: groupLabel(H, dim, key), n: g.x.length, r: c.r, rho: c.rho, p: c.p, log10p: c.log10p });
    }
    if (dim === 'combo') out.sort((p, q) => q.n - p.n);
    else out.sort((p, q) => (p.key > q.key ? 1 : -1));
    return out;
  }
  function groupSelected(H, st, key) {
    switch (st.group) {
      case 'continent': return st.continents.includes(C.CONTINENTS[key]);
      case 'war': return st.war.includes(key);
      case 'decade': return st.yearFrom === key && st.yearTo === Math.min(H.yearMax, key + 9);
      default: return !!(st.focus && st.focus[0] === st.group && st.focus[1] === key);
    }
  }
  /* Click: only this group (again: all). Shift/Cmd/Ctrl-click: add or remove it. */
  function toggleGroup(H, st, key, add) {
    const sel = groupSelected(H, st, key);
    const pick = (list, v) => add ? (sel ? list.filter(c => c !== v) : list.concat(v)) : (sel && list.length === 1 ? [] : [v]);
    switch (st.group) {
      case 'continent': st.continents = pick(st.continents, C.CONTINENTS[key]); break;
      case 'war': st.war = pick(st.war, key); break;
      case 'decade':
        if (sel) { st.yearFrom = H.yearMin; st.yearTo = H.yearMax; }
        else { st.yearFrom = Math.max(H.yearMin, key); st.yearTo = Math.min(H.yearMax, key + 9); }
        break;
      default: st.focus = sel ? null : [st.group, key];
    }
  }

  /* ---------- routing ---------- */
  let current = { view: null, H: null };
  function route(token, opts = {}) {
    token = (token || 'overview').replace(/^#/, '');
    hideTooltip();
    if (C.PRESETS[token]) {
      const p = C.PRESETS[token];
      return openHypothesis(p.h, H => { states[p.h] = presetState(H, p); presetTrail(H, p, states[p.h]); }, token);
    }
    if (TOKEN[token]) {
      const id = TOKEN[token];
      return openHypothesis(id, opts.reset ? H => { states[id] = defaultState(H); trails[id] = { steps: [baseStep(H)], cur: 0 }; } : null, token);
    }
    if (token === 'why' || /^why-h[1-4]$/.test(token)) return renderExplain(token);
    if (token === 'methods') return renderMethods();
    renderOverview(token);
  }
  function setHash(token) {
    try { if (location.hash.slice(1) !== token) history.replaceState(null, '', '#' + token); } catch (err) { /* sandboxed frame */ }
  }
  window.addEventListener('hashchange', () => route(location.hash.slice(1)));

  function renderNav(active) {
    const item = (token, label, title) => `<a href="#${token}" class="${active === token ? 'is-active' : ''}" ${active === token ? 'aria-current="page"' : ''} title="${esc(title || '')}">${label}</a>`;
    $('#mainnav').innerHTML =
      item('overview', 'Overview') +
      '<span class="nav-sep" aria-hidden="true"></span>' +
      C.HYPOTHESES.filter(h => h.role === 'main').map(h => item(h.token, h.id, h.title)).join('') +
      item('why', 'Why?', 'Explanations for H1–H4 with sources') +
      '<span class="nav-sep" aria-hidden="true"></span><span class="nav-label">Side</span>' +
      C.HYPOTHESES.filter(h => h.role === 'side').map(h => item(h.token, h.id, h.title)).join('') +
      '<span class="nav-sep" aria-hidden="true"></span>' + item('methods', 'Methods') +
      '<span class="nav-ink" aria-hidden="true"></span>';
    placeNavInk(true);
  }
  let navInk = null;
  function placeNavInk(animate) {
    const nav = $('#mainnav'), ink = nav.querySelector('.nav-ink'), a = nav.querySelector('a.is-active');
    if (!ink) return;
    if (!a) { ink.style.opacity = '0'; navInk = null; return; }
    const to = { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight };
    const put = p => { ink.style.transform = `translate(${p.x}px, ${p.y}px)`; ink.style.width = p.w + 'px'; ink.style.height = p.h + 'px'; };
    const glide = animate && navInk && !reduceMotion();
    ink.style.transition = 'none';
    if (glide) { put(navInk); void ink.offsetWidth; ink.style.transition = ''; }
    put(to); ink.style.opacity = '1';
    if (!glide) { void ink.offsetWidth; ink.style.transition = ''; } // first placement: no slide in from the corner
    navInk = to;
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeNavInk(false)); // web fonts change the link widths

  /* ---------- overview ---------- */
  function refStats(id) {
    const r = REF.baseline[id];
    return { n: r.n, r: r.pearson_r, rho: r.spearman_rho, p: r.p_standard, log10p: r.p_standard > 0 ? Math.log10(r.p_standard) : -Infinity };
  }
  function pFromRef(id) { // recompute log10 p for underflowed values so the table never says p = 0
    const r = REF.baseline[id], pv = S.pValue(r.pearson_r, r.n);
    return fmtP(pv.p, pv.log10);
  }
  function expectedSign(cfg) { return cfg.expected === 'negative' ? '−' : '+'; }
  function verdictChip(cfg) { return `<span class="chip tone-${cfg.tone}">${esc(cfg.verdict)}</span>`; }
  function resultRows(list) {
    return list.map(cfg => {
      const s = refStats(cfg.id);
      return `<tr>
        <th scope="row"><a class="hyp-link" href="#${cfg.token}"><span class="hyp-id">${cfg.id}</span>${esc(cfg.title)}</a>
          <div class="hyp-statement">${esc(cfg.statement)}</div></th>
        <td class="num center"><span class="sign">${expectedSign(cfg)}</span></td>
        <td class="num">${fInt.format(s.n)}</td>
        <td class="num strong">${fmtR(s.r)}</td>
        <td class="num">${fmtR(s.rho)}</td>
        <td class="num">${pFromRef(cfg.id)}</td>
        <td>${S.strength(s.r)}</td>
        <td>${verdictChip(cfg)}</td>
      </tr>`;
    }).join('');
  }
  function resultCards(list) {
    return list.map(cfg => {
      const s = refStats(cfg.id), exp = cfg.expected === 'negative' ? -1 : 1, strength = S.strength(s.r);
      return `<a class="rcard" href="#${cfg.token}">
        <div class="rcard-top"><span class="rcard-id">${cfg.id}</span>${verdictChip(cfg)}</div>
        <h3>${esc(cfg.title)}</h3>
        <p class="rcard-statement">${esc(cfg.statement)}</p>
        <div class="rcard-r ${s.r < 0 ? 'neg' : 'pos'}">
          <span class="rcard-big" data-count-r="${s.r}">${fmtR(s.r)}</span>
          <span class="rcard-tags"><span class="pill pill-${strength}">${strength}</span><span class="muted">Pearson r</span></span>
        </div>
        <div class="gauge gauge-card" aria-hidden="true">
          <span class="gauge-band" style="left:45%;width:10%"></span>
          <span class="gauge-tick" style="left:35%"></span><span class="gauge-tick" style="left:25%"></span>
          <span class="gauge-tick" style="left:65%"></span><span class="gauge-tick" style="left:75%"></span>
          <span class="gauge-zero"></span><span class="gauge-expect ${exp < 0 ? 'neg' : 'pos'}"></span>
          <span class="gauge-dot ${s.r < 0 ? 'neg' : 'pos'}" style="left:50%" data-left="${gaugePos(s.r)}"></span>
        </div>
        <dl class="rcard-kv">
          <div><dt>n</dt><dd>${fInt.format(s.n)}</dd></div>
          <div><dt>p (standard)</dt><dd>${pFromRef(cfg.id)}</dd></div>
          <div><dt>Spearman ρ</dt><dd>${fmtR(s.rho)}</dd></div>
          <div><dt>Expected</dt><dd>${cfg.expected === 'negative' ? '− negative' : '+ positive'}</dd></div>
        </dl>
        <span class="rcard-go">Explore ${cfg.id}</span>
      </a>`;
    }).join('');
  }
  function rStrip(list) {
    const lo = -0.6, hi = 0.6, pos = v => ((v - lo) / (hi - lo)) * 100;
    const bands = [[-0.6, -0.5, 'strong'], [-0.5, -0.3, 'moderate'], [-0.3, -0.1, 'weak'], [-0.1, 0.1, 'negligible'], [0.1, 0.3, 'weak'], [0.3, 0.5, 'moderate'], [0.5, 0.6, 'strong']];
    const ticks = [-0.5, -0.3, -0.1, 0, 0.1, 0.3, 0.5];
    return `<div class="rstrip" role="img" aria-label="Pearson r of all hypotheses on a scale from −0.6 to +0.6">
      <div class="rstrip-head"><span></span><div class="rstrip-axis">${bands.map(b => `<span class="band band-${b[2]}" style="left:${pos(b[0])}%;width:${pos(b[1]) - pos(b[0])}%">${b[2] === 'negligible' ? 'not interpretable' : b[1] > 0 && b[2] !== 'negligible' ? b[2] : ''}</span>`).join('')}</div></div>
      ${list.map(cfg => {
        const r = REF.baseline[cfg.id].pearson_r, exp = cfg.expected === 'negative' ? -1 : 1;
        return `<a class="rstrip-row" href="#${cfg.token}">
          <span class="rstrip-label"><b>${cfg.id}</b> ${esc(cfg.title)}</span>
          <span class="rstrip-track">
            ${bands.map(b => `<span class="band-bg band-${b[2]}" style="left:${pos(b[0])}%;width:${pos(b[1]) - pos(b[0])}%"></span>`).join('')}
            <span class="zero" style="left:${pos(0)}%"></span>
            <span class="expect ${exp < 0 ? 'neg' : 'pos'}" style="${exp < 0 ? 'right:' + (100 - pos(0)) + '%' : 'left:' + pos(0) + '%'}" title="Expected direction"></span>
            <span class="dot ${r < 0 ? 'neg' : 'pos'}" style="left:${pos(0)}%" data-left="${pos(r)}" title="r = ${fmtR(r)}"></span>
            <span class="dot-label" style="left:${pos(0)}%" data-left="${pos(r)}">${fmtR2(r)}</span>
          </span></a>`;
      }).join('')}
      <div class="rstrip-foot"><span></span><div class="rstrip-ticks">${ticks.map(t => `<span style="left:${pos(t)}%">${fmtR2(t).replace('+0.00', '0')}</span>`).join('')}</div></div>
    </div>`;
  }

  /* ---------- entrance and scroll reveal ---------- */
  let enterTimer = 0, revealObs = null;
  function enterView() { // the panels of a newly opened page rise in one after another
    if (reduceMotion()) return;
    app.classList.remove('view-enter'); void app.offsetWidth; app.classList.add('view-enter');
    clearTimeout(enterTimer); enterTimer = setTimeout(() => app.classList.remove('view-enter'), 1600);
  }
  function countUp(el, to, fmt) { tween(el, 0, to, fmt); }
  function playReveal(el) {
    el.classList.add('is-in');
    $$('[data-count]', el).forEach(n => countUp(n, +n.dataset.count, v => fInt.format(Math.round(v))));
    $$('[data-count-r]', el).forEach(n => countUp(n, +n.dataset.countR, fmtR));
    $$('[data-left]', el).forEach(d => { d.style.left = d.dataset.left + '%'; });
  }
  /* sections fade up when they scroll into view; their numbers count up and their dots slide into place */
  function setupReveal() {
    if (revealObs) revealObs.disconnect();
    const els = $$('#app .section'), hero = $('#app .hero');
    if (hero) setTimeout(() => playReveal(hero), reduceMotion() ? 0 : 220); // in view from the start: count while it rises
    $$('#app .rcards, #app .lenses, #app .rstrip, #app .takeaways, #app .sources, #app .facts, #app .why-teasers, #app .why-cards, #app .why-figs').forEach(c => Array.from(c.children).forEach((ch, i) => ch.style.setProperty('--i', i)));
    if (reduceMotion() || !('IntersectionObserver' in window)) { els.forEach(playReveal); return; }
    els.forEach(el => el.classList.add('reveal'));
    revealObs = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) { revealObs.unobserve(en.target); playReveal(en.target); }
    }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
    els.forEach(el => revealObs.observe(el));
  }

  function renderOverview(anchor) {
    const again = current.view === 'overview';
    current = { view: 'overview', H: null };
    renderNav('overview');
    const main = C.HYPOTHESES.filter(h => h.role === 'main'), side = C.HYPOTHESES.filter(h => h.role === 'side');
    const nMin = Math.min(...main.map(h => REF.baseline[h.id].n));
    app.innerHTML = `
    <section class="hero wrap">
      <div class="hero-text">
        <p class="kicker">Integrationsseminar · DHBW Mannheim · Fall 2026 · Jannis Hardt</p>
        <h1>Do richer and more connected countries keep different armies?</h1>
        <p class="lead">Four hypotheses on productivity, trade and armed forces, tested on country-years and country pairs from 1950 to 2014. Every chart and number in the explorer is recalculated live, so any group, war status or single country can be taken out or looked at alone.</p>
        <div class="hero-actions">
          <a class="btn btn-accent btn-lg" href="#h1">Explore H1</a>
          <a class="btn btn-lg" href="#results">See all results</a>
        </div>
      </div>
      <dl class="facts">
        <div><dt>Data sources</dt><dd data-count="8">8</dd><span>10 raw files, merged by country code and year</span></div>
        <div><dt>Countries</dt><dd data-count="${NENT}">${fInt.format(NENT)}</dd><span>post-1950 states with clean territorial coverage</span></div>
        <div><dt>Smallest main sample</dt><dd data-count="${nMin}">${fInt.format(nMin)}</dd><span>value pairs (H2). Course minimum: 5,000</span></div>
        <div><dt>Largest sample</dt><dd data-count="${REF.baseline.H4.n}">${fInt.format(REF.baseline.H4.n)}</dd><span>country-pair years (H4)</span></div>
      </dl>
    </section>

    <section class="wrap section" id="results">
      <div class="section-head">
        <h2>Results at a glance</h2>
        <p class="checks"><span class="check">3–5 hypotheses</span><span class="check">≥ 5,000 value pairs each</span><span class="check">n, r and p reported</span></p>
      </div>
      <div class="rcards">${resultCards(main)}</div>
      <p class="note">Strength follows the course thresholds: |r| > 0.5 strong, > 0.3 moderate, > 0.1 weak; smaller values are not interpreted. Standard p-values assume independent rows. Countries and pairs repeat over years, so they overstate certainty.</p>
    </section>

    <section class="wrap section" id="explain">
      <div class="section-head"><h2>Why the results look like this</h2><p class="sub">Explanations from research, geopolitics and history, each with checked sources.</p></div>
      <div class="why-teasers">${C.EXPLAIN.map(X => `<a class="why-teaser" href="#why-${X.token}">
        <span class="lens-kicker">${X.id} · ${esc(HYP[X.id].title)}</span>
        <h3>${esc(X.answer.split('. ')[0].replace(/\.$/, ''))}.</h3>
        <span class="why-teaser-types">${[...new Set(X.cards.map(c => c.type))].map(t => `<span class="t-${t}" title="${C.EXPLAIN_TYPES[t].label}">${typeIcon(t)}</span>`).join('')}</span>
        <span class="lens-go">Read why</span></a>`).join('')}</div>
    </section>

    <section class="wrap section">
      <div class="section-head"><h2>Where each result sits</h2><p class="sub">Dot: observed r. Shaded arrow: the direction the hypothesis expected.</p></div>
      ${rStrip(main.concat(side))}
    </section>

    <section class="wrap section" id="individual">
      <div class="section-head"><h2>Individual part: looking inside the averages</h2>
      <p class="sub">The global r is one number for 65 years and up to 194 countries. These three lenses show what it hides.</p></div>
      <div class="lenses">
        <a class="lens" href="#h1-within"><span class="lens-kicker">Level</span><h3>Between vs. within countries</h3><p>H1 is +0.40 between country averages but −0.16 within countries over time.</p><span class="lens-go">Open H1 · within</span></a>
        <a class="lens" href="#h1-continents"><span class="lens-kicker">Region and war</span><h3>Continents and war status</h3><p>CEPII continents and COW inter-state war participation up to 2007, plus a filter for war-prone countries.</p><span class="lens-go">Open H1 · continents</span></a>
        <a class="lens" href="#h1-northamerica-without-usa"><span class="lens-kicker">Influence</span><h3>Single countries and extreme cases</h3><p>Leave-one-country-out shows which state carries a result. North America flips sign without the USA.</p><span class="lens-go">Open H1 · without USA</span></a>
      </div>
    </section>

    <section class="wrap section" id="side">
      <div class="section-head"><h2>Side questions</h2><p class="sub">Added after the first results to look for explanations. Exploratory; H8 stays below 5,000 pairs.</p></div>
      <div class="table-scroll"><table class="results compact">
        <thead><tr><th scope="col">Question</th><th scope="col" class="center">Exp.</th><th scope="col" class="num">n</th><th scope="col" class="num">Pearson r</th><th scope="col" class="num">Spearman ρ</th><th scope="col" class="num">p (standard)</th><th scope="col">Strength</th><th scope="col">Result</th></tr></thead>
        <tbody>${resultRows(side)}</tbody>
      </table></div>
    </section>

    <section class="wrap section" id="conclusion">
      <div class="section-head"><h2>What the data say</h2></div>
      <div class="takeaways">
        <div><h3>The expected links are weak or reversed</h3><p>H1 and H2 point the opposite way, H3 has the expected sign but is negligible, H4 is zero. Weak results are results, too.</p></div>
        <div><h3>The level of analysis changes the answer</h3><p>Rich countries have more soldiers per capita, yet a country that grows more productive tends to reduce them. Pooled data mix both.</p></div>
        <div><h3>Single countries move regional results</h3><p>The USA flips H1 in North America and creates the H4 pattern in the Americas. Angola drives much of H3’s noise.</p></div>
      </div>
      <p class="note">Correlation is not causation. War status covers inter-state wars only (COW, up to 2007), so “no war recorded” does not mean peace.</p>
    </section>

    <section class="wrap section" id="sources">
      <div class="section-head"><h2>Data sources</h2></div>
      <div class="sources">${C.SOURCES.map(s => `<div><b>${esc(s.name)}</b><span>${esc(s.use)}</span><em>${esc(s.unit)}</em></div>`).join('')}</div>
      <p class="note">Prepared with <code>Historical_War_Continent_Analysis.ipynb</code>; exported by <code>Website/build_data.py</code> on ${esc(META.built.slice(0, 10))}. <a href="#methods">Methods and live validation</a></p>
    </section>`;
    if (!again) enterView();
    setupReveal();
    if (anchor && anchor !== 'overview') {
      const el = document.getElementById(anchor);
      if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
    } else window.scrollTo(0, 0);
  }

  /* ---------- explorer ---------- */
  let ex = null; // { H, st, res, groups, plot, linePlot }
  function openHypothesis(id, init, token) {
    const cfg = HYP[id];
    const go = () => {
      const H = getHyp(id);
      if (init) init(H);
      if (!states[id]) states[id] = defaultState(H);
      renderExplorer(H, token);
    };
    if (window.APPDATA[cfg.dataset] || datasets[cfg.dataset]) return go();
    showLoading(cfg.dataset === 'TRADE' ? 'Loading 259,503 country-pair years…' : cfg.dataset === 'H3' ? 'Loading 176,593 country-pair years…' : 'Loading data…');
    loadScript(cfg.dataset).then(() => { setTimeout(() => { go(); hideLoading(); }, 10); })
      .catch(err => { hideLoading(); app.innerHTML = `<div class="wrap section"><p class="error">${esc(err.message)}. Open the site from the Website folder so the data folder sits next to index.html.</p></div>`; });
  }

  function chipGroup(id, items) {
    return `<div class="chips" id="${id}">${items.map(([v, label]) => `<button type="button" class="chip-btn" data-v="${esc(v)}" aria-pressed="false">${esc(label)}</button>`).join('')}</div>`;
  }
  function seg(id, items) {
    return `<div class="seg" id="${id}" role="group">${items.map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="false">${esc(label)}</button>`).join('')}</div>`;
  }

  function renderExplorer(H, token) {
    const cfg = H.cfg, st = states[cfg.id];
    // same hypothesis again (tour step, prepared view): charts and numbers move on from the previous state
    const keep = ex && current.view === 'explorer' && ex.H === H
      ? { frame: ex.frame, lineFrame: ex.lineFrame, shown: ex.shown, bars: ex.bars, trailSeen: ex.trailSeen, cfxSeen: ex.cfxSeen, snap: ex.frame ? Charts.snapshot($('#plot')) : null }
      : null;
    if (ex) { Charts.stop($('#plot')); Charts.stop($('#line')); }
    current = { view: 'explorer', H };
    renderNav(cfg.token);
    setHash(token || cfg.token);
    const warLabels = H.pair ? C.PAIR_WAR : C.COUNTRY_WAR;
    const groupOpts = cfg.groups.map(g => `<option value="${g}">${esc(C.GROUP_LABELS[g])}</option>`).join('');
    const datalist = ENT.map((e, i) => `<option value="${esc(e.name)} (${e.iso3})"></option>`).join('');
    app.innerHTML = `
    <section class="ex-head wrap">
      <div class="ex-title">
        <p class="kicker">${cfg.role === 'main' ? 'Main hypothesis' : 'Side question'} · ${H.pair ? 'country-pair years' : 'country-years'} · expected ${cfg.expected}</p>
        <h1><span class="hyp-id">${cfg.id}</span> ${esc(cfg.title)}</h1>
        <p class="statement">${esc(cfg.statement)} <span class="why">${esc(cfg.why)}</span></p>
        ${cfg.role === 'main' ? `<a class="why-cta" href="#why-${cfg.token}">${typeIcon('research')}<span>Why this result? Explanations with sources</span><span aria-hidden="true">→</span></a>` : ''}
      </div>
      <dl class="ex-vars">
        <div><dt class="var-tag">X</dt><dd><b>${esc(cfg.xLabel)}</b><span>${esc(cfg.xSource)}</span></dd></div>
        <div><dt class="var-tag">Y</dt><dd><b>${esc(cfg.yLabel)}</b><span>${esc(cfg.ySource)}</span></dd></div>
      </dl>
    </section>

    <div class="ex wrap ${ui.railCollapsed ? 'is-collapsed' : ''}" id="ex">
      <aside class="rail" id="rail" aria-label="Filters">
        <button type="button" class="rail-open" id="rail-open" aria-controls="rail-body" aria-expanded="false" title="Show filters">
          <span>Filters</span><span class="rail-count" data-rail-count></span>
        </button>
        <div class="rail-body" id="rail-body">
        <div class="rail-head">
          <h2>Filters <span class="rail-count" data-rail-count></span></h2>
          <button type="button" class="icon-btn rail-close" id="rail-close" aria-controls="rail-body" aria-expanded="true" title="Hide filters, make the charts wider">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="sr-only">Hide filters</span>
          </button>
        </div>
        <div class="rail-block">
          <div class="rail-label">Continent ${H.pair ? '<span class="hint">(pairs)</span>' : ''}</div>
          ${chipGroup('f-cont', C.CONTINENTS.slice(0, 6).map(c => [c, C.CONTINENT_EN[c]]))}
          ${H.pair ? `<label class="mini-select" for="f-pairrule">Pair rule <select id="f-pairrule"><option value="any">at least one country</option><option value="both">both countries</option></select></label>` : ''}
        </div>
        <div class="rail-block">
          <div class="rail-label">Inter-state war in that year</div>
          ${chipGroup('f-war', warLabels.map((l, i) => [i, l]))}
        </div>
        <div class="rail-block">
          <label class="rail-label" for="f-freq">War-prone countries</label>
          <select id="f-freq">
            <option value="none">Keep all countries</option>
            <option value="reference">Reference: known status, ≥ ${META.frequency.minYears} years</option>
            <option value="aboveMean">Drop war share above mean (${(100 * META.frequency.meanShare).toFixed(2)}%)</option>
            <option value="aboveP90">Drop war share above P90 (${(100 * META.frequency.p90Share).toFixed(1)}%)</option>
            <option value="aboveCount">Drop above-mean number of wars</option>
          </select>
        </div>
        <div class="rail-block">
          <div class="rail-label">Years</div>
          <div class="years">
            <label for="f-y0" class="sr-only">From year</label><input id="f-y0" type="number" min="${H.yearMin}" max="${H.yearMax}" step="1">
            <span aria-hidden="true">–</span>
            <label for="f-y1" class="sr-only">To year</label><input id="f-y1" type="number" min="${H.yearMin}" max="${H.yearMax}" step="1">
          </div>
          <input id="f-yr" class="range" type="range" min="${H.yearMin}" max="${H.yearMax}" step="1" aria-label="Move the end year">
        </div>
        <div class="rail-block">
          <label class="rail-label" for="f-country">Countries</label>
          ${seg('f-cmode', [['exclude', 'Exclude'], ['only', 'Only these']])}
          <input id="f-country" list="country-list" type="search" placeholder="Type a country, press Enter" autocomplete="off">
          <datalist id="country-list">${datalist}</datalist>
          <div class="cfx" id="f-countries" aria-live="polite"></div>
        </div>
        <div class="rail-block">
          <div class="rail-label">Outliers (1st / 99th percentile)</div>
          ${seg('f-outlier', [['full', 'Full'], ['trim', 'Trim'], ['winsor', 'Winsorise']])}
          ${cfg.id === 'H3' ? '<label class="check-row" for="f-jumps"><input type="checkbox" id="f-jumps"> Drop spending jumps above ±100%</label>' : ''}
        </div>
        <div class="rail-block rail-foot"><button type="button" class="btn btn-ghost btn-block" id="f-reset">Reset all filters</button></div>
        </div>
      </aside>

      <div class="ex-main">
        <div class="statbar" id="statbar" aria-live="polite"></div>
        <div class="trail" id="trail" aria-label="Steps of this exploration"></div>

        <div class="grid-2">
          <section class="panel panel-plot" id="plot-panel">
            <div class="panel-head">
              <h2 id="plot-title">Scatter</h2>
              <div class="panel-tools">
                ${seg('v-level', [['pooled', 'All rows'], ['between', H.pair ? 'Pair means' : 'Country means'], ['within', 'Within']])}
                <button type="button" class="btn btn-sm" id="plot-expand" aria-pressed="false" title="Show the chart across the whole screen (Esc closes)">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span>Expand</span>
                </button>
              </div>
            </div>
            <div class="plot-tools">
              ${H.xPositive ? '<label class="check-row" for="v-xlog"><input type="checkbox" id="v-xlog"> Log X</label>' : ''}
              <label class="check-row" for="v-central"><input type="checkbox" id="v-central"> Central 98%</label>
              <label class="check-row" for="v-context"><input type="checkbox" id="v-context"> Filtered-out rows</label>
              ${H.pair ? '<label class="check-row" for="v-density"><input type="checkbox" id="v-density"> Density</label>' : ''}
              <label class="mini-select" for="v-color">Color
                <select id="v-color">
                  <option value="auto">Automatic</option>
                  <option value="none">One color</option>
                  <option value="continent">Continent</option>
                  <option value="war">War status</option>
                  <option value="country">Selected countries</option>
                </select></label>
              <label class="check-row" for="v-split" title="One small chart per colored group, all on the same axes"><input type="checkbox" id="v-split"> Split by group</label>
              <span class="zoom-tools" role="group" aria-label="Zoom">
                ${seg('z-mode', [['box', 'Box zoom'], ['pan', 'Pan']])}
                <button type="button" class="icon-btn icon-sm" id="z-in" aria-label="Zoom in" title="Zoom in">+</button>
                <button type="button" class="icon-btn icon-sm" id="z-out" aria-label="Zoom out" title="Zoom out">−</button>
                <button type="button" class="btn btn-xs" id="z-reset">Reset zoom</button>
              </span>
            </div>
            <div class="inview" id="inview"></div>
            <div class="plot-wrap" id="plot-wrap">
              <canvas id="plot" aria-label="Scatter plot of the current selection"></canvas>
              <div class="hover-ring" id="hover-ring" hidden></div>
              <div class="zoom-box" id="zoom-box" hidden></div>
            </div>
            <div class="legend" id="legend"></div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Compare groups</h2>
              <label class="mini-select" for="v-group"><span class="sr-only">Group by</span><select id="v-group">${groupOpts}</select></label>
            </div>
            <p class="panel-note" id="group-note"></p>
            <div class="groups" id="groups"></div>
            <p class="panel-note">Click a row to filter to it, click again to undo. Shift-click adds more groups, which then get their own colors in the scatter. Hatched: fewer than 30 rows.</p>
          </section>
        </div>

        <div class="grid-2 grid-2b">
          <section class="panel">
            <div class="panel-head">
              ${seg('v-tab', [['influence', 'Influential countries'], ['extremes', 'Extreme cases'], ['selected', 'Selected']])}
            </div>
            <div id="tab-body"></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Correlation by year</h2><button type="button" class="btn btn-xs" id="lz-reset" hidden>Reset years</button></div>
            <div class="plot-wrap line-wrap" id="line-wrap"><canvas id="line" aria-label="Pearson r for each year"></canvas><div class="hover-ring" id="line-ring" hidden></div><div class="zoom-box" id="line-box" hidden></div></div>
            <p class="panel-note">Years with at least 30 rows. Dashed line: r of the whole selection. Drag across years to zoom in, double-click to reset.</p>
            <div id="model-box"></div>
          </section>
        </div>

        <section class="panel" id="data-panel">
          <div class="panel-head">
            <h2>Data</h2>
            <div class="panel-tools">
              <label for="t-q" class="sr-only">Search countries</label>
              <input id="t-q" type="search" placeholder="Search country or ISO code" autocomplete="off">
              <button type="button" class="btn" id="t-csv">Download CSV</button>
            </div>
          </div>
          <div class="table-scroll"><table class="data" id="t-table"></table></div>
          <div class="pager" id="t-pager"></div>
        </section>
      </div>
    </div>`;
    ui.expanded = false; document.body.classList.remove('plot-expanded');
    ex = Object.assign({ H, st, res: null, groups: null, plot: null, shown: null }, keep);
    if (!keep) enterView();
    if (!(location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))) $('#t-csv').hidden = true;
    bindExplorer();
    update();
    window.scrollTo(0, 0);
  }

  function bindExplorer() {
    const H = ex.H;
    const st = () => states[H.cfg.id];
    const onChips = (id, fn) => $('#' + id).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { fn(b.dataset.v); changed(); } });
    onChips('f-cont', v => { const s = st(); s.continents = s.continents.includes(v) ? s.continents.filter(c => c !== v) : s.continents.concat(v); });
    onChips('f-war', v => { const s = st(), k = +v; s.war = s.war.includes(k) ? s.war.filter(w => w !== k) : s.war.concat(k); });
    onChips('f-cmode', v => { st().countryMode = v; });
    onChips('f-outlier', v => { st().outlier = v; });
    const onView = (id, fn) => $('#' + id).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { fn(b.dataset.v); refreshView(); } });
    onView('v-level', v => { st().level = v; st().zoom = null; });
    onView('v-tab', v => { st().tab = v; });
    const pr = $('#f-pairrule'); if (pr) pr.addEventListener('change', () => { st().pairRule = pr.value; changed(); });
    $('#f-freq').addEventListener('change', e => { st().freq = e.target.value; changed(); });
    const years = () => {
      const s = st(); let a = +$('#f-y0').value || H.yearMin, b = +$('#f-y1').value || H.yearMax;
      a = Math.max(H.yearMin, Math.min(H.yearMax, a)); b = Math.max(H.yearMin, Math.min(H.yearMax, b));
      if (a > b) [a, b] = [b, a];
      s.yearFrom = a; s.yearTo = b; changed();
    };
    $('#f-y0').addEventListener('change', years); $('#f-y1').addEventListener('change', years);
    $('#f-yr').addEventListener('input', e => { $('#f-y1').value = e.target.value; });
    $('#f-yr').addEventListener('change', e => { $('#f-y1').value = e.target.value; years(); });
    const addCountry = () => {
      const input = $('#f-country'), m = input.value.match(/\(([A-Z_]+)\)\s*$/);
      let e = m ? ISO_INDEX[m[1]] : undefined;
      if (e === undefined) {
        const q = input.value.trim().toLowerCase();
        if (q) e = ENT.findIndex(x => x.name.toLowerCase() === q || x.iso3.toLowerCase() === q);
        if (e === -1) e = ENT.findIndex(x => x.name.toLowerCase().startsWith(q));
      }
      if (e !== undefined && e >= 0) { const s = st(); if (!s.countries.includes(e)) s.countries.push(e); input.value = ''; changed(); }
    };
    $('#f-country').addEventListener('change', addCountry);
    $('#f-country').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCountry(); } });
    $('#f-countries').addEventListener('click', e => {
      const b = e.target.closest('button[data-remove]');
      if (b) { const s = st(); s.countries = s.countries.filter(c => c !== +b.dataset.remove); previewCountry(null); changed(); }
    });
    // hovering a country (filter list or influence table) previews its points in the scatter
    const hoverPreview = el => {
      el.addEventListener('mouseover', e => { const r = e.target.closest('[data-hover-e]'); previewCountry(r ? +r.dataset.hoverE : null); });
      el.addEventListener('mouseleave', () => previewCountry(null));
    };
    hoverPreview($('#f-countries')); hoverPreview($('#tab-body'));
    // any later change of the chart width (rail, scrollbar, window) gets a fresh, sharp drawing
    if (window.ResizeObserver) {
      let roTimer = 0;
      new ResizeObserver(() => {
        const box = $('#ex');
        if (!ex || !ex.plotSize || !box || box.classList.contains('is-widening') || box.classList.contains('is-narrowing')) return;
        if (Math.abs(Math.max(280, $('#plot-wrap').clientWidth) - ex.plotSize.w) > 1) { clearTimeout(roTimer); roTimer = setTimeout(() => redraw({ animate: false }), 60); }
      }).observe($('#plot-wrap'));
    }
    $('#rail-close').addEventListener('click', () => setRail(true));
    $('#rail-open').addEventListener('click', () => setRail(false));
    $('#trail').addEventListener('click', e => {
      const c = e.target.closest('button[data-clear]');
      if (c) { clearFilter(H, st(), c.dataset.clear); changed(); return; }
      const b = e.target.closest('button[data-step]');
      if (b) { restoreStep(+b.dataset.step); return; }
      if (e.target.closest('#trail-clear')) { trails[H.cfg.id] = { steps: [baseStep(H)], cur: 0 }; recordStep(H, st(), ex.res); renderStats(); renderTrail(); renderActiveChips(); }
    });
    const jumps = $('#f-jumps'); if (jumps) jumps.addEventListener('change', () => { st().noJumps = jumps.checked; changed(); });
    $('#f-reset').addEventListener('click', () => { states[H.cfg.id] = Object.assign(defaultState(H), { group: st().group, level: st().level }); changed(); });
    const tog = (id, key, resetZoom) => { const el = $('#' + id); if (el) el.addEventListener('change', () => { st()[key] = el.checked; if (resetZoom) st().zoom = null; redraw(); }); };
    tog('v-xlog', 'xLog', true); tog('v-context', 'context'); tog('v-density', 'density');
    $('#v-central').addEventListener('change', e => { st().yView = e.target.checked ? 'central' : 'full'; st().zoom = null; redraw(); });
    // zoom controls
    $('#z-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ui.zoomMode = b.dataset.v; syncRail(); } });
    $('#z-in').addEventListener('click', () => zoomCenter(0.6));
    $('#z-out').addEventListener('click', () => zoomCenter(1 / 0.6));
    $('#z-reset').addEventListener('click', () => { st().zoom = null; redraw(); });
    $('#lz-reset').addEventListener('click', () => { st().lineZoom = null; redraw(); });
    $('#plot-expand').addEventListener('click', () => setExpanded(!ui.expanded));
    $('#v-color').addEventListener('change', e => { st().colorBy = e.target.value; refreshView(); });
    $('#v-split').addEventListener('change', e => { st().split = e.target.checked; st().zoom = null; redraw(); });
    // hovering a group (legend or group list) brings it forward; clicking the legend keeps it there
    const hoverGroups = el => {
      el.addEventListener('mouseover', e => { const g = e.target.closest('[data-cat]'); focusCat(g ? +g.dataset.cat : null); });
      el.addEventListener('mouseleave', () => focusCat(null));
    };
    hoverGroups($('#legend')); hoverGroups($('#groups'));
    $('#legend').addEventListener('click', e => {
      if (e.target.closest('[data-clear-select]')) { st().select = null; refreshView(); return; }
      const g = e.target.closest('button[data-cat]');
      if (!g || !ex.colors || !ex.colors.cats) return;
      const key = ex.colors.cats[+g.dataset.cat].key, s = st();
      s.focusKey = s.focusKey === key ? null : key;
      hoverCat = null; redraw();
    });
    $('#v-group').addEventListener('change', e => { st().group = e.target.value; changed(); });
    $('#groups').addEventListener('click', e => {
      const b = e.target.closest('[data-key]');
      if (b) { toggleGroup(H, st(), JSON.parse(b.dataset.key), e.shiftKey || e.metaKey || e.ctrlKey); changed(); }
    });
    $('#tab-body').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const s = st(), ent = +b.dataset.e;
      if (b.dataset.act === 'select') s.select = sameSel(s.select, { type: 'country', e: ent }) ? null : { type: 'country', e: ent }; // second click removes the highlight
      if (b.dataset.act === 'pair') s.select = { type: 'pair', e1: +b.dataset.e1, e2: +b.dataset.e2 };
      if (b.dataset.act === 'exclude') { s.countryMode = 'exclude'; s.countries = [ent]; }
      if (b.dataset.act === 'only') { s.countryMode = 'only'; s.countries = [ent]; }
      if (b.dataset.act === 'clear-select') s.select = null;
      if (b.dataset.act === 'row') { selectRow(+b.dataset.row); }
      if (['select', 'pair', 'row'].includes(b.dataset.act)) { s.tab = 'selected'; }
      if (b.dataset.act === 'exclude' || b.dataset.act === 'only') changed(); else refreshView();
    });
    // table
    $('#t-q').addEventListener('input', e => { st().table.q = e.target.value; st().table.page = 0; renderTable(); });
    $('#t-table').addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (th) { const t = st().table; if (t.sort === th.dataset.sort) t.dir *= -1; else { t.sort = th.dataset.sort; t.dir = th.dataset.sort === 'name' || th.dataset.sort === 'year' ? 1 : -1; } t.page = 0; renderTable(); return; }
      const tr = e.target.closest('tr[data-row]');
      if (tr) { selectRow(+tr.dataset.row); st().tab = 'selected'; refreshView(); }
    });
    $('#t-pager').addEventListener('click', e => { const b = e.target.closest('button[data-page]'); if (b) { st().table.page = +b.dataset.page; renderTable(); } });
    $('#t-csv').addEventListener('click', downloadCsv);
    // plot hover / click
    const wrap = $('#plot-wrap'), ring = $('#hover-ring');
    wrap.addEventListener('mousemove', e => {
      if (!ex.plot || drag) return;
      const r = wrap.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const hit = ex.plot.pick(px, py);
      const cursor = ui.zoomMode === 'pan' ? 'grab' : 'crosshair';
      if (!hit) { ring.hidden = true; hideTooltip(); wrap.style.cursor = cursor; return; }
      if (hit.bin) { ring.hidden = true; showTooltip(e, binTip(hit.bin)); wrap.style.cursor = cursor; return; }
      ring.hidden = false; ring.style.left = hit.px + 'px'; ring.style.top = hit.py + 'px';
      wrap.style.cursor = 'pointer';
      showTooltip(e, pointTip(hit.i));
    });
    wrap.addEventListener('mouseleave', () => { ring.hidden = true; if (!drag) hideTooltip(); });
    wrap.addEventListener('click', e => {
      if (!ex.plot || suppressClick) return;
      const r = wrap.getBoundingClientRect(), hit = ex.plot.pick(e.clientX - r.left, e.clientY - r.top), s = st();
      if (hit && hit.i !== undefined) {
        const before = s.select;
        selectPoint(hit.i);
        if (sameSel(before, s.select)) s.select = null; // clicking the highlighted country again removes it
        else s.tab = 'selected';
        refreshView();
      } else if (s.select && !hit) { s.select = null; refreshView(); } // a click on empty space clears the highlight
    });
    wrap.addEventListener('mousedown', e => startDrag(e, 'plot'));
    wrap.addEventListener('dblclick', () => { st().zoom = null; redraw(); });
    wrap.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey) || !ex.plot || ex.split) return; // plain scrolling keeps scrolling the page
      e.preventDefault();
      const r = wrap.getBoundingClientRect(), [cx, cy] = ex.plot.invert(e.clientX - r.left, e.clientY - r.top);
      zoomAround(cx, cy, Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.01)) * 0.35), false);
    }, { passive: false });
    const lw = $('#line-wrap'), lr = $('#line-ring');
    lw.addEventListener('mousedown', e => startDrag(e, 'line'));
    lw.addEventListener('dblclick', () => { st().lineZoom = null; redraw(); });
    lw.addEventListener('mousemove', e => {
      if (!ex.line || drag) return;
      const r = lw.getBoundingClientRect(), hit = ex.line.pick(e.clientX - r.left);
      if (!hit) { lr.hidden = true; hideTooltip(); return; }
      lr.hidden = false; lr.style.left = hit.px + 'px'; lr.style.top = hit.py + 'px';
      showTooltip(e, `<b>${hit.year}</b><br>r = ${fmtR(hit.r)}<br>n = ${fInt.format(hit.n)}`);
    });
    lw.addEventListener('mouseleave', () => { lr.hidden = true; hideTooltip(); });
  }

  function clearFilter(H, st, what) {
    switch (what) {
      case 'continents': st.continents = []; break;
      case 'war': st.war = []; break;
      case 'freq': st.freq = 'none'; break;
      case 'years': st.yearFrom = H.yearMin; st.yearTo = H.yearMax; break;
      case 'countries': st.countries = []; break;
      case 'outlier': st.outlier = 'full'; break;
      case 'jumps': st.noJumps = false; break;
      case 'focus': st.focus = null; break;
      case 'select': st.select = null; break;
      case 'all': states[H.cfg.id] = Object.assign(defaultState(H), { group: st.group, level: st.level }); break;
    }
  }

  /* ---------- zoom, pan, expand ----------
   * Drag a box to zoom in, drag with "Pan" (or Shift) to move, Ctrl/Cmd + scroll
   * zooms around the pointer, double-click resets. The year chart zooms on x only. */
  let drag = null, suppressClick = false, drawRaf = 0;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  function startDrag(e, target) {
    const chart = target === 'plot' ? ex.plot : ex.line;
    if (e.button !== 0 || !chart || (target === 'plot' && ex.split)) return;
    const wrap = $(target === 'plot' ? '#plot-wrap' : '#line-wrap'), r = wrap.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top, m = chart.margins, inner = chart.inner;
    if (px < m.l || px > m.l + inner.w || py < m.t || py > m.t + inner.h) return;
    const mode = target === 'line' ? 'box' : (e.shiftKey ? (ui.zoomMode === 'box' ? 'pan' : 'box') : ui.zoomMode);
    drag = { target, wrap, px, py, x: px, y: py, moved: false, mode, dom: target === 'plot' ? { x: chart.domain.x.slice(), y: chart.domain.y.slice() } : null };
    e.preventDefault();
  }
  window.addEventListener('mousemove', e => {
    if (!drag || !ex) return;
    const chart = drag.target === 'plot' ? ex.plot : ex.line, m = chart.margins, inner = chart.inner;
    const r = drag.wrap.getBoundingClientRect();
    drag.x = clampN(e.clientX - r.left, m.l, m.l + inner.w); drag.y = clampN(e.clientY - r.top, m.t, m.t + inner.h);
    if (!drag.moved && Math.abs(drag.x - drag.px) + Math.abs(drag.y - drag.py) < 6) return;
    drag.moved = true; hideTooltip();
    const box = $(drag.target === 'plot' ? '#zoom-box' : '#line-box');
    if (drag.mode === 'box') {
      const full = drag.target === 'line';
      box.hidden = false;
      box.style.left = Math.min(drag.px, drag.x) + 'px'; box.style.width = Math.abs(drag.x - drag.px) + 'px';
      box.style.top = (full ? m.t : Math.min(drag.py, drag.y)) + 'px';
      box.style.height = (full ? inner.h : Math.abs(drag.y - drag.py)) + 'px';
      return;
    }
    // pan: shift the domain by the dragged distance (in log space on a log axis)
    const dx = (drag.x - drag.px) / inner.w, dy = (drag.y - drag.py) / inner.h, [x0, x1] = drag.dom.x, [y0, y1] = drag.dom.y;
    let nx;
    if (ex.pd.xLog) { const a = Math.log10(x0), b = Math.log10(x1), s = (b - a) * dx; nx = [Math.pow(10, a - s), Math.pow(10, b - s)]; }
    else { const s = (x1 - x0) * dx; nx = [x0 - s, x1 - s]; }
    const s = (y1 - y0) * dy;
    ex.st.zoom = { x: nx, y: [y0 + s, y1 + s] };
    drag.wrap.style.cursor = 'grabbing';
    cancelAnimationFrame(drawRaf); drawRaf = requestAnimationFrame(drawPlotOnly);
  });
  window.addEventListener('mouseup', () => {
    if (!drag || !ex) return;
    const d = drag; drag = null;
    $('#zoom-box').hidden = true; $('#line-box').hidden = true;
    if (!d.moved) return; // a plain click: point selection handles it
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (d.mode === 'box') {
      const w = Math.abs(d.x - d.px), h = Math.abs(d.y - d.py);
      if (d.target === 'line') {
        if (w < 8) return;
        let a = Math.round(ex.line.invertX(Math.min(d.px, d.x))), b = Math.round(ex.line.invertX(Math.max(d.px, d.x)));
        if (b - a < 2) { const c = Math.round((a + b) / 2); a = c - 1; b = c + 1; }
        ex.st.lineZoom = [a, b];
      } else {
        if (w < 8 || h < 8) return;
        const p = ex.plot.invert(Math.min(d.px, d.x), Math.max(d.py, d.y)), q = ex.plot.invert(Math.max(d.px, d.x), Math.min(d.py, d.y));
        ex.st.zoom = { x: [p[0], q[0]], y: [p[1], q[1]] };
      }
    }
    redraw();
  });
  function zoomAround(cx, cy, f, animate) {
    const d = ex.plot.domain, xLog = ex.pd.xLog;
    let nx;
    if (xLog) { const lc = Math.log10(cx), a = Math.log10(d.x[0]), b = Math.log10(d.x[1]); nx = [Math.pow(10, lc - (lc - a) * f), Math.pow(10, lc + (b - lc) * f)]; }
    else nx = [cx - (cx - d.x[0]) * f, cx + (d.x[1] - cx) * f];
    ex.st.zoom = { x: nx, y: [cy - (cy - d.y[0]) * f, cy + (d.y[1] - cy) * f] };
    cancelAnimationFrame(drawRaf); drawRaf = requestAnimationFrame(() => redraw({ animate: animate !== false }));
  }
  function zoomCenter(f) {
    if (!ex.plot) return;
    const d = ex.plot.domain, cx = ex.pd.xLog ? Math.sqrt(d.x[0] * d.x[1]) : (d.x[0] + d.x[1]) / 2;
    zoomAround(cx, (d.y[0] + d.y[1]) / 2, f);
  }
  function setExpanded(on) {
    const panel = $('#plot-panel'), b = $('#plot-expand');
    ui.expanded = on;
    b.setAttribute('aria-pressed', String(on)); b.querySelector('span').textContent = on ? 'Close' : 'Expand';
    const apply = () => {
      panel.classList.toggle('is-expanded', ui.expanded);
      document.body.classList.toggle('plot-expanded', ui.expanded);
      redraw({ animate: false });
    };
    if (on || reduceMotion()) { apply(); return; }
    // closing: the panel shrinks back before it returns to the page
    panel.classList.add('is-closing'); document.body.classList.add('plot-closing');
    setTimeout(() => { panel.classList.remove('is-closing'); document.body.classList.remove('plot-closing'); if (!ui.expanded) apply(); }, 190);
  }
  function setRail(collapsed) {
    const box = $('#ex');
    ui.railCollapsed = collapsed;
    $('#rail-open').setAttribute('aria-expanded', String(!collapsed)); $('#rail-close').setAttribute('aria-expanded', String(!collapsed));
    if (reduceMotion()) { box.classList.toggle('is-collapsed', collapsed); requestAnimationFrame(() => redraw({ animate: false })); return; }
    // the columns glide; charts keep their picture (cropped or with space to the right) and are redrawn at the end
    box.classList.remove('is-widening', 'is-narrowing');
    box.classList.add(collapsed ? 'is-widening' : 'is-narrowing');
    box.classList.toggle('is-collapsed', collapsed);
    let done = false;
    const finish = () => { if (done) return; done = true; box.classList.remove('is-widening', 'is-narrowing'); redraw({ animate: false }); };
    box.addEventListener('transitionend', function te(e) {
      if (e.target === box && e.propertyName === 'grid-template-columns') { box.removeEventListener('transitionend', te); finish(); }
    });
    setTimeout(finish, 480);
  }
  function restoreStep(k) {
    const H = ex.H, t = trails[H.cfg.id], step = t && t.steps[k];
    if (!step) return;
    const st = states[H.cfg.id];
    for (const key of FILTER_KEYS) st[key] = Array.isArray(step.snap[key]) ? step.snap[key].slice() : step.snap[key];
    t.cur = k;
    changed();
  }
  /* highlight arrays for one country or pair; rows outside the selection come from the full sample (pooled view) */
  function highlightFor(sel, x, y, level) {
    const H = ex.H, d = H.d, res = ex.res, hx = [], hy = [], codes = ex.colors && ex.colors.code;
    let code = null;
    const match = i => (H.pair ? (sel.type === 'pair' ? d.e1[i] === sel.e1 && d.e2[i] === sel.e2 : d.e1[i] === sel.e || d.e2[i] === sel.e) : d.e[i] === sel.e);
    if (level === 'between') {
      res.bw.bEnt.forEach((ent, k) => {
        const hit = H.pair ? (sel.type === 'pair' ? d.pairEnts[ent][0] === sel.e1 && d.pairEnts[ent][1] === sel.e2 : d.pairEnts[ent].includes(sel.e)) : ent === sel.e;
        if (hit) { hx.push(x[k]); hy.push(y[k]); if (code === null && codes) code = codes[k]; }
      });
      return { x: hx, y: hy, outside: false, code };
    }
    const idx = [];
    for (let j = 0; j < res.n; j++) if (match(res.rows[j])) idx.push(j);
    if (idx.length || level === 'within') {
      idx.sort((a, b) => d.year[res.rows[a]] - d.year[res.rows[b]]);
      for (const j of idx) { hx.push(x[j]); hy.push(y[j]); }
      return { x: hx, y: hy, outside: false, code: idx.length && codes ? codes[idx[0]] : null };
    }
    const rows = Array.from(H.rows).filter(match).sort((a, b) => d.year[a] - d.year[b]); // e.g. an excluded country
    for (const i of rows) { hx.push(H.X[i]); hy.push(H.Y[i]); }
    return { x: hx, y: hy, outside: true };
  }
  let hoverEnt = null, hoverCat = null;
  function focusCat(k) {
    if (!ex || hoverCat === k) return;
    hoverCat = k;
    cancelAnimationFrame(drawRaf); drawRaf = requestAnimationFrame(drawPlotOnly);
  }
  function previewCountry(e) {
    if (!ex || hoverEnt === e) return;
    hoverEnt = e;
    cancelAnimationFrame(drawRaf); drawRaf = requestAnimationFrame(drawPlotOnly);
  }
  function drawPlotOnly() { // fast path: no new statistics, only the canvas
    if (!ex || !ex.pd || !ex.plotSize) return;
    const pd = Object.assign({}, ex.pd);
    if (ex.st.zoom) { pd.xDomain = ex.st.zoom.x; pd.yDomain = ex.st.zoom.y; pd.exact = true; }
    if (hoverEnt !== null) {
      const h = highlightFor({ type: 'country', e: hoverEnt }, pd.x, pd.y, ex.st.level);
      pd.hi = { x: h.x, y: h.y, line: !ex.H.pair, color: Charts.token('--ink'), cat: h.code };
      pd.visId += '|hover' + hoverEnt;
    }
    if (hoverCat !== null && pd.cats && pd.cats[hoverCat]) { pd.focus = hoverCat; pd.visId += '|focus' + hoverCat; }
    ex.plot = ex.split ? Charts.facets($('#plot'), Object.assign({ width: ex.plotSize.w }, pd))
      : Charts.scatter($('#plot'), Object.assign({ width: ex.plotSize.w, height: ex.plotSize.h }, pd));
    ex.frame = ex.plot.frame;
    $$('#legend [data-cat]').forEach(g => g.classList.toggle('is-hover', +g.dataset.cat === hoverCat));
  }

  let pending = 0, dataSeq = 0;
  function changed() {
    const id = ++pending;
    $('#statbar').classList.add('is-busy');
    setHash(ex.H.cfg.token);
    setTimeout(() => { if (id === pending) update(); }, 0);
  }

  function update() {
    if (!ex) return;
    const H = ex.H, st = states[H.cfg.id];
    ex.st = st;
    ex.res = compute(H, st);
    ex.dataVer = ++dataSeq;
    recordStep(H, st, ex.res);
    ex.groups = computeGroups(H, st);
    ex.countryFx = countryEffects(H, st, ex.res);
    syncRail();
    renderStats();
    renderTrail();
    renderActiveChips();
    redraw();
    renderGroups();
    renderTab();
    renderModel();
    renderTable();
    $('#statbar').classList.remove('is-busy');
  }

  function refreshView() { // selection, tab or display level changed: no new statistics needed
    if (!ex || !ex.res) return;
    redraw(); renderGroups(); renderTab(); renderTable();
  }

  function activeFilterCount(H, st) {
    return [st.continents.length, st.war.length, st.freq !== 'none', st.yearFrom !== H.yearMin || st.yearTo !== H.yearMax,
      st.countries.length, st.outlier !== 'full', st.noJumps, !!st.focus].filter(Boolean).length;
  }

  function syncRail() {
    const H = ex.H, st = ex.st;
    const press = (id, fn) => $$('#' + id + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b.dataset.v) ? 'true' : 'false'));
    press('f-cont', v => st.continents.includes(v));
    press('f-war', v => st.war.includes(+v));
    press('f-cmode', v => st.countryMode === v);
    press('f-outlier', v => st.outlier === v);
    press('v-level', v => st.level === v);
    press('v-tab', v => st.tab === v);
    press('z-mode', v => ui.zoomMode === v);
    const pr = $('#f-pairrule'); if (pr) pr.value = st.pairRule;
    $('#f-freq').value = st.freq;
    $('#f-y0').value = st.yearFrom; $('#f-y1').value = st.yearTo; $('#f-yr').value = st.yearTo;
    const j = $('#f-jumps'); if (j) j.checked = st.noJumps;
    const xl = $('#v-xlog'); if (xl) { xl.checked = st.xLog; xl.disabled = st.level === 'within'; }
    $('#v-central').checked = st.yView === 'central';
    $('#v-context').checked = st.context; $('#v-context').disabled = st.level !== 'pooled';
    $('#v-color').value = st.colorBy || 'auto';
    const dn = $('#v-density'); if (dn) { dn.checked = st.density; dn.disabled = st.level !== 'pooled'; }
    $('#v-group').value = st.group;
    $('#z-reset').disabled = !st.zoom;
    $('#lz-reset').hidden = !st.lineZoom;
    const count = activeFilterCount(H, st);
    $$('[data-rail-count]').forEach(el => { el.textContent = count ? String(count) : ''; });
  }

  /* country list in the filter rail, with live values for every country */
  function renderCountryList() {
    const st = ex.st, fx = ex.countryFx || [], res = ex.res, colors = ex.colors;
    if (!st.countries.length) { $('#f-countries').innerHTML = ''; ex.cfxSeen = null; return; }
    const head = st.countryMode === 'exclude'
      ? `<p class="cfx-note">Current r <b>${fmtR(res.corr.r)}</b>. Each line: r if that country came back.</p>`
      : `<p class="cfx-note">Each line: the country on its own, and r of the others without it.</p>`;
    const marker = e => {
      if (!colors || !colors.cats || colors.mode !== 'country') return '';
      const c = colors.cats.find(cc => cc.key === e); return c ? shapeSvg(c.shape, c.css) : '';
    };
    const seen = ex.cfxSeen || new Map(), now = new Map();
    $('#f-countries').innerHTML = head + st.countries.map(e => {
      const f = fx.find(o => o.e === e), info = ENT[e];
      let vals = '<span class="muted">…</span>';
      if (f && st.countryMode === 'exclude') {
        vals = `<span>${fInt.format(f.rows)} rows out</span><span>with it <b>${fmtR(f.rBack)}</b></span>
          <span class="${f.effect < 0 ? 'neg-t' : 'pos-t'}">effect ${isFinite(f.effect) ? minus((f.effect > 0 ? '+' : '') + f.effect.toFixed(3)) : '–'}</span>`;
      } else if (f) {
        vals = `<span>${fInt.format(f.rows)} rows</span><span>own r <b>${isFinite(f.own) ? fmtR(f.own) : '–'}</b></span>
          ${st.countries.length > 1 ? `<span>others ${isFinite(f.rWithout) ? fmtR(f.rWithout) : '–'}</span>` : ''}`;
      }
      now.set(e, vals);
      const cls = !seen.has(e) ? 'is-new' : seen.get(e) !== vals ? 'is-updated' : '';
      return `<div class="cfx-row ${cls}" data-hover-e="${e}">
        <span class="cfx-name">${marker(e)}${esc(info.name)} <span class="muted">${info.iso3}</span></span>
        <button type="button" class="cfx-x" data-remove="${e}" aria-label="Remove ${esc(info.name)}">×</button>
        <span class="cfx-vals">${vals}</span>
      </div>`;
    }).join('') + (st.countries.length > 12 ? '<p class="cfx-note">Live values for the first 12 countries.</p>' : '');
    ex.cfxSeen = now;
  }

  /* numbers count from their previous value to the new one */
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tween(el, from, to, fmt) {
    cancelAnimationFrame(el._raf);
    if (!isFinite(from) || !isFinite(to) || from === to || reduceMotion()) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 520;
    const tick = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (t < 1) el._raf = requestAnimationFrame(tick);
    };
    el._raf = requestAnimationFrame(tick);
  }
  const gaugePos = r => (isFinite(r) ? 50 + 50 * Math.max(-1, Math.min(1, r)) : 50);
  function deltaBadge(d, unit) {
    if (!isFinite(d) || Math.abs(d) < 5e-4) return '<span class="delta flat">no change vs previous step</span>';
    return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${minus((d > 0 ? '+' : '') + (unit === 'n' ? fInt.format(Math.round(d)) : d.toFixed(3)))} vs previous step</span>`;
  }

  function renderStats() {
    const H = ex.H, res = ex.res, c = res.corr, cfg = H.cfg, bw = res.bw;
    const ref = REF.baseline[cfg.id], full = ref.pearson_r;
    const t = trails[cfg.id], prev = t && t.cur > 0 ? t.steps[t.cur - 1] : null;
    const exp = cfg.expected === 'negative' ? -1 : 1;
    const dir = !isFinite(c.r) ? '' : Math.sign(c.r) === exp ? 'as expected' : 'opposite of expected';
    const strength = S.strength(c.r);
    const units = H.pair ? `${fInt.format(res.pairs || 0)} pairs · ${fInt.format(res.countries)} countries` : `${fInt.format(res.countries)} ${res.countries === 1 ? 'country' : 'countries'}`;
    const shown = ex.shown || (reduceMotion() ? {} : { n: 0, r: 0, rho: 0, between: 0, within: 0 });
    const now = { n: res.n, r: c.r, rho: c.rho, between: bw ? bw.between.r : NaN, within: bw ? bw.within.r : NaN };
    $('#statbar').innerHTML = `
      <div class="stat stat-n"><span class="stat-label">n (value pairs)</span><span class="stat-value" data-k="n">${fInt.format(res.n)}</span>
        <span class="stat-sub">${units} · ${res.n ? res.years[0] + '–' + res.years[1] : '–'}</span>
        ${prev ? deltaBadge(res.n - prev.n, 'n') : ''}</div>
      <div class="stat stat-r ${c.r < 0 ? 'neg' : 'pos'}">
        <span class="stat-label">Pearson r</span>
        <div class="r-line"><span class="stat-value big" data-k="r">${fmtR(c.r)}</span>
          <span class="r-tags"><span class="pill pill-${strength}">${strength}</span>${dir ? `<span class="${dir === 'as expected' ? 'ok' : 'warn'}">${dir}</span>` : ''}</span></div>
        <div class="gauge" aria-hidden="true" title="Pearson r on the scale from −1 to +1. Hollow mark: previous step.">
          <span class="gauge-band" style="left:45%;width:10%"></span>
          <span class="gauge-tick" style="left:35%"></span><span class="gauge-tick" style="left:25%"></span>
          <span class="gauge-tick" style="left:65%"></span><span class="gauge-tick" style="left:75%"></span>
          <span class="gauge-zero"></span>
          <span class="gauge-expect ${exp < 0 ? 'neg' : 'pos'}"></span>
          ${prev && isFinite(prev.r) ? `<span class="gauge-prev" style="left:${gaugePos(prev.r)}%"></span>` : ''}
          <span class="gauge-dot ${c.r < 0 ? 'neg' : 'pos'}" style="left:${gaugePos(isFinite(shown.r) ? shown.r : c.r)}%"></span>
        </div>
        ${prev ? deltaBadge(c.r - prev.r, 'r') : '<span class="delta flat">full sample, as tested</span>'}</div>
      <div class="stat"><span class="stat-label">p (standard)</span><span class="stat-value">${fmtP(c.p, c.log10p)}</span><span class="stat-sub">two-sided t-test of r</span></div>
      <div class="stat"><span class="stat-label">Spearman ρ</span><span class="stat-value" data-k="rho">${fmtR(c.rho)}</span><span class="stat-sub">rank correlation</span></div>
      <div class="stat"><span class="stat-label">Between</span><span class="stat-value" data-k="between">${bw ? fmtR(bw.between.r) : '–'}</span><span class="stat-sub">${bw && bw.betweenN > 2 ? 'r of ' + fInt.format(bw.betweenN) + ' ' + (H.pair ? 'pair' : 'country') + ' means' : 'needs at least 3 ' + (H.pair ? 'pairs' : 'countries')}</span></div>
      <div class="stat"><span class="stat-label">Within</span><span class="stat-value" data-k="within">${bw ? fmtR(bw.within.r) : '–'}</span><span class="stat-sub">${bw && !isFinite(bw.within.r) && res.n >= 3 ? 'not defined: X is constant within each ' + (H.pair ? 'pair' : 'country') : 'r of deviations from own mean'}</span></div>
      <div class="stat stat-delta"><span class="stat-label">Full sample</span><span class="stat-value">${fmtR(full)}</span>
        <span class="stat-sub">${res.n !== ref.n && isFinite(c.r) ? 'this selection ' + minus((c.r - full >= 0 ? '+' : '') + (c.r - full).toFixed(3)) : 'n = ' + fInt.format(ref.n)}</span></div>`;
    for (const k of ['n', 'r', 'rho', 'between', 'within']) {
      const el = $(`#statbar [data-k="${k}"]`);
      if (el && isFinite(now[k])) tween(el, shown[k], now[k], k === 'n' ? v => fInt.format(Math.round(v)) : fmtR);
    }
    const dot = $('#statbar .gauge-dot');
    if (dot) requestAnimationFrame(() => { dot.style.left = gaugePos(c.r) + '%'; });
    ex.shown = now;
  }

  /* the path of intermediate results, one chip per step */
  function renderTrail() {
    const H = ex.H, t = trails[H.cfg.id];
    if (!t) { $('#trail').innerHTML = ''; return; }
    const seen = ex.trailSeen || new Set(), fresh = [];
    const items = t.steps.map((s, k) => {
      const d = k > 0 ? s.r - t.steps[k - 1].r : NaN, isNew = !seen.has(s.sig);
      if (isNew) fresh.push(s.sig);
      return `${k ? `<li class="trail-arrow ${isNew ? 'is-new' : ''}" aria-hidden="true" style="--i:${fresh.length}">→</li>` : ''}<li>
        <button type="button" class="step ${k === t.cur ? 'is-cur' : ''} ${isNew ? 'is-new' : ''}" style="--i:${fresh.length}" data-step="${k}" ${k === t.cur ? 'aria-current="step"' : ''} title="${esc(s.label)}: go back to this step">
          <span class="step-label">${esc(s.label)}</span>
          <span class="step-r ${s.r < 0 ? 'neg-t' : 'pos-t'}">${fmtR(s.r)}</span>
          <span class="step-gauge"><i style="left:${gaugePos(s.r)}%"></i></span>
          <span class="step-meta">n ${fInt.format(s.n)}${isFinite(d) ? ` · <span class="${d < 0 ? 'neg-t' : 'pos-t'}">${minus((d > 0 ? '+' : '') + d.toFixed(3))}</span>` : ''}</span>
        </button></li>`;
    }).join('');
    $('#trail').innerHTML = `<div class="trail-head"><span class="trail-title" title="Each filter change adds a step. Click a step to go back to it.">Steps</span>
      <div class="active-chips" id="active-chips"></div>
      ${t.steps.length > 1 ? '<button type="button" class="link-btn" id="trail-clear" title="Keep only the full sample and the current step">Start from here</button>' : ''}</div>
      <ol class="trail-list">${items}</ol>`;
    ex.trailSeen = new Set(t.steps.map(s => s.sig));
    const list = $('#trail .trail-list'), curEl = list.querySelector('.is-cur');
    if (curEl) list.scrollLeft = Math.max(0, curEl.offsetLeft - list.clientWidth + curEl.offsetWidth + 24);
  }

  function renderActiveChips() {
    const H = ex.H, st = ex.st, chips = [];
    if (st.continents.length) chips.push(['continents', 'Continent: ' + st.continents.map(c => C.CONTINENT_EN[c]).join(', ') + (H.pair ? (st.pairRule === 'both' ? ' (both)' : ' (at least one)') : '')]);
    if (st.war.length) chips.push(['war', 'War: ' + st.war.map(w => (H.pair ? C.PAIR_WAR : C.COUNTRY_WAR)[w]).join(', ')]);
    if (st.freq !== 'none') chips.push(['freq', $('#f-freq').selectedOptions[0].textContent]);
    if (st.yearFrom !== H.yearMin || st.yearTo !== H.yearMax) chips.push(['years', 'Years ' + st.yearFrom + '–' + st.yearTo]);
    if (st.countries.length) chips.push(['countries', (st.countryMode === 'only' ? 'Only: ' : 'Without: ') + st.countries.map(e => entName(e)).join(', ')]);
    if (st.outlier !== 'full') chips.push(['outlier', st.outlier === 'trim' ? 'Trimmed to 1st–99th percentile' : 'Winsorised at 1st/99th percentile']);
    if (st.noJumps) chips.push(['jumps', 'Spending jumps > ±100% dropped']);
    if (st.focus) chips.push(['focus', C.GROUP_LABELS[st.focus[0]] + ': ' + groupLabel(H, st.focus[0], st.focus[1])]);
    $('#active-chips').innerHTML = chips.length
      ? chips.map(([k, l]) => `<button type="button" class="filter-chip" data-clear="${k}" title="Remove this filter">${esc(l)} <span aria-hidden="true">×</span></button>`).join('') + `<button type="button" class="link-btn" data-clear="all">Reset all</button>`
      : '<span class="muted">No filter: full sample, as tested in the notebook.</span>';
  }

  /* ---------- colors for several selected groups ----------
   * Each continent, war status and selected country keeps its own color slot,
   * so a color never changes when other groups are added or removed.
   * Shapes repeat the color as a second cue (color-vision safe). */
  const CONT_SLOT = { Europa: 0, Afrika: 1, Asien: 2, Nordamerika: 3, 'Südamerika': 4, Ozeanien: 6 };
  const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triDown', 'plus', 'ring', 'x'];
  function colorMode(H, st) {
    const m = st.colorBy || 'auto';
    if (m !== 'auto') return m;
    if (st.countryMode === 'only' && st.countries.length >= 2) return 'country';
    if (st.continents.length >= 2) return 'continent';
    if (st.war.length >= 2) return 'war';
    return 'none';
  }
  function countrySlots(st) {
    const slots = st.countrySlots || (st.countrySlots = {});
    for (const k of Object.keys(slots)) if (!st.countries.includes(+k)) delete slots[k];
    for (const e of st.countries) if (slots[e] === undefined) {
      const used = new Set(Object.values(slots)); let s = 0; while (used.has(s)) s++; slots[e] = s;
    }
    return slots;
  }
  /* Returns {mode, cats, code} where code[j] is the category of displayed point j (255 = grey). */
  function buildColors(H, st, level, x, y) {
    const mode = colorMode(H, st), res = ex.res, d = H.d, n = x.length;
    if (mode === 'none' || !n) return null;
    if (mode === 'war' && level === 'between') return { mode, note: 'War status changes from year to year, so averages are not colored by it.' };
    if (mode === 'country' && !(st.countryMode === 'only' && st.countries.length)) return { mode, note: 'Choose “Only these” with two or more countries to color them.' };
    const cats = [], index = new Map();
    const cat = (key, label, slot) => {
      let c = index.get(key);
      if (c === undefined) {
        c = cats.length; index.set(key, c);
        const mixed = slot === 'mixed';
        cats.push({ key, label, slot: mixed ? 99 : slot, shape: mixed ? 'x' : SHAPES[slot], css: mixed ? 'var(--ink-2)' : `var(--series-${slot + 1})`,
          canvas: Charts.token(mixed ? '--ink-2' : `--series-${slot + 1}`), m: [0, 0, 0, 0, 0, 0] });
      }
      return c;
    };
    const S = st.continents.length ? st.continents : C.CONTINENTS.slice(0, 6), all = !st.continents.length;
    const slots = mode === 'country' ? countrySlots(st) : null;
    // classify a set of member countries (one for country-years, two for pairs)
    const byMembers = members => {
      if (mode === 'continent') {
        const hit = [...new Set(members.map(e => C.CONTINENTS[entCont[e]]))].filter(c => S.includes(c));
        if (!hit.length) return 255;
        if (hit.length > 1) return cat('mixed', all ? 'Between continents' : 'Between selected continents', 'mixed');
        const c = hit[0], en = C.CONTINENT_EN[c];
        return cat(c, H.pair ? (all ? 'Within ' + en : en + ' pairs') : en, CONT_SLOT[c]);
      }
      const hit = members.filter(e => slots[e] !== undefined && slots[e] < 8);
      if (!hit.length) return 255;
      if (hit.length > 1) return cat('mixed', 'Between selected countries', 'mixed');
      return cat(hit[0], entName(hit[0]) + (H.pair ? ' pairs' : ''), slots[hit[0]]);
    };
    const code = new Uint8Array(n);
    if (mode === 'war') {
      const labels = H.pair ? C.PAIR_WAR : C.COUNTRY_WAR, unknown = H.pair ? 3 : 2;
      for (let j = 0; j < n; j++) { const w = d.war[res.rows[j]]; code[j] = w === unknown ? 255 : cat(w, labels[w], w); }
    } else if (level === 'between') {
      for (let k = 0; k < n; k++) { const ent = res.bw.bEnt[k]; code[k] = byMembers(H.pair ? d.pairEnts[ent] : [ent]); }
    } else {
      for (let j = 0; j < n; j++) { const i = res.rows[j]; code[j] = byMembers(H.pair ? [d.e1[i], d.e2[i]] : [d.e[i]]); }
    }
    // per-group correlation and least-squares line (on the plotted values)
    for (const c of cats) { c.xMin = Infinity; c.xMax = -Infinity; }
    for (let j = 0; j < n; j++) {
      if (code[j] === 255) continue;
      const c = cats[code[j]], m = c.m; m[0]++; m[1] += x[j]; m[2] += y[j]; m[3] += x[j] * x[j]; m[4] += y[j] * y[j]; m[5] += x[j] * y[j];
      if (x[j] < c.xMin) c.xMin = x[j]; if (x[j] > c.xMax) c.xMax = x[j];
    }
    for (const c of cats) {
      const [k, sx, sy, sxx, syy, sxy] = c.m, vx = sxx - sx * sx / k, vy = syy - sy * sy / k;
      c.n = k;
      c.r = k >= 3 && vx > 1e-12 && vy > 1e-12 ? (sxy - sx * sy / k) / Math.sqrt(vx * vy) : NaN;
      c.slope = vx > 1e-12 ? (sxy - sx * sy / k) / vx : NaN;
      c.intercept = (sy - c.slope * sx) / k;
    }
    cats.sort((a, b) => a.slot - b.slot);
    const remap = new Uint8Array(256).fill(255);
    cats.forEach((c, k) => { remap[index.get(c.key)] = k; });
    for (let j = 0; j < n; j++) code[j] = remap[code[j]];
    return { mode, cats, code };
  }
  function shapeSvg(shape, color) {
    const s = { circle: '<circle r="4"/>', square: '<rect x="-3.6" y="-3.6" width="7.2" height="7.2"/>',
      triangle: '<path d="M0-4.8L4.4 3.2H-4.4Z"/>', triDown: '<path d="M0 4.8L4.4-3.2H-4.4Z"/>', diamond: '<path d="M0-5L4.2 0 0 5-4.2 0Z"/>',
      plus: '<path d="M-1.6-5h3.2v3.4H5v3.2H1.6V5h-3.2V1.6H-5v-3.2h3.4Z"/>', ring: '<circle r="3.4" fill="none" stroke-width="1.8"/>',
      x: '<path d="M-4-4L4 4M4-4L-4 4" fill="none" stroke-width="2"/>' }[shape];
    return `<svg class="shape" viewBox="-6 -6 12 12" width="12" height="12" aria-hidden="true" style="fill:${color};stroke:${color}">${s}</svg>`;
  }

  /* ---------- scatter ---------- */
  function plotData() {
    const H = ex.H, st = ex.st, res = ex.res, d = H.d, cfg = H.cfg;
    const level = st.level, n = res.n;
    let x = res.x, y = res.y, reg = res.corr, xLog = st.xLog && level !== 'within' && H.xPositive, ctxPts = null, hi = null;
    if (level === 'between' && res.bw) { x = res.bw.bx; y = res.bw.by; reg = res.bw.between; }
    if (level === 'within' && res.bw) { x = res.bw.wx; y = res.bw.wy; reg = res.bw.within; }
    const colors = buildColors(H, st, level, x, y);
    ex.colors = colors;
    const colored = !!(colors && colors.cats);
    const hiColor = colored ? Charts.token('--ink') : null;
    const splitting = colored && st.split && colors.cats.length >= 2; // small multiples: no filtered-out rows, axes fit the selection
    if (level === 'pooled' && !splitting) {
      if (st.context && n < H.rows.length) {
        const inSample = new Uint8Array(d.n); for (const i of res.rows) inSample[i] = 1;
        const cx = [], cy = [];
        for (const i of H.rows) if (!inSample[i]) { cx.push(H.X[i]); cy.push(H.Y[i]); }
        if (cx.length) ctxPts = { x: cx, y: cy };
      }
    }
    const sel = st.select;
    if (sel && n) {
      const h = highlightFor(sel, x, y, level);
      hi = { x: h.x, y: h.y, line: !H.pair || sel.type === 'pair', color: hiColor, cat: h.code };
    }
    // domains
    let xd, yd;
    const all = (arr1, arr2) => { const a = Charts.extent(arr1, xLog); if (arr2) { const b = Charts.extent(arr2, xLog); a[0] = Math.min(a[0], b[0]); a[1] = Math.max(a[1], b[1]); } return a; };
    let exact = false;
    if (st.zoom) { xd = st.zoom.x.slice(); yd = st.zoom.y.slice(); exact = true; }
    else if (st.yView === 'central' && x.length > 20) {
      const xs = xLog ? Array.from(x).filter(v => v > 0) : x;
      xd = S.quantiles(xs, [0.01, 0.99]); yd = S.quantiles(y, [0.01, 0.99]);
    } else {
      xd = all(x, ctxPts && ctxPts.x); yd = Charts.extent(y); if (ctxPts) { const b = Charts.extent(ctxPts.y); yd = [Math.min(yd[0], b[0]), Math.max(yd[1], b[1])]; }
    }
    const fx = C.FORMAT[cfg.fx], fy = C.FORMAT[cfg.fy];
    const fxt = C.FORMAT[cfg.fxTick || cfg.fx], fyt = C.FORMAT[cfg.fyTick || cfg.fy];
    const delta = f => v => (v > 0 ? '+' : '') + (cfg.fx === 'lnkm' ? C.FORMAT.num2(v) : f(v));
    // point identity for animated transitions: rows (pooled, within) or group means (between)
    const grouped = level === 'between' && !!res.bw;
    return {
      x, y, xLog, ctx: ctxPts, hi, reg: n >= 3 ? reg : null, xDomain: xd, yDomain: yd, exact,
      level, space: grouped ? 'groups' : 'rows', keys: grouped ? res.bw.bEnt : res.rows, parents: grouped ? res.bw.bEnt : res.ent || null,
      dataId: ex.dataVer + '|' + level + '|' + xLog,
      visId: [colors ? colors.mode : 'none', JSON.stringify(sel), st.context, st.density, JSON.stringify(st.focusKey)].join('|'),
      focus: colored ? colors.cats.findIndex(c => c.key === st.focusKey) : -1,
      color: colored ? colors.code : null, cats: colored ? colors.cats : null,
      lines: colored ? colors.cats.map((c, k) => ({ cat: k, key: c.key, n: c.n, slope: c.slope, intercept: c.intercept, color: c.canvas, x0: c.xMin, x1: c.xMax })).filter(l => l.n >= 10 && isFinite(l.slope)) : null,
      density: !colored && H.pair && st.density && level === 'pooled' && n > 30000,
      xTick: level === 'within' ? delta(fxt) : fxt, yTick: level === 'within' ? (v => (v > 0 ? '+' : '') + fyt(v)) : fyt,
      xLabel: (level === 'within' ? 'Deviation from own mean: ' : level === 'between' ? 'Average: ' : '') + cfg.xLabel + (xLog ? ' (log scale)' : ''),
      yLabel: (level === 'within' ? 'Deviation: ' : level === 'between' ? 'Average: ' : '') + cfg.yLabel,
      zeroLines: level === 'within', fx, fy,
      ramp: ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7'].map(Charts.token),
    };
  }
  /* opts.animate === false: draw at once (resize, theme, layout changes) */
  function redraw(opts) {
    if (!ex || !ex.res) return;
    const animate = !(opts && opts.animate === false);
    const st = ex.st, wrap = $('#plot-wrap'), canvas = $('#plot');
    syncRail();
    // the chart fills the width and as much screen height as the layout allows
    const width = Math.max(280, wrap.clientWidth), vh = window.innerHeight;
    ex.pd = plotData();
    // "Split by group": one small chart per colored group instead of all groups on top of each other
    const cats = ex.pd.cats, split = !!(st.split && cats && cats.length >= 2), wasSplit = ex.split;
    const height = split ? Charts.facetLayout(width, cats.length).height
      : Math.round(ui.expanded ? Math.max(320, vh - 250) : Math.max(340, Math.min(680, width * 0.64, vh - 360)));
    ex.split = split;
    ex.plotSize = { w: width, h: height };
    hoverCat = null;
    $('#plot-panel').classList.toggle('is-split', split);
    const sp = $('#v-split'), canSplit = !!(cats && cats.length >= 2);
    sp.checked = split; sp.disabled = !canSplit;
    sp.parentElement.title = canSplit ? 'One small chart per colored group, all on the same axes' : 'Color the points by group first (several continents, war statuses or countries)';
    // first view: points sweep in; afterwards every change animates from the previous picture
    const tr = !animate ? null : ex.frame ? { from: ex.frame, snap: ex.snap } : { enter: true };
    ex.snap = null;
    ex.plot = split ? Charts.facets(canvas, Object.assign({ width, transition: tr }, ex.pd))
      : Charts.scatter(canvas, Object.assign({ width, height, transition: tr }, ex.pd));
    ex.frame = ex.plot.frame;
    if (animate && wasSplit !== undefined && wasSplit !== split && !reduceMotion()) { wrap.classList.remove('is-swap'); void wrap.offsetWidth; wrap.classList.add('is-swap'); }
    hoverEnt = null;
    $('#hover-ring').hidden = true;
    renderCountryList();
    renderInView();
    const levelText = { pooled: 'All rows', between: ex.H.pair ? 'One point per pair (average)' : 'One point per country (average)', within: 'Deviations from each ' + (ex.H.pair ? 'pair' : 'country') + '’s own average' }[st.level];
    $('#plot-title').textContent = levelText;
    const leg = [], colors = ex.colors;
    if (ex.pd.density) leg.push('<span class="lg"><i class="sw sw-seq"></i>darker = more rows (log scale)</span>');
    else if (!cats) leg.push(`<span class="lg"><i class="sw" style="background:var(--series-1)"></i>${st.level === 'pooled' ? (ex.H.pair ? 'Pair-year' : 'Country-year') : st.level === 'between' ? 'Average' : 'Deviation'} in selection</span>`);
    if (colors && colors.note) leg.push(`<span class="lg muted">${esc(colors.note)}</span>`);
    if (ex.pd.ctx) leg.push('<span class="lg"><i class="sw" style="background:var(--ctx)"></i>Filtered out</span>');
    if (cats && ex.pd.color.some(c => c === 255)) leg.push('<span class="lg"><i class="sw" style="background:var(--ctx)"></i>Other rows in selection</span>');
    if (ex.pd.hi) leg.push(`<button type="button" class="lg lg-sel" data-clear-select title="Remove the highlight (or click the country again, click empty space, press Esc)"><i class="sw sw-ring" style="background:${ex.pd.hi.color || 'var(--hi)'}"></i>${esc(selectionLabel())}<span class="lg-x" aria-hidden="true">×</span><span class="sr-only">Remove highlight</span></button>`);
    if (!st.zoom) leg.push(`<span class="lg muted zoom-hint">${ex.split ? 'Same axes in every panel · + / − zoom all panels' : 'Drag to zoom · Ctrl/⌘ + scroll · double-click resets'}</span>`);
    leg.push(`<span class="lg"><i class="sw sw-line${cats ? ' sw-dash' : ''}"></i>Least-squares line${cats ? ', all rows' : ''}${ex.pd.xLog ? ' (fitted on raw X, so it curves on the log axis)' : ''}</span>`);
    const pinned = ex.pd.focus;
    $('#legend').innerHTML = leg.join('') + (cats ? `<div class="legend-groups ${pinned >= 0 ? 'has-focus' : ''}">${cats.map((c, k) => `
      <button type="button" class="lg-group ${k === pinned ? 'is-focus' : ''}" data-cat="${k}" aria-pressed="${k === pinned}" title="Hover to bring this group forward, click to keep it there">${shapeSvg(c.shape, c.css)}<span class="lg-name">${esc(c.label)}</span>
        <span class="lg-stats">n = ${fInt.format(c.n)} · r = ${isFinite(c.r) ? fmtR(c.r) : 'n/a'}</span></button>`).join('')}
      <span class="lg-hint">${ex.split ? 'One panel per group: its points in color, all other points grey behind them. Colored line: the group’s own least-squares line; dashed: all points together.' : 'Colored lines: least-squares line of each group, drawn across that group’s own range. Hover a group to bring it forward, click to keep it; <b>Split by group</b> draws one small chart per group.'}</span></div>` : '');
    // annual line
    const lw = $('#line-wrap'), lwW = Math.max(260, lw.clientWidth);
    const ltr = !animate ? null : ex.lineFrame ? { from: ex.lineFrame } : { reveal: true };
    ex.line = Charts.line($('#line'), { width: lwW, height: Math.round(190 * Charts.scale()), points: ex.res.annual || [], xDomain: st.lineZoom || [ex.H.yearMin, ex.H.yearMax], overall: ex.res.corr.r, transition: ltr });
    ex.lineFrame = ex.line.frame;
  }
  /* live values for the visible part of a zoomed chart */
  function renderInView() {
    const st = ex.st, pd = ex.pd, box = $('#inview');
    const all = ex.res.corr, summary = `<span>Selection: n <b>${fInt.format(ex.res.n)}</b></span><span>r <b class="${all.r < 0 ? 'neg-t' : 'pos-t'}">${fmtR(all.r)}</b></span><span>ρ <b>${fmtR(all.rho)}</b></span><span>p ${fmtP(all.p, all.log10p)}</span>`;
    box.hidden = !st.zoom && !ui.expanded;
    box.classList.toggle('is-zoomed', !!st.zoom);
    if (!st.zoom) { box.innerHTML = ui.expanded ? summary : ''; return; }
    const [x0, x1] = ex.plot.domain.x, [y0, y1] = ex.plot.domain.y, xs = [], ys = [];
    for (let j = 0; j < pd.x.length; j++) {
      const a = pd.x[j], b = pd.y[j];
      if (a >= x0 && a <= x1 && b >= y0 && b <= y1) { xs.push(a); ys.push(b); }
    }
    const c = xs.length >= 3 ? S.pearson(xs, ys) : { r: NaN };
    box.innerHTML = `${ui.expanded ? summary + '<span class="sep" aria-hidden="true">|</span>' : ''}<b>Zoomed view</b><span>${fInt.format(xs.length)} of ${fInt.format(pd.x.length)} points visible</span>
      <span>r in view <b class="${c.r < 0 ? 'neg-t' : 'pos-t'}">${isFinite(c.r) ? fmtR(c.r) : 'n/a'}</b></span>
      <span class="muted">X ${pd.xTick(x0)} to ${pd.xTick(x1)} · Y ${pd.yTick(y0)} to ${pd.yTick(y1)}</span>
      <button type="button" class="link-btn" data-zoom-reset>Reset zoom</button>`;
    box.querySelector('[data-zoom-reset]').addEventListener('click', () => { st.zoom = null; redraw(); });
  }
  function selectionLabel() {
    const sel = ex.st.select; if (!sel) return '';
    return sel.type === 'pair' ? entName(sel.e1) + ' – ' + entName(sel.e2) : entName(sel.e);
  }

  function rowLabel(i) {
    const d = ex.H.d;
    return ex.H.pair ? `${esc(entName(d.e1[i]))} – ${esc(entName(d.e2[i]))}` : esc(entName(d.e[i]));
  }
  function warText(i) {
    const d = ex.H.d, w = d.war[i];
    if (ex.H.pair) {
      if (w === 3) return 'War status unknown (after 2007)';
      const parts = [d.e1[i], d.e2[i]].map(e => META.warNames[e + '-' + d.year[i]]).filter(Boolean);
      return C.PAIR_WAR[w] + (parts.length ? ': ' + esc(parts.join('; ')) : '');
    }
    if (w === 2) return 'War status unknown (after 2007)';
    return w === 1 ? 'At war: ' + esc(META.warNames[d.e[i] + '-' + d.year[i]] || 'recorded') : 'No inter-state war recorded';
  }
  function pointTip(j) {
    const H = ex.H, st = ex.st, res = ex.res, cfg = H.cfg, pd = ex.pd;
    if (st.level === 'between') {
      const ent = res.bw.bEnt[j], cnt = res.bw.bCount[j];
      const label = H.pair ? esc(entName(H.d.pairEnts[ent][0])) + ' – ' + esc(entName(H.d.pairEnts[ent][1])) : esc(entName(ent));
      return `<b>${label}</b><br>average of ${cnt} year${cnt === 1 ? '' : 's'}<br>${esc(cfg.xLabel)}: ${pd.fx(pd.x[j])}<br>${esc(cfg.yLabel)}: ${pd.fy(pd.y[j])}`;
    }
    const i = res.rows[j];
    if (st.level === 'within') {
      return `<b>${rowLabel(i)}</b> · ${H.d.year[i]}<br>X vs own mean: ${pd.xTick(pd.x[j])}<br>Y vs own mean: ${pd.yTick(pd.y[j])}<br><span class="muted">Actual: ${pd.fx(res.x[j])} · ${pd.fy(res.y[j])}</span>`;
    }
    const cont = H.pair ? contEn(H.d.c1[i]) + ' / ' + contEn(H.d.c2[i]) : contEn(H.d.c[i]);
    return `<b>${rowLabel(i)}</b> · ${H.d.year[i]} <span class="muted">· ${cont}</span><br>${esc(cfg.xLabel)}: ${pd.fx(res.x[j])}<br>${esc(cfg.yLabel)}: ${pd.fy(res.y[j])}<br><span class="muted">${warText(i)}</span><br><span class="hint">${isSelectedRow(i) ? 'Highlighted · click again to remove' : 'Click to highlight'}</span>`;
  }
  function isSelectedRow(i) {
    const sel = ex.st.select, d = ex.H.d;
    if (!sel) return false;
    if (sel.type === 'pair') return d.e1[i] === sel.e1 && d.e2[i] === sel.e2;
    return ex.H.pair ? d.e1[i] === sel.e || d.e2[i] === sel.e : d.e[i] === sel.e;
  }
  function binTip(b) {
    const pd = ex.pd;
    return `<b>${fInt.format(b.count)} rows</b><br>X ${pd.fx(b.x0)} to ${pd.fx(b.x1)}<br>Y ${pd.fy(b.y0)} to ${pd.fy(b.y1)}`;
  }
  const sameSel = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  function selectPoint(j) {
    const H = ex.H, st = ex.st, res = ex.res;
    if (st.level === 'between') {
      const ent = res.bw.bEnt[j];
      st.select = H.pair ? { type: 'pair', e1: H.d.pairEnts[ent][0], e2: H.d.pairEnts[ent][1] } : { type: 'country', e: ent };
    } else selectRow(res.rows[j]);
  }
  function selectRow(i) {
    const H = ex.H, d = H.d;
    states[H.cfg.id].select = H.pair ? { type: 'pair', e1: d.e1[i], e2: d.e2[i] } : { type: 'country', e: d.e[i] };
  }

  /* ---------- groups ---------- */
  function groupCat(st, key) { // index of the scatter color of this group, if the scatter is colored by this grouping
    const colors = ex.colors;
    if (!colors || !colors.cats || colors.mode !== st.group) return -1;
    const want = st.group === 'continent' ? C.CONTINENTS[key] : key;
    return colors.cats.findIndex(cc => cc.key === want);
  }
  function groupMarker(st, key) {
    const k = groupCat(st, key);
    return k >= 0 ? shapeSvg(ex.colors.cats[k].shape, ex.colors.cats[k].css) : '';
  }
  function renderGroups() {
    const H = ex.H, st = ex.st, groups = ex.groups;
    const note = (C.GROUP_NOTES[st.group] || {})[H.pair ? 'pair' : 'country'] || '';
    $('#group-note').textContent = note + (note ? ' ' : '') + 'Other filters stay active.';
    const m = Math.max(0.2, ...groups.map(g => (isFinite(g.r) ? Math.abs(g.r) : 0)));
    const scale = Math.ceil(m * 10) / 10;
    // bars start at their previous length (or at zero) and grow to the new one
    const prev = ex.bars || {}, next = {};
    $('#groups').innerHTML = groups.length ? `<div class="g-axis"><span>${fmtR2(-scale)}</span><span>0</span><span>${fmtR2(scale)}</span></div>` + groups.map((g, k) => {
      const sel = groupSelected(H, st, g.key), small = g.n < 30, w = isFinite(g.r) ? Math.abs(g.r) / scale * 50 : 0;
      const key = JSON.stringify(g.key), l = g.r < 0 ? 50 - w : 50, p = prev[key] || { l: 50, w: 0, r: 0 };
      next[key] = { l, w, r: g.r };
      const cat = groupCat(st, g.key);
      return `<button type="button" class="g-row ${sel ? 'is-sel' : ''} ${small ? 'is-small' : ''}" data-key='${key}' ${cat >= 0 ? `data-cat="${cat}"` : ''} aria-pressed="${sel}" style="--i:${k}">
        <span class="g-label"><span class="g-name">${groupMarker(st, g.key)}${esc(g.label)}</span><span class="g-n">n = ${fInt.format(g.n)}${small ? ' · small' : ''}</span></span>
        <span class="g-track"><span class="g-zero"></span>${isFinite(g.r) ? `<span class="g-bar ${g.r < 0 ? 'neg' : 'pos'}" data-l="${l}" data-w="${w}" style="left:${p.l}%;width:${p.w}%"></span>` : ''}</span>
        <span class="g-val"><span class="g-rv" data-from="${p.r}" data-to="${g.r}">${isFinite(g.r) ? fmtR(g.r) : 'n/a'}</span><span class="g-rho">ρ ${fmtR2(g.rho)}</span></span>
      </button>`;
    }).join('') : '<p class="muted">No rows in this selection.</p>';
    ex.bars = next;
    void $('#groups').offsetWidth; // apply the start lengths before the transition
    $$('#groups .g-bar').forEach(b => { b.style.left = b.dataset.l + '%'; b.style.width = b.dataset.w + '%'; });
    $$('#groups .g-rv').forEach(v => { const to = +v.dataset.to; if (isFinite(to)) tween(v, +v.dataset.from, to, fmtR); });
  }

  /* ---------- influence / extremes / selection ---------- */
  function renderTab() {
    const body = $('#tab-body'), html = tabHtml();
    if (body._html === html) return;
    body._html = html; body.innerHTML = html;
    if (!reduceMotion()) { body.classList.remove('is-fresh'); void body.offsetWidth; body.classList.add('is-fresh'); }
  }
  function tabHtml() {
    const H = ex.H, st = ex.st, res = ex.res, cfg = H.cfg;
    if (res.n < 3) return '<p class="muted">Fewer than 3 rows: no correlation can be computed.</p>';
    if (st.tab === 'influence') {
      const list = res.loo.list.filter(o => isFinite(o.r)).slice(0, 8);
      if (res.countries <= 1) return '<p class="muted">Only one country left, so there is nothing to leave out.</p>';
      return `<p class="panel-note">r of the current selection without all rows of one country${H.pair ? ' (in either role of a pair)' : ''}. Sorted by the size of the change.</p>
      <div class="table-scroll"><table class="mini"><thead><tr><th>Country</th><th class="num">rows</th><th class="num">r without</th><th class="num">change</th><th></th></tr></thead><tbody>
      ${list.map(o => `<tr data-hover-e="${o.e}"><td><button type="button" class="link-btn" data-act="select" data-e="${o.e}">${esc(entName(o.e))}</button> <span class="muted">${contEn(entCont[o.e])}</span></td>
        <td class="num">${fInt.format(o.removed)}</td><td class="num">${fmtR(o.r)}</td>
        <td class="num ${o.delta < 0 ? 'neg-t' : 'pos-t'}">${minus((o.delta > 0 ? '+' : '') + o.delta.toFixed(3))}</td>
        <td class="actions"><button type="button" class="btn btn-xs" data-act="exclude" data-e="${o.e}">Exclude</button><button type="button" class="btn btn-xs" data-act="only" data-e="${o.e}">Only</button></td></tr>`).join('')}
      </tbody></table></div>`;
    }
    if (st.tab === 'extremes') {
      const E = res.extremes, pd = ex.pd;
      const block = (title, idx, val) => `<div class="xb"><h3>${title}</h3><ol>${idx.map(j => `<li><button type="button" class="link-btn" data-act="row" data-row="${res.rows[j]}">${rowLabel(res.rows[j])} ${H.d.year[res.rows[j]]}</button><span class="num">${val(j)}</span></li>`).join('')}</ol></div>`;
      return `<div class="xgrid">
        ${block('Highest Y', E.yHigh, j => pd.fy(res.y[j]))}
        ${block('Lowest Y', E.yLow, j => pd.fy(res.y[j]))}
        ${block('Highest X', E.xHigh, j => pd.fx(res.x[j]))}
        ${block('Lowest X', E.xLow, j => pd.fx(res.x[j]))}
        ${block('Furthest above the line', E.above, j => '+' + pd.fy(E.resid[j]))}
        ${block('Furthest below the line', E.below, j => pd.fy(E.resid[j]).replace(/^-/, '−'))}
      </div><p class="panel-note">${E.yMinTies > 5 ? fInt.format(E.yMinTies) + ' rows share the lowest Y value (' + pd.fy(E.yMin) + '), so the lowest cases are interchangeable. ' : ''}Extreme does not mean wrong: these rows are real observations.</p>`;
    }
    const sel = st.select;
    if (!sel) return '<p class="muted">Click a point, a table row or a country name to look at one country.</p>';
    if (sel.type === 'pair') {
      const d = H.d, xs = [], ys = [], yrs = [];
      for (let j = 0; j < res.n; j++) { const i = res.rows[j]; if (d.e1[i] === sel.e1 && d.e2[i] === sel.e2) { xs.push(res.x[j]); ys.push(res.y[j]); yrs.push(d.year[i]); } }
      const c = S.pearson(xs, ys);
      return `<div class="sel-head"><h3>${esc(entName(sel.e1))} – ${esc(entName(sel.e2))}</h3><button type="button" class="link-btn" data-act="clear-select">Clear</button></div>
        <p>${xs.length} year${xs.length === 1 ? '' : 's'} in the selection${yrs.length ? ' (' + Math.min(...yrs) + '–' + Math.max(...yrs) + ')' : ''}. ${xs.length >= 3 && isFinite(c.r) ? 'r within this pair: <b>' + fmtR(c.r) + '</b>.' : ''}</p>
        <div class="sel-actions">${[sel.e1, sel.e2].map(e => `<div><b>${esc(entName(e))}</b><button type="button" class="btn btn-xs" data-act="select" data-e="${e}">Highlight all pairs</button><button type="button" class="btn btn-xs" data-act="exclude" data-e="${e}">Exclude</button><button type="button" class="btn btn-xs" data-act="only" data-e="${e}">Only</button></div>`).join('')}</div>`;
    }
    const e = sel.e, info = ENT[e], d = H.d, xs = [], ys = [], yrs = []; let wars = 0;
    for (let j = 0; j < res.n; j++) {
      const i = res.rows[j];
      if (H.pair ? d.e1[i] === e || d.e2[i] === e : d.e[i] === e) { xs.push(res.x[j]); ys.push(res.y[j]); yrs.push(d.year[i]); if (!H.pair && d.war[i] === 1) wars++; }
    }
    const c = S.pearson(xs, ys), loo = res.loo.list.find(o => o.e === e), f = info.freq;
    return `<div class="sel-head"><h3>${esc(info.name)} <span class="muted">${info.iso3} · ${contEn(entCont[e])}</span></h3><button type="button" class="link-btn" data-act="clear-select">Clear</button></div>
      <dl class="kv">
        <div><dt>${H.pair ? 'Pair-years with this country' : 'Years in selection'}</dt><dd>${fInt.format(xs.length)}${yrs.length ? ' <span class="muted">(' + Math.min(...yrs) + '–' + Math.max(...yrs) + ')</span>' : ''}</dd></div>
        <div><dt>${H.pair ? 'r among its pairs' : 'r within this country'}</dt><dd>${xs.length >= 3 && isFinite(c.r) ? fmtR(c.r) : '–'}</dd></div>
        <div><dt>r of selection without it</dt><dd>${loo && isFinite(loo.r) ? fmtR(loo.r) + ' <span class="muted">(' + minus((loo.delta > 0 ? '+' : '') + loo.delta.toFixed(3)) + ')</span>' : '–'}</dd></div>
        ${H.pair ? '' : `<div><dt>Mean X / mean Y</dt><dd>${xs.length ? ex.pd.fx(xs.reduce((a, b) => a + b, 0) / xs.length) + ' / ' + ex.pd.fy(ys.reduce((a, b) => a + b, 0) / ys.length) : '–'}</dd></div>
        <div><dt>War years in selection</dt><dd>${wars}</dd></div>`}
        <div><dt>War-year share 1950–2007</dt><dd>${f && f.share !== null ? (100 * f.share).toFixed(1) + '% · ' + f.wars + ' war' + (f.wars === 1 ? '' : 's') : '–'}</dd></div>
      </dl>
      <div class="sel-actions"><div><button type="button" class="btn btn-xs" data-act="exclude" data-e="${e}">Exclude ${esc(info.iso3)}</button><button type="button" class="btn btn-xs" data-act="only" data-e="${e}">Only ${esc(info.iso3)}</button></div></div>`;
  }

  function renderModel() {
    const H = ex.H, res = ex.res, box = $('#model-box');
    if (H.pair || !res.fe) { box.innerHTML = ''; return; }
    const fe = res.fe, cfg = H.cfg;
    if (fe.status !== 'computed') { box.innerHTML = `<div class="model"><h3>Fixed-effects model</h3><p class="muted">Not computed: ${esc(fe.status)}.</p></div>`; return; }
    box.innerHTML = `<div class="model">
      <h3>Fixed-effects model <span class="muted">country + year effects</span></h3>
      <p class="model-eq">Y = β · ${cfg.modelLog ? 'log(X)' : 'X'} + country effect + year effect</p>
      <dl class="kv kv-inline">
        <div><dt>β</dt><dd>${minus(fe.beta.toFixed(3))}</dd></div>
        <div><dt>95% CI</dt><dd>${minus(fe.ciLow.toFixed(2))} to ${minus(fe.ciHigh.toFixed(2))}</dd></div>
        <div><dt>p (clustered)</dt><dd>${fmtP(fe.p)}</dd></div>
        <div><dt>clusters</dt><dd>${fe.entities} countries · ${fe.years} years</dd></div>
      </dl>
      <p class="panel-note">Uses only change within each country, net of common year shocks. Standard errors are clustered by country and year; t-reference with ${fe.dof} degrees of freedom. ${cfg.id === 'H2' ? 'Without the notebook’s extra controls (log population, log productivity).' : ''}</p>
    </div>`;
  }

  /* ---------- data table ---------- */
  function tableRows() {
    const H = ex.H, st = ex.st, res = ex.res, d = H.d, q = st.table.q.trim().toLowerCase();
    let idx = Array.from({ length: res.n }, (_, j) => j);
    if (q) idx = idx.filter(j => {
      const i = res.rows[j];
      const ents = H.pair ? [d.e1[i], d.e2[i]] : [d.e[i]];
      return ents.some(e => ENT[e].name.toLowerCase().includes(q) || ENT[e].iso3.toLowerCase() === q) || String(d.year[i]) === q;
    });
    const t = st.table, dir = t.dir;
    const key = t.sort === 'x' ? j => res.x[j] : t.sort === 'y' ? j => res.y[j] : t.sort === 'year' ? j => d.year[res.rows[j]] * 1000 + (H.pair ? d.e1[res.rows[j]] : d.e[res.rows[j]]) / 1000 : null;
    if (key) idx.sort((a, b) => (key(a) - key(b)) * dir);
    else idx.sort((a, b) => rowLabel(res.rows[a]).localeCompare(rowLabel(res.rows[b])) * dir || d.year[res.rows[a]] - d.year[res.rows[b]]);
    return idx;
  }
  function renderTable() {
    const H = ex.H, st = ex.st, res = ex.res, d = H.d, cfg = H.cfg, pd = ex.pd;
    const idx = tableRows(), per = 25, pages = Math.max(1, Math.ceil(idx.length / per));
    st.table.page = Math.min(st.table.page, pages - 1);
    const page = idx.slice(st.table.page * per, st.table.page * per + per);
    const arrow = k => st.table.sort === k ? (st.table.dir > 0 ? ' ↑' : ' ↓') : '';
    const sel = st.select;
    $('#t-table').innerHTML = `<thead><tr>
      <th data-sort="name" scope="col">${H.pair ? 'Pair' : 'Country'}${arrow('name')}</th>
      <th scope="col">Continent</th>
      <th data-sort="year" scope="col" class="num">Year${arrow('year')}</th>
      <th data-sort="x" scope="col" class="num">X: ${esc(cfg.xLabel)}${arrow('x')}</th>
      <th data-sort="y" scope="col" class="num">Y: ${esc(cfg.yLabel)}${arrow('y')}</th>
      <th scope="col">Inter-state war</th></tr></thead>
      <tbody>${page.map(j => {
        const i = res.rows[j];
        const isSel = sel && (H.pair ? (sel.type === 'pair' ? d.e1[i] === sel.e1 && d.e2[i] === sel.e2 : d.e1[i] === sel.e || d.e2[i] === sel.e) : d.e[i] === sel.e);
        const cont = H.pair ? contEn(d.c1[i]) + ' / ' + contEn(d.c2[i]) : contEn(d.c[i]);
        return `<tr data-row="${i}" class="${isSel ? 'is-sel' : ''}"><td>${rowLabel(i)}</td><td>${cont}</td><td class="num">${d.year[i]}</td><td class="num">${pd.fx(res.x[j])}</td><td class="num">${pd.fy(res.y[j])}</td><td class="war-cell">${warText(i)}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="muted">No rows match.</td></tr>'}</tbody>`;
    const p = st.table.page;
    $('#t-pager').innerHTML = `<span>${fInt.format(idx.length)} rows${st.outlier !== 'full' ? ' after outlier treatment' : ''}</span>
      <span class="pager-btns"><button type="button" class="btn btn-xs" data-page="0" ${p === 0 ? 'disabled' : ''}>First</button><button type="button" class="btn btn-xs" data-page="${p - 1}" ${p === 0 ? 'disabled' : ''}>Previous</button>
      <span class="muted">Page ${p + 1} of ${fInt.format(pages)}</span>
      <button type="button" class="btn btn-xs" data-page="${p + 1}" ${p >= pages - 1 ? 'disabled' : ''}>Next</button><button type="button" class="btn btn-xs" data-page="${pages - 1}" ${p >= pages - 1 ? 'disabled' : ''}>Last</button></span>`;
  }
  function downloadCsv() {
    const H = ex.H, res = ex.res, d = H.d, cfg = H.cfg;
    const head = H.pair ? ['iso3_a', 'country_a', 'iso3_b', 'country_b', 'year', cfg.x, cfg.y, 'war_status'] : ['iso3', 'country', 'continent', 'year', 'x_' + cfg.xLabel, 'y_' + cfg.yLabel, 'war_status'];
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(',')];
    for (let j = 0; j < res.n; j++) {
      const i = res.rows[j];
      const war = (H.pair ? C.PAIR_WAR : C.COUNTRY_WAR)[d.war[i]];
      lines.push((H.pair ? [ENT[d.e1[i]].iso3, ENT[d.e1[i]].name, ENT[d.e2[i]].iso3, ENT[d.e2[i]].name, d.year[i], res.x[j], res.y[j], war]
        : [ENT[d.e[i]].iso3, ENT[d.e[i]].name, contEn(d.c[i]), d.year[i], res.x[j], res.y[j], war]).map(q).join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = cfg.id + '_selection.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- methods ---------- */
  function renderMethods() {
    if (current.view !== 'methods') enterView();
    current = { view: 'methods', H: null };
    renderNav('methods');
    setHash('methods');
    const fq = META.frequency;
    app.innerHTML = `
    <section class="wrap section prose">
      <p class="kicker">Methods</p>
      <h1>How the numbers are made</h1>
      <p class="lead">The data preparation runs in the Jupyter notebook. This site receives the finished samples and recomputes every statistic in the browser with the same formulas.</p>

      <h2>Pipeline</h2>
      <ol class="steps">
        <li><b>Import.</b> Ten raw files from eight sources are read unchanged. Missing-value codes are removed only in measured fields; true zeros stay zero.</li>
        <li><b>Country identities.</b> COW codes are mapped to ISO codes explicitly. Predecessor and successor states (USSR/Russia, Yugoslavia/Serbia, East/West Germany) are not merged; transition years are excluded from cross-source tables.</li>
        <li><b>Variables.</b> Productivity = PWT rgdpo / emp. Military personnel per 1,000 = NMC milper / tpop × 1000. Import HHI = sum of squared partner shares. Mutual import share = mean of both directed import shares. Spending growth from SIPRI uses the exact previous year only.</li>
        <li><b>Quality rules.</b> H2, H3 and H4 keep a country-year only if its observed bilateral imports cover 90–110% of its national imports (for pairs: both countries). H8 also needs ≥ 95% distance coverage of exports.</li>
        <li><b>Context.</b> Continents from CEPII (the Americas split into North incl. Central America/Caribbean, and South). War status from COW Inter-State War Data: a country-year is “at war” if any participation episode covers that year, up to 2007; later years are unknown.</li>
        <li><b>Export.</b> <code>Website/build_data.py</code> runs the notebook cells and writes the finished samples to <code>Website/data/</code>. Nothing is filtered or added there.</li>
      </ol>

      <h2>Statistics computed live</h2>
      <dl class="defs">
        <div><dt>Pearson r and p</dt><dd>Linear correlation with the conventional two-sided t-test, as in <code>scipy.stats.pearsonr</code>. Rows are not independent (a country appears in many years), so p is too optimistic. Very small p-values are shown in powers of ten instead of 0.</dd></div>
        <div><dt>Spearman ρ</dt><dd>Correlation of ranks (ties get average ranks). Robust to skewed scales.</dd></div>
        <div><dt>Between / within</dt><dd>Between: r of the averages of each country (or pair), each weighted equally. Within: r of deviations from each country’s own average. Pooled r mixes both.</dd></div>
        <div><dt>Fixed-effects model</dt><dd>Country-year hypotheses only: Y on X (log X for H1) with country and year effects absorbed by alternating demeaning. Standard errors are two-way clustered (country, year) with small-sample correction; t-reference with min(clusters) − 1 degrees of freedom. Same as <code>fit_absorbed</code> in the notebook.</dd></div>
        <div><dt>Outliers</dt><dd>Trim drops rows outside the 1st or 99th percentile of X or Y in the current selection; winsorise clips them to those bounds.</dd></div>
        <div><dt>Influence</dt><dd>Leave-one-country-out r: all rows of a country are removed at once (for pairs, in either role), because one country repeats in many rows.</dd></div>
        <div><dt>War-prone countries</dt><dd>War-year share 1950–2007 per country, countries with ≥ ${fq.minYears} observed years weighted equally. Mean share ${(100 * fq.meanShare).toFixed(3)}%, 90th percentile ${(100 * fq.p90Share).toFixed(1)}%, mean number of wars ${fq.meanCount.toFixed(2)}. Rows with unknown war status are dropped by these rules.</dd></div>
      </dl>

      <h2>Limits</h2>
      <ul>
        <li>Correlation is not causation; hidden variables (security threats, conscription laws, oil wealth) can drive both X and Y.</li>
        <li>War data cover inter-state wars only. Civil wars are missing, so “no war recorded” does not mean peace. Two countries both at war need not fight each other.</li>
        <li>NMC counts personnel on 1 January, while war status counts any participation in the calendar year.</li>
        <li>Many groups and filters are exploratory comparisons. A small p in one subgroup is not a confirmation.</li>
      </ul>

      <h2 id="validation">Live validation against the notebook</h2>
      <p>The table compares the browser engine with the values stored by the notebook run. Loading the pair data takes a moment.</p>
      <button type="button" class="btn btn-accent" id="run-validation">Run the check</button>
      <div class="table-scroll"><table class="results compact" id="validation"></table></div>
    </section>`;
    $('#run-validation').addEventListener('click', runValidation);
    window.scrollTo(0, 0);
  }
  async function runValidation() {
    const btn = $('#run-validation'); btn.disabled = true; btn.textContent = 'Checking…';
    const rows = [];
    for (const cfg of C.HYPOTHESES) {
      await loadScript(cfg.dataset);
      await new Promise(r => setTimeout(r, 0));
      const H = getHyp(cfg.id), x = new Float64Array(H.rows.length), y = new Float64Array(H.rows.length);
      H.rows.forEach((i, j) => { x[j] = H.X[i]; y[j] = H.Y[i]; });
      const c = S.correlate(x, y), ref = REF.baseline[cfg.id];
      rows.push(`<tr><th scope="row">${cfg.id}</th><td class="num">${fInt.format(c.n)}</td><td class="num">${fInt.format(ref.n)}</td>
        <td class="num">${c.r.toFixed(4)}</td><td class="num">${ref.pearson_r.toFixed(4)}</td><td class="num">${c.rho.toFixed(4)}</td><td class="num">${ref.spearman_rho.toFixed(4)}</td>
        <td>${c.n === ref.n && Math.abs(c.r - ref.pearson_r) < 5e-4 ? '<span class="ok">matches</span>' : '<span class="warn">differs</span>'}</td></tr>`);
      $('#validation').innerHTML = `<thead><tr><th>Hyp.</th><th class="num">n live</th><th class="num">n notebook</th><th class="num">r live</th><th class="num">r notebook</th><th class="num">ρ live</th><th class="num">ρ notebook</th><th></th></tr></thead><tbody>${rows.join('')}</tbody>`;
    }
    btn.textContent = 'Checked';
  }

  /* ---------- explanations for H1–H4 ----------
   * A separate page (#why, #why-h1 … #why-h4): per hypothesis the result, a short answer, two figures
   * drawn from the data, explanation cards by type and the numbered sources. */
  const TYPE_ICONS = {
    research: '<path d="M10 5.2C8 3.9 5.6 3.6 3 4.4v11c2.6-.8 5-.5 7 .8 2-1.3 4.4-1.6 7-.8v-11c-2.6-.8-5-.5-7 .8zM10 5.2v11"/>',
    geopolitics: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.4 2.2 2.4 11.8 0 14M10 3c-2.4 2.2-2.4 11.8 0 14"/>',
    history: '<path d="M5 3h10M5 17h10M6.5 3c0 4.2 7 4.6 7 7s-7 2.8-7 7M13.5 3c0 4.2-7 4.6-7 7s7 2.8 7 7"/>',
    statistics: '<path d="M3 17h14"/><path d="M5.5 16v-5M10 16V5M14.5 16v-8" stroke-width="2.6"/>',
  };
  const typeIcon = t => `<svg class="ti" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${TYPE_ICONS[t]}</svg>`;
  const avg = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
  function foundValue(spec) {
    const [id, kind] = spec.split(':');
    if (id === 'fixed') return +kind;
    if (kind === 'pooled') return REF.baseline[id].pearson_r;
    if (kind === 'rho') return REF.baseline[id].spearman_rho;
    const wb = REF.withinBetween[id];
    return kind === 'between' ? wb.between_entity_means.r : wb.within_entity_demeaned.r;
  }

  /* references are numbered per hypothesis in the order they are first cited */
  function refNumbers(X) {
    const order = [];
    for (const c of X.cards) for (const m of c.text.matchAll(/\{ref:(\w+)\}/g)) if (!order.includes(m[1])) order.push(m[1]);
    return order;
  }
  function richText(text, X, order) {
    return esc(text)
      .replace(/\{ref:(\w+)\}/g, (m, k) => `<button type="button" class="ref" data-ref="${X.id}-${k}" data-cite="${esc(C.REFS[k].cite)}" aria-label="Source ${order.indexOf(k) + 1}">${order.indexOf(k) + 1}</button>`)
      .replace(/\{live:(\w+)\}/g, (m, k) => `<span class="live" data-live="${k}">…</span>`);
  }
  const svg = (w, h, label, inner) => `<svg class="fig-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
  const usdK = v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v));

  /* ---- figures ---- */
  const FIGS = {
    'h1-paths': { title: 'Rich countries keep more soldiers, yet each country sheds them as it grows', data: 'H1', build: figH1Paths },
    'h1-usa': { title: 'United States: fewer soldiers per inhabitant after the draft and the Cold War', data: 'H1', build: figUSA },
    'h2-quartiles': { title: 'The more concentrated the imports, the smaller the forces', data: 'H2', build: figH2Quartiles },
    'h2-decades': { title: 'Imports spread over more partners after decolonisation', data: 'H2', build: figH2Decades },
    'h3-drivers': { title: 'What moves defence budgets, and what does not', build: figH3Drivers },
    'h3-bars': { title: 'One extreme year weighs on the linear correlation', build: figH3Bars },
    'h4-tug': { title: 'Two forces pull in opposite directions', build: figH4Tug },
    'h4-bars': { title: 'Distance and one big partner matter more than the wealth gap', build: figH4Bars },
  };
  function axisText(x, y, t, anchor = 'middle', cls = 'fx-t') { return `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(t)}</text>`; }

  function figH1Paths() {
    const H = getHyp('H1'), d = H.d, X = H.X, Y = H.Y;
    const agg = new Map();
    for (const i of H.rows) { let a = agg.get(d.e[i]); if (!a) agg.set(d.e[i], a = [0, 0, 0]); a[0]++; a[1] += Math.log10(X[i]); a[2] += Y[i]; }
    const means = [...agg.values()].map(a => ({ lx: a[1] / a[0], y: a[2] / a[0] }));
    const paths = ['USA', 'GBR', 'FRA', 'KOR', 'TWN'].map(iso => ISO_INDEX[iso]).filter(e => e !== undefined).map((e, k) => {
      const rows = Array.from(H.rows).filter(i => d.e[i] === e).sort((a, b) => d.year[a] - d.year[b]);
      const pts = rows.map((i, j) => { const w = rows.slice(Math.max(0, j - 2), j + 3); return { lx: avg(w.map(r => Math.log10(X[r]))), y: avg(w.map(r => Y[r])) }; });
      return { e, k, pts, r: S.pearson(rows.map(i => X[i]), rows.map(i => Y[i])).r, y0: d.year[rows[0]], y1: d.year[rows[rows.length - 1]] };
    });
    const W = 640, Ht = 380, m = { l: 46, r: 14, t: 14, b: 40 }, iw = W - m.l - m.r, ih = Ht - m.t - m.b;
    const all = means.concat(...paths.map(p => p.pts));
    const lx0 = Math.min(...all.map(p => p.lx)) - 0.05, lx1 = Math.max(...all.map(p => p.lx)) + 0.05, ymax = Math.max(...all.map(p => p.y)) * 1.04;
    const sx = lx => m.l + (lx - lx0) / (lx1 - lx0) * iw, sy = v => m.t + ih - Math.sqrt(Math.max(0, v) / ymax) * ih;
    let g = '';
    for (const v of [1e3, 3e3, 1e4, 3e4, 1e5, 3e5]) { const lx = Math.log10(v); if (lx < lx0 || lx > lx1) continue; g += `<line class="fx-grid" x1="${sx(lx)}" x2="${sx(lx)}" y1="${m.t}" y2="${m.t + ih}"/>` + axisText(sx(lx), Ht - 22, usdK(v)); }
    for (const v of [0, 2, 5, 10, 20, 40, 60]) { if (v > ymax) continue; g += `<line class="fx-grid" x1="${m.l}" x2="${m.l + iw}" y1="${sy(v)}" y2="${sy(v)}"/>` + axisText(m.l - 6, sy(v) + 4, String(v), 'end'); }
    g += axisText(m.l + iw / 2, Ht - 4, 'Real GDP per worker (log scale)', 'middle', 'fx-t fx-title');
    g += `<text class="fx-t fx-title" transform="translate(12 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">Military personnel per 1,000 (square-root scale)</text>`;
    g += means.map(p => `<circle class="fx-dot" cx="${sx(p.lx).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.2"/>`).join('');
    // trend across country averages
    const mx = avg(means.map(p => p.lx)), my = avg(means.map(p => p.y));
    const b = means.reduce((s, p) => s + (p.lx - mx) * (p.y - my), 0) / means.reduce((s, p) => s + (p.lx - mx) ** 2, 0), a = my - b * mx;
    const trend = Array.from({ length: 41 }, (_, k) => { const lx = lx0 + (lx1 - lx0) * k / 40; return [sx(lx), sy(a + b * lx)]; }).filter(q => isFinite(q[1]));
    g += `<path class="fx-trend" d="M${trend.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L')}"/>`;
    g += `<text class="fx-t fx-note" x="${trend[trend.length - 1][0] - 4}" y="${trend[trend.length - 1][1] - 8}" text-anchor="end">across countries: up</text>`;
    for (const p of paths) {
      const q = p.pts.map(t => [sx(t.lx), sy(t.y)]), last = q[q.length - 1], prev = q[Math.max(0, q.length - 4)];
      const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]), hx = (dx, dy) => [last[0] + dx * Math.cos(ang) - dy * Math.sin(ang), last[1] + dx * Math.sin(ang) + dy * Math.cos(ang)];
      const tip = [hx(6, 0), hx(-6, 5), hx(-6, -5)];
      g += `<g class="fx-path" style="--c:var(--series-${p.k + 1});--i:${p.k}">
        <path class="draw" pathLength="1" d="M${q.map(t => t[0].toFixed(1) + ' ' + t[1].toFixed(1)).join('L')}"/>
        <circle class="fx-start" cx="${q[0][0].toFixed(1)}" cy="${q[0][1].toFixed(1)}" r="3.5"/>
        <polygon class="fx-head" points="${tip.map(t => t.map(v => v.toFixed(1)).join(',')).join(' ')}"/></g>`;
    }
    const legend = `<ul class="fig-legend">${paths.map(p => `<li style="--c:var(--series-${p.k + 1})"><i></i><b>${esc(entName(p.e))}</b> ${p.y0}–${p.y1} <span class="mono">r = ${fmtR2(p.r)}</span></li>`).join('')}<li class="muted"><i class="dot"></i>Average of one country, 1950–2014</li></ul>`;
    return { svg: svg(W, Ht, 'Country averages rise with productivity while five country paths fall over time', g), after: legend,
      note: 'Paths are 5-year moving averages; the hollow circle marks the first year. r: correlation of productivity and personnel within that country. Data: PWT 11.0, COW NMC 7.0.' };
  }

  function figUSA(order) {
    const H = getHyp('H1'), d = H.d, e = ISO_INDEX.USA;
    const rows = Array.from(H.rows).filter(i => d.e[i] === e).sort((a, b) => d.year[a] - d.year[b]);
    const W = 640, Ht = 300, m = { l: 40, r: 16, t: 28, b: 30 }, iw = W - m.l - m.r, ih = Ht - m.t - m.b;
    const yr0 = d.year[rows[0]], yr1 = d.year[rows[rows.length - 1]], ymax = Math.max(...rows.map(i => H.Y[i])) * 1.12;
    const sx = v => m.l + (v - yr0) / (yr1 - yr0) * iw, sy = v => m.t + ih - v / ymax * ih;
    let g = '';
    // inter-state war years from COW (shaded)
    let start = null;
    rows.forEach((i, j) => {
      const war = d.war[i] === 1, next = rows[j + 1];
      if (war && start === null) start = d.year[i];
      if (war && (!next || d.war[next] !== 1 || d.year[next] !== d.year[i] + 1)) { g += `<rect class="fx-war" x="${sx(start - 0.5)}" y="${m.t}" width="${sx(d.year[i] + 0.5) - sx(start - 0.5)}" height="${ih}"/>`; start = null; }
    });
    for (const v of [0, 5, 10, 15, 20, 25]) { if (v > ymax) continue; g += `<line class="fx-grid" x1="${m.l}" x2="${m.l + iw}" y1="${sy(v)}" y2="${sy(v)}"/>` + axisText(m.l - 6, sy(v) + 4, String(v), 'end'); }
    for (let y = 1950; y <= yr1; y += 10) g += axisText(sx(y), Ht - 10, String(y));
    // events
    const n = k => order.indexOf(k) + 1;
    g += `<rect class="fx-band" x="${sx(1989)}" y="${m.t}" width="${sx(1991) - sx(1989)}" height="${ih}"/>`;
    g += `<text class="fx-t fx-event" x="${sx(1990)}" y="${m.t - 8}" text-anchor="middle">Cold War ends [${n('haltiner')}]</text>`;
    g += `<line class="fx-mark" x1="${sx(1973)}" x2="${sx(1973)}" y1="${m.t}" y2="${m.t + ih}"/>`;
    g += `<text class="fx-t fx-event" x="${sx(1973) + 6}" y="${m.t + 14}">Draft ends, 1973 [${n('army')}]</text>`;
    const pts = rows.map(i => [sx(d.year[i]), sy(H.Y[i])]);
    g += `<path class="fx-line draw" pathLength="1" d="M${pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L')}"/>`;
    const peak = rows.reduce((b, i) => (H.Y[i] > H.Y[b] ? i : b), rows[0]), last = rows[rows.length - 1];
    for (const i of [peak, last]) g += `<circle class="fx-pt" cx="${sx(d.year[i])}" cy="${sy(H.Y[i])}" r="4"/><text class="fx-t fx-val" x="${sx(d.year[i]) + (i === last ? -6 : 6)}" y="${sy(H.Y[i]) - 8}" text-anchor="${i === last ? 'end' : 'start'}">${H.Y[i].toFixed(1)} in ${d.year[i]}</text>`;
    const x0 = H.X[rows[0]], x1 = H.X[last];
    return { svg: svg(W, Ht, 'US military personnel per 1,000 inhabitants, 1950 to 2014', g),
      after: '<ul class="fig-legend"><li style="--c:var(--series-1)"><i></i>Military personnel per 1,000 inhabitants</li><li><i class="sq war"></i>Inter-state war (COW, up to 2007)</li></ul>',
      note: `Over the same years, real GDP per worker rose from ${usdK(x0)} to ${usdK(x1)}. Data: COW NMC 7.0, COW Inter-State War 4.0, PWT 11.0.` };
  }

  function h2Rows() {
    const H = getHyp('H2'), d = H.d;
    return Array.from(H.rows, i => ({ x: H.X[i], y: H.Y[i], year: d.year[i], e: d.e[i] }));
  }
  function vbars(items, fmt, opts = {}) { // vertical bars, items: [{label, sub, v}]
    const W = 640, Ht = 300, m = { l: 40, r: 10, t: 30, b: 50 }, iw = W - m.l - m.r, ih = Ht - m.t - m.b;
    const max = opts.max || Math.max(...items.map(t => t.v)) * 1.2, bw = iw / items.length;
    const sy = v => m.t + ih - v / max * ih;
    let g = '';
    for (const v of opts.ticks || []) g += `<line class="fx-grid" x1="${m.l}" x2="${m.l + iw}" y1="${sy(v)}" y2="${sy(v)}"/>` + axisText(m.l - 6, sy(v) + 4, fmt(v), 'end');
    items.forEach((t, k) => {
      const x = m.l + k * bw + bw * 0.18, w = bw * 0.64;
      g += `<rect class="fx-vbar" style="--i:${k}" x="${x.toFixed(1)}" y="${sy(t.v).toFixed(1)}" width="${w.toFixed(1)}" height="${(m.t + ih - sy(t.v)).toFixed(1)}" rx="4"/>`;
      g += `<text class="fx-t fx-val" x="${(x + w / 2).toFixed(1)}" y="${(sy(t.v) - 8).toFixed(1)}" text-anchor="middle">${fmt(t.v)}</text>`;
      g += axisText(x + w / 2, Ht - 30, t.label, 'middle', 'fx-t fx-strong') + axisText(x + w / 2, Ht - 13, t.sub);
    });
    g += `<line class="fx-axis" x1="${m.l}" x2="${m.l + iw}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
    return svg(W, Ht, opts.label || '', g);
  }
  function figH2Quartiles() {
    const rows = h2Rows().sort((a, b) => a.x - b.x), q = [0, 1, 2, 3].map(k => rows.slice(Math.floor(k * rows.length / 4), Math.floor((k + 1) * rows.length / 4)));
    const labels = ['Least', 'Lower middle', 'Upper middle', 'Most'];
    const items = q.map((g, k) => ({ label: labels[k], sub: 'HHI ' + g[0].x.toFixed(2) + '–' + g[g.length - 1].x.toFixed(2), v: median(g.map(r => r.y)) }));
    return { svg: vbars(items, v => v.toFixed(1), { ticks: [0, 1, 2, 3, 4, 5], max: Math.max(...items.map(t => t.v)) * 1.25, label: 'Median military personnel per 1,000 by quarter of import concentration' }),
      note: `Median military personnel per 1,000 inhabitants in each quarter of ${fInt.format(rows.length)} country-years, sorted by import concentration. Data: COW Trade 4.0, COW NMC 7.0.` };
  }
  function figH2Decades(order) {
    const rows = h2Rows(), dec = new Map();
    for (const r of rows) { const k = Math.floor(r.year / 10) * 10; if (!dec.has(k)) dec.set(k, []); dec.get(k).push(r.x); }
    const items = [...dec].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ k, v: median(v), n: v.length }));
    const W = 640, Ht = 300, m = { l: 44, r: 20, t: 34, b: 34 }, iw = W - m.l - m.r, ih = Ht - m.t - m.b, max = 0.3;
    const sx = k => m.l + (k + 0.5) / items.length * iw, sy = v => m.t + ih - v / max * ih;
    let g = '';
    for (const v of [0, 0.1, 0.2, 0.3]) g += `<line class="fx-grid" x1="${m.l}" x2="${m.l + iw}" y1="${sy(v)}" y2="${sy(v)}"/>` + axisText(m.l - 6, sy(v) + 4, v.toFixed(1), 'end');
    const pts = items.map((t, k) => [sx(k), sy(t.v)]);
    g += `<path class="fx-area" d="M${pts[0][0]} ${sy(0)}L${pts.map(q => q.join(' ')).join('L')}L${pts[pts.length - 1][0]} ${sy(0)}Z"/>`;
    g += `<path class="fx-line draw" pathLength="1" d="M${pts.map(q => q.join(' ')).join('L')}"/>`;
    items.forEach((t, k) => { g += `<circle class="fx-pt" cx="${pts[k][0]}" cy="${pts[k][1]}" r="4.5"/>` + axisText(pts[k][0], pts[k][1] - 11, t.v.toFixed(2), 'middle', 'fx-t fx-val') + axisText(pts[k][0], Ht - 12, t.k + 's'); });
    g += `<text class="fx-t fx-event" x="${m.l + iw}" y="${m.t - 14}" text-anchor="end">Colonial trade ties erode over decades [${order.indexOf('hmr') + 1}]</text>`;
    return { svg: svg(W, Ht, 'Median import concentration by decade', g), note: 'Median import concentration (Herfindahl–Hirschman index of partner shares, 0 to 1) of all country-years in each decade. Data: COW Trade 4.0.' };
  }

  function wrapLines(t, max) { // split a label into lines of at most max characters
    const out = []; let line = '';
    for (const w of t.split(' ')) { if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
    if (line) out.push(line);
    return out;
  }
  function figH3Drivers(order) {
    const n = k => order.indexOf(k) + 1, W = 640, Ht = 300;
    const inputs = [
      { t: 'Risk of armed conflict', ref: n('nordhaus'), y: 46 },
      { t: 'Neighbours’ military spending', ref: n('dunne'), y: 112 },
      { t: 'War at home or abroad', ref: n('dunne'), y: 178 },
      { t: 'Trading partners', ref: null, y: 250, weak: true },
    ];
    const cx = 420, cw = 196, ch = 74, cy = 148;
    let g = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="fx-arrowhead"/></marker></defs>`;
    inputs.forEach((p, k) => {
      const x1 = 254, y1 = p.y, x2 = cx - 4, y2 = cy + (p.y - cy) * 0.28;
      g += `<path class="fx-flow ${p.weak ? 'weak' : 'draw'}" ${p.weak ? '' : 'pathLength="1"'} style="--i:${k}" d="M${x1} ${y1}C${x1 + 70} ${y1} ${x2 - 70} ${y2} ${x2} ${y2}" marker-end="url(#arr)"/>`;
      g += `<rect class="fx-node ${p.weak ? 'weak' : ''}" x="20" y="${p.y - 22}" width="232" height="44" rx="10"/>`;
      g += `<text class="fx-t fx-node-t" x="36" y="${p.y + 5}">${esc(p.t)}${p.ref ? ` [${p.ref}]` : ''}</text>`;
      if (p.weak) g += `<text class="fx-t fx-flow-t" x="${(254 + cx) / 2 + 6}" y="${p.y - 10}" text-anchor="middle">r = −0.03 in our data</text>`;
    });
    g += `<rect class="fx-node fx-center" x="${cx}" y="${cy - ch / 2}" width="${cw}" height="${ch}" rx="12"/>`;
    g += `<text class="fx-t fx-center-t" x="${cx + cw / 2}" y="${cy - 4}" text-anchor="middle">Military spending</text><text class="fx-t" x="${cx + cw / 2}" y="${cy + 16}" text-anchor="middle">change from year to year</text>`;
    return { svg: svg(W, Ht, 'Threats, neighbours and wars drive military spending; trade partners hardly do', g), note: 'Solid arrows: drivers found in the cited studies. Dashed: the link H3 tested.' };
  }
  function hbars(rows, opts) { // horizontal bars around zero, rows: [{label, v, note}]
    const W = 640, rowH = 46, m = { l: 230, r: 60, t: 22, b: 30 }, Ht = m.t + rows.length * rowH + m.b, iw = W - m.l - m.r;
    const sx = v => m.l + (v - opts.min) / (opts.max - opts.min) * iw, z = sx(0);
    let g = '';
    for (const v of opts.ticks) g += `<line class="fx-grid" x1="${sx(v)}" x2="${sx(v)}" y1="${m.t - 6}" y2="${Ht - m.b}"/>` + axisText(sx(v), Ht - 10, (v > 0 ? '+' : '') + v.toFixed(1).replace('-', '−'));
    if (opts.weak) g += `<rect class="fx-band" x="${sx(-0.1)}" y="${m.t - 6}" width="${sx(0.1) - sx(-0.1)}" height="${Ht - m.b - m.t + 6}"/><text class="fx-t fx-note" x="${sx(opts.min < -0.1 ? -0.1 : 0.1) + (opts.min < -0.1 ? 4 : -4)}" y="${m.t + 4}" text-anchor="${opts.min < -0.1 ? 'start' : 'end'}">|r| < 0.1: not interpretable</text>`;
    rows.forEach((r, k) => {
      const y = m.t + k * rowH + 10, x = Math.min(z, sx(r.v)), w = Math.abs(sx(r.v) - z);
      g += lines(r.label, 230 - 14, y + 16);
      g += `<rect class="fx-hbar ${r.v < 0 ? 'neg' : 'pos'}" style="--i:${k}" x="${x.toFixed(1)}" y="${y}" width="${Math.max(2, w).toFixed(1)}" height="22" rx="3"/>`;
      g += `<text class="fx-t fx-val" x="${(r.v < 0 ? x - 6 : x + w + 6).toFixed(1)}" y="${y + 16}" text-anchor="${r.v < 0 ? 'end' : 'start'}">${fmtR(r.v)}</text>`;
    });
    g += `<line class="fx-zero" x1="${z}" x2="${z}" y1="${m.t - 6}" y2="${Ht - m.b}"/>`;
    return svg(W, Ht, opts.label, g);
    function lines(t, x, y) { const ls = wrapLines(t, 30); return ls.map((l, i) => `<text class="fx-t fx-strong" x="${x}" y="${y + (i - (ls.length - 1) / 2) * 14}" text-anchor="end">${esc(l)}</text>`).join(''); }
  }
  function figH3Bars() {
    return { svg: hbars([
      { label: 'All pairs (Pearson r)', v: REF.baseline.H3.pearson_r },
      { label: 'Without Angola (Pearson r)', v: -0.060 },
      { label: 'All pairs, ranks (Spearman ρ)', v: REF.baseline.H3.spearman_rho },
    ], { min: -0.25, max: 0.05, ticks: [-0.2, -0.1, 0], weak: true, label: 'Correlations for H3' }), note: 'Pearson r follows the size of each value, so one extreme year matters a lot; Spearman ρ only uses the ranks.' };
  }
  function figH4Tug(order) {
    const n = k => order.indexOf(k) + 1, W = 640, Ht = 270, mid = 320, ry = 138;
    const r = REF.baseline.H4.pearson_r, sx = v => mid + v * 400;
    let g = `<defs><marker id="arr2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" class="fx-arrowhead"/></marker></defs>`;
    g += `<line class="fx-rope" x1="60" x2="580" y1="${ry}" y2="${ry}"/>`;
    g += `<path class="fx-pull neg draw" pathLength="1" d="M${mid - 40} ${ry - 30}L90 ${ry - 30}" marker-end="url(#arr2)"/>`;
    g += `<path class="fx-pull pos draw" pathLength="1" d="M${mid + 40} ${ry - 30}L550 ${ry - 30}" marker-end="url(#arr2)"/>`;
    const block = (x, anchor, lines) => lines.map((l, i) => `<text class="fx-t ${i ? 'fx-desc' : 'fx-strong'}" x="${x}" y="${28 + i * 18}" text-anchor="${anchor}">${esc(l)}</text>`).join('');
    g += block(40, 'start', ['Similar incomes, similar demand', 'more trade between similar countries', `Linder [${n('linder')}]`]);
    g += block(600, 'end', ['Different countries, different goods', 'more trade across sectors', `Hallak [${n('hallak')}]`]);
    g += `<text class="fx-t fx-note" x="90" y="${ry + 26}">pulls r below 0</text><text class="fx-t fx-note" x="550" y="${ry + 26}" text-anchor="end">pulls r above 0</text>`;
    for (const v of [-0.5, 0, 0.5]) g += `<line class="fx-grid" x1="${sx(v)}" x2="${sx(v)}" y1="${ry + 44}" y2="${ry + 54}"/>` + axisText(sx(v), ry + 70, v === 0 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1));
    g += `<line class="fx-axis" x1="${sx(-0.5)}" x2="${sx(0.5)}" y1="${ry + 49}" y2="${ry + 49}"/>`;
    g += `<g class="fx-knot"><circle cx="${sx(r)}" cy="${ry}" r="11"/><circle class="fx-knot-dot" cx="${sx(r)}" cy="${ry + 49}" r="5"/></g>`;
    g += `<text class="fx-t fx-center-t" x="${sx(r)}" y="${ry + 100}" text-anchor="middle">Net result in total imports: r = ${fmtR(r)}</text>`;
    return { svg: svg(W, Ht, 'Linder effect and trade across sectors cancel out', g), note: 'Schematic. The two forces are described in the cited studies; their net effect is the H4 result.' };
  }
  function figH4Bars() {
    return { svg: hbars([
      { label: 'Distance and trade ties (E5)', v: REF.baseline.E5.pearson_r },
      { label: 'Wealth gap and trade ties, all pairs (H4)', v: REF.baseline.H4.pearson_r },
      { label: 'Wealth gap, North–South America pairs', v: 0.335 },
      { label: '… without the USA', v: 0.033 },
    ], { min: -0.36, max: 0.45, ticks: [-0.2, 0, 0.2, 0.4], weak: true, label: 'Correlations with mutual import share' }), note: 'All values: correlation with the mutual import share of a country pair. Data: COW Trade 4.0, PWT 11.0, CEPII GeoDist.' };
  }

  /* ---- live values in the card texts ---- */
  function liveValues() {
    const out = {}, H = getHyp('H1'), d = H.d;
    const agg = new Map();
    for (const i of H.rows) { let a = agg.get(d.e[i]); if (!a) agg.set(d.e[i], a = [0, 0, 0]); a[0]++; a[1] += H.X[i]; a[2] += H.Y[i]; }
    const means = [...agg].map(([e, a]) => ({ e, x: a[1] / a[0], y: a[2] / a[0] }));
    const medX = median(means.map(o => o.x)), medY = median(means.map(o => o.y));
    const rich = means.filter(o => o.x > medX).sort((a, b) => b.y - a.y).slice(0, 6);
    out.h1rich = rich.map(o => `${entName(o.e)} ${o.y.toFixed(1)}`).join(', ') + ` per 1,000 (median of all countries: ${medY.toFixed(1)})`;
    const warry = rich.filter(o => ENT[o.e].freq && ENT[o.e].freq.aboveMean).length;
    out.h1war = `${warry} of these ${rich.length} spent an above-average share of years at war in the COW data (1950–2007).`;
    const gulf = ['ARE', 'QAT', 'OMN', 'BHR', 'KWT', 'SAU'].map(iso => means.find(o => o.e === ISO_INDEX[iso])).filter(Boolean);
    out.h1gulf = `Gulf oil states: ${gulf.map(o => `${entName(o.e)} ${o.y.toFixed(1)}`).join(', ')} per 1,000, all above the median of ${medY.toFixed(1)}, at ${usdK(Math.min(...gulf.map(o => o.x)))}–${usdK(Math.max(...gulf.map(o => o.x)))} per worker.`;
    out.h1paths = ['USA', 'GBR', 'FRA', 'KOR', 'TWN'].map(iso => {
      const e = ISO_INDEX[iso], rows = Array.from(H.rows).filter(i => d.e[i] === e);
      return `${entName(e)} r = ${fmtR2(S.pearson(rows.map(i => H.X[i]), rows.map(i => H.Y[i])).r)}`;
    }).join(', ');
    const us = Array.from(H.rows).filter(i => d.e[i] === ISO_INDEX.USA), at = y => { const i = us.find(r => d.year[r] === y); return i === undefined ? '–' : H.Y[i].toFixed(1); };
    out.h1usa = `US personnel per 1,000: ${at(1952)} in 1952, ${at(1968)} in 1968, ${at(1973)} in 1973, ${at(1991)} in 1991, ${at(2014)} in 2014.`;
    const rows = h2Rows();
    const by = new Map(); for (const r of rows) { if (!by.has(r.e)) by.set(r.e, []); by.get(r.e).push(r.x); }
    const top = [...by].map(([e, v]) => ({ e, x: avg(v) })).sort((a, b) => b.x - a.x).slice(0, 6);
    out.h2top = top.map(o => entName(o.e)).join(', ') + ` (average index ${top[top.length - 1].x.toFixed(2)}–${top[0].x.toFixed(2)}; 1 would mean a single partner)`;
    const sorted = rows.slice().sort((a, b) => a.x - b.x), q1 = sorted.slice(0, sorted.length >> 2), q4 = sorted.slice(sorted.length - (sorted.length >> 2));
    out.h2q = `Median personnel per 1,000: ${median(q1.map(r => r.y)).toFixed(1)} in the least concentrated quarter of country-years, ${median(q4.map(r => r.y)).toFixed(1)} in the most concentrated.`;
    const dec = k => median(rows.filter(r => Math.floor(r.year / 10) * 10 === k).map(r => r.x));
    out.h2dec = `Median import concentration: ${dec(1950).toFixed(2)} in the 1950s, ${dec(2000).toFixed(2)} in the 2000s.`;
    return out;
  }

  let figObs = null;
  function drawWhenVisible(fig) { // figures animate (lines draw, bars grow) once they scroll into view
    if (reduceMotion() || !('IntersectionObserver' in window)) { fig.classList.add('drawn'); return; }
    if (!figObs) figObs = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) { figObs.unobserve(en.target); requestAnimationFrame(() => en.target.classList.add('drawn')); }
    }, { threshold: 0.35 });
    figObs.observe(fig);
  }
  function fillFigure(fig, order) {
    const f = FIGS[fig.dataset.fig], out = f.build(order);
    $('.why-fig-body', fig).innerHTML = out.svg + (out.after || '');
    $('.why-fig-note', fig).textContent = out.note || '';
    fig.classList.remove('is-loading');
    drawWhenVisible(fig);
  }

  function renderExplain(token) {
    const target = token === 'why' ? null : token;
    if (current.view === 'why') { scrollToWhy(target, true); return; }
    current = { view: 'why', H: null };
    renderNav('why');
    enterView();
    const T = C.EXPLAIN_TYPES;
    app.innerHTML = `
    <section class="why-hero wrap">
      <div class="why-hero-text">
        <p class="kicker">Explanations · main hypotheses H1–H4</p>
        <h1>Why the results look the way they do</h1>
        <p class="lead">Each main hypothesis met a result that was weaker than expected or pointed the other way. Research, geopolitics and history offer explanations, and every claim below links to its source.</p>
        <p class="why-caveat"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v5M10 13.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <span>These explanations fit our numbers, but this project does not test them. A correlation does not show a cause.</span></p>
      </div>
      <ul class="why-types">${Object.entries(T).map(([k, t]) => `<li class="t-${k}">${typeIcon(k)}<b>${t.label}</b><span>${t.note}</span></li>`).join('')}</ul>
    </section>
    <nav class="why-tabs" aria-label="Hypotheses"><div class="wrap">${C.EXPLAIN.map(X => {
      const cfg = HYP[X.id], r = REF.baseline[X.id].pearson_r;
      return `<a href="#why-${X.token}" data-why="${X.token}"><span class="hyp-id">${X.id}</span><span class="why-tab-t">${esc(cfg.title)}</span><span class="why-tab-r ${r < 0 ? 'neg-t' : 'pos-t'}">${fmtR2(r)}</span></a>`;
    }).join('')}<a href="#overview" class="why-tab-back">← Overview</a></div></nav>
    ${C.EXPLAIN.map(X => whySection(X)).join('')}
    <section class="wrap section why-end">
      <p class="note">References were checked against the publishers (DOI) or the issuing institution. The numbers come from this project’s data and match the notebook (see <a href="#methods">Methods</a>).</p>
    </section>`;
    setupReveal();
    $$('.why-fig', app).forEach(fig => {
      const X = C.EXPLAIN.find(x => x.figures.includes(fig.dataset.fig)), order = refNumbers(X), f = FIGS[fig.dataset.fig];
      if (!f.data) fillFigure(fig, order);
    });
    // figures and values that need the country-year data
    Promise.all(['H1', 'H2'].map(loadScript)).then(() => {
      if (current.view !== 'why') return;
      $$('.why-fig.is-loading', app).forEach(fig => fillFigure(fig, refNumbers(C.EXPLAIN.find(x => x.figures.includes(fig.dataset.fig)))));
      const live = liveValues();
      $$('[data-live]', app).forEach(el => { el.textContent = live[el.dataset.live] || ''; el.classList.add('is-set'); });
    }).catch(err => { $$('.why-fig.is-loading .why-fig-body', app).forEach(b => { b.innerHTML = `<p class="error">${esc(err.message)}</p>`; }); });
    bindExplain();
    scrollToWhy(target, false);
  }
  function whySection(X) {
    const cfg = HYP[X.id], order = refNumbers(X), T = C.EXPLAIN_TYPES;
    const lo = -0.6, hi = 0.6, pos = v => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100, exp = cfg.expected === 'negative' ? -1 : 1;
    const found = X.found.map(([label, spec]) => {
      const v = foundValue(spec);
      return `<div class="wf-row"><span class="wf-label">${esc(label)}</span>
        <span class="wf-track"><span class="wf-band" style="left:${pos(-0.1)}%;width:${pos(0.1) - pos(-0.1)}%"></span><span class="wf-zero" style="left:50%"></span>
          <span class="wf-dot ${v < 0 ? 'neg' : 'pos'}" style="left:50%" data-left="${pos(v)}"></span></span>
        <span class="wf-val ${v < 0 ? 'neg-t' : 'pos-t'}">${fmtR(v)}</span></div>`;
    }).join('');
    return `<section class="wrap section why-hyp" id="why-${X.token}" data-why="${X.token}">
      <div class="why-head">
        <div class="why-title">
          <p class="kicker">Main hypothesis · ${H_KIND[X.id]}</p>
          <h2><span class="hyp-id">${X.id}</span> ${esc(cfg.title)}</h2>
          <p class="why-expected"><span>Expected</span>${esc(X.expected)}</p>
          <p>${verdictChip(cfg)} <span class="muted">${S.strength(REF.baseline[X.id].pearson_r)} · n = ${fInt.format(REF.baseline[X.id].n)}</span></p>
        </div>
        <div class="why-found" aria-label="What we found">
          <div class="wf-head"><span>What we found</span><span class="wf-scale"><span>−0.6</span><span>0</span><span>+0.6</span></span><span></span></div>
          ${found}
          <p class="wf-foot"><span class="wf-band-key"></span>|r| below 0.1 is not interpreted · expected sign: ${exp < 0 ? '−' : '+'}</p>
        </div>
      </div>
      <div class="why-answer"><span class="why-answer-label">In short</span><p>${esc(X.answer)}</p></div>
      <div class="why-figs">${X.figures.map(k => `<figure class="why-fig ${FIGS[k].data ? 'is-loading' : ''}" data-fig="${k}">
        <figcaption>${esc(FIGS[k].title)}</figcaption>
        <div class="why-fig-body">${FIGS[k].data ? '<div class="fig-skeleton" aria-hidden="true"></div>' : ''}</div>
        <p class="why-fig-note"></p></figure>`).join('')}</div>
      <div class="why-cards">${X.cards.map((c, k) => `<article class="why-card t-${c.type}" style="--i:${k}">
        <div class="why-tag">${typeIcon(c.type)}${T[c.type].label}</div>
        <h3>${esc(c.title)}</h3>
        <p>${richText(c.text, X, order)}</p>
        <div class="why-evidence"><span>In our data</span><p>${richText(c.evidence, X, order)}</p></div>
        <a class="why-link" href="#${c.link[0]}">${esc(c.link[1])} <span aria-hidden="true">→</span></a>
      </article>`).join('')}</div>
      <div class="why-refs">
        <h3>Sources</h3>
        <ol>${order.map(k => { const R = C.REFS[k], href = R.doi ? 'https://doi.org/' + R.doi : R.url;
          return `<li id="ref-${X.id}-${k}">${esc(R.cite)} <a href="${esc(href)}" target="_blank" rel="noopener">${R.doi ? 'doi:' + esc(R.doi) : esc(href.replace(/^https?:\/\//, ''))}</a></li>`; }).join('')}</ol>
      </div>
      <div class="why-foot"><a class="btn btn-accent" href="#${X.token}">Explore ${X.id} live</a><a class="btn" href="#why">Back to top</a></div>
    </section>`;
  }
  const H_KIND = { H1: 'country-years', H2: 'country-years', H3: 'country pairs', H4: 'country pairs' };
  let whyObs = null, whyBound = false;
  function bindExplain() {
    if (!whyBound) { // the page container stays, so its listeners are added once
      whyBound = true;
      app.addEventListener('mouseover', whyHover);
      app.addEventListener('mouseout', whyOut);
      app.addEventListener('click', whyClick);
    }
    // the tab of the section in view is marked
    if (whyObs) whyObs.disconnect();
    if ('IntersectionObserver' in window) {
      whyObs = new IntersectionObserver(entries => {
        for (const en of entries) if (en.isIntersecting) $$('.why-tabs a[data-why]').forEach(a => a.classList.toggle('is-cur', a.dataset.why === en.target.dataset.why));
      }, { rootMargin: '-45% 0px -50% 0px' });
      $$('.why-hyp', app).forEach(s => whyObs.observe(s));
    }
  }
  function whyHover(e) { const b = e.target.closest && e.target.closest('.ref'); if (b && current.view === 'why') showTooltip(e, esc(b.dataset.cite)); }
  function whyOut(e) { if (e.target.closest && e.target.closest('.ref')) hideTooltip(); }
  function whyClick(e) {
    if (current.view !== 'why') return;
    const b = e.target.closest('.ref');
    if (b) {
      const li = document.getElementById('ref-' + b.dataset.ref);
      if (li) { li.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' }); li.classList.remove('is-flash'); void li.offsetWidth; li.classList.add('is-flash'); }
      return;
    }
    const a = e.target.closest('a[href^="#why"]'); // jumps within the page do not re-render it
    if (a) { e.preventDefault(); const t = a.getAttribute('href').slice(1); setHash(t); scrollToWhy(t === 'why' ? null : t, true); }
  }
  function scrollToWhy(target, smooth) {
    if (!target) { if (!smooth) window.scrollTo(0, 0); else window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
    const el = document.getElementById(target);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: smooth && !reduceMotion() ? 'smooth' : 'auto', block: 'start' }));
  }

  /* ---------- tooltip ---------- */
  const tip = $('#tooltip');
  function showTooltip(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  function hideTooltip() { tip.hidden = true; }

  /* ---------- tour ---------- */
  let tourIndex = -1;
  function tourGo(k) {
    tourIndex = Math.max(0, Math.min(C.TOUR.length - 1, k));
    const step = C.TOUR[tourIndex];
    $('#tourbar').hidden = false; document.body.classList.add('touring');
    const text = $('#tourbar .tour-text');
    if (!reduceMotion()) { text.classList.remove('is-swap'); void text.offsetWidth; text.classList.add('is-swap'); }
    $('#tour-kicker').textContent = step.kicker;
    $('#tour-caption').textContent = step.text;
    $('#tour-count').textContent = (tourIndex + 1) + ' / ' + C.TOUR.length;
    $('#tour-prev').disabled = tourIndex === 0;
    $('#tour-next').disabled = tourIndex === C.TOUR.length - 1;
    $('#tour-progress').style.setProperty('--p', ((tourIndex + 1) / C.TOUR.length * 100) + '%');
    const token = step.anchor || step.view;
    try { if (location.hash.slice(1) !== token) history.pushState(null, '', '#' + token); } catch (err) { /* sandboxed frame */ }
    route(token, { reset: true });
  }
  function tourEnd() { tourIndex = -1; $('#tourbar').hidden = true; document.body.classList.remove('touring'); }
  $('#tour-start').addEventListener('click', () => tourGo(tourIndex >= 0 ? tourIndex : 0));
  $('#tour-next').addEventListener('click', () => tourGo(tourIndex + 1));
  $('#tour-prev').addEventListener('click', () => tourGo(tourIndex - 1));
  $('#tour-end').addEventListener('click', tourEnd);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ui.expanded) { setExpanded(false); return; }
    if (e.key === 'Escape' && tourIndex < 0 && current.view === 'explorer' && ex && ex.st.select && !['input', 'select', 'textarea'].includes((e.target.tagName || '').toLowerCase())) { ex.st.select = null; refreshView(); return; }
    if (tourIndex < 0 || e.altKey || e.metaKey || e.ctrlKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); tourGo(tourIndex + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); tourGo(tourIndex - 1); }
    else if (e.key === 'Escape') tourEnd();
  });

  /* ---------- theme ---------- */
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (err) { /* storage unavailable */ }
    if (current.view === 'explorer') redraw({ animate: false });
  }
  try { const saved = localStorage.getItem('theme'); if (saved) document.documentElement.setAttribute('data-theme', saved); } catch (err) { /* storage unavailable */ }
  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (current.view === 'explorer') redraw({ animate: false }); });
  const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', $('#topbar').offsetHeight + 'px');
  syncTopbar();
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { syncTopbar(); placeNavInk(false); if (current.view === 'explorer') redraw({ animate: false }); }, 120); });

  route(location.hash.slice(1));
})();
