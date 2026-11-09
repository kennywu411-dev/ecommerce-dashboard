/* 跨境电商经营分析看板：所有指标在浏览器里由订单级数据现算，口径见 docs/指标定义.md */
(async function () {
  "use strict";
  const [D, F] = await Promise.all([
    fetch("data.json").then((r) => r.json()),
    fetch("findings.json").then((r) => r.json()),
  ]);

  // ---------- 数据准备 ----------
  const START = Date.UTC(2009, 11, 1);
  const NM = D.months.length; // 24
  const NC = D.countries.length;
  const UK = D.countries.indexOf("United Kingdom");
  const monthOfDay = (d) => {
    const t = new Date(START + d * 86400000);
    return (t.getUTCFullYear() - 2009) * 12 + t.getUTCMonth() - 11;
  };
  function prep(t) {
    const n = t.d.length, m = new Int16Array(n), v = new Float64Array(n);
    for (let i = 0; i < n; i++) { m[i] = monthOfDay(t.d[i]); v[i] = t.v[i] / 100; }
    return { n, m, v, c: t.c, u: t.u, d: t.d };
  }
  const O = prep(D.orders), R = prep(D.returns);
  const mk = () => Array.from({ length: NM }, () => new Float64Array(NC));
  const gmvMC = mk(), ordMC = mk(), retMC = mk(), noIdMC = mk();
  for (let i = 0; i < O.n; i++) {
    gmvMC[O.m[i]][O.c[i]] += O.v[i]; ordMC[O.m[i]][O.c[i]] += 1;
    if (O.u[i] < 0) noIdMC[O.m[i]][O.c[i]] += O.v[i];
  }
  for (let i = 0; i < R.n; i++) retMC[R.m[i]][R.c[i]] += R.v[i];
  const NK = D.categories.length;

  const monthLabel = (i) => D.months[i];
  const shortMonth = (i) => D.months[i].slice(2).replace("-", ".");
  const czh = (c) => D.countries_zh[c];

  // ---------- 状态 ----------
  const state = { m0: 12, m1: NM - 1, market: "all", tab: "overview" };
  const marketTest = (mkt) => {
    if (mkt === "all") return () => true;
    if (mkt === "uk") return (c) => c === UK;
    if (mkt === "ov") return (c) => c !== UK;
    const k = +mkt.slice(2);
    return (c) => c === k;
  };
  const marketName = (mkt) => mkt === "all" ? "全部市场" : mkt === "uk" ? "英国" : mkt === "ov" ? "海外（英国以外）" : czh(+mkt.slice(2));

  // ---------- 计算 ----------
  function sumMC(arr, m0, m1, test) {
    let s = 0;
    for (let m = m0; m <= m1; m++) for (let c = 0; c < NC; c++) if (test(c)) s += arr[m][c];
    return s;
  }
  function monthly(arr, m0, m1, test) {
    const out = [];
    for (let m = m0; m <= m1; m++) { let s = 0; for (let c = 0; c < NC; c++) if (test(c)) s += arr[m][c]; out.push(s); }
    return out;
  }
  function customers(m0, m1, test) {
    const cnt = new Map(), val = new Map();
    for (let i = 0; i < O.n; i++) {
      const u = O.u[i];
      if (u < 0 || O.m[i] < m0 || O.m[i] > m1 || !test(O.c[i])) continue;
      cnt.set(u, (cnt.get(u) || 0) + 1); val.set(u, (val.get(u) || 0) + O.v[i]);
    }
    return { cnt, val };
  }
  function kpis(m0, m1, test) {
    const gmv = sumMC(gmvMC, m0, m1, test), orders = sumMC(ordMC, m0, m1, test), ret = sumMC(retMC, m0, m1, test);
    const { cnt } = customers(m0, m1, test);
    let rep = 0; cnt.forEach((n) => { if (n >= 2) rep++; });
    return {
      gmv, orders, ret, net: gmv - ret, aov: orders ? gmv / orders : NaN, retRate: gmv ? ret / gmv : NaN,
      cust: cnt.size, repeat: cnt.size ? rep / cnt.size : NaN, noId: gmv ? sumMC(noIdMC, m0, m1, test) / gmv : NaN,
    };
  }
  function catAgg(m0, m1, test) {
    const s = new Float64Array(NK), r = new Float64Array(NK);
    for (const [m, c, k, sv, rv] of D.cat) if (m >= m0 && m <= m1 && test(c)) { s[k] += sv / 100; r[k] += rv / 100; }
    return { s, r };
  }

  // ---------- 格式化 ----------
  const fmtMoney = (x) => {
    if (!isFinite(x)) return "—";
    const a = Math.abs(x);
    if (a >= 1e8) return "£" + (x / 1e8).toFixed(2) + "亿";
    if (a >= 1e4) return "£" + (x / 1e4).toFixed(1) + "万";
    return "£" + x.toFixed(0);
  };
  const fmtInt = (x) => isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—";
  const fmtPct = (x, d = 1) => isFinite(x) ? (x * 100).toFixed(d) + "%" : "—";
  const axisMoney = (x) => Math.abs(x) >= 1e4 ? (x / 1e4).toFixed(0) + "万" : String(Math.round(x));

  // ---------- 主题（从 CSS 变量读取，深浅色各自取值） ----------
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function theme() {
    return {
      ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), grid: css("--grid"), axis: css("--axis"),
      surface: css("--surface"), s1: css("--s1"), s2: css("--s2"), ghost: css("--ghost"),
      seq: css("--seq").split(",").map((s) => s.trim()),
    };
  }
  let T = theme();
  const charts = {};
  function chart(id) {
    const el = document.getElementById(id);
    if (!charts[id]) charts[id] = echarts.init(el, null, { renderer: "svg" });
    return charts[id];
  }
  const baseText = () => ({ fontFamily: '"Geist", "PingFang SC", system-ui, sans-serif', color: T.ink2, fontSize: 12 });
  const tooltip = (extra) => Object.assign({
    backgroundColor: T.surface, borderColor: T.grid, textStyle: { color: T.ink, fontSize: 12 },
    extraCssText: "border-radius:12px;padding:10px 12px;box-shadow:0 18px 40px -18px rgba(0,0,0,.35);",
  }, extra);
  const catAxis = (data, extra) => Object.assign({
    type: "category", data, axisLine: { lineStyle: { color: T.axis } }, axisTick: { show: false },
    axisLabel: { color: T.muted, fontSize: 11 },
  }, extra);
  const valAxis = (fmt, extra) => Object.assign({
    type: "value", splitLine: { lineStyle: { color: T.grid } }, axisLabel: { color: T.muted, fontSize: 11, formatter: fmt },
  }, extra);
  const legend = (show) => ({ show, top: 0, right: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { color: T.ink2, fontSize: 12 } });
  const barStyle = (color) => ({ color, borderRadius: [4, 4, 0, 0] });
  // 自定义 tooltip：数值在前、名称在后，用短线标识系列
  function tipRows(title, rows) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    let h = `<div style="color:${T.muted};margin-bottom:4px">${esc(title)}</div>`;
    for (const [color, name, val] of rows) {
      h += `<div style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;width:12px;height:2px;background:${color}"></span><b style="color:${T.ink}">${esc(val)}</b><span style="color:${T.ink2}">${esc(name)}</span></div>`;
    }
    return h;
  }

  // ---------- 筛选控件 ----------
  const $ = (id) => document.getElementById(id);
  function initFilters() {
    for (const sel of [$("m-start"), $("m-end")]) {
      D.months.forEach((m, i) => { const o = document.createElement("option"); o.value = i; o.textContent = m; sel.appendChild(o); });
    }
    const mk = $("market");
    const add = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; mk.appendChild(o); };
    add("all", "全部市场"); add("uk", "英国"); add("ov", "海外（英国以外）");
    const og = document.createElement("optgroup"); og.label = "单个国家（按 GMV 排序）"; mk.appendChild(og);
    D.countries.forEach((c, i) => { if (i === UK) return; const o = document.createElement("option"); o.value = "c:" + i; o.textContent = czh(i); og.appendChild(o); });

    $("m-start").onchange = () => { state.m0 = +$("m-start").value; if (state.m0 > state.m1) state.m1 = state.m0; render(); };
    $("m-end").onchange = () => { state.m1 = +$("m-end").value; if (state.m1 < state.m0) state.m0 = state.m1; render(); };
    $("market").onchange = () => { state.market = $("market").value; render(); };
    document.querySelectorAll("#presets .chip").forEach((b) => b.onclick = () => {
      const n = +b.dataset.n; state.m1 = NM - 1; state.m0 = NM - n; render();
    });
    document.querySelectorAll("nav.tabs button").forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; render(); });
    $("open-defs").onclick = () => $("defs").showModal();
    $("close-defs").onclick = () => $("defs").close();
  }
  function syncControls() {
    $("m-start").value = state.m0; $("m-end").value = state.m1; $("market").value = state.market;
    const n = state.m1 - state.m0 + 1;
    document.querySelectorAll("#presets .chip").forEach((b) => b.setAttribute("aria-pressed", String(state.m1 === NM - 1 && +b.dataset.n === n)));
    document.querySelectorAll("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    document.querySelectorAll("section[data-panel]").forEach((s) => s.hidden = s.dataset.panel !== state.tab);
    const isF = state.tab === "findings";
    $("filters").hidden = isF; $("findings-note").hidden = !isF;
    $("scope-note").textContent = `${monthLabel(state.m0)} 至 ${monthLabel(state.m1)}（${n} 个月）· ${marketName(state.market)}`;
  }

  // ---------- KPI 卡 ----------
  function delta(cur, prev, kind, goodUp = true) {
    if (!isFinite(cur) || !isFinite(prev) || prev === 0) return null;
    const diff = kind === "pp" ? (cur - prev) * 100 : cur / prev - 1;
    const txt = kind === "pp" ? (diff >= 0 ? "+" : "") + diff.toFixed(1) + "pp" : (diff >= 0 ? "+" : "") + (diff * 100).toFixed(1) + "%";
    const good = goodUp ? diff >= 0 : diff <= 0;
    return { txt, cls: Math.abs(diff) < 1e-9 ? "" : good ? "up" : "down", arrow: diff >= 0 ? "▲" : "▼" };
  }
  function kpiCards(containerId, items) {
    const box = $(containerId);
    for (const it of items) if (it.hero && charts[it.hero]) { charts[it.hero].dispose(); delete charts[it.hero]; }
    box.textContent = "";
    for (const it of items) {
      const card = document.createElement("div"); card.className = "card kpi" + (it.hero ? " hero" : "") + (it.guard ? " guard" : "");
      const lab = document.createElement("div"); lab.className = "label";
      const s = document.createElement("span"); s.textContent = it.label; lab.appendChild(s);
      const info = document.createElement("button"); info.className = "info"; info.textContent = "i"; info.title = it.def; info.setAttribute("aria-label", it.label + "口径：" + it.def);
      info.onclick = () => $("defs").showModal(); lab.appendChild(info);
      const val = document.createElement("div"); val.className = "value"; val.textContent = it.value;
      const dl = document.createElement("div"); dl.className = "delta";
      for (const [name, d] of it.deltas || []) {
        const sp = document.createElement("span");
        if (d) { sp.textContent = name + " "; const b = document.createElement("span"); b.className = d.cls || "flat"; b.textContent = d.arrow + " " + d.txt; sp.appendChild(b); }
        else sp.textContent = name + " —";
        dl.appendChild(sp);
      }
      if (it.foot) { const f = document.createElement("span"); f.className = "foot"; f.textContent = it.foot; dl.appendChild(f); }
      card.append(lab, val, dl);
      if (it.hero) { const sp = document.createElement("div"); sp.className = "spark"; sp.id = it.hero; card.appendChild(sp); }
      box.appendChild(card);
    }
  }

  // ---------- ① 总览 ----------
  function renderOverview() {
    const { m0, m1 } = state, test = marketTest(state.market), L = m1 - m0 + 1;
    const cur = kpis(m0, m1, test);
    const pop = m0 - L >= 0 ? kpis(m0 - L, m0 - 1, test) : null;
    const yoy = m0 - 12 >= 0 ? kpis(m0 - 12, m1 - 12, test) : null;
    const ds = (k, kind, goodUp) => L === 12 ? [["同比", yoy && delta(cur[k], yoy[k], kind, goodUp)]]
      : [["环比", pop && delta(cur[k], pop[k], kind, goodUp)], ["同比", yoy && delta(cur[k], yoy[k], kind, goodUp)]];
    kpiCards("kpis", [
      { label: "GMV（下单金额）", value: fmtMoney(cur.gmv), deltas: ds("gmv"), def: "销售订单商品行 数量×单价 之和，不扣退货、不含邮费", hero: "ov-spark" },
      { label: "净销售额", value: fmtMoney(cur.net), deltas: ds("net"), def: "GMV − 退货额" },
      { label: "订单数", value: fmtInt(cur.orders), deltas: ds("orders"), def: "销售订单去重发票数" },
      { label: "客单价", value: "£" + fmtInt(cur.aov), deltas: ds("aov"), def: "GMV ÷ 订单数" },
      { label: "退货率", value: fmtPct(cur.retRate, 2), deltas: ds("retRate", "pp", false), def: "退货额 ÷ GMV（金额口径）" },
      { label: "复购率", value: fmtPct(cur.repeat), deltas: ds("repeat", "pp"), def: "时间段内下单≥2次的客户 ÷ 下单客户（仅有编号客户）" },
      { label: "无编号 GMV 占比", value: fmtPct(cur.noId), deltas: ds("noId", "pp", false), def: "无客户编号订单的 GMV ÷ GMV；数据质量护栏指标，越低越好", guard: true },
    ]);
    // GMV 主卡里的迷你走势
    const spk = monthly(gmvMC, m0, m1, test);
    chart("ov-spark").setOption({
      grid: { left: 0, right: 0, top: 6, bottom: 0 }, xAxis: { type: "category", show: false, boundaryGap: false, data: spk.map((_, i) => monthLabel(m0 + i)) },
      yAxis: { type: "value", show: false, min: (v) => v.min * 0.85 },
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "line", lineStyle: { color: T.axis } }, formatter: (p) => tipRows(p[0].name, [[T.s1, "GMV", fmtMoney(p[0].value)]]) }),
      series: [{ type: "line", data: spk, smooth: 0.35, symbol: "none", lineStyle: { width: 2, color: T.s1 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: T.s1 + "33" }, { offset: 1, color: T.s1 + "00" }]) } }],
    }, true);
    $("ov-note").textContent = "无客户编号的订单计入 GMV 和订单数，不计入复购。" + (yoy ? "" : " 所选时间段没有完整的去年同期数据，同比不显示。");

    // 月度 GMV：今年 vs 去年同月
    const months = []; for (let m = m0; m <= m1; m++) months.push(m);
    const curS = monthly(gmvMC, m0, m1, test);
    const hasLY = m0 - 12 >= 0;
    const lyS = hasLY ? monthly(gmvMC, m0 - 12, m1 - 12, test) : null;
    const series = [];
    if (hasLY) series.push({ name: "去年同月", type: "bar", data: lyS, itemStyle: barStyle(T.ghost), barGap: "8%", barMaxWidth: 18 });
    series.push({ name: "本期", type: "bar", data: curS, itemStyle: barStyle(T.s1), barMaxWidth: 18 });
    chart("ov-trend").setOption({
      textStyle: baseText(), grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true }, legend: legend(hasLY),
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,.08)" } },
        formatter: (p) => { const i = p[0].dataIndex; const rows = [[T.s1, monthLabel(months[i]), fmtMoney(curS[i])]];
          if (hasLY) rows.push([T.ghost, monthLabel(months[i] - 12), fmtMoney(lyS[i])]);
          if (hasLY && lyS[i]) rows.push(["transparent", "同比", (curS[i] / lyS[i] - 1 >= 0 ? "+" : "") + ((curS[i] / lyS[i] - 1) * 100).toFixed(1) + "%"]);
          return tipRows(monthLabel(months[i]), rows); } }),
      xAxis: catAxis(months.map(shortMonth)), yAxis: valAxis(axisMoney), series,
    }, true);

    // 市场贡献：不受市场筛选影响，被选中的高亮
    const all = () => true, sel = marketTest(state.market);
    const tot = sumMC(gmvMC, m0, m1, all);
    const byC = D.countries.map((_, c) => [c, sumMC(gmvMC, m0, m1, (x) => x === c)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const top = byC.slice(0, 7), rest = byC.slice(7).reduce((s, x) => s + x[1], 0);
    const rows = top.map(([c, v]) => ({ name: czh(c), v, c })).concat([{ name: "其他国家", v: rest, c: -1 }]).reverse();
    const hl = state.market === "all" ? () => true : (c) => c >= 0 ? sel(c) : (state.market === "ov");
    chart("ov-country").setOption({
      textStyle: baseText(), grid: { left: 4, right: 52, top: 4, bottom: 4, containLabel: true },
      tooltip: tooltip({ trigger: "item", formatter: (p) => tipRows(p.name, [[T.s1, "占 GMV", fmtPct(rows[p.dataIndex].v / tot)], [T.s1, "GMV", fmtMoney(rows[p.dataIndex].v)]]) }),
      xAxis: { type: "value", show: false, max: (v) => v.max * 1.05 },
      yAxis: catAxis(rows.map((r) => r.name), { axisLine: { show: false }, axisLabel: { color: T.ink2, fontSize: 12 } }),
      series: [{ type: "bar", barMaxWidth: 16, data: rows.map((r) => ({ value: r.v / tot, itemStyle: { color: hl(r.c) ? T.s1 : T.ghost, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: "right", color: T.ink2, fontSize: 11, formatter: (p) => fmtPct(p.value) } }],
    }, true);
  }

  // ---------- ② 趋势 ----------
  function renderTrend() {
    const { m0, m1 } = state, test = marketTest(state.market);
    const months = []; for (let m = m0; m <= m1; m++) months.push(m);
    const x = months.map(shortMonth);
    const g = monthly(gmvMC, m0, m1, test), r = monthly(retMC, m0, m1, test), o = monthly(ordMC, m0, m1, test);
    const net = g.map((v, i) => v - r[i]), aov = g.map((v, i) => o[i] ? v / o[i] : null), rr = g.map((v, i) => v ? r[i] / v : null);
    const grid = { left: 8, right: 12, top: 28, bottom: 4, containLabel: true };
    const line = (name, data, color) => ({ name, type: "line", data, symbol: "circle", symbolSize: 8, showSymbol: months.length <= 12, lineStyle: { width: 2, color }, itemStyle: { color, borderColor: T.surface, borderWidth: 2 } });
    const axisTip = (fmts) => tooltip({ trigger: "axis", axisPointer: { type: "line", lineStyle: { color: T.axis } },
      formatter: (p) => tipRows(monthLabel(months[p[0].dataIndex]), p.map((s, k) => [s.color, s.seriesName, fmts[k](s.value)])) });

    chart("tr-gmv").setOption({ textStyle: baseText(), grid, legend: legend(true), tooltip: axisTip([fmtMoney, fmtMoney]),
      xAxis: catAxis(x, { boundaryGap: false }), yAxis: valAxis(axisMoney), series: [line("GMV", g, T.s1), line("净销售额", net, T.s2)] }, true);
    chart("tr-orders").setOption({ textStyle: baseText(), grid, tooltip: axisTip([fmtInt]),
      xAxis: catAxis(x), yAxis: valAxis((v) => v.toLocaleString()), series: [{ name: "订单数", type: "bar", data: o, itemStyle: barStyle(T.s1), barMaxWidth: 18 }] }, true);
    chart("tr-aov").setOption({ textStyle: baseText(), grid, tooltip: axisTip([(v) => "£" + fmtInt(v)]),
      xAxis: catAxis(x, { boundaryGap: false }), yAxis: valAxis((v) => "£" + v, { scale: true }), series: [line("客单价", aov, T.s1)] }, true);
    chart("tr-ret").setOption({ textStyle: baseText(), grid, tooltip: axisTip([(v) => fmtPct(v, 2)]),
      xAxis: catAxis(x, { boundaryGap: false }), yAxis: valAxis((v) => (v * 100).toFixed(0) + "%"), series: [line("退货率", rr, T.s1)] }, true);
  }

  // ---------- ③ 国家与品类 ----------
  function renderDrill() {
    const { m0, m1 } = state, test = marketTest(state.market);
    const tot = sumMC(gmvMC, m0, m1, () => true);
    const custByC = new Array(NC).fill(0).map(() => new Set());
    for (let i = 0; i < O.n; i++) if (O.u[i] >= 0 && O.m[i] >= m0 && O.m[i] <= m1) custByC[O.c[i]].add(O.u[i]);
    const rows = D.countries.map((_, c) => {
      const t = (x) => x === c, g = sumMC(gmvMC, m0, m1, t), o = sumMC(ordMC, m0, m1, t), r = sumMC(retMC, m0, m1, t);
      return { c, g, o, r, cust: custByC[c].size };
    }).filter((x) => x.g > 0).sort((a, b) => b.g - a.g);

    const tbl = $("country-table"); tbl.textContent = "";
    const head = tbl.createTHead().insertRow();
    for (const h of ["国家", "GMV", "占比", "订单数", "客单价", "退货率", "客户数"]) { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); }
    const body = tbl.createTBody();
    for (const x of rows) {
      const tr = body.insertRow(); tr.className = "clickable"; tr.tabIndex = 0;
      const selected = state.market === "c:" + x.c || (state.market === "uk" && x.c === UK);
      [czh(x.c), fmtMoney(x.g), fmtPct(x.g / tot), fmtInt(x.o), "£" + fmtInt(x.g / x.o), fmtPct(x.r / x.g, 2), fmtInt(x.cust)]
        .forEach((v, k) => { const td = tr.insertCell(); td.textContent = v; if (selected) td.style.fontWeight = "700"; if (k === 0 && selected) td.style.color = T.s1; });
      const go = () => { state.market = x.c === UK ? "uk" : "c:" + x.c; render(); };
      tr.onclick = go; tr.onkeydown = (e) => { if (e.key === "Enter") go(); };
    }

    const ov = rows.filter((x) => x.c !== UK).slice(0, 15).reverse();
    const sel = marketTest(state.market);
    chart("dr-country").setOption({
      textStyle: baseText(), grid: { left: 4, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: tooltip({ trigger: "item", formatter: (p) => { const x = ov[p.dataIndex]; return tipRows(czh(x.c), [[T.s1, "GMV", fmtMoney(x.g)], [T.s1, "客单价", "£" + fmtInt(x.g / x.o)], [T.s1, "退货率", fmtPct(x.r / x.g, 2)]]); } }),
      xAxis: { type: "value", show: false, max: (v) => v.max * 1.08 },
      yAxis: catAxis(ov.map((x) => czh(x.c)), { axisLine: { show: false }, axisLabel: { color: T.ink2, fontSize: 12 } }),
      series: [{ type: "bar", barMaxWidth: 14, data: ov.map((x) => ({ value: x.g, itemStyle: { color: state.market === "all" || sel(x.c) ? T.s1 : T.ghost, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: "right", color: T.ink2, fontSize: 11, formatter: (p) => fmtMoney(p.value) } }],
    }, true);
    chart("dr-country").off("click");
    chart("dr-country").on("click", (p) => { state.market = "c:" + ov[p.dataIndex].c; render(); });

    const { s, r } = catAgg(m0, m1, test);
    const st = s.reduce((a, b) => a + b, 0);
    const order = [...Array(NK).keys()].sort((a, b) => (D.categories[a] === "其他") - (D.categories[b] === "其他") || s[b] - s[a]);
    const names = order.map((k) => D.categories[k]);
    const hbar = (id, vals, fmt, tipName) => chart(id).setOption({
      textStyle: baseText(), grid: { left: 4, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: tooltip({ trigger: "item", formatter: (p) => { const k = order[order.length - 1 - p.dataIndex]; return tipRows(D.categories[k], [[T.s1, "GMV", fmtMoney(s[k])], [T.s1, "占比", fmtPct(s[k] / st)], [T.s1, "退货率", fmtPct(s[k] ? r[k] / s[k] : NaN, 2)]]); } }),
      xAxis: { type: "value", show: false, max: (v) => v.max * 1.1 },
      yAxis: catAxis([...names].reverse(), { axisLine: { show: false }, axisLabel: { color: T.ink2, fontSize: 12 } }),
      series: [{ name: tipName, type: "bar", barMaxWidth: 14, data: [...vals].reverse().map((v, i) => ({ value: v, itemStyle: { color: names[names.length - 1 - i] === "其他" ? T.ghost : T.s1, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: "right", color: T.ink2, fontSize: 11, formatter: (p) => fmt(p.value) } }],
    }, true);
    hbar("dr-cat", order.map((k) => s[k] / st), (v) => fmtPct(v), "占比");
    hbar("dr-cat-ret", order.map((k) => s[k] ? r[k] / s[k] : 0), (v) => fmtPct(v, 2), "退货率");
  }

  // ---------- ④ 客户复购 ----------
  function renderRetention() {
    const { m0, m1 } = state, test = marketTest(state.market);
    // 首单月：在当前市场范围内，按客户全部历史计
    const first = new Map();
    for (let i = 0; i < O.n; i++) { const u = O.u[i]; if (u < 0 || !test(O.c[i])) continue; if (!first.has(u) || O.m[i] < first.get(u)) first.set(u, O.m[i]); }
    const { cnt, val } = customers(m0, m1, test);
    let rep = 0, repVal = 0, totVal = 0, newC = 0, orders = 0;
    cnt.forEach((n, u) => { orders += n; totVal += val.get(u); if (n >= 2) { rep++; repVal += val.get(u); } if (first.get(u) >= m0) newC++; });
    kpiCards("ret-kpis", [
      { label: "下单客户数", value: fmtInt(cnt.size), def: "有客户编号的去重客户" },
      { label: "复购率", value: fmtPct(rep / cnt.size), def: "下单≥2次的客户 ÷ 下单客户" },
      { label: "复购客户 GMV 占比", value: fmtPct(repVal / totVal), def: "下单≥2次的客户贡献的 GMV ÷ 有编号客户 GMV" },
      { label: "新客数", value: fmtInt(newC), def: "首单落在所选时间段内的客户" },
      { label: "人均下单次数", value: (orders / cnt.size).toFixed(1), def: "有编号订单数 ÷ 下单客户数" },
      { label: "全局新客 90 天复购", value: fmtPct(F.cohort.new_90d_repeat), def: "首单在 2010-01-01 至 2011-08-31 的新客中，90 天内再次下单的比例（全部市场，不随筛选变化）", foot: "全部市场，固定口径" },
    ]);

    // 同期群
    const MAXN = 12;
    const seen = new Map(); // cohort -> array of Set per age
    for (let i = 0; i < O.n; i++) {
      const u = O.u[i]; if (u < 0 || !test(O.c[i])) continue;
      const f = first.get(u); if (f < m0 || f > m1) continue;
      const age = O.m[i] - f; if (age > MAXN) continue;
      if (!seen.has(f)) seen.set(f, Array.from({ length: MAXN + 1 }, () => new Set()));
      seen.get(f)[age].add(u);
    }
    const cohorts = [...seen.keys()].sort((a, b) => a - b);
    const data = [];
    cohorts.forEach((f, row) => {
      const size = seen.get(f)[0].size;
      for (let a = 1; a <= MAXN; a++) if (f + a <= NM - 1) data.push([a - 1, row, seen.get(f)[a].size / size, seen.get(f)[a].size, size]);
    });
    const ylab = cohorts.map((f) => `${monthLabel(f)}（${seen.get(f)[0].size}人）`);
    const vmax = Math.max(0.4, ...data.filter((d) => cohorts[d[1]] !== 0).map((d) => d[2]));
    const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light" || document.documentElement.dataset.theme === "dark";
    const ramp = dark ? [...T.seq].reverse() : T.seq; // 深色模式下"接近 0"要贴近深色背景
    const cells = data.map((d) => ({ value: d, label: { color: (dark ? d[2] / vmax > 0.55 : d[2] / vmax > 0.45) ? (dark ? "#0b0b0b" : "#ffffff") : T.ink } }));
    chart("cohort").setOption({
      textStyle: baseText(), grid: { left: 4, right: 8, top: 24, bottom: 4, containLabel: true },
      tooltip: tooltip({ trigger: "item", formatter: (p) => tipRows(`${monthLabel(cohorts[p.value[1]])} 首单客户 · 第 ${p.value[0] + 1} 个月`, [[T.s1, "留存", fmtPct(p.value[2])], [T.s1, "人数", `${p.value[3]} / ${p.value[4]}`]]) }),
      xAxis: catAxis(Array.from({ length: MAXN }, (_, i) => `第${i + 1}月`), { position: "top", axisLine: { show: false } }),
      yAxis: catAxis(ylab, { inverse: true, axisLine: { show: false }, axisLabel: { color: T.ink2, fontSize: 11 } }),
      visualMap: { show: false, dimension: 2, min: 0, max: vmax, inRange: { color: ramp } },
      series: [{ type: "heatmap", data: cells, itemStyle: { borderColor: T.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: true, fontSize: 10, formatter: (p) => Math.round(p.value[2] * 100) },
        emphasis: { itemStyle: { borderColor: T.ink, borderWidth: 1 } } }],
    }, true);
    $("cohort").style.height = Math.max(220, 60 + cohorts.length * 22) + "px";
    chart("cohort").resize();

    // 客户价值十分位
    const vals = [...val.values()].sort((a, b) => b - a), n = vals.length, tv = vals.reduce((a, b) => a + b, 0);
    const dec = Array.from({ length: 10 }, (_, k) => vals.slice(Math.floor(n * k / 10), Math.floor(n * (k + 1) / 10)).reduce((a, b) => a + b, 0) / tv);
    chart("decile").setOption({
      textStyle: baseText(), grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      tooltip: tooltip({ trigger: "item", formatter: (p) => tipRows(`消费额第 ${p.dataIndex + 1} 组（前 ${(p.dataIndex + 1) * 10}%）`, [[T.s1, "贡献 GMV", fmtPct(p.value)]]) }),
      xAxis: catAxis(dec.map((_, k) => `前${(k + 1) * 10}%`.replace("前10%", "前10%"))), yAxis: valAxis((v) => (v * 100).toFixed(0) + "%"),
      series: [{ type: "bar", barMaxWidth: 28, data: dec.map((v, k) => ({ value: v, itemStyle: barStyle(k === 0 ? T.s1 : T.ghost) })),
        label: { show: true, position: "top", color: T.ink2, fontSize: 11, formatter: (p) => p.dataIndex === 0 ? fmtPct(p.value) : "" } }],
    }, true);

    // 下单次数分布
    const buckets = [["1次", 1, 1], ["2次", 2, 2], ["3次", 3, 3], ["4–5次", 4, 5], ["6–10次", 6, 10], ["11次以上", 11, 1e9]];
    const bc = buckets.map(() => 0); cnt.forEach((k) => { buckets.forEach((b, i) => { if (k >= b[1] && k <= b[2]) bc[i]++; }); });
    chart("freq").setOption({
      textStyle: baseText(), grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      tooltip: tooltip({ trigger: "item", formatter: (p) => tipRows(buckets[p.dataIndex][0], [[T.s1, "客户数", fmtInt(p.value)], [T.s1, "占比", fmtPct(p.value / cnt.size)]]) }),
      xAxis: catAxis(buckets.map((b) => b[0])), yAxis: valAxis((v) => v.toLocaleString()),
      series: [{ type: "bar", barMaxWidth: 28, data: bc, itemStyle: barStyle(T.s1),
        label: { show: true, position: "top", color: T.ink2, fontSize: 11, formatter: (p) => fmtPct(p.value / cnt.size, 0) } }],
    }, true);
  }

  // ---------- ⑤ 发现与建议（固定近 12 个月、全部市场） ----------
  function renderFindings() {
    const box = $("findings");
    if (!box.dataset.built) {
      const c = F.country, s = F.season, r = F.returns, h = F.cohort, k1 = F.kpi_p1, k2 = F.kpi_p2, g = F.definition_gap_p2;
      const top5 = Object.keys(c.top_overseas_p2).map((n) => D.countries_zh[D.countries.indexOf(n)]).join("、");
      const items = [
        { id: "f1", title: `英国基本持平，海外同比增长 ${pct(c.ov_yoy)}：增长主要来自海外`,
          body: [`近 12 个月英国 GMV 同比 <strong>${pct(c.uk_yoy)}</strong>，海外（英国以外）同比 <strong>${pct(c.ov_yoy)}</strong>。`,
            `海外客户只占 ${fp(c.ov_customer_share_p2)}，却贡献了 ${fp(c.ov_gmv_share_p2)} 的 GMV；海外客单价 <strong>£${Math.round(c.ov_aov_p2)}</strong>，英国 £${Math.round(c.uk_aov_p2)}。前五大海外市场：${top5}。`,
            `海外也有大客户集中的风险：第一大海外市场荷兰只有 <strong>${c.top_overseas_customers_p2.Netherlands} 个</strong>有编号的客户，贡献了海外 GMV 的 ${fp(c.nl_gmv_share_of_overseas_p2)}。`],
          advice: "把海外当成独立增长线经营：按前五大海外市场分别盯客户名单和复购，优先维护批发大客户，并补齐物流时效、本地节日等本地化动作。数据里没有获客和物流成本，加大投入前要先补这两项再算利润。",
          how: "同比 = 近 12 个月（2010-12 至 2011-11）GMV ÷ 前 12 个月 GMV − 1；海外 = 英国以外所有国家；客户占比按有编号客户去重。" },
        { id: "f2", title: `9–11 月贡献近 12 个月 ${fp(s.sep_nov_share_p2, 0)} 的 GMV，旺季集中明显`,
          body: [`最高的 11 月 GMV ${fmtMoney(s.monthly_p2["2011-11"])}，是最低的 2 月（${fmtMoney(s.monthly_p2["2011-02"])}）的 <strong>${s.peak_vs_low.toFixed(1)} 倍</strong>。`,
            `节日派对类商品有 <strong>${fp(s.festive_sep_nov_share, 0)}</strong> 的销售额落在 9–11 月（平均分布应为 25%）。`],
          advice: `旺季备货和营销要前置：9 月 GMV 比 8 月高 ${pct(s.monthly_p2["2011-09"] / s.monthly_p2["2011-08"] - 1)}，旺季从 9 月就开始，节日品类的上新和库存准备最好在 8 月底前完成；2 月、4 月等淡季适合做清库存和老客召回。`,
          how: "按发票日期汇总月度 GMV；节日派对品类按商品名关键词归类（规则见 scripts/build_data.py）。" },
        { id: "f3", title: `退货率被少数大额退单左右：前 10 张退货单占退货额的 ${fp(r.top10_share_p2, 0)}`,
          body: [`近 12 个月共 ${r.n_return_invoices_p2.toLocaleString()} 张退货单，金额最大的 10 张占退货额 <strong>${fp(r.top10_share_p2)}</strong>。`,
            `最大一张 £${Math.round(r.top1_p2).toLocaleString()}（2011-01-18，同一商品 74,215 件，下单 16 分钟后整单退回），同时也抬高了当月 GMV。剔除这 10 张，退货率从 ${fp(k2.return_rate, 2)} 降到 <strong>${fp(r.return_rate_ex_top10_p2, 2)}</strong>（分母不变）。`],
          advice: "退货率拆成两条线看：「常规退货率」反映商品和服务质量，「大额退单」单独做异常告警；对数量远超该客户历史水平的订单增加下单二次确认，减少误下单造成的 GMV 虚高。",
          how: "退货额 = C 开头退货单商品行金额绝对值，按退货日期归属；退货率 = 退货额 ÷ GMV。图中虚线为剔除近 12 个月金额最大的 10 张退货单后的月度退货率。" },
        { id: "f4", title: `收入高度依赖老客：复购客户贡献 ${fp(h.repeaters_gmv_share_p2, 0)} 的 GMV`,
          body: [`近 12 个月 ${fp(h.repeaters_share_p2, 0)} 的客户下单 2 次以上，贡献了 <strong>${fp(h.repeaters_gmv_share_p2)}</strong> 的 GMV；消费额前 10% 的客户贡献 <strong>${fp(h.top10pct_customers_gmv_share_p2)}</strong>。`,
            `新客首单后 90 天内再下单的比例为 <strong>${fp(h.new_90d_repeat)}</strong>；各月新客的次月留存平均 ${fp(h.m1_mean_2010_01_to_2011_10)}（最低 ${fp(h.m1_min)}，最高 ${fp(h.m1_max)}）。`],
          advice: "运营重点放在「新客第二单」：首单后 90 天内做召回（新品推荐、满额优惠）；前 10% 的大客户安排专人维护，监控下单间隔，超过平时间隔就提醒跟进。",
          how: "只统计有客户编号的订单。复购客户 = 时间段内下单 ≥ 2 次；新客 90 天复购只看首单在 2010-01-01 至 2011-08-31 的客户（共 " + h.new_customers_n.toLocaleString() + " 人），保证观察期完整；次月留存取 2010-01 至 2011-10 各批次的平均。" },
        { id: "f5", title: `数据口径与质量：${fp(k2.no_id_gmv_share, 1)} 的 GMV 找不到客户，同一个"销售额"口径差 ${fp(-g.raw_vs_net, 1)}`,
          body: [`近 12 个月 <strong>${fp(k2.no_id_gmv_share)}</strong> 的 GMV 来自没有客户编号的订单，比前 12 个月（${fp(k1.no_id_gmv_share)}）高 ${((k2.no_id_gmv_share - k1.no_id_gmv_share) * 100).toFixed(1)} 个百分点；旺季更高，2010-12 达 ${fp(F.no_id_monthly_top3["2010-12"])}、2011-11 达 ${fp(F.no_id_monthly_top3["2011-11"])}。这部分订单无法算复购、留存和客户价值。`,
            `同期"销售额"从原始加总 £${Math.round(g.raw_non_return_sum).toLocaleString()}，去重、去邮费后到 GMV £${Math.round(g.gmv).toLocaleString()}，再扣退货到净销售额 £${Math.round(g.net).toLocaleString()}，最宽和最窄口径相差 <strong>${fp(-g.raw_vs_net)}</strong>。`],
          advice: "下单环节要求关联客户编号（游客结账也生成唯一标识）；把「无编号 GMV 占比」作为数据质量护栏指标长期监控；对外汇报统一用指标文档里的口径，避免不同部门各报一个销售额。",
          how: "无编号 GMV 占比 = 无客户编号订单 GMV ÷ GMV；口径瀑布见 docs/指标定义.md 第 6 节，由 scripts/analysis.py 从原始数据计算。" },
      ];
      for (const [i, it] of items.entries()) {
        const card = document.createElement("article"); card.className = "card finding";
        const left = document.createElement("div");
        left.innerHTML = `<div class="num"><b>${i + 1}</b>Finding · 发现</div><h3></h3>${it.body.map((b) => `<p>${b}</p>`).join("")}<p class="advice"><span class="tag">建议 · Action</span></p><div class="how"></div>`;
        left.querySelector("h3").textContent = it.title;
        left.querySelectorAll("p")[it.body.length].appendChild(document.createTextNode(it.advice));
        left.querySelector(".how").textContent = "计算方法：" + it.how;
        const right = document.createElement("div"); right.className = "chart"; right.id = it.id;
        card.append(left, right); box.appendChild(card);
      }
      box.dataset.built = "1";
    }
    const P0 = 12, P1 = NM - 1, all = () => true;
    const months = []; for (let m = P0; m <= P1; m++) months.push(m);
    const grid = { left: 8, right: 12, top: 28, bottom: 4, containLabel: true };

    // f1：英国 vs 海外，两个小图（同比增速、客单价），不共用坐标轴
    const c = F.country;
    chart("f1").setOption({
      textStyle: baseText(),
      title: [{ text: "近 12 个月 GMV 同比", left: "2%", top: 0, textStyle: { fontSize: 12, color: T.ink2, fontWeight: 500 } },
        { text: "客单价（£）", left: "54%", top: 0, textStyle: { fontSize: 12, color: T.ink2, fontWeight: 500 } }],
      grid: [{ left: "2%", width: "42%", top: 34, bottom: 24 }, { left: "54%", width: "42%", top: 34, bottom: 24 }],
      tooltip: tooltip({ trigger: "item", formatter: (p) => tipRows(p.name, [[T.s1, p.seriesName, p.seriesIndex === 0 ? pct(p.value) : "£" + Math.round(p.value)]]) }),
      xAxis: [catAxis(["英国", "海外"], { gridIndex: 0 }), catAxis(["英国", "海外"], { gridIndex: 1 })],
      yAxis: [valAxis(() => "", { gridIndex: 0, splitLine: { show: false } }), valAxis(() => "", { gridIndex: 1, splitLine: { show: false } })],
      series: [
        { name: "GMV 同比", type: "bar", xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 40, data: [{ value: c.uk_yoy, itemStyle: barStyle(T.ghost) }, { value: c.ov_yoy, itemStyle: barStyle(T.s1) }], label: { show: true, position: "top", color: T.ink, formatter: (p) => pct(p.value) } },
        { name: "客单价", type: "bar", xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 40, data: [{ value: c.uk_aov_p2, itemStyle: barStyle(T.ghost) }, { value: c.ov_aov_p2, itemStyle: barStyle(T.s1) }], label: { show: true, position: "top", color: T.ink, formatter: (p) => "£" + Math.round(p.value) } },
      ],
    }, true);

    // f2：近 12 个月月度 GMV，9–11 月高亮
    const g = monthly(gmvMC, P0, P1, all);
    chart("f2").setOption({
      textStyle: baseText(), grid,
      tooltip: tooltip({ trigger: "item", formatter: (p) => tipRows(monthLabel(months[p.dataIndex]), [[T.s1, "GMV", fmtMoney(p.value)]]) }),
      xAxis: catAxis(months.map(shortMonth)), yAxis: valAxis(axisMoney),
      series: [{ type: "bar", barMaxWidth: 22, data: g.map((v, i) => ({ value: v, itemStyle: barStyle([9, 10, 11].includes(+D.months[months[i]].slice(5)) ? T.s1 : T.ghost) })),
        label: { show: true, position: "top", color: T.ink2, fontSize: 11, formatter: (p) => [9, 10, 11].includes(+D.months[months[p.dataIndex]].slice(5)) ? fmtMoney(p.value) : "" } }],
    }, true);

    // f3：月度退货率，全部 vs 剔除前 10 大退货单
    const idx = []; for (let i = 0; i < R.n; i++) if (R.m[i] >= P0 && R.m[i] <= P1) idx.push(i);
    idx.sort((a, b) => R.v[b] - R.v[a]);
    const top10 = new Set(idx.slice(0, 10));
    const rAll = new Array(months.length).fill(0), rEx = new Array(months.length).fill(0);
    for (const i of idx) { rAll[R.m[i] - P0] += R.v[i]; if (!top10.has(i)) rEx[R.m[i] - P0] += R.v[i]; }
    const lineS = (name, data, color, dashed) => ({ name, type: "line", data, symbol: "circle", symbolSize: 8, lineStyle: { width: 2, color, type: dashed ? "dashed" : "solid" }, itemStyle: { color, borderColor: T.surface, borderWidth: 2 } });
    chart("f3").setOption({
      textStyle: baseText(), grid, legend: legend(true),
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "line", lineStyle: { color: T.axis } }, formatter: (p) => tipRows(monthLabel(months[p[0].dataIndex]), p.map((s) => [s.color, s.seriesName, fmtPct(s.value, 2)])) }),
      xAxis: catAxis(months.map(shortMonth), { boundaryGap: false }), yAxis: valAxis((v) => (v * 100).toFixed(0) + "%"),
      series: [lineS("全部退货", rAll.map((v, i) => v / g[i]), T.s1), lineS("剔除前 10 大退货单", rEx.map((v, i) => v / g[i]), T.s2, true)],
    }, true);

    // f4：近 12 个月客户价值十分位
    const { val } = customers(P0, P1, all);
    const vals = [...val.values()].sort((a, b) => b - a), n = vals.length, tv = vals.reduce((a, b) => a + b, 0);
    const dec = Array.from({ length: 10 }, (_, k) => vals.slice(Math.floor(n * k / 10), Math.floor(n * (k + 1) / 10)).reduce((a, b) => a + b, 0) / tv);
    chart("f4").setOption({
      textStyle: baseText(), grid: Object.assign({}, grid, { top: 34 }),
      title: { text: "客户按消费额分 10 组，各组贡献 GMV", left: 0, top: 0, textStyle: { fontSize: 12, color: T.ink2, fontWeight: 500 } },
      tooltip: tooltip({ trigger: "item", formatter: (p) => tipRows(`前 ${(p.dataIndex + 1) * 10}% 这一组`, [[T.s1, "贡献 GMV", fmtPct(p.value)]]) }),
      xAxis: catAxis(dec.map((_, k) => `${k * 10}–${(k + 1) * 10}%`)), yAxis: valAxis((v) => (v * 100).toFixed(0) + "%"),
      series: [{ type: "bar", barMaxWidth: 26, data: dec.map((v, k) => ({ value: v, itemStyle: barStyle(k === 0 ? T.s1 : T.ghost) })),
        label: { show: true, position: "top", color: T.ink2, fontSize: 11, formatter: (p) => p.dataIndex <= 1 ? fmtPct(p.value) : "" } }],
    }, true);

    // f5：24 个月无编号 GMV 占比
    const all24 = []; for (let m = 0; m < NM; m++) all24.push(m);
    const gg = monthly(gmvMC, 0, NM - 1, all), nn = monthly(noIdMC, 0, NM - 1, all);
    chart("f5").setOption({
      textStyle: baseText(), grid: Object.assign({}, grid, { top: 34 }),
      title: { text: "每月无客户编号订单占 GMV 比例", left: 0, top: 0, textStyle: { fontSize: 12, color: T.ink2, fontWeight: 500 } },
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "line", lineStyle: { color: T.axis } }, formatter: (p) => tipRows(monthLabel(all24[p[0].dataIndex]), [[T.s1, "无编号 GMV 占比", fmtPct(p[0].value)]]) }),
      xAxis: catAxis(all24.map(shortMonth), { boundaryGap: false }), yAxis: valAxis((v) => (v * 100).toFixed(0) + "%"),
      series: [lineS("无编号 GMV 占比", nn.map((v, i) => v / gg[i]), T.s1)],
    }, true);
  }
  function fp(x, d = 1) { return (x * 100).toFixed(d) + "%"; }
  function pct(x) { return (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%"; }

  // ---------- 渲染 ----------
  function render() {
    syncControls();
    ({ overview: renderOverview, trend: renderTrend, drill: renderDrill, retention: renderRetention, findings: renderFindings })[state.tab]();
    requestAnimationFrame(() => Object.values(charts).forEach((c) => c.getDom().offsetParent && c.resize()));
  }
  initFilters();
  // 支持链接直达：#findings、#drill 等
  const h = location.hash.slice(1);
  if (["overview", "trend", "drill", "retention", "findings"].includes(h)) state.tab = h;
  render();
  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.getDom().offsetParent && c.resize()));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { T = theme(); render(); });
  window.__dash = { state, render }; // 方便截图脚本切换页面
})();
