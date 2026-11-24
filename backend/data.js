// Per-user data routes (profile, budget, purchases, streak, ...).
//
// Every query is scoped to ctx.user_ID, which server.js takes from the session
// cookie — never from the request body — so users can only see and change their
// own rows. Rows are returned with the same field names api.js uses in mock mode.

const { requirePool } = require("./db");
const sessions = require("./sessions");
const { HttpError } = require("./errors");
const { bad, str, isISODate, isoDate, idParam } = require("./validate");
const { version: APP_VERSION } = require("../package.json");

const bool = (v) => Boolean(Number(v));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_AMOUNT = 99999999.99; // DECIMAL(10, 2)
const MAX_PICTURE_CHARS = 700000; // ~500 KB image as a data URL

// ------------------------------------------------------------------ Profile

const PROFILE_SQL = `
  SELECT u.user_ID, u.user_name, u.user_email, u.is_verified, u.created_at,
         p.profile_ID, p.nickname, p.birthday, p.profile_picture, p.profile_icon,
         p.profile_color, p.profile_border, p.status_2FA
  FROM users u LEFT JOIN profiles p ON p.user_ID = u.user_ID
  WHERE u.user_ID = ?`;

async function getProfile({ user_ID }) {
  const [rows] = await requirePool().execute(PROFILE_SQL, [user_ID]);
  const r = rows[0];
  if (!r) throw new HttpError(401, "Please log in.");
  return {
    user_ID: r.user_ID,
    user_name: r.user_name,
    user_email: r.user_email,
    is_verified: bool(r.is_verified),
    created_at: isoDate(r.created_at),
    profile_ID: r.profile_ID,
    nickname: r.nickname || "",
    birthday: isoDate(r.birthday) || "",
    profile_picture: r.profile_picture || null,
    profile_icon: r.profile_icon || null,
    profile_color: r.profile_color || "#5fe0b7",
    profile_border: r.profile_border || "#e87500",
    status_2FA: bool(r.status_2FA),
  };
}

// Field -> [table, validator returning the value to store]. Unknown fields are ignored.
// (user_email isn't editable here: changing it should go through email verification.)
const PROFILE_FIELDS = {
  user_name: ["users", (v) => {
    const s = str(v).trim();
    if (!s || s.length > 60) throw bad("Name must be 1–60 characters.");
    return s;
  }],
  nickname: ["profiles", (v) => {
    const s = str(v).trim();
    if (s.length > 30) throw bad("Nickname must be 30 characters or fewer.");
    return s || null;
  }],
  birthday: ["profiles", (v) => {
    if (v === "" || v == null) return null;
    if (!isISODate(v, { notFuture: true })) throw bad("Enter a valid birthday.");
    return v;
  }],
  profile_picture: ["profiles", (v) => {
    if (v === "" || v == null) return null;
    if (!/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(str(v)) || v.length > MAX_PICTURE_CHARS)
      throw bad("That image is too large or not a supported type.");
    return v;
  }],
  profile_icon: ["profiles", (v) => (v == null ? null : str(v).slice(0, 50))],
  profile_color: ["profiles", (v) => {
    if (!HEX_COLOR.test(str(v))) throw bad("Invalid color.");
    return v;
  }],
  profile_border: ["profiles", (v) => {
    if (!HEX_COLOR.test(str(v))) throw bad("Invalid color.");
    return v;
  }],
  // status_2FA isn't here on purpose: turning 2FA on needs an emailed code (backend/twofa.js).
};

async function updateProfile(ctx) {
  const updates = { users: [], profiles: [] };
  for (const [key, value] of Object.entries(ctx.body)) {
    const field = PROFILE_FIELDS[key];
    if (field) updates[field[0]].push([key, field[1](value)]);
  }

  const pool = requirePool();
  for (const [table, pairs] of Object.entries(updates)) {
    if (!pairs.length) continue;
    if (table === "profiles") await pool.execute("INSERT IGNORE INTO profiles (user_ID) VALUES (?)", [ctx.user_ID]);
    // Column names come from the PROFILE_FIELDS whitelist above, never from the request.
    const set = pairs.map(([k]) => `${k} = ?`).join(", ");
    await pool.execute(`UPDATE ${table} SET ${set} WHERE user_ID = ?`, [...pairs.map(([, v]) => v), ctx.user_ID]);
  }
  return getProfile(ctx);
}

// ------------------------------------------------------------------ Budget

/** The user's overall budget, or an unsaved placeholder (limit 0) if they haven't set one. */
async function getBudget({ user_ID }) {
  const [rows] = await requirePool().execute(
    `SELECT budget_ID, user_ID, period, limit_amount, alert_threshold, category_ID
     FROM budgets WHERE user_ID = ? AND category_ID IS NULL ORDER BY budget_ID LIMIT 1`,
    [user_ID]
  );
  const b = rows[0];
  if (!b) return { budget_ID: null, user_ID, period: "MONTHLY", limit_amount: 0, alert_threshold: 80, category_ID: null };
  return { ...b, limit_amount: Number(b.limit_amount), alert_threshold: Number(b.alert_threshold) };
}

