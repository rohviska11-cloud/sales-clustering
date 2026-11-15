/* =====================================================================
   Sales Time Series Analytics — front-end (vanilla JS + ECharts)
   Semua hasil clustering sudah dihitung oleh build/build_data.py.
   ===================================================================== */
"use strict";

const PALETTE = ["#2A817A", "#C49A52", "#3E5C8A", "#B77B5D", "#7FA88F", "#8A6A9B", "#5B8DB8", "#A3A25A", "#C2737F", "#4E9C9C"];
const NOISE = "#B9BEC7";
const REP_LABEL = { Original: "Data asli", MinMax: "MinMax", Scaled: "Scaled" };
const ALGO_SHORT = { "K-Means DBA": "DBA", "K-Medoids PAM": "PAM", "Hierarchical Average": "HC", "Hierarchical Complete": "HC", DBSCAN: "DBSCAN" };
const color = (c) => (c < 0 ? NOISE : PALETTE[c % PALETTE.length]);

const S = {
  base: null, manifest: null, ranking: [], X: {}, mcache: new Map(),
  sel: { rep: "Original", dist: "DTW", radius: "2", g: "0.05", algo: "PAM", link: "average", k: 3, ms: "10", pct: "90" },
  vs: { rep: "Original", key: "DTW_Original", k: 3 },
  cur: null, activeCluster: 0, product: null, picked: [], hmRep: "all",
};

/* ------------------------------------------------------------------ helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (v, d = 0) => (v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${fmt(v, d)}%`);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const std = (a, ddof = 0) => { const m = mean(a); return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / Math.max(a.length - ddof, 1)); };
const quantile = (arr, q) => { const a = [...arr].sort((x, y) => x - y); const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return a[lo] + (a[hi] - a[lo]) * (p - lo); };
const median = (a) => quantile(a, 0.5);
const argmax = (a) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
const argmin = (a) => a.reduce((b, v, i) => (v < a[b] ? i : b), 0);
const gStr = (v) => (Number.isInteger(+v) ? (+v).toFixed(1) : String(+v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600); }
function downloadCSV(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const q = (v) => (v == null ? "" : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function variantLabel(dist, param) {
  if (dist === "CDTW") return `CDTW · R${param}`;
  if (dist === "WDTW") return `WDTW · g=${gStr(param)}`;
  return dist;
}
function matrixKey(rep, dist, radius, g) {
  if (dist === "CDTW") return `CDTW_${rep}_R${radius}`;
  if (dist === "WDTW") return `WDTW_${rep}_g${gStr(g)}`;
  return `${dist}_${rep}`;
}

/* ------------------------------------------------------------------ ECharts plumbing */
const charts = {};
const ro = new ResizeObserver((es) => es.forEach((e) => charts[e.target.id] && charts[e.target.id].resize()));
function ec(id) {
  if (!charts[id]) { const el = document.getElementById(id); charts[id] = echarts.init(el, null, { renderer: "canvas" }); ro.observe(el); }
  return charts[id];
}
const seen = new Set(), pending = new Map();
const lazyObs = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  const id = e.target.id; seen.add(id); lazyObs.unobserve(e.target);
  const fn = pending.get(id); if (fn) { pending.delete(id); fn(); }
}), { rootMargin: "0px 0px -40px 0px" });
function draw(id, optFn) {
  const run = () => { const c = ec(id); c.setOption(optFn(), true); return c; };
  if (seen.has(id)) return run();
  if (!pending.has(id)) lazyObs.observe(document.getElementById(id));
  pending.set(id, run);
}
const TIP = { backgroundColor: "rgba(20,33,61,.95)", borderWidth: 0, padding: [9, 13], textStyle: { color: "#F6F2EA", fontSize: 12 }, extraCssText: "border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.25)" };
const AX = {
  axisLine: { lineStyle: { color: "#D9D1C2" } }, axisTick: { show: false },
  axisLabel: { color: "#6A7487", fontSize: 11 }, splitLine: { lineStyle: { color: "#EFE9DD" } },
  nameTextStyle: { color: "#6A7487", fontSize: 11 },
};
const base = (o) => ({ textStyle: { fontFamily: "Plus Jakarta Sans, Segoe UI, sans-serif" }, animationDuration: 900, animationEasing: "cubicOut", tooltip: { ...TIP, ...(o.tooltip || {}) }, ...o, tooltip: { ...TIP, ...(o.tooltip || {}) } });
const grad = (c, a1 = 0.35, a2 = 0.02) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: hexA(c, a1) }, { offset: 1, color: hexA(c, a2) }]);
function hexA(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

/* ------------------------------------------------------------------ segmented controls */
function seg(id, onChange) {
  const el = document.getElementById(id);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled || b.classList.contains("on")) return;
    $$("button", el).forEach((x) => x.classList.toggle("on", x === b)); onChange(b.dataset.v);
  });
}
function setSeg(id, v) { $$(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(v))); }
function sliderFill(el) { el.style.setProperty("--p", `${((el.value - el.min) / (el.max - el.min)) * 100}%`); }

/* ------------------------------------------------------------------ boot */
async function boot() {
  try {
    const [b, m, r] = await Promise.all(["data/base.json", "data/manifest.json", "data/ranking.json"].map((u) => fetch(u).then((x) => { if (!x.ok) throw new Error(`${u}: ${x.status}`); return x.json(); })));
    S.base = b; S.manifest = m; S.ranking = r;
  } catch (err) {
    $("#loader p").innerHTML = `Data gagal dimuat (${esc(err.message)}).<br><small>Buka lewat server lokal, mis. <code>python -m http.server</code>, bukan dengan klik ganda file.</small>`;
    return;
  }
  prepareData();
  uiChrome();
  heroLines();
  renderEDA();
  initClusterControls();
  initRecommend();
  $("#buildInfo").textContent = `Data dibangun ${S.manifest.built} · ${fmt(S.manifest.n_models)} model · K-Medoids: ${S.manifest.kmedoids_impl}`;
  setTimeout(() => $("#loader").classList.add("done"), 250);
  renderCluster();
}

function prepareData() {
  const raw = S.base.raw, n = raw.length, T = raw[0].length;
  S.n = n; S.T = T; S.codes = S.base.codes; S.weeks = S.base.weeks;
  S.codeIdx = new Map(S.codes.map((c, i) => [c, i]));
  const mu = [], sd = [];
  for (let t = 0; t < T; t++) { const col = raw.map((r) => r[t]); mu.push(mean(col)); sd.push(std(col)); }
  S.X.Original = raw;
  S.X.MinMax = S.base.minmax;
  S.X.Scaled = raw.map((r) => r.map((v, t) => (sd[t] ? (v - mu[t]) / sd[t] : 0)));
  S.pTotal = raw.map(sum);
  S.pMean = raw.map(mean);
  S.pSd = raw.map((r) => std(r));
  S.pCV = S.pMean.map((m, i) => (m ? S.pSd[i] / m : 0));
  S.grand = sum(S.pTotal);
  S.q33 = quantile(S.pMean, 1 / 3); S.q67 = quantile(S.pMean, 2 / 3);
}

