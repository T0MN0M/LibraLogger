// Auth routes: register, login, logout, change password.
// Validation mirrors the browser pages, but the server is the source of truth —
// never trust the browser's checks alone.
//
// Every handler takes a ctx from server.js: { req, body, query, params, user_ID, setCookie }.

const { requirePool } = require("./db");
const { hashPassword, verifyPassword } = require("./passwords");
const sessions = require("./sessions");
const { isPasswordless } = require("./google");
const { HttpError } = require("./errors");
const { bad, str, isISODate, checkPassword } = require("./validate");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 50; // per first / last name field
const USER_NAME_MAX = 60; // users.user_name VARCHAR(60)
const EMAIL_MAX = 255; // users.user_email VARCHAR(255)

const normalizeEmail = (v) => str(v).trim().toLowerCase();

/** Returns { user_name, user_email, password, birthday } or throws HttpError(400). */
function validateRegistration(body) {
  const first = str(body.first_name).trim();
  const last = str(body.last_name).trim();
  const email = normalizeEmail(body.user_email);
  const password = str(body.password);
  const birthday = str(body.birthday);

  if (!first) throw bad("First name is required.");
  if (first.length > NAME_MAX) throw bad(`First name must be ${NAME_MAX} characters or fewer.`);
  if (!last) throw bad("Last name is required.");
  if (last.length > NAME_MAX) throw bad(`Last name must be ${NAME_MAX} characters or fewer.`);
  const user_name = `${first} ${last}`;
  if (user_name.length > USER_NAME_MAX)
    throw bad(`First and last name together must be ${USER_NAME_MAX - 1} characters or fewer.`);

  if (!EMAIL_RE.test(email) || email.length > EMAIL_MAX) throw bad("Enter a valid email address.");
  checkPassword(password);
  if (!isISODate(birthday, { notFuture: true })) throw bad("Enter a valid date of birth.");

  return { user_name, user_email: email, password, birthday };
}

/**
 * POST /api/auth/register
 * Creates the users row + matching profiles row in one transaction. Nothing else:
 * a new account starts with no purchases, no budget and no streak.
 */
async function register({ body }) {
  const data = validateRegistration(body);
  const pool = requirePool();

  const hash_password = await hashPassword(data.password);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      "INSERT INTO users (user_name, user_email, hash_password) VALUES (?, ?, ?)",
      [data.user_name, data.user_email, hash_password]
    );
    const user_ID = result.insertId;
    await conn.execute("INSERT INTO profiles (user_ID, birthday) VALUES (?, ?)", [user_ID, data.birthday]);
    await conn.commit();
    return { user_ID, user_name: data.user_name, user_email: data.user_email };
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err && err.code === "ER_DUP_ENTRY") throw new HttpError(409, "An account with that email already exists.");
    throw err;
  } finally {
    conn.release();
  }
}

// Used when the email doesn't exist, so a wrong email takes as long as a wrong
// password (doesn't reveal which emails have accounts).
let dummyHash = null;

/** POST /api/auth/login  body: { user_email, password } */
async function login({ req, body, setCookie }) {
  const email = normalizeEmail(body.user_email);
  const password = str(body.password);
  if (!email || !password) throw bad("Please enter your email and password.");
  const pool = requirePool();

  const [rows] = await pool.execute("SELECT user_ID, hash_password FROM users WHERE user_email = ?", [email]);
  const user = rows[0];
  if (!user) {
    dummyHash = dummyHash || (await hashPassword("not-a-real-password"));
    await verifyPassword(password, dummyHash);
  }
  if (!user || !(await verifyPassword(password, user.hash_password))) {
    throw new HttpError(401, "Incorrect email or password.");
  }

  setCookie(await sessions.createSession(pool, req, user.user_ID));
  return { user_ID: user.user_ID };
}

/** POST /api/auth/logout */
async function logout({ req, setCookie }) {
  setCookie(await sessions.destroySession(requirePool(), req));
  return null;
}

/** POST /api/auth/password  body: { current_password, new_password } */
async function changePassword({ req, body, user_ID }) {
  const current = str(body.current_password);
  const next = str(body.new_password);
  if (!current) throw bad("Enter your current password.");
  checkPassword(next);
  if (next === current) throw bad("New password must be different from your current one.");

  const pool = requirePool();
  const [rows] = await pool.execute("SELECT hash_password FROM users WHERE user_ID = ?", [user_ID]);
  if (rows.length && isPasswordless(rows[0].hash_password))
    throw bad("This account signs in with Google, so it doesn't have a password to change.");
  // 400 (not 401) so the page doesn't treat it as "logged out".
  if (!rows.length || !(await verifyPassword(current, rows[0].hash_password)))
    throw bad("Your current password is incorrect.");

  await pool.execute("UPDATE users SET hash_password = ? WHERE user_ID = ?", [await hashPassword(next), user_ID]);
  await sessions.destroyOtherSessions(pool, req, user_ID);
  return null;
}

module.exports = { register, login, logout, changePassword, validateRegistration, HttpError };