async function setBudget(ctx) {
  const current = await getBudget(ctx);
  const b = ctx.body;
  const period = b.period ?? current.period;
  const limit = b.limit_amount !== undefined ? Number(b.limit_amount) : current.limit_amount;
  const threshold = b.alert_threshold !== undefined ? Number(b.alert_threshold) : current.alert_threshold;

  if (!["WEEKLY", "MONTHLY"].includes(period)) throw bad("Budget period must be weekly or monthly.");
  if (!(limit > 0 && limit <= MAX_AMOUNT)) throw bad("Enter a budget limit above $0.");
  if (!(Number.isInteger(threshold) && threshold >= 1 && threshold <= 100))
    throw bad("Alert threshold must be a whole number from 1 to 100.");
  const limit_amount = Math.round(limit * 100) / 100;

  const pool = requirePool();
  if (current.budget_ID) {
    await pool.execute(
      "UPDATE budgets SET period = ?, limit_amount = ?, alert_threshold = ? WHERE budget_ID = ? AND user_ID = ?",
      [period, limit_amount, threshold, current.budget_ID, ctx.user_ID]
    );
  } else {
    await pool.execute(
      "INSERT INTO budgets (user_ID, period, limit_amount, alert_threshold) VALUES (?, ?, ?, ?)",
      [ctx.user_ID, period, limit_amount, threshold]
    );
  }
  return getBudget(ctx);
}

// ------------------------------------------------------------------ Purchases

const PURCHASE_COLS = `purchase_ID, user_ID, name, amount, date, description, recurring,
                       frequency, next_due_date, category_ID, is_refunded`;

const purchaseRow = (r) => ({
  ...r,
  amount: Number(r.amount),
  date: isoDate(r.date),
  description: r.description || "",
  recurring: bool(r.recurring),
  next_due_date: isoDate(r.next_due_date),
  is_refunded: bool(r.is_refunded),
});

async function getTransactions({ user_ID, query }) {
  const where = ["user_ID = ?"];
  const params = [user_ID];
  if (query.category_ID) {
    where.push("category_ID = ?");
    params.push(idParam(query.category_ID));
  }
  for (const [key, op] of [["from", ">="], ["to", "<="]]) {
    if (!query[key]) continue;
    if (!isISODate(query[key])) throw bad(`Invalid "${key}" date.`);
    where.push(`date ${op} ?`);
    params.push(query[key]);
  }
  let sql = `SELECT ${PURCHASE_COLS} FROM purchases WHERE ${where.join(" AND ")} ORDER BY date DESC, purchase_ID DESC`;
  if (query.limit) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1) throw bad("Invalid limit.");
    sql += ` LIMIT ${Math.min(limit, 1000)}`; // validated integer, safe to inline
  }
  const [rows] = await requirePool().execute(sql, params);
  return rows.map(purchaseRow);
}

async function getPurchase(user_ID, purchase_ID) {
  const [rows] = await requirePool().execute(
    `SELECT ${PURCHASE_COLS} FROM purchases WHERE purchase_ID = ? AND user_ID = ?`,
    [purchase_ID, user_ID]
  );
  if (!rows.length) throw new HttpError(404, "That transaction wasn't found.");
  return purchaseRow(rows[0]);
}

async function checkCategory(user_ID, value) {
  const id = Number(value);
  if (Number.isInteger(id) && id > 0) {
    const [rows] = await requirePool().execute(
      "SELECT 1 FROM categories WHERE category_ID = ? AND (user_ID IS NULL OR user_ID = ?)",
      [id, user_ID]
    );
    if (rows.length) return id;
  }
  throw bad("Choose a valid category.");
}

// Field -> validator for purchase columns the user may set.
const PURCHASE_FIELDS = {
  name: (v) => {
    const s = str(v).trim();
    if (!s || s.length > 100) throw bad("Name must be 1–100 characters.");
    return s;
  },
  amount: (v) => {
    const n = Number(v);
    if (!(Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT)) throw bad("Enter a valid amount.");
    return Math.round(n * 100) / 100;
  },
  date: (v) => {
    if (!isISODate(v)) throw bad("Enter a valid date.");
    return v;
  },
  description: (v) => {
    const s = str(v).trim();
    if (s.length > 255) throw bad("Description must be 255 characters or fewer.");
    return s;
  },
  recurring: (v) => Boolean(v),
  is_refunded: (v) => Boolean(v),
};