/* ------------------------------------------------------------------ page chrome */
function uiChrome() {
  const nav = $("#nav"), prog = $("#progress"), top = $("#toTop");
  const onScroll = () => {
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    nav.classList.toggle("scrolled", y > 40); prog.style.width = `${(y / h) * 100}%`; top.classList.toggle("show", y > 700);
  };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();
  top.onclick = () => scrollTo({ top: 0, behavior: "smooth" });
  $("#navToggle").onclick = () => $("#navLinks").classList.toggle("open");
  $$("#navLinks a").forEach((a) => (a.onclick = () => $("#navLinks").classList.remove("open")));

  const spy = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) $$("[data-spy]").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${e.target.id}`));
  }), { rootMargin: "-45% 0px -50% 0px" });
  $$("main section").forEach((s) => spy.observe(s));

  const rev = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); rev.unobserve(e.target); } }), { threshold: 0.08 });
  $$(".reveal").forEach((el) => rev.observe(el));

  $("#hsProducts").dataset.count = S.n; $("#hsWeeks").dataset.count = S.T;
  $("#hsMatrices").dataset.count = S.manifest.matrices.length; $("#hsModels").dataset.count = S.manifest.n_models;
  $$("[data-count]").forEach((el) => countUp(el, +el.dataset.count, 1600));
}
function countUp(el, target, dur = 1200, dec = 0, suffix = "") {
  const t0 = performance.now();
  const step = (t) => { const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 4); el.textContent = fmt(target * e, dec) + suffix; if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function heroLines() {
  const svg = $("#heroLines"), W = 1200, H = 500;
  const order = [...S.pTotal.keys()].sort((a, b) => S.pTotal[b] - S.pTotal[a]);
  const picks = [order[0], order[6], order[25], order[60], order[140]].filter((i) => i != null);
  const cols = ["#E2C28A", "#3FA79D", "#F6F2EA", "#C49A52", "#7FA88F"];
  svg.innerHTML = picks.map((idx, j) => {
    const r = S.base.raw[idx]; const sm = r.map((_, t) => mean(r.slice(Math.max(0, t - 2), t + 3)));
    const lo = Math.min(...sm), hi = Math.max(...sm) || 1;
    const band = H * 0.42, off = 40 + j * 62;
    const pts = sm.map((v, t) => [(t / (sm.length - 1)) * W, off + band - ((v - lo) / (hi - lo || 1)) * band]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
    return `<path d="${d}" stroke="${cols[j]}" style="opacity:${0.85 - j * 0.12};animation-delay:${0.2 + j * 0.25}s"/>`;
  }).join("");
  $$("path", svg).forEach((p) => p.style.setProperty("--len", p.getTotalLength()));
}

/* ================================================================== 01 EDA */
function renderEDA() {
  const raw = S.base.raw, T = S.T, W = S.weeks;
  const wTotal = W.map((_, t) => sum(raw.map((r) => r[t])));
  const wMean = wTotal.map((v) => v / S.n);
  const zero = (sum(raw.map((r) => r.filter((v) => v === 0).length)) / (S.n * T)) * 100;
  const peak = argmax(wTotal), low = argmin(wTotal);

  countUp($("#kProducts"), S.n); countUp($("#kTotal"), S.grand);
  countUp($("#kAvg"), mean(S.pMean), 1200, 2); countUp($("#kZero"), zero, 1200, 1, "%");
  $("#mPeak").textContent = W[peak]; $("#mPeakV").textContent = `${fmt(wTotal[peak])} transaksi`;
  $("#mLow").textContent = W[low]; $("#mLowV").textContent = `${fmt(wTotal[low])} transaksi`;
  $("#mRange").textContent = fmt(wTotal[peak] - wTotal[low]);

  const trend = (mode) => draw("chTrend", () => {
    const data = mode === "total" ? wTotal : wMean, c = "#2A817A";
    return base({
      grid: { left: 54, right: 24, top: 30, bottom: 34 },
      tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v, mode === "total" ? 0 : 2) },
      xAxis: { type: "category", data: W, boundaryGap: false, ...AX, axisLabel: { ...AX.axisLabel, interval: 3 } },
      yAxis: { type: "value", scale: true, ...AX },
      series: [{
        type: "line", data, smooth: 0.35, symbol: "circle", symbolSize: 6, showSymbol: false,
        lineStyle: { width: 3, color: c }, itemStyle: { color: c }, areaStyle: { color: grad(c) },
        markPoint: { symbolSize: 46, label: { fontSize: 10, color: "#fff" }, data: [{ type: "max", name: "Puncak", itemStyle: { color: "#C49A52" } }, { type: "min", name: "Terendah", itemStyle: { color: "#3E5C8A" } }] },
        markLine: { silent: true, symbol: "none", lineStyle: { type: "dashed", color: "#C49A52" }, label: { formatter: "rata-rata", color: "#8A6220", fontSize: 10 }, data: [{ type: "average" }] },
      }],
    });
  });
  trend("total");
  seg("trendMode", trend);

  const order = [...S.pTotal.keys()].sort((a, b) => S.pTotal[b] - S.pTotal[a]);
  const top = order.slice(0, 10).reverse();
  draw("chTop", () => base({
    grid: { left: 56, right: 50, top: 8, bottom: 20 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => `${fmt(v)} transaksi` },
    xAxis: { type: "value", ...AX }, yAxis: { type: "category", data: top.map((i) => S.codes[i]), ...AX },
    series: [{
      type: "bar", data: top.map((i) => S.pTotal[i]), barWidth: "58%",
      itemStyle: { borderRadius: [0, 8, 8, 0], color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: "#2A817A" }, { offset: 1, color: "#C49A52" }]) },
      label: { show: true, position: "right", color: "#1B2A4A", fontWeight: 700, fontSize: 11, formatter: (p) => fmt(p.value) },
      animationDelay: (i) => i * 60,
    }],
  }));
  const bottom = [...order].reverse().slice(0, 10);
  $("#tblBottom").innerHTML = `<thead><tr><th>#</th><th>Product_Code</th><th>Total</th><th>Rata-rata/minggu</th><th>Minggu tanpa transaksi</th></tr></thead><tbody>${bottom.map((i, j) =>
    `<tr><td>${j + 1}</td><td><b>${S.codes[i]}</b></td><td>${fmt(S.pTotal[i])}</td><td>${fmt(S.pMean[i], 2)}</td><td>${S.base.raw[i].filter((v) => v === 0).length} / ${T}</td></tr>`).join("")}</tbody>`;

  const hist = (id, values, nb, c, xName) => draw(id, () => {
    const lo = Math.min(...values), hi = Math.max(...values), w = (hi - lo) / nb || 1;
    const counts = Array(nb).fill(0); values.forEach((v) => counts[Math.min(nb - 1, Math.floor((v - lo) / w))]++);
    const labels = counts.map((_, i) => `${fmt(lo + i * w, w < 1 ? 2 : 0)}–${fmt(lo + (i + 1) * w, w < 1 ? 2 : 0)}`);
    return base({
      grid: { left: 46, right: 16, top: 16, bottom: 46 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p) => `${xName}: <b>${p[0].name}</b><br>${p[0].value} produk` },
      xAxis: { type: "category", data: labels, ...AX, axisLabel: { ...AX.axisLabel, interval: Math.ceil(nb / 7) - 1, rotate: 0 }, name: xName, nameLocation: "middle", nameGap: 30 },
      yAxis: { type: "value", name: "produk", ...AX },
      series: [{ type: "bar", data: counts, barCategoryGap: "8%", itemStyle: { color: grad(c, 0.95, 0.55), borderRadius: [5, 5, 0, 0] }, animationDelay: (i) => i * 20 }],
    });
  });
  hist("chHist", S.pTotal, 35, "#C49A52", "Total transaksi");
  hist("chCV", S.pCV.filter((v) => isFinite(v)), 35, "#3E5C8A", "Koefisien variasi");

  const q90 = quantile(S.pCV, 0.9), q25 = quantile(S.pCV, 0.25);
  const noSales = S.pTotal.filter((v) => v === 0).length;
  const highVar = S.pCV.filter((v) => v >= q90).length, steady = S.pCV.filter((v) => v <= q25).length;
  $("#iNoSales").textContent = fmt(noSales); $("#iHighVar").textContent = fmt(highVar); $("#iSteady").textContent = fmt(steady);
  const top10share = (sum(order.slice(0, Math.round(S.n * 0.1)).map((i) => S.pTotal[i])) / S.grand) * 100;
  const h1 = mean(wTotal.slice(0, 26)), h2 = mean(wTotal.slice(26));
  $("#edaNarrative").innerHTML =
    `<b>Ringkasan temuan.</b> Permintaan agregat mencapai puncak pada <b>${W[peak]}</b> (${fmt(wTotal[peak])} transaksi) dan titik terendah pada <b>${W[low]}</b>. ` +
    `Paruh kedua tahun rata-rata ${h2 >= h1 ? "lebih tinggi" : "lebih rendah"} ${pct(Math.abs((h2 - h1) / h1) * 100)} dibanding paruh pertama. ` +
    `Sebanyak 10% produk teratas menyumbang <b>${pct(top10share)}</b> dari seluruh volume, menandakan ${top10share > 40 ? "konsentrasi penjualan yang cukup tinggi pada segelintir produk" : "penjualan yang relatif tersebar di banyak produk"}. ` +
    `Sekitar ${pct(zero)} sel produk–minggu bernilai nol; angka ini mencerminkan minggu tanpa penjualan, bukan data yang hilang.`;

  // product picker
  S.picked = order.slice(0, 3).map((i) => S.codes[i]);
  initPicker(); renderPicked();

  // descriptive table
  const rows = W.map((w, t) => { const col = raw.map((r) => r[t]); return [w, col.length, mean(col), std(col, 1), Math.min(...col), quantile(col, 0.25), quantile(col, 0.5), quantile(col, 0.75), Math.max(...col)]; });
  $("#tblDesc").innerHTML = `<thead><tr>${["Minggu", "count", "mean", "std", "min", "25%", "50%", "75%", "max"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) =>
    `<tr><td><b>${r[0]}</b></td>${r.slice(1).map((v, i) => `<td>${fmt(v, i === 0 ? 0 : 2)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function initPicker() {
  const inp = $("#prodSearch"), box = $("#prodSuggest");
  let hl = 0, items = [];
  const show = () => {
    const q = inp.value.trim().toLowerCase();
    items = S.codes.map((c, i) => [c, i]).filter(([c]) => !S.picked.includes(c) && (!q || c.toLowerCase().includes(q)))
      .sort((a, b) => (q ? (a[0].toLowerCase().startsWith(q) ? -1 : 0) - (b[0].toLowerCase().startsWith(q) ? -1 : 0) || a[0].length - b[0].length : S.pTotal[b[1]] - S.pTotal[a[1]])).slice(0, 30);
    hl = 0;
    box.innerHTML = items.map(([c, i], j) => `<div data-c="${c}" class="${j === 0 ? "hl" : ""}"><b>${c}</b><small>${fmt(S.pTotal[i])} transaksi</small></div>`).join("") || `<div><small>Tidak ditemukan</small></div>`;
    box.classList.add("show");
  };
  const pick = (c) => {
    if (!c) return;
    if (S.picked.length >= 8) { toast("Maksimal 8 produk. Hapus salah satu terlebih dahulu."); return; }
    S.picked.push(c); inp.value = ""; box.classList.remove("show"); renderPicked();
  };
  inp.addEventListener("focus", show); inp.addEventListener("input", show);
  inp.addEventListener("keydown", (e) => {
    const els = $$("div[data-c]", box);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); hl = (hl + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length; els.forEach((x, j) => x.classList.toggle("hl", j === hl)); els[hl]?.scrollIntoView({ block: "nearest" }); }
    if (e.key === "Enter") { e.preventDefault(); pick(els[hl]?.dataset.c); }
    if (e.key === "Escape") box.classList.remove("show");
  });
  box.addEventListener("mousedown", (e) => { const d = e.target.closest("[data-c]"); if (d) { e.preventDefault(); pick(d.dataset.c); } });
  inp.addEventListener("blur", () => setTimeout(() => box.classList.remove("show"), 120));
  $("#prodChips").addEventListener("click", (e) => { const b = e.target.closest("button[data-x]"); if (b) { S.picked = S.picked.filter((c) => c !== b.dataset.x); renderPicked(); } });
}
function renderPicked() {
  $("#prodChips").innerHTML = S.picked.map((c, j) => `<span class="chip"><i style="background:${PALETTE[j % 10]}"></i>${c}<button data-x="${c}" aria-label="hapus">×</button></span>`).join("");
  draw("chProducts", () => base({
    color: PALETTE,
    grid: { left: 48, right: 20, top: 40, bottom: 34 },
    legend: { top: 0, icon: "roundRect", itemWidth: 14, itemHeight: 6, textStyle: { color: "#3D475A" } },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: S.weeks, boundaryGap: false, ...AX, axisLabel: { ...AX.axisLabel, interval: 3 } },
    yAxis: { type: "value", name: "Transaksi", ...AX },
    series: S.picked.map((c) => ({ name: c, type: "line", smooth: 0.3, showSymbol: false, lineStyle: { width: 2.5 }, emphasis: { focus: "series" }, data: S.base.raw[S.codeIdx.get(c)] })),
  }));
}

