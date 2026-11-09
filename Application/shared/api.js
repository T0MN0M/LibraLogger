/* =====================================================================
   Libra Logger — data access layer (window.LibraAPI)

   Every page talks to data ONLY through this file. Right now it runs in
   "mock" mode (sample data saved in the browser's localStorage) so the
   pages work by just opening the HTML files.

   When the Node.js + MySQL backend is deployed on Railway:
     1. Set LIBRA_CONFIG.mode = "remote"
     2. Set LIBRA_CONFIG.baseUrl to the Railway service URL
        (or leave "" if the server also serves these HTML files)
     3. Implement the REST endpoints listed in ENDPOINTS below.

   Field names are the MySQL column names from Database/schema.sql
   (user_ID, purchase_ID, amount, category_ID, ...), so JSON rows from the
   server can be dropped in without any renaming.
   All functions are async and return Promises in both modes.
   ===================================================================== */
(function () {
  const LIBRA_CONFIG = {
    mode: "mock", // "mock" | "remote"
    baseUrl: "", // e.g. "https://libra-logger-production.up.railway.app"
    appVersion: "0.1.0",
  };

  // REST endpoints the backend should expose (remote mode).
  const ENDPOINTS = {
    login: ["POST", "/api/auth/login"],
    logout: ["POST", "/api/auth/logout"],
    getProfile: ["GET", "/api/profile"],
    updateProfile: ["PATCH", "/api/profile"],
    getBudget: ["GET", "/api/budget"],
    setBudget: ["PUT", "/api/budget"],
    getBudgetStatus: ["GET", "/api/budget/status"],
    getTransactions: ["GET", "/api/purchases"],
    addTransaction: ["POST", "/api/purchases"],
    editTransaction: ["PATCH", "/api/purchases/:id"],
    removeTransaction: ["DELETE", "/api/purchases/:id"],
    getCategories: ["GET", "/api/categories"],
    getStreak: ["GET", "/api/streak"],
    getResources: ["GET", "/api/resources"],
    resetUserData: ["POST", "/api/user/reset"],
    deleteAccount: ["DELETE", "/api/user"],
    getAppVersion: ["GET", "/api/version"],
  };

  // ------------------------------------------------------------------
  // Date helpers ("YYYY-MM-DD" strings, same as MySQL DATE)
  // ------------------------------------------------------------------
  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseISODate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return toISODate(d);
  }

  /** Start/end (inclusive) of the current budget period. */
  function periodRange(period, now = new Date()) {
    if (period === "WEEKLY") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const offset = (start.getDay() + 6) % 7; // Monday = 0
      start.setDate(start.getDate() - offset);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, end };
  }

  /** Budget.display_Budget_Status() / calculate_Performance() logic. */
  function computeBudgetStatus(budget, purchases, now = new Date()) {
    const { start, end } = periodRange(budget.period, now);
    const startISO = toISODate(start);
    const endISO = toISODate(end);
    const current_spent = purchases
      .filter((p) => !p.is_refunded && p.date >= startISO && p.date <= endISO)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const limit = Number(budget.limit_amount);
    const pct = limit > 0 ? (current_spent / limit) * 100 : 0;
    const totalDays = Math.round((end - start) / 86400000) + 1;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfPeriod = Math.min(totalDays, Math.round((today - start) / 86400000) + 1);

    let status = "good";
    let alert = null; // Alert.type from the Logical View
    if (pct >= 100) {
      status = "critical";
      alert = "EXCEEDED_100";
    } else if (pct >= budget.alert_threshold) {
      status = "warning";
      alert = "NEAR_80";
    }

    return {
      ...budget,
      current_spent: Math.round(current_spent * 100) / 100,
      remaining: Math.round((limit - current_spent) * 100) / 100,
      percent_used: pct,
      status,
      alert,
      period_start: startISO,
      period_end: endISO,
      day_of_period: dayOfPeriod,
      days_in_period: totalDays,
    };
  }

  // ------------------------------------------------------------------
  // Remote mode (Node.js server on Railway -> MySQL)
  // ------------------------------------------------------------------
  async function http(name, { id, body, query } = {}) {
    const [method, pathTemplate] = ENDPOINTS[name];
    let url = LIBRA_CONFIG.baseUrl + pathTemplate.replace(":id", encodeURIComponent(id));
    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
      ).toString();
      if (qs) url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      credentials: "include", // session cookie set by the server at login
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${pathTemplate} failed (${res.status})`);
    return res.status === 204 ? null : res.json();
  }

  // ------------------------------------------------------------------
  // Mock mode (localStorage). Mirrors the MySQL tables one-to-one.
  // ------------------------------------------------------------------
  const STORE_KEY = "libra.mock.v1";
  const SESSION_KEY = "libra.session";

  const DEFAULT_CATEGORIES = [
    { category_ID: 1, name: "Food & Dining", is_default: true },
    { category_ID: 2, name: "Groceries", is_default: true },
    { category_ID: 3, name: "Transportation", is_default: true },
    { category_ID: 4, name: "Entertainment", is_default: true },
    { category_ID: 5, name: "School", is_default: true },
    { category_ID: 6, name: "Subscriptions", is_default: true },
    { category_ID: 7, name: "Housing", is_default: true },
    { category_ID: 8, name: "Other", is_default: true },
  ];

  function seedData() {
    const p = (id, name, amount, ago, category_ID, extra = {}) => ({
      purchase_ID: id,
      user_ID: 1,
      name,
      amount,
      date: daysAgo(ago),
      description: "",
      recurring: false,
      category_ID,
      is_refunded: false,
      ...extra,
    });

    return {
      users: [
        { user_ID: 1, user_name: "Test User 01", user_email: "example@gmail.com", is_verified: true, created_at: daysAgo(120) },
      ],
      profiles: [
        {
          profile_ID: 1,
          user_ID: 1,
          nickname: "",
          birthday: "",
          profile_picture: null,
          profile_icon: "comet",
          profile_color: "#5fe0b7",
          profile_border: "#e87500",
          status_2FA: false,
        },
      ],
      categories: DEFAULT_CATEGORIES,
      budgets: [
        { budget_ID: 1, user_ID: 1, period: "MONTHLY", limit_amount: 800, alert_threshold: 80, category_ID: null },
      ],
      streaks: [{ streak_ID: 1, user_ID: 1, weeks_under_budget: 3, last_updated: daysAgo(2) }],
      purchases: [
        p(1, "Chick-fil-A", 11.42, 0, 1),
        p(2, "DART Monthly Pass", 32.0, 1, 3, { recurring: true }),
        p(3, "Tom Thumb", 54.87, 2, 2),
        p(4, "Spotify Student", 5.99, 3, 6, { recurring: true }),
        p(5, "Calculus Textbook", 89.5, 4, 5, { description: "Used copy from the bookstore" }),
        p(6, "Movie Night", 15.0, 5, 4),
        p(7, "Shell Gas", 38.21, 6, 3),
        p(8, "Starbucks", 6.75, 7, 1),
        p(9, "Walmart", 42.3, 9, 2),
        p(10, "Rent Share", 450.0, 10, 7, { recurring: true }),
        p(11, "Netflix", 7.99, 12, 6, { recurring: true }),
        p(12, "Lab Goggles", 12.0, 14, 5, { is_refunded: true }),
        p(13, "Taco Bell", 9.18, 16, 1),
        p(14, "Concert Tickets", 60.0, 20, 4),
        p(15, "Kroger", 47.66, 24, 2),
      ],
      resources: [
        {
          resource_ID: 1,
          resource_name: "UTD Office of Financial Aid",
          category: "Aid",
          description: "Grants, loans, work-study and FAFSA help for Comets.",
          resource_link: "https://financialaid.utdallas.edu/",
          resource_image: null,
        },
        {
          resource_ID: 2,
          resource_name: "UTD Scholarships",
          category: "Aid",
          description: "Search and apply for university scholarships in one portal.",
          resource_link: "https://utdallas.academicworks.com/",
          resource_image: null,
        },
        {
          resource_ID: 3,
          resource_name: "Comet Cupboard",
          category: "Food",
          description: "Free food pantry for UTD students. (TODO: confirm official link)",
          resource_link: "https://www.utdallas.edu/",
          resource_image: null,
        },
        {
          resource_ID: 4,
          resource_name: "Federal Student Aid",
          category: "Aid",
          description: "File the FAFSA and manage federal student loans.",
          resource_link: "https://studentaid.gov/",
          resource_image: null,
        },
        {
          resource_ID: 5,
          resource_name: "CFPB — Budgeting Tools",
          category: "Tips",
          description: "Free worksheets for building a budget and tracking spending.",
          resource_link: "https://www.consumerfinance.gov/consumer-tools/",
          resource_image: null,
        },
        {
          resource_ID: 6,
          resource_name: "Student Discounts",
          category: "Tips",
          description: "Always ask for a student discount — show your Comet Card. (TODO: curate list)",
          resource_link: "https://www.utdallas.edu/",
          resource_image: null,
        },
      ],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("LibraAPI: could not read mock data, reseeding.", e);
    }
    const data = seedData();
    save(data);
    return data;
  }

  function save(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("LibraAPI: could not save mock data.", e);
    }
  }

  function currentUserId() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY))?.user_ID ?? 1;
    } catch {
      return 1;
    }
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const byNewest = (a, b) => (a.date === b.date ? b.purchase_ID - a.purchase_ID : a.date < b.date ? 1 : -1);

  const mock = {
    async login(user_email /*, password */) {
      // TODO(remote): real check happens on the server (hash_password).
      const db = load();
      const user = db.users.find((u) => u.user_email === user_email) || db.users[0];
      localStorage.setItem(SESSION_KEY, JSON.stringify({ user_ID: user.user_ID }));
      return { user_ID: user.user_ID };
    },

    async logout() {
      localStorage.removeItem(SESSION_KEY);
      return null;
    },

    async getProfile() {
      const db = load();
      const uid = currentUserId();
      const user = db.users.find((u) => u.user_ID === uid) || db.users[0];
      const profile = db.profiles.find((p) => p.user_ID === user.user_ID);
      return clone({ ...user, ...profile });
    },

    async updateProfile(fields) {
      const db = load();
      const uid = currentUserId();
      const user = db.users.find((u) => u.user_ID === uid) || db.users[0];
      const profile = db.profiles.find((p) => p.user_ID === user.user_ID);
      const userCols = ["user_name", "user_email"];
      for (const [k, v] of Object.entries(fields)) {
        if (userCols.includes(k)) user[k] = v;
        else if (k in profile) profile[k] = v;
      }
      save(db);
      return clone({ ...user, ...profile });
    },

    async getBudget() {
      const db = load();
      return clone(db.budgets.find((b) => b.user_ID === currentUserId()) || db.budgets[0]);
    },

    async setBudget(fields) {
      const db = load();
      const budget = db.budgets.find((b) => b.user_ID === currentUserId()) || db.budgets[0];
      Object.assign(budget, fields);
      save(db);
      return clone(budget);
    },

    async getBudgetStatus() {
      const db = load();
      const budget = db.budgets.find((b) => b.user_ID === currentUserId()) || db.budgets[0];
      return computeBudgetStatus(budget, db.purchases.filter((p) => p.user_ID === budget.user_ID));
    },

    async getTransactions({ limit, category_ID, from, to } = {}) {
      const db = load();
      let rows = db.purchases.filter((p) => p.user_ID === currentUserId());
      if (category_ID) rows = rows.filter((p) => p.category_ID === Number(category_ID));
      if (from) rows = rows.filter((p) => p.date >= from);
      if (to) rows = rows.filter((p) => p.date <= to);
      rows.sort(byNewest);
      return clone(limit ? rows.slice(0, limit) : rows);
    },

    async addTransaction(data) {
      const db = load();
      const nextId = db.purchases.reduce((m, p) => Math.max(m, p.purchase_ID), 0) + 1;
      const row = {
        purchase_ID: nextId,
        user_ID: currentUserId(),
        name: data.name,
        amount: Number(data.amount),
        date: data.date || toISODate(new Date()),
        description: data.description || "",
        recurring: Boolean(data.recurring),
        category_ID: Number(data.category_ID) || 8,
        is_refunded: false,
      };
      db.purchases.push(row);
      save(db);
      return clone(row);
    },

    async editTransaction(id, fields) {
      const db = load();
      const row = db.purchases.find((p) => p.purchase_ID === Number(id));
      if (!row) throw new Error(`Purchase ${id} not found`);
      Object.assign(row, fields);
      save(db);
      return clone(row);
    },

    async removeTransaction(id) {
      const db = load();
      db.purchases = db.purchases.filter((p) => p.purchase_ID !== Number(id));
      save(db);
      return null;
    },

    async getCategories() {
      return clone(load().categories);
    },

    async getStreak() {
      const db = load();
      return clone(db.streaks.find((s) => s.user_ID === currentUserId()) || db.streaks[0]);
    },

    async getResources() {
      return clone(load().resources);
    },

    async resetUserData() {
      localStorage.removeItem(STORE_KEY);
      load();
      return null;
    },

    async deleteAccount() {
      // Mock: same as reset + log out. Remote: server deletes the user row (cascade).
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(SESSION_KEY);
      return null;
    },

    async getAppVersion() {
      return { version: LIBRA_CONFIG.appVersion, mode: LIBRA_CONFIG.mode };
    },
  };

  const remote = {
    login: (user_email, password) => http("login", { body: { user_email, password } }),
    logout: () => http("logout"),
    getProfile: () => http("getProfile"),
    updateProfile: (fields) => http("updateProfile", { body: fields }),
    getBudget: () => http("getBudget"),
    setBudget: (fields) => http("setBudget", { body: fields }),
    getBudgetStatus: () => http("getBudgetStatus"),
    getTransactions: (query = {}) => http("getTransactions", { query }),
    addTransaction: (data) => http("addTransaction", { body: data }),
    editTransaction: (id, fields) => http("editTransaction", { id, body: fields }),
    removeTransaction: (id) => http("removeTransaction", { id }),
    getCategories: () => http("getCategories"),
    getStreak: () => http("getStreak"),
    getResources: () => http("getResources"),
    resetUserData: () => http("resetUserData"),
    deleteAccount: () => http("deleteAccount"),
    getAppVersion: () => http("getAppVersion"),
  };

  // ------------------------------------------------------------------
  // Helpers that work the same in both modes
  // ------------------------------------------------------------------

  /** Purchase.export_Transactions(): returns CSV text for the given rows. */
  function transactionsToCSV(rows, categories) {
    const catName = (id) => categories.find((c) => c.category_ID === id)?.name ?? "";
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["purchase_ID", "date", "name", "amount", "category", "description", "recurring", "is_refunded"];
    const lines = rows.map((r) =>
      [r.purchase_ID, r.date, r.name, r.amount, catName(r.category_ID), r.description, r.recurring, r.is_refunded]
        .map(esc)
        .join(",")
    );
    return [header.join(","), ...lines].join("\n");
  }

  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const formatMoney = (n) => currency.format(Number(n) || 0);
  const formatDate = (iso, opts = { month: "short", day: "numeric" }) =>
    parseISODate(iso).toLocaleDateString("en-US", opts);

  window.LibraAPI = {
    config: LIBRA_CONFIG,
    endpoints: ENDPOINTS,
    ...(LIBRA_CONFIG.mode === "remote" ? remote : mock),
    util: { toISODate, parseISODate, periodRange, computeBudgetStatus, transactionsToCSV, formatMoney, formatDate },
  };
})();
