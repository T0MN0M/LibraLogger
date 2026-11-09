// Analytics page: Graphs (Dashboard.render_Graph / apply_Filter) + Goals (Budget.set_Budget).
document.addEventListener("DOMContentLoaded", async () => {
  const api = window.LibraAPI;
  const { formatMoney, formatDate, toISODate, parseISODate, periodRange } = api.util;
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const tooltip = $("tooltip");

  let range = "MONTH";
  let [purchases, categories, budget, streak] = await Promise.all([
    api.getTransactions(),
    api.getCategories(),
    api.getBudget(),
    api.getStreak(),
  ]);

  // ----- Time-range filter -----
  $("rangeControl").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-range]");
    if (!btn) return;
    range = btn.dataset.range;
    $("rangeControl")
      .querySelectorAll("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    render();
  });

  // ----- Goals form -----
  const goalForm = $("goalForm");
  const g = goalForm.elements;
  g.period.value = budget.period;
  g.limit_amount.value = budget.limit_amount;
  g.alert_threshold.value = budget.alert_threshold;
  $("goalStreak").textContent = streak?.weeks_under_budget ?? 0;

  goalForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const limit = Number(g.limit_amount.value);
    const threshold = Number(g.alert_threshold.value);
    const status = $("goalStatus");
    if (!(limit > 0) || !(threshold >= 1 && threshold <= 100)) {
      status.style.color = "var(--error)";
      status.textContent = "Enter a limit above $0 and an alert between 1% and 100%.";
      return;
    }
    budget = await api.setBudget({ period: g.period.value, limit_amount: limit, alert_threshold: threshold });
    status.style.color = "";
    status.textContent = `Saved: ${formatMoney(limit)} per ${budget.period === "WEEKLY" ? "week" : "month"}, alert at ${threshold}%.`;
    render();
  });

  render();

  // =================================================================
  function currentRange() {
    const today = new Date();
    if (range === "WEEK") return periodRange("WEEKLY", today);
    if (range === "MONTH") return periodRange("MONTHLY", today);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 89);
    return { start, end: new Date(today.getFullYear(), today.getMonth(), today.getDate()) };
  }

  function render() {
    const { start, end } = currentRange();
    const startISO = toISODate(start);
    const endISO = toISODate(end);
    const todayISO = toISODate(new Date());
    const rows = purchases.filter((p) => !p.is_refunded && p.date >= startISO && p.date <= endISO);

    // Daily totals from start to today (or end of range, whichever is first)
    const days = [];
    const lastISO = todayISO < endISO ? todayISO : endISO;
    let running = 0;
    for (let d = new Date(start); toISODate(d) <= lastISO; d.setDate(d.getDate() + 1)) {
      const iso = toISODate(d);
      const spent = rows.filter((r) => r.date === iso).reduce((s, r) => s + Number(r.amount), 0);
      running += spent;
      days.push({ date: iso, spent, cumulative: running });
    }

    // KPIs
    const byCat = new Map();
    for (const r of rows) byCat.set(r.category_ID, (byCat.get(r.category_ID) || 0) + Number(r.amount));
    const catName = (id) => categories.find((c) => c.category_ID === id)?.name ?? "Other";
    const ranked = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

    $("kpiTotal").textContent = formatMoney(running);
    $("kpiAvg").textContent = formatMoney(days.length ? running / days.length : 0);
    $("kpiTop").textContent = ranked.length ? catName(ranked[0][0]) : "–";
    $("kpiCount").textContent = rows.length;

    // Show the budget limit only when the range matches the budget period
    const showLimit =
      (range === "WEEK" && budget.period === "WEEKLY") || (range === "MONTH" && budget.period === "MONTHLY");

    renderLine(days, start, end, showLimit ? Number(budget.limit_amount) : null);
    renderBars(ranked, running, catName);
    renderTable(days);
  }

  // ----- Line chart: cumulative spend (single series, so no legend) -----
  function renderLine(days, start, end, limit) {
    const W = 560, H = 260;
    const m = { l: 56, r: 16, t: 16, b: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const totalDays = Math.round((end - start) / 86400000);

    const maxY = Math.max(1, days.at(-1)?.cumulative ?? 0, limit ?? 0) * 1.1;
    const step = niceStep(maxY / 4);
    const yMax = Math.ceil(maxY / step) * step;
    const x = (iso) => m.l + (totalDays ? ((parseISODate(iso) - start) / 86400000 / totalDays) * iw : iw / 2);
    const y = (v) => m.t + ih - (v / yMax) * ih;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Cumulative spending over time" });

    // Recessive grid + y-axis labels
    const grid = el("g", { class: "grid" });
    const axis = el("g", { class: "axis" });
    for (let v = 0; v <= yMax + 0.01; v += step) {
      if (v > 0) grid.append(el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      axis.append(text(m.l - 8, y(v) + 4, compactMoney(v), "end"));
    }
    // x-axis labels (~5)
    const tickCount = Math.min(5, totalDays + 1);
    for (let i = 0; i < tickCount; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + Math.round((i / Math.max(1, tickCount - 1)) * totalDays));
      const iso = toISODate(d);
      axis.append(text(x(iso), H - 8, formatDate(iso), i === 0 ? "start" : i === tickCount - 1 ? "end" : "middle"));
    }
    svg.append(grid, axis, el("line", { class: "baseline", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));

    if (limit) {
      svg.append(el("line", { class: "limit", x1: m.l, x2: W - m.r, y1: y(limit), y2: y(limit) }));
      const label = text(W - m.r, y(limit) - 6, `Budget ${formatMoney(limit)}`, "end");
      label.setAttribute("class", "limit-label");
      svg.append(label);
    }

    if (days.length) {
      const pts = days.map((d) => `${x(d.date)},${y(d.cumulative)}`);
      svg.append(el("path", { class: "area", d: `M${x(days[0].date)},${y(0)} L${pts.join(" L")} L${x(days.at(-1).date)},${y(0)} Z` }));
      svg.append(el("path", { class: "series", d: `M${pts.join(" L")}` }));
    }

    // Hover layer: crosshair + dot + tooltip
    const cross = el("line", { class: "crosshair", y1: m.t, y2: m.t + ih, visibility: "hidden" });
    const dot = el("circle", { class: "dot", r: 5, visibility: "hidden" });
    const hit = el("rect", { class: "hit", x: m.l, y: m.t, width: iw, height: ih });
    svg.append(cross, dot, hit);

    hit.addEventListener("pointermove", (e) => {
      if (!days.length) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const px = pt.matrixTransform(svg.getScreenCTM().inverse()).x;
      const nearest = days.reduce((best, d) => (Math.abs(x(d.date) - px) < Math.abs(x(best.date) - px) ? d : best));
      const cx = x(nearest.date), cy = y(nearest.cumulative);
      cross.setAttribute("x1", cx);
      cross.setAttribute("x2", cx);
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", cy);
      cross.setAttribute("visibility", "visible");
      dot.setAttribute("visibility", "visible");

      const r = dot.getBoundingClientRect();
      showTooltip(
        r.left + r.width / 2,
        r.top,
        `${formatDate(nearest.date, { weekday: "short", month: "short", day: "numeric" })}<br>` +
          `Spent that day: <strong>${formatMoney(nearest.spent)}</strong><br>` +
          `Total so far: <strong>${formatMoney(nearest.cumulative)}</strong>`
      );
    });
    hit.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      hideTooltip();
    });

    $("lineChart").replaceChildren(svg);
  }

  // ----- Ranked horizontal bars (one hue, largest first) -----
  function renderBars(ranked, total, catName) {
    const list = $("categoryBars");
    if (!ranked.length) {
      list.innerHTML = '<li class="empty-state">No spending in this range.</li>';
      return;
    }
    const max = ranked[0][1];
    list.replaceChildren(
      ...ranked.map(([id, amount]) => {
        const li = document.createElement("li");
        li.className = "bar-row";
        li.tabIndex = 0;
        const share = total ? Math.round((amount / total) * 100) : 0;
        li.innerHTML = `
          <span class="bar-name"></span>
          <span class="bar-track"><span class="bar-fill" style="display:block;width:${(amount / max) * 100}%"></span></span>
          <span class="bar-value">${formatMoney(amount)}</span>`;
        li.querySelector(".bar-name").textContent = catName(id);

        const tip = `<strong>${escapeHTML(catName(id))}</strong><br>${formatMoney(amount)} · ${share}% of spending`;
        const show = () => {
          const r = li.querySelector(".bar-fill").getBoundingClientRect();
          showTooltip(r.right, r.top, tip);
        };
        li.addEventListener("pointerenter", show);
        li.addEventListener("focus", show);
        li.addEventListener("pointerleave", hideTooltip);
        li.addEventListener("blur", hideTooltip);
        return li;
      })
    );
  }

  function renderTable(days) {
    const table = $("lineTable");
    table.innerHTML = "<thead><tr><th>Date</th><th>Spent</th><th>Total so far</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const d of days.filter((d) => d.spent > 0)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${formatDate(d.date)}</td><td>${formatMoney(d.spent)}</td><td>${formatMoney(d.cumulative)}</td>`;
      tbody.append(tr);
    }
    table.append(tbody);
  }

  // ----- Helpers -----
  function el(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function text(xp, yp, str, anchor = "start") {
    const t = el("text", { x: xp, y: yp, "text-anchor": anchor });
    t.textContent = str;
    return t;
  }

  // Category names will come from the database, so escape before using innerHTML.
  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function niceStep(raw) {
    const pow = 10 ** Math.floor(Math.log10(raw));
    const n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }

  function compactMoney(v) {
    return v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : `$${Math.round(v)}`;
  }

  function showTooltip(px, py, html) {
    tooltip.innerHTML = html;
    tooltip.style.left = `${px}px`;
    tooltip.style.top = `${py}px`;
    tooltip.hidden = false;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }
});