/* ================================================================== 02 CLUSTERING */
function initClusterControls() {
  const s = S.sel;
  if (!S.manifest.dba) { const b = $('#cAlgo button[data-v="DBA"]'); b.disabled = true; b.title = "Belum digenerate (jalankan build dengan tslearn)"; }
  seg("cRep", (v) => { s.rep = v; renderCluster(); });
  seg("cDist", (v) => { s.dist = v; syncControls(); renderCluster(); });
  seg("cRadius", (v) => { s.radius = v; renderCluster(); });
  seg("cG", (v) => { s.g = v; renderCluster(); });
  seg("cAlgo", (v) => { s.algo = v; syncControls(); renderCluster(); });
  seg("cLink", (v) => { s.link = v; renderCluster(); });
  seg("cMs", (v) => { s.ms = v; renderCluster(); });
  seg("cPct", (v) => { s.pct = v; renderCluster(); });
  const k = $("#cK"); sliderFill(k);
  k.addEventListener("input", () => { s.k = +k.value; $("#kVal").textContent = k.value; sliderFill(k); clearTimeout(k._t); k._t = setTimeout(renderCluster, 120); });
  $("#memberSearch").addEventListener("input", renderMembers);
  $("#dlLabels").onclick = () => {
    const c = S.cur; if (!c) return;
    downloadCSV(`cluster_labels_${c.key}_${c.id}.csv`, S.codes.map((code, i) => ({ Product_Code: code, Cluster: c.run.labels[i] < 0 ? "Noise" : `Cluster ${c.run.labels[i] + 1}`, Cluster_ID: c.run.labels[i], Karakter: c.run.labels[i] < 0 ? "" : c.profiles[c.run.labels[i]].persona })));
  };
  syncControls();
}
function syncControls() {
  const s = S.sel;
  $("#wRadius").hidden = s.dist !== "CDTW"; $("#wG").hidden = s.dist !== "WDTW";
  $("#wLink").hidden = s.algo !== "HC"; $("#wK").hidden = s.algo === "DBSCAN";
  $("#wMs").hidden = s.algo !== "DBSCAN"; $("#wPct").hidden = s.algo !== "DBSCAN";
  const dbaBtn = $('#cAlgo button[data-v="DBA"]');
  if (S.manifest.dba) { dbaBtn.disabled = s.dist === "WDTW"; dbaBtn.title = s.dist === "WDTW" ? "tslearn tidak menyediakan barycenter WDTW" : ""; }
  if (s.algo === "DBA" && dbaBtn.disabled) { s.algo = "PAM"; setSeg("cAlgo", "PAM"); $("#wLink").hidden = true; $("#wK").hidden = false; toast("K-Means DBA tidak tersedia untuk WDTW — beralih ke K-Medoids."); }
}
function runId(s) {
  if (s.algo === "DBA") return `DBA_k${s.k}`;
  if (s.algo === "PAM") return `PAM_k${s.k}`;
  if (s.algo === "HC") return `HC-${s.link}_k${s.k}`;
  return `DBSCAN_ms${s.ms}_p${s.pct}`;
}
async function loadMatrix(key) {
  if (!S.mcache.has(key)) S.mcache.set(key, fetch(`data/m/${key}.json`).then((r) => { if (!r.ok) throw new Error(`Matriks ${key} tidak ditemukan`); return r.json(); }));
  return S.mcache.get(key);
}