async function addTransaction(ctx) {
  const b = ctx.body;
  const today = isoDate(new Date());
  const row = {
    name: PURCHASE_FIELDS.name(b.name),
    amount: PURCHASE_FIELDS.amount(b.amount),
    date: PURCHASE_FIELDS.date(b.date || today),
    description: PURCHASE_FIELDS.description(b.description ?? ""),
    recurring: Boolean(b.recurring),
    category_ID: b.category_ID ? await checkCategory(ctx.user_ID, b.category_ID) : 8, // 8 = "Other"
  };
  const [result] = await requirePool().execute(
    `INSERT INTO purchases (user_ID, name, amount, date, description, recurring, category_ID)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ctx.user_ID, row.name, row.amount, row.date, row.description, row.recurring, row.category_ID]
  );
  return getPurchase(ctx.user_ID, result.insertId);
}

async function editTransaction(ctx) {
  const id = idParam(ctx.params.id);
  await getPurchase(ctx.user_ID, id); // 404 if it isn't this user's
  const pairs = [];
  for (const [key, value] of Object.entries(ctx.body)) {
    if (PURCHASE_FIELDS[key]) pairs.push([key, PURCHASE_FIELDS[key](value)]);
    else if (key === "category_ID") pairs.push([key, await checkCategory(ctx.user_ID, value)]);
  }
  if (pairs.length) {
    // Column names come from the whitelist above, never from the request.
    await requirePool().execute(
      `UPDATE purchases SET ${pairs.map(([k]) => `${k} = ?`).join(", ")} WHERE purchase_ID = ? AND user_ID = ?`,
      [...pairs.map(([, v]) => v), id, ctx.user_ID]
    );
  }
  return getPurchase(ctx.user_ID, id);
}

async function removeTransaction(ctx) {
  const [result] = await requirePool().execute("DELETE FROM purchases WHERE purchase_ID = ? AND user_ID = ?", [
    idParam(ctx.params.id),
    ctx.user_ID,
  ]);
  if (!result.affectedRows) throw new HttpError(404, "That transaction wasn't found.");
  return null;
}

// ------------------------------------------------------------------ Shared lists

/** Default categories (shared) + any the user created. */
async function getCategories({ user_ID }) {
  const [rows] = await requirePool().execute(
    "SELECT category_ID, name, is_default FROM categories WHERE user_ID IS NULL OR user_ID = ? ORDER BY category_ID",
    [user_ID]
  );
  return rows.map((r) => ({ ...r, is_default: bool(r.is_default) }));
}

async function getResources() {
  const [rows] = await requirePool().execute(
    "SELECT resource_ID, resource_name, category, description, resource_link, resource_image FROM resources ORDER BY resource_ID"
  );
  return rows;
}

// ------------------------------------------------------------------ Streak

async function getStreak({ user_ID }) {
  const [rows] = await requirePool().execute(
    "SELECT streak_ID, user_ID, weeks_under_budget, last_updated FROM streaks WHERE user_ID = ?",
    [user_ID]
  );
  const s = rows[0];
  return s
    ? { ...s, last_updated: isoDate(s.last_updated) }
    : { streak_ID: null, user_ID, weeks_under_budget: 0, last_updated: null };
}

// ------------------------------------------------------------------ Account

/**
 * POST /api/user/reset — back to a brand-new account: deletes the user's purchases,
 * budgets, receipts, streak and custom categories, and resets the profile card.
 * Keeps the login, name, birthday and 2FA setting.
 */
async function resetUserData({ user_ID }) {
  const conn = await requirePool().getConnection();
  try {
    await conn.beginTransaction();
    for (const table of ["purchases", "budgets", "receipts", "streaks", "categories"]) {
      await conn.execute(`DELETE FROM ${table} WHERE user_ID = ?`, [user_ID]);
    }
    await conn.execute(
      `UPDATE profiles SET nickname = NULL, profile_picture = NULL, profile_icon = NULL,
         profile_color = DEFAULT(profile_color), profile_border = DEFAULT(profile_border)
       WHERE user_ID = ?`,
      [user_ID]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  return null;
}

/** DELETE /api/user — removes the users row; ON DELETE CASCADE removes everything else. */
async function deleteAccount({ req, user_ID, setCookie }) {
  await requirePool().execute("DELETE FROM users WHERE user_ID = ?", [user_ID]);
  setCookie(sessions.cookieHeader(req, "", 0));
  return null;
}

async function getAppVersion() {
  return { version: APP_VERSION, mode: "remote" };
}

module.exports = {
  getProfile,
  updateProfile,
  getBudget,
  setBudget,
  getTransactions,
  addTransaction,
  editTransaction,
  removeTransaction,
  getCategories,
  getResources,
  getStreak,
  resetUserData,
  deleteAccount,
  getAppVersion,
};
