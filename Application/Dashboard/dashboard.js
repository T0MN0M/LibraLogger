// Dashboard: the main landing page after login.
// Reads data only (per Logical View note 5) — all writes happen on other pages.
document.addEventListener("DOMContentLoaded", async () => {
  const api = window.LibraAPI;
  const { formatMoney, formatDate } = api.util;
  const $ = (id) => document.getElementById(id);

  // ----- Encouragement messages by % of budget REMAINING -----
  // (Declared before the data loads below: renderBudget() reads them.)
  // Levels match the arc colors: green > 75%, yellow 50–75%, orange 25–50%, red under 25%.
  // When a level has more than one message, one is picked at random on each visit.
  const BUDGET_MESSAGES = [
    {
      level: "great", // more than 75% left
      min: 75,
      texts: ["You're doing great! Keep up the good spending habits!", "You're a spending wizard, Harry!"],
    },
    {
      level: "good", // 50% – 75% left
      min: 50,
      texts: ["More than half your budget remains."],
    },
    {
      level: "wary", // 25% – 50% left
      min: 25,
      texts: [
        "Be wary of your spending, less than half of your budget remains.",
        "Like the sand of time, your budget is being spent",
      ],
    },
    {
      level: "caution", // 1% – 25% left (anything above 0%)
      min: 0,
      texts: ["Proceed with caution, your budget dwindles."],
    },
  ];
  const OUT_OF_BUDGET = {
    level: "empty", // 0% left, or over budget
    texts: ["You ran out of budget for this period, better luck next time...", "Game over. Try to spend less next period"],
  };

  try {
    const [status, recent, categories, profile, streak] = await Promise.all([
      api.getBudgetStatus(),
      api.getTransactions({ limit: 7 }),
      api.getCategories(),
      api.getProfile(),
      api.getStreak(),
    ]);
    renderBudget(status);
    renderRecent(recent, categories);
    renderProfile(profile, streak);
  } catch (err) {
    console.error(err);
    $("recentList").innerHTML = '<li class="empty-state">Could not load data.</li>';
    $("budgetStatus").querySelector(".status-text").textContent = "Could not load budget.";
  }

  // ----- Center: budget meter (Dashboard.display_Budget_Status) -----
  function renderBudget(s) {
    const pct = s.percent_used;
    const meter = $("budgetMeter");
    meter.dataset.status = s.status;

    // Arc fill uses pathLength=100, so the dash length is the percentage (capped at 100).
    // Set via style (not the attribute) so the CSS transition animates it.
    // Gap of 200 (> path length 100) so the dash never repeats as a dot at the 100% end.
    const fill = $("meterFill");
    fill.style.visibility = pct > 0 ? "visible" : "hidden"; // no round-cap dot at 0%
    requestAnimationFrame(() => {
      fill.style.strokeDasharray = `${Math.min(pct, 100)} 200`;
    });

    // Threshold tick across the arc at alert_threshold %.
    const theta = Math.PI * (1 - s.alert_threshold / 100);
    const cx = 120, cy = 120, r = 100;
    const tick = $("meterTick");
    tick.setAttribute("x1", cx + (r - 16) * Math.cos(theta));
    tick.setAttribute("y1", cy - (r - 16) * Math.sin(theta));
    tick.setAttribute("x2", cx + (r + 16) * Math.cos(theta));
    tick.setAttribute("y2", cy - (r + 16) * Math.sin(theta));

    $("meterPct").textContent = `${Math.round(pct)}%`;
    $("meterDesc").textContent = `${Math.round(pct)}% of budget used; alert at ${s.alert_threshold}%`;

    const messages = {
      good: "On track",
      warning: `Heads up — past your ${s.alert_threshold}% alert`,
      critical: "Over budget",
    };
    const statusEl = $("budgetStatus");
    statusEl.dataset.status = s.status;
    statusEl.querySelector(".status-text").textContent = messages[s.status];

    $("budgetPeriodLabel").textContent = s.period === "WEEKLY" ? "Weekly Budget" : "Monthly Budget";
    $("budgetSpent").textContent = formatMoney(s.current_spent);
    $("budgetLimit").textContent = formatMoney(s.limit_amount);
    $("budgetLeft").textContent = s.remaining >= 0 ? formatMoney(s.remaining) : `−${formatMoney(-s.remaining)}`;

    const unit = s.period === "WEEKLY" ? "week" : "month";
    $("budgetPeriod").textContent =
      `${formatDate(s.period_start)} – ${formatDate(s.period_end)} · day ${s.day_of_period} of ${s.days_in_period} this ${unit}`;

    renderMessage(100 - pct);
  }

  // ----- Center: encouragement message -----
  function renderMessage(remainingPct) {
    const bucket =
      remainingPct <= 0 ? OUT_OF_BUDGET : BUDGET_MESSAGES.find((b) => remainingPct > b.min) ?? BUDGET_MESSAGES.at(-1);
    const el = $("budgetMessage");
    el.dataset.level = bucket.level;
    el.textContent = bucket.texts[Math.floor(Math.random() * bucket.texts.length)];
  }

  // ----- Left: recent transactions (Dashboard.recent_Transactions) -----
  function renderRecent(rows, categories) {
    const list = $("recentList");
    if (!rows.length) {
      list.innerHTML = '<li class="empty-state">No transactions yet.</li>';
      return;
    }
    const catName = (id) => categories.find((c) => c.category_ID === id)?.name ?? "Other";
    list.replaceChildren(
      ...rows.map((tx) => {
        const li = document.createElement("li");
        li.className = "tx-item" + (tx.is_refunded ? " refunded" : "");

        const icon = document.createElement("span");
        icon.className = "tx-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = catName(tx.category_ID).charAt(0);

        const info = document.createElement("div");
        info.style.minWidth = "0";
        const name = document.createElement("div");
        name.className = "tx-name";
        name.textContent = tx.name;
        const meta = document.createElement("div");
        meta.className = "tx-meta";
        meta.textContent = `${formatDate(tx.date)} · ${catName(tx.category_ID)}${tx.recurring ? " · recurring" : ""}${tx.is_refunded ? " · refunded" : ""}`;
        info.append(name, meta);

        const amount = document.createElement("span");
        amount.className = "tx-amount";
        amount.textContent = `−${formatMoney(tx.amount)}`;

        li.append(icon, info, amount);
        return li;
      })
    );
  }

  // ----- Right: profile card (Profile.load_Profile_Card) -----
  function renderProfile(p, streak) {
    $("profileName").textContent = p.user_name;
    $("profileNickname").textContent = p.nickname ? `“${p.nickname}”` : "";
    $("profileEmail").textContent = p.user_email;
    $("profileSince").textContent = p.created_at
      ? formatDate(p.created_at, { month: "short", year: "numeric" })
      : "–";
    $("profileBirthday").textContent = p.birthday ? formatDate(p.birthday) : "Not set";
    $("profile2fa").textContent = p.status_2FA ? "Enabled" : "Off";
    $("streakCount").textContent = streak?.weeks_under_budget ?? 0;

    const avatar = $("profileAvatar");
    if (p.profile_border) avatar.style.borderColor = p.profile_border;
    if (p.profile_color) avatar.style.color = p.profile_color;
    if (p.profile_picture) {
      const img = document.createElement("img");
      img.src = p.profile_picture;
      img.alt = "";
      avatar.replaceChildren(img);
    }
  }
});