let renderToken = 0;
async function renderCluster() {
  const s = S.sel, key = matrixKey(s.rep, s.dist, s.radius, s.g), id = runId(s), tok = ++renderToken;
  const body = $("#clusterBody"); body.classList.add("loading-pane");
  let m;
  try { m = await loadMatrix(key); } catch (e) { body.classList.remove("loading-pane"); notice(e.message); return; }
  if (tok !== renderToken) return;
  body.classList.remove("loading-pane");
  const run = m.runs[id];
  if (!run) { notice(`Model ${id} belum tersedia pada matriks ${key}. Jalankan ulang build_data.py.`); return; }
  notice(null);
  const X = S.X[s.rep], L = run.labels, ncl = run.ncl;
  const members = Array.from({ length: ncl }, () => []); L.forEach((c, i) => c >= 0 && members[c].push(i));
  const profiles = members.map((mem, c) => profileCluster(mem, c));
  S.cur = { key, id, m, run, X, members, profiles };
  S.activeCluster = 0; S.product = null;

  // tag
  const algoName = { DBA: "K-Means DBA", PAM: "K-Medoids", HC: `Hierarchical · ${s.link}`, DBSCAN: "DBSCAN" }[s.algo];
  $("#modelTag").innerHTML = `<span>${algoName}</span><span>${variantLabel(m.dist, m.param)}</span><span>${REP_LABEL[s.rep]}</span>` +
    (s.algo === "DBSCAN" ? `<span class="alt">eps = ${fmt(run.eps, 4)} · min_samples = ${s.ms}</span>` : `<span class="alt">K = ${s.k}</span>`) +
    `<span class="alt">waktu komputasi ${fmt(run.t, 2)} dtk</span>`;

  renderMetrics(run, m);
  renderScatter(m, L);
  renderPie(members);
  renderSummary(run, members, profiles);
  renderCenters();
  renderClusterTabs();
  renderExplorer();
  renderPersonas();
}
function notice(msg) {
  const n = $("#clusterNotice"); n.hidden = !msg; n.textContent = msg || "";
  $("#clusterBody").style.display = msg ? "none" : "";
}
function renderMetrics(run, m) {
  const chiMax = Math.max(...Object.values(m.runs).map((r) => r.chi || 0)) || 1;
  const q = (v, a, b) => (v == null ? ["—", "bad"] : v >= b ? ["Kuat", "good"] : v >= a ? ["Cukup", "mid"] : ["Lemah", "bad"]);
  const [siT, siC] = q(run.si, 0.25, 0.5);
  const dbiT = run.dbi == null ? ["—", "bad"] : run.dbi <= 0.8 ? ["Baik", "good"] : run.dbi <= 1.5 ? ["Sedang", "mid"] : ["Tumpang tindih", "bad"];
  const [bsT, bsC] = run.bs >= 0.8 ? ["Merata", "good"] : run.bs >= 0.5 ? ["Cukup merata", "mid"] : ["Timpang", "bad"];
  const cards = [
    ["Silhouette", run.si == null ? "—" : fmt(run.si, 4), run.si == null ? 0 : Math.max(0, run.si), siT, siC],
    ["Davies–Bouldin", run.dbi == null ? "—" : fmt(run.dbi, 4), run.dbi == null ? 0 : 1 / (1 + run.dbi), dbiT[0], dbiT[1]],
    ["Calinski–Harabasz", run.chi == null ? "—" : fmt(run.chi, 1), (run.chi || 0) / chiMax, "relatif thd. model lain", "mid"],
    ["Balance Score", fmt(run.bs, 4), run.bs, bsT, bsC],
    ["Jumlah cluster", String(run.ncl), Math.min(run.ncl / 10, 1), `noise ${pct(run.noise, 2)}`, run.noise > 20 ? "bad" : "good"],
  ];
  $("#metricGrid").innerHTML = cards.map(([l, v, p, t, c]) => `<div class="metric"><span class="m-lbl">${l}</span><span class="m-val">${v}</span><div class="m-bar"><i data-w="${(p * 100).toFixed(1)}"></i></div><span class="badge ${c}">${t}</span></div>`).join("");
  requestAnimationFrame(() => requestAnimationFrame(() => $$("#metricGrid .m-bar i").forEach((i) => (i.style.width = `${i.dataset.w}%`))));
}
function renderScatter(m, L) {
  const groups = new Map(); L.forEach((c, i) => { if (!groups.has(c)) groups.set(c, []); groups.get(c).push([m.xy[i][0], m.xy[i][1], i]); });
  const keys = [...groups.keys()].sort((a, b) => a - b);
  const c = draw("chScatter", () => base({
    grid: { left: 36, right: 16, top: 36, bottom: 30 },
    legend: { top: 0, icon: "circle", itemWidth: 9, textStyle: { color: "#3D475A" } },
    tooltip: { trigger: "item", formatter: (p) => `<b>${S.codes[p.data[2]]}</b><br>${p.seriesName}<br>Total ${fmt(S.pTotal[p.data[2]])} transaksi` },
    xAxis: { type: "value", scale: true, ...AX, axisLabel: { show: false }, name: "Dimensi 1" , nameLocation: "middle", nameGap: 12},
    yAxis: { type: "value", scale: true, ...AX, axisLabel: { show: false }, name: "Dimensi 2", nameLocation: "middle", nameGap: 12 },
    series: keys.map((k) => ({
      name: k < 0 ? "Noise" : `Cluster ${k + 1}`, type: "scatter", data: groups.get(k), symbolSize: k < 0 ? 5 : 8,
      itemStyle: { color: color(k), opacity: k < 0 ? 0.55 : 0.82, borderColor: "#fff", borderWidth: 0.6 },
      emphasis: { focus: "series", itemStyle: { opacity: 1, borderWidth: 1.5 } },
      animationDelay: (i) => i * 1.2,
    })),
  }));
  const bind = (ch) => { ch.off("click"); ch.on("click", (p) => { const i = p.data[2], cl = S.cur.run.labels[i]; if (cl < 0) return; S.activeCluster = cl; S.product = i; renderClusterTabs(); renderExplorer(); $("#chCluster").scrollIntoView({ behavior: "smooth", block: "center" }); }); };
  if (c) bind(c); else pending.set("chScatter", ((fn) => () => bind(fn()))(pending.get("chScatter")));
}
function renderPie(members) {
  const noiseN = S.cur.run.labels.filter((v) => v < 0).length;
  const data = members.map((mem, c) => ({ name: `Cluster ${c + 1}`, value: mem.length, itemStyle: { color: color(c) } }));
  if (noiseN) data.push({ name: "Noise", value: noiseN, itemStyle: { color: NOISE } });
  draw("chPie", () => base({
    tooltip: { trigger: "item", formatter: (p) => `<b>${p.name}</b><br>${fmt(p.value)} produk · ${fmt(p.percent, 1)}%` },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, textStyle: { color: "#3D475A" } },
    series: [{
      type: "pie", radius: ["46%", "74%"], center: ["50%", "45%"], data, padAngle: 2,
      itemStyle: { borderRadius: 8, borderColor: "#FFFDF9", borderWidth: 2 },
      label: { formatter: (p) => `${fmt(p.percent, 1)}%`, color: "#1B2A4A", fontWeight: 700 },
      emphasis: { scale: true, scaleSize: 8 }, animationType: "scale", animationEasing: "elasticOut",
    }],
    graphic: [{ type: "text", left: "center", top: "39%", style: { text: fmt(S.n), fontSize: 26, fontWeight: 800, fill: "#14213D", textAlign: "center" } },
      { type: "text", left: "center", top: "48%", style: { text: "produk", fontSize: 12, fill: "#6A7487", textAlign: "center" } }],
  }));
}
function renderSummary(run, members, profiles) {
  const nn = sum(members.map((m) => m.length)), k = members.length;
  const rows = members.map((mem, c) => {
    const p = mem.length / nn, contrib = k > 1 ? (-(p * Math.log(p)) / Math.log(k)) : 0, rep = run.reps[c];
    return `<tr><td><span class="dot" style="background:${color(c)}"></span><b>Cluster ${c + 1}</b></td><td>${profiles[c].persona}</td><td>${fmt(mem.length)}</td><td>${pct((mem.length / S.n) * 100, 2)}</td><td>${pct(profiles[c].volShare, 1)}</td><td>${fmt(contrib, 4)}</td><td><b>${S.codes[rep]}</b></td><td>${fmt(S.pTotal[rep])}</td></tr>`;
  });
  const noiseN = run.labels.filter((v) => v < 0).length;
  if (noiseN) rows.push(`<tr><td><span class="dot" style="background:${NOISE}"></span><b>Noise</b></td><td>—</td><td>${fmt(noiseN)}</td><td>${pct((noiseN / S.n) * 100, 2)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`);
  $("#tblSummary").innerHTML = `<thead><tr><th>Cluster</th><th>Karakter</th><th>Jumlah produk</th><th>Proporsi</th><th>Pangsa volume</th><th>Kontribusi Balance</th><th>Produk representatif</th><th>Total transaksi rep.</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}
function centerProfile(c) {
  const { run, X, members } = S.cur, s = S.sel;
  if (s.algo === "DBA" && run.centers) return { y: run.centers[c], name: "Centroid DBA" };
  if (s.algo === "PAM") return { y: X[run.reps[c]], name: `Medoid ${S.codes[run.reps[c]]}` };
  return { y: S.weeks.map((_, t) => median(members[c].map((i) => X[i][t]))), name: "Median profil anggota" };
}
function renderCenters() {
  const s = S.sel, k = S.cur.members.length;
  const note = s.algo === "DBA" ? (s.dist === "DDTW" ? "Centroid DBA dihitung di ruang turunan (DDTW), sehingga menggambarkan laju perubahan—bukan level transaksi." : "Profil pusat berupa centroid DBA: deret ‘rata-rata’ yang diselaraskan dengan DTW.")
    : s.algo === "PAM" ? "Profil pusat berupa medoid, yaitu produk nyata yang paling mewakili cluster." : "Profil pusat berupa median nilai anggota pada setiap minggu.";
  $("#centerNote").textContent = `${note} Skala sumbu Y mengikuti representasi ${REP_LABEL[s.rep]}.`;
  draw("chCenters", () => base({
    grid: { left: 52, right: 20, top: 44, bottom: 34 },
    legend: { top: 0, icon: "roundRect", itemWidth: 14, itemHeight: 6, textStyle: { color: "#3D475A" } },
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v, 3) },
    xAxis: { type: "category", data: S.weeks, boundaryGap: false, ...AX, axisLabel: { ...AX.axisLabel, interval: 3 } },
    yAxis: { type: "value", scale: true, ...AX, name: REP_LABEL[s.rep] },
    series: Array.from({ length: k }, (_, c) => { const cp = centerProfile(c); return { name: `Cluster ${c + 1} · ${cp.name}`, type: "line", smooth: 0.3, showSymbol: false, data: cp.y, lineStyle: { width: 3, color: color(c) }, itemStyle: { color: color(c) }, emphasis: { focus: "series" }, animationDelay: c * 150 }; }),
  }));
}
function renderClusterTabs() {
  const el = $("#clusterTabs");
  el.innerHTML = S.cur.members.map((m, c) => `<button data-v="${c}" class="${c === S.activeCluster ? "on" : ""}"><span class="dot" style="background:${color(c)};margin-right:6px"></span>Cluster ${c + 1}</button>`).join("");
  if (!el._bound) { el._bound = true; el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.activeCluster = +b.dataset.v; S.product = null; $$("button", el).forEach((x) => x.classList.toggle("on", x === b)); renderExplorer(); }); }
}
function renderExplorer() {
  const c = S.activeCluster, { X, members } = S.cur, mem = members[c];
  if (!mem) return;
  const rnd = mulberry(2026 + c), pool = [...mem];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const sample = pool.slice(0, 35), cp = centerProfile(c), col = color(c);
  draw("chCluster", () => base({
    title: { text: `Cluster ${c + 1} · ${fmt(mem.length)} produk · ${S.cur.profiles[c].persona}`, left: 0, top: 0, textStyle: { fontSize: 14, color: "#14213D", fontWeight: 700 } },
    grid: { left: 52, right: 20, top: 46, bottom: 34 },
    tooltip: { trigger: "item", formatter: (p) => `<b>${p.seriesName}</b><br>${p.name}: ${fmt(p.value, 3)}` },
    xAxis: { type: "category", data: S.weeks, boundaryGap: false, ...AX, axisLabel: { ...AX.axisLabel, interval: 3 } },
    yAxis: { type: "value", scale: true, ...AX, name: REP_LABEL[S.sel.rep] },
    series: [
      ...sample.map((i) => ({ name: S.codes[i], type: "line", data: X[i], showSymbol: false, smooth: 0.2, lineStyle: { width: 1, color: hexA(col, 0.2) }, emphasis: { focus: "series", lineStyle: { width: 2.5, color: col } }, z: 1, animationDuration: 600 })),
      { name: cp.name, type: "line", data: cp.y, smooth: 0.3, symbol: "circle", symbolSize: 5, lineStyle: { width: 4, color: "#14213D" }, itemStyle: { color: "#C49A52", borderColor: "#14213D" }, z: 5, animationDuration: 1300 },
    ],
  }));
  $("#memberSearch").value = "";
  if (S.product == null || S.cur.run.labels[S.product] !== c) S.product = S.cur.run.reps[c];
  renderMembers();
}
function renderMembers() {
  const c = S.activeCluster, mem = S.cur.members[c], q = $("#memberSearch").value.trim().toLowerCase();
  const list = mem.filter((i) => !q || S.codes[i].toLowerCase().includes(q)).sort((a, b) => S.pTotal[b] - S.pTotal[a]);
  const rep = S.cur.run.reps[c];
  $("#tblMembers").innerHTML = `<thead><tr><th>Product_Code</th><th>Total</th><th>Rata-rata</th><th>Std</th><th>CV</th></tr></thead><tbody>${list.map((i) =>
    `<tr data-i="${i}" class="${i === S.product ? "sel" : ""}"><td><b>${S.codes[i]}</b>${i === rep ? ' <span class="badge good" style="margin:0">rep</span>' : ""}</td><td>${fmt(S.pTotal[i])}</td><td>${fmt(S.pMean[i], 2)}</td><td>${fmt(S.pSd[i], 2)}</td><td>${fmt(S.pCV[i], 3)}</td></tr>`).join("")}</tbody>`;
  $("#memberCount").textContent = `Menampilkan ${fmt(list.length)} dari ${fmt(mem.length)} produk pada Cluster ${c + 1}. Klik baris untuk melihat polanya.`;
  const tb = $("#tblMembers");
  if (!tb._bound) { tb._bound = true; tb.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-i]"); if (!tr) return; S.product = +tr.dataset.i; $$("tr.sel", tb).forEach((x) => x.classList.remove("sel")); tr.classList.add("sel"); renderOne(); }); }
  renderOne();
}
function renderOne() {
  const i = S.product, c = S.activeCluster, col = color(c), avg = S.cur.profiles[c].meanProfile;
  draw("chOne", () => base({
    title: { text: `Pola transaksi ${S.codes[i]}`, subtext: `Total ${fmt(S.pTotal[i])} · rata-rata ${fmt(S.pMean[i], 2)}/minggu · CV ${fmt(S.pCV[i], 2)}`, left: 0, top: 0, textStyle: { fontSize: 14, color: "#14213D" }, subtextStyle: { color: "#6A7487", fontSize: 12 } },
    grid: { left: 44, right: 14, top: 62, bottom: 50 },
    legend: { bottom: 0, itemWidth: 14, itemHeight: 6, textStyle: { color: "#3D475A", fontSize: 11 } },
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v, 2) },
    xAxis: { type: "category", data: S.weeks, boundaryGap: false, ...AX, axisLabel: { ...AX.axisLabel, interval: 5 } },
    yAxis: { type: "value", ...AX },
    series: [
      { name: S.codes[i], type: "line", data: S.base.raw[i], smooth: 0.3, symbol: "circle", symbolSize: 5, lineStyle: { width: 3, color: col }, itemStyle: { color: col }, areaStyle: { color: grad(col, 0.3, 0.01) } },
      { name: `Rata-rata Cluster ${c + 1}`, type: "line", data: avg.map((v) => +v.toFixed(2)), smooth: 0.3, showSymbol: false, lineStyle: { width: 2, type: "dashed", color: "#14213D" } },
    ],
  }));
}

/* ------------------------------------------------------------------ interpretation */
const PERSONA = {
  sporadic: { name: "Permintaan Sporadis", reco: ["Terapkan stok minimum atau pola <i>make-to-order</i> agar biaya simpan tidak membengkak.", "Gunakan metode peramalan untuk permintaan intermiten (mis. Croston) bila perlu perencanaan.", "Tinjau relevansi produk di katalog; pertimbangkan bundling atau promosi silang."] },
  growing: { name: "Sedang Bertumbuh", reco: ["Naikkan <i>reorder point</i> dan <i>safety stock</i> secara bertahap mengikuti laju tren.", "Pastikan kapasitas pemasok siap mengantisipasi lonjakan agar tidak terjadi kehabisan stok.", "Prioritaskan produk ini dalam rencana pembelian periode berikutnya."] },
  declining: { name: "Mulai Melemah", reco: ["Kurangi kuantitas pemesanan dan hindari penumpukan persediaan.", "Telusuri penyebab penurunan: harga, musim, atau produk substitusi.", "Pertimbangkan promosi terarah untuk mengurangi stok lama."] },
  volatile: { name: "Fluktuatif", reco: ["Siapkan <i>buffer stock</i> lebih besar untuk meredam lonjakan mendadak.", "Tinjau posisi stok lebih sering (mingguan) dibanding produk stabil.", "Identifikasi pemicu lonjakan—promosi, musim, atau pesanan besar."] },
  anchor: { name: "Andalan Stabil", reco: ["Jaga ketersediaan dengan <i>replenishment</i> berkala yang terjadwal.", "<i>Safety stock</i> moderat sudah memadai karena permintaan mudah diprediksi.", "Kandidat kuat untuk kontrak pasokan jangka panjang dan negosiasi harga."] },
  steady: { name: "Penopang Stabil", reco: ["Gunakan siklus pemesanan tetap dengan <i>safety stock</i> sesuai variasi historis.", "Manfaatkan peluang <i>cross-selling</i> bersama produk andalan.", "Evaluasi berkala untuk menangkap perubahan pola lebih awal."] },
  small: { name: "Volume Kecil Stabil", reco: ["Pesan dalam lot kecil namun teratur untuk menghemat ruang simpan.", "Gabungkan pemesanan dengan produk lain dari pemasok yang sama.", "Pantau cukup per bulan; risiko permintaan relatif rendah."] },
};
function profileCluster(mem, c) {
  const raw = S.base.raw, T = S.T;
  const meanProfile = S.weeks.map((_, t) => mean(mem.map((i) => raw[i][t])));
  const avg = mean(meanProfile), medMean = median(mem.map((i) => S.pMean[i]));
  const level = medMean >= S.q67 ? "tinggi" : medMean >= S.q33 ? "menengah" : "rendah";
  const early = mean(meanProfile.slice(0, 13)), late = mean(meanProfile.slice(T - 13));
  const trend = early > 0 ? ((late - early) / early) * 100 : NaN;
  const cv = median(mem.map((i) => S.pCV[i]));
  const zero = sum(mem.map((i) => raw[i].filter((v) => v === 0).length)) / (mem.length * T);
  const volShare = (sum(mem.map((i) => S.pTotal[i])) / S.grand) * 100;
  let type;
  if (zero > 0.5 || (level === "rendah" && cv > 1)) type = "sporadic";
  else if (trend > 15) type = "growing";
  else if (trend < -15) type = "declining";
  else if (cv > 0.6) type = "volatile";
  else type = level === "tinggi" ? "anchor" : level === "menengah" ? "steady" : "small";
  return { c, n: mem.length, meanProfile, avg, level, trend, cv, zero, volShare, peak: argmax(meanProfile), trough: argmin(meanProfile), type, persona: PERSONA[type].name };
}
function narrative(p) {
  const W = S.weeks;
  const tr = !isFinite(p.trend) ? "Arah tren tidak dapat dihitung karena kuartal pertama nihil transaksi."
    : p.trend > 15 ? `Permintaannya <b>menguat</b>: rata-rata 13 minggu terakhir ${pct(p.trend)} lebih tinggi daripada 13 minggu pertama.`
    : p.trend < -15 ? `Permintaannya <b>melemah</b>: rata-rata 13 minggu terakhir ${pct(Math.abs(p.trend))} lebih rendah daripada 13 minggu pertama.`
    : `Sepanjang tahun permintaannya <b>relatif datar</b>, dengan perubahan hanya ${p.trend >= 0 ? "+" : ""}${pct(p.trend)} antara kuartal pertama dan terakhir.`;
  const vol = p.cv < 0.35 ? `Fluktuasi mingguan rendah (CV median ${fmt(p.cv, 2)}), sehingga pola ini cukup mudah diprediksi.`
    : p.cv < 0.7 ? `Fluktuasi mingguan berada pada tingkat sedang (CV median ${fmt(p.cv, 2)}).`
    : `Fluktuasi mingguan tinggi (CV median ${fmt(p.cv, 2)}); permintaan sulit ditebak dari minggu ke minggu.`;
  const zero = p.zero > 0.25 ? ` Sekitar ${pct(p.zero * 100, 0)} minggu tercatat tanpa penjualan.` : "";
  return `Kelompok ini menghimpun <b>${fmt(p.n)} produk</b> (${pct((p.n / S.n) * 100)}) yang menyumbang <b>${pct(p.volShare)}</b> volume transaksi. ` +
    `Rata-rata setiap produk terjual ${fmt(p.avg, 1)} unit per minggu—tergolong <b>${p.level}</b> dibanding keseluruhan katalog. ${tr} ${vol}${zero} ` +
    `Puncak permintaan rata-rata jatuh pada <b>${W[p.peak]}</b>, sedangkan titik terendah pada ${W[p.trough]}.`;
}
function sparkSVG(y, col) {
  const W = 300, H = 54, lo = Math.min(...y), hi = Math.max(...y) || 1;
  const pts = y.map((v, t) => [(t / (y.length - 1)) * W, H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 10)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const gid = `g${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${W},${H}L0,${H}Z" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
}
function renderPersonas() {
  $("#personaGrid").innerHTML = S.cur.profiles.map((p, j) => {
    const col = color(p.c), trTxt = !isFinite(p.trend) ? "—" : `${p.trend >= 0 ? "+" : ""}${fmt(p.trend, 1)}%`;
    return `<article class="persona" style="--c:${col};animation-delay:${j * 0.07}s">
      <div class="persona-top"><span class="persona-name">Cluster ${p.c + 1}</span><span class="persona-tag">${fmt(p.n)} produk</span></div>
      <h4>${p.persona}</h4>
      ${sparkSVG(p.meanProfile, col)}
      <div class="facts"><div><span>Rata-rata/mgg</span><b>${fmt(p.avg, 1)}</b></div><div><span>Tren Q1→Q4</span><b>${trTxt}</b></div><div><span>CV median</span><b>${fmt(p.cv, 2)}</b></div></div>
      <p>${narrative(p)}</p>
      <div class="reco"><b>Rekomendasi tindakan</b><ul>${PERSONA[p.type].reco.map((r) => `<li>${r}</li>`).join("")}</ul></div>
    </article>`;
  }).join("");
}

/* ================================================================== 03 RECOMMENDATION */
function rowLabel(r) {
  const algo = r.algo, v = variantLabel(r.dist, r.param);
  const par = r.algo === "DBSCAN" ? `min_samples ${r.ms} · eps P${r.pct}` : `K = ${r.k}`;
  return { algo, v, par };
}
function applyRow(r) {
  const s = S.sel;
  s.rep = r.rep; s.dist = r.dist;
  if (r.dist === "CDTW") s.radius = String(r.param);
  if (r.dist === "WDTW") s.g = gStr(r.param);
  s.algo = ALGO_SHORT[r.algo];
  if (s.algo === "HC") s.link = r.link;
  if (s.algo === "DBSCAN") { s.ms = String(r.ms); s.pct = String(r.pct); } else { s.k = r.k; }
  setSeg("cRep", s.rep); setSeg("cDist", s.dist); setSeg("cRadius", s.radius); setSeg("cG", s.g); setSeg("cAlgo", s.algo); setSeg("cLink", s.link); setSeg("cMs", s.ms); setSeg("cPct", s.pct);
  const k = $("#cK"); k.value = s.k; $("#kVal").textContent = s.k; sliderFill(k);
  syncControls(); renderCluster();
  document.getElementById("klasterisasi").scrollIntoView({ behavior: "smooth" });
  toast(`Menerapkan ${r.algo} · ${variantLabel(r.dist, r.param)} · ${REP_LABEL[r.rep]}`);
}
function initRecommend() {
  // podium
  const top3 = S.ranking.slice(0, 3), order = [1, 0, 2];
  $("#podium").innerHTML = order.filter((i) => top3[i]).map((i) => {
    const r = top3[i], L = rowLabel(r);
    const warn = r.bs < 0.5 ? `<p class="warn">⚠ Ukuran cluster timpang (Balance ${fmt(r.bs, 2)}). Metrik pemisahan tinggi bisa jadi karena satu cluster dominan.</p>` : r.noise > 20 ? `<p class="warn">⚠ Noise ${pct(r.noise)} — banyak produk tidak masuk cluster mana pun.</p>` : "";
    return `<div class="pod ${i === 0 ? "first" : ""} reveal in"><span class="medal">#${i + 1}</span><span class="pod-rank">Peringkat ${i + 1} dari ${fmt(S.ranking.length)}</span>
      <h4>${L.algo}</h4><p class="pod-sub">${L.v} · ${REP_LABEL[r.rep]} · ${L.par} · ${r.ncl} cluster</p>
      <div class="pod-metrics"><div><span>SI</span><b>${fmt(r.si, 3)}</b></div><div><span>DBI</span><b>${fmt(r.dbi, 3)}</b></div><div><span>CHI</span><b>${fmt(r.chi, 0)}</b></div><div><span>Balance</span><b>${fmt(r.bs, 2)}</b></div></div>
      ${warn}<button class="btn btn-gold" data-apply="${i}">Terapkan <span>→</span></button></div>`;
  }).join("");
  $("#podium").addEventListener("click", (e) => { const b = e.target.closest("[data-apply]"); if (b) applyRow(S.ranking[+b.dataset.apply]); });

  // heatmap
  seg("hmRep", (v) => { S.hmRep = v; renderHeat(); });
  renderHeat();

  // versus
  seg("vRep", (v) => { const cur = S.manifest.matrices.find((m) => m.key === S.vs.key); S.vs.rep = v; fillVsKeys(cur); renderVs(); });
  const vk = $("#vK"); sliderFill(vk);
  vk.addEventListener("input", () => { S.vs.k = +vk.value; $("#vKVal").textContent = vk.value; sliderFill(vk); clearTimeout(vk._t); vk._t = setTimeout(renderVs, 120); });
  $("#vKey").addEventListener("change", (e) => { S.vs.key = e.target.value; renderVs(); });
  fillVsKeys(); renderVs();

  // table
  const algos = [...new Set(S.ranking.map((r) => r.algo))];
  $("#fAlgo").innerHTML += algos.map((a) => `<option>${a}</option>`).join("");
  ["fRep", "fDist", "fAlgo", "fBalanced"].forEach((id) => $(`#${id}`).addEventListener("change", renderRankTable));
  $("#tblRank").addEventListener("click", (e) => { const b = e.target.closest("[data-rid]"); if (b) applyRow(S.rankFiltered[+b.dataset.rid]); });
  $("#dlRank").onclick = () => downloadCSV("ranking_model.csv", S.rankFiltered.map((r) => ({ Rank: r.rank, Algoritma: r.algo, Representasi: r.rep, Jarak: variantLabel(r.dist, r.param), Matriks: r.key, K: r.k ?? "", Linkage: r.link ?? "", min_samples: r.ms ?? "", eps: r.eps ?? "", Jumlah_Cluster: r.ncl, Silhouette: r.si, DBI_MDS: r.dbi, CHI_MDS: r.chi, Balance: r.bs, Noise_pct: r.noise, Skor_Ranking: r.score })));
  renderRankTable();
}
function renderHeat() {
  const rows = [["DTW", null], ["CDTW", 2], ["CDTW", 3], ["CDTW", 5], ["DDTW", null], ["WDTW", 0.05], ["WDTW", 0.1], ["WDTW", 0.5], ["WDTW", 1]];
  const cols = ["K-Means DBA", "K-Medoids PAM", "Hierarchical Average", "Hierarchical Complete", "DBSCAN"];
  const best = new Map();
  S.ranking.forEach((r) => {
    if (S.hmRep !== "all" && r.rep !== S.hmRep) return;
    const k = `${r.dist}|${r.param ?? ""}|${r.algo}`;
    if (!best.has(k) || r.rank < best.get(k).rank) best.set(k, r);
  });
  const data = [];
  rows.forEach(([d, p], y) => cols.forEach((a, x) => { const r = best.get(`${d}|${p ?? ""}|${a}`); data.push([x, y, r ? r.rank : "-", r]); }));
  const ranks = data.filter((d) => d[2] !== "-").map((d) => d[2]);
  const rLo = Math.min(...ranks), rHi = Math.max(...ranks);
  data.forEach((d, i) => { data[i] = { value: d, label: { color: d[2] !== "-" && (d[2] - rLo) / (rHi - rLo || 1) > 0.55 ? "#14213D" : "#fff" } }; });
  draw("chHeat", () => base({
    grid: { left: 110, right: 30, top: 20, bottom: 80 },
    tooltip: { trigger: "item", formatter: (p) => { const r = p.value[3]; if (!r) return "Tidak tersedia"; const L = rowLabel(r); return `<b>Peringkat #${r.rank}</b><br>${L.algo} · ${L.v}<br>${REP_LABEL[r.rep]} · ${L.par}<br>SI ${fmt(r.si, 3)} · DBI ${fmt(r.dbi, 3)} · CHI ${fmt(r.chi, 0)}<br><i>klik untuk menerapkan</i>`; } },
    xAxis: { type: "category", data: cols.map((c) => c.replace("Hierarchical ", "HC ")), ...AX, splitArea: { show: false } },
    yAxis: { type: "category", data: rows.map(([d, p]) => variantLabel(d, p)), inverse: true, ...AX },
    visualMap: { min: Math.min(...ranks), max: Math.max(...ranks), calculable: false, orient: "horizontal", left: "center", bottom: 8, itemWidth: 12, itemHeight: 200, inRange: { color: ["#14213D", "#2A817A", "#9CC5BC", "#E6D3AA"] }, text: ["peringkat bawah", "peringkat atas"], textStyle: { color: "#6A7487", fontSize: 11 }, dimension: 2 },
    series: [{ type: "heatmap", data, label: { show: true, formatter: (p) => (p.value[2] === "-" ? "–" : `#${p.value[2]}`), fontWeight: 700, fontSize: 12 }, itemStyle: { borderColor: "#FFFDF9", borderWidth: 3, borderRadius: 8 }, emphasis: { itemStyle: { shadowBlur: 12, shadowColor: "rgba(0,0,0,.3)" } } }],
  }));
  const ch = charts.chHeat; const bind = (c) => { c.off("click"); c.on("click", (p) => p.value[3] && applyRow(p.value[3])); };
  if (ch) bind(ch); else { const fn = pending.get("chHeat"); pending.set("chHeat", () => bind(fn())); }
}
function fillVsKeys(prev) {
  const opts = S.manifest.matrices.filter((m) => m.rep === S.vs.rep);
  $("#vKey").innerHTML = opts.map((m) => `<option value="${m.key}">${variantLabel(m.dist, m.param)}</option>`).join("");
  const same = prev && opts.find((m) => m.dist === prev.dist && m.param === prev.param);
  S.vs.key = (same || opts[0]).key; $("#vKey").value = S.vs.key;
}
async function renderVs() {
  const m = await loadMatrix(S.vs.key), k = S.vs.k;
  const cands = [];
  const push = (name, id) => m.runs[id] && cands.push({ name, id, ...m.runs[id] });
  push("K-Means DBA", `DBA_k${k}`); push("K-Medoids", `PAM_k${k}`); push("Hierarchical Average", `HC-average_k${k}`); push("Hierarchical Complete", `HC-complete_k${k}`);
  const db = Object.entries(m.runs).filter(([id, r]) => id.startsWith("DBSCAN") && r.si != null).sort((a, b) => b[1].si - a[1].si)[0];
  if (db) { const [, ms, p] = db[0].match(/ms(\d+)_p(\d+)/); cands.push({ name: `DBSCAN (ms ${ms}, P${p})`, id: db[0], ...db[1] }); }
  const valid = cands.filter((c) => c.si != null && c.dbi != null && c.chi != null);
  const rank = (key, asc) => { const sorted = [...valid].sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key])); valid.forEach((c) => { c[`r_${key}`] = sorted.findIndex((x) => x === c) + 1; }); };
  rank("si", false); rank("dbi", true); rank("chi", false);
  valid.forEach((c) => (c.score = (c.r_si + c.r_dbi + c.r_chi) / 3));
  cands.sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
  $("#tblVs").innerHTML = `<thead><tr><th>#</th><th>Metode</th><th>Silhouette</th><th>DBI</th><th>CHI</th><th>Balance</th><th>Cluster</th><th>Noise</th><th>Skor</th></tr></thead><tbody>${cands.map((c, j) =>
    `<tr><td><span class="rank-pill ${j === 0 && c.score != null ? "top" : ""}">${c.score != null ? j + 1 : "–"}</span></td><td><b>${c.name}</b></td><td>${fmt(c.si, 4)}</td><td>${fmt(c.dbi, 4)}</td><td>${fmt(c.chi, 1)}</td><td>${fmt(c.bs, 3)}</td><td>${c.ncl}</td><td>${pct(c.noise, 1)}</td><td>${c.score != null ? fmt(c.score, 2) : "—"}</td></tr>`).join("")}</tbody>`;
  const norm = (key, inv) => { const vals = valid.map((c) => c[key]), lo = Math.min(...vals), hi = Math.max(...vals); return (v) => (hi === lo ? 1 : inv ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo)); };
  const nS = norm("si"), nD = norm("dbi", true), nC = norm("chi");
  draw("chRadar", () => base({
    color: PALETTE,
    legend: { bottom: 0, icon: "circle", itemWidth: 9, textStyle: { color: "#3D475A", fontSize: 11 } },
    tooltip: { trigger: "item" },
    radar: { center: ["50%", "46%"], radius: "64%", indicator: [{ name: "Silhouette", max: 1 }, { name: "DBI (dibalik)", max: 1 }, { name: "CHI", max: 1 }, { name: "Balance", max: 1 }], axisName: { color: "#14213D", fontWeight: 700, fontSize: 11 }, splitArea: { areaStyle: { color: ["#FFFDF9", "#F8F4EC"] } }, splitLine: { lineStyle: { color: "#E8E1D4" } }, axisLine: { lineStyle: { color: "#E8E1D4" } } },
    series: [{ type: "radar", symbolSize: 5, data: valid.map((c) => ({ name: c.name, value: [nS(c.si), nD(c.dbi), nC(c.chi), c.bs].map((v) => +v.toFixed(3)), areaStyle: { opacity: 0.12 }, lineStyle: { width: 2 } })) }],
  }));
  const w = cands[0];
  $("#vsNarrative").innerHTML = w && w.score != null
    ? `<b>Kesimpulan.</b> Pada matriks <b>${variantLabel(m.dist, m.param)}</b> dengan representasi ${REP_LABEL[m.rep]}${w.id.startsWith("DBSCAN") ? "" : ` dan K = ${k}`}, metode dengan peringkat terbaik adalah <b>${w.name}</b> (Silhouette ${fmt(w.si, 3)}, DBI ${fmt(w.dbi, 3)}, CHI ${fmt(w.chi, 0)}). ` +
      (w.bs < 0.5 ? `Namun Balance Score-nya hanya ${fmt(w.bs, 2)}, artinya sebagian besar produk terkumpul di satu cluster—pertimbangkan metode peringkat berikutnya bila tujuan Anda adalah segmentasi yang merata.` : `Balance Score ${fmt(w.bs, 2)} menunjukkan ukuran cluster yang cukup proporsional untuk kebutuhan segmentasi.`)
    : "Belum ada kandidat dengan metrik lengkap pada kombinasi ini.";
}
function renderRankTable() {
  const rep = $("#fRep").value, dist = $("#fDist").value, algo = $("#fAlgo").value, bal = $("#fBalanced").checked;
  S.rankFiltered = S.ranking.filter((r) => (!rep || r.rep === rep) && (!dist || r.dist === dist) && (!algo || r.algo === algo) && (!bal || r.bs >= 0.5));
  const show = S.rankFiltered.slice(0, 200), siMax = Math.max(...S.ranking.map((r) => r.si));
  $("#tblRank").innerHTML = `<thead><tr><th>Rank</th><th>Algoritma</th><th>Representasi</th><th>Jarak</th><th>Parameter</th><th>Cluster</th><th>Silhouette</th><th>DBI</th><th>CHI</th><th>Balance</th><th>Noise</th><th>Skor</th><th></th></tr></thead><tbody>${show.map((r, j) => {
    const L = rowLabel(r);
    return `<tr><td><span class="rank-pill ${r.rank <= 3 ? "top" : ""}">${r.rank}</span></td><td><b>${L.algo}</b></td><td>${REP_LABEL[r.rep]}</td><td>${L.v}</td><td>${L.par}</td><td>${r.ncl}</td>
    <td class="bar-cell"><i style="width:${Math.max(0, (r.si / siMax) * 100)}%"></i><span>${fmt(r.si, 4)}</span></td><td>${fmt(r.dbi, 4)}</td><td>${fmt(r.chi, 1)}</td><td>${fmt(r.bs, 3)}</td><td>${pct(r.noise, 1)}</td><td>${fmt(r.score, 2)}</td>
    <td><button class="btn-link" data-rid="${j}">Terapkan →</button></td></tr>`;
  }).join("")}</tbody>`;
  $("#rankCount").textContent = `Menampilkan ${fmt(show.length)} dari ${fmt(S.rankFiltered.length)} kombinasi yang sesuai filter (total ${fmt(S.ranking.length)} model valid).`;
}

document.addEventListener("DOMContentLoaded", boot);
