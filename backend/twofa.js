// Two-factor authentication with one-time codes sent to the account's email.
//
// Turning it on (Settings page, logged in):
//   POST /api/auth/2fa/enable          -> emails a 6-digit code
//   POST /api/auth/2fa/enable/confirm  -> { code }; correct code sets profiles.status_2FA
// Turning it off:
//   POST /api/auth/2fa/disable
//
// Logging in with 2FA on (Login page, not logged in yet):
//   POST /api/auth/login (or the Google callback) checks the password as usual, but instead
//   of a session it emails a code and sets a short-lived HttpOnly `libra_2fa` cookie that
//   identifies this login attempt. Then:
//   POST /api/auth/2fa/verify  -> { code }; correct code creates the real session
//   POST /api/auth/2fa/resend  -> emails a fresh code for the same attempt
//
// Codes are stored hashed in `two_factor_codes`, expire after CODE_MINUTES, and allow
// MAX_ATTEMPTS guesses each.

const crypto = require("crypto");
const { requirePool } = require("./db");
const sessions = require("./sessions");
const { sendCodeEmail } = require("./mailer");
const { HttpError } = require("./errors");
const { bad, str } = require("./validate");

const COOKIE_NAME = "libra_2fa";
const COOKIE_PATH = "/api/auth/2fa";
const CODE_MINUTES = 10; // each code is valid this long after it is sent
const CHALLENGE_MINUTES = 30; // a login attempt can be resent / finished for this long
const MAX_ATTEMPTS = 5; // wrong guesses allowed per code
const RESEND_SECONDS = 30; // minimum gap between emails for the same attempt
const LOGIN_LIMIT = 5; // login codes per user...
const LOGIN_LIMIT_MINUTES = 15; // ...per this many minutes

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const codeHash = (challenge_ID, code) => sha256(`${challenge_ID}:${code}`);

/** "jordan@utdallas.edu" -> "j*****@utdallas.edu" (so the page can say where the code went). */
function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!domain) return "your email";
  return `${name[0]}${"*".repeat(Math.max(1, Math.min(name.length - 1, 6)))}@${domain}`;
}

/** Accepts "123456", "123 456" or "123-456". */
function readCode(body) {
  const code = str(body.code).replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) throw bad("Enter the 6-digit code from your email.");
  return code;
}

// ------------------------------------------------------------------ Cookie

function isHttps(req) {
  return req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function cookieHeader(req, value, maxAgeSeconds) {
  const parts = [`${COOKIE_NAME}=${value}`, `Path=${COOKIE_PATH}`, "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

function tokenFromRequest(req) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== COOKIE_NAME) continue;
    const token = part.slice(i + 1).trim();
    return /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
  }
  return null;
}

// ------------------------------------------------------------------ Shared helpers

async function getUser(pool, user_ID) {
  const [rows] = await pool.execute(
    `SELECT u.user_email, COALESCE(p.status_2FA, FALSE) AS status_2FA
     FROM users u LEFT JOIN profiles p ON p.user_ID = u.user_ID WHERE u.user_ID = ?`,
    [user_ID]
  );
  if (!rows.length) throw new HttpError(401, "Please log in.");
  return { user_email: rows[0].user_email, status_2FA: Boolean(Number(rows[0].status_2FA)) };
}

/** True if this user must enter an emailed code to log in. */
async function isEnabled(pool, user_ID) {
  return (await getUser(pool, user_ID)).status_2FA;
}

/** Stores a new code row and emails it. Removes the row again if the email can't be sent. */
async function createCode(pool, user_ID, email, purpose, challenge_ID) {
  await pool.execute("DELETE FROM two_factor_codes WHERE created_at < UTC_TIMESTAMP() - INTERVAL 1 DAY");
  const code = newCode();
  await pool.execute(
    `INSERT INTO two_factor_codes (challenge_ID, user_ID, purpose, code_hash, created_at, sent_at, expires_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL ${CODE_MINUTES} MINUTE)`,
    [challenge_ID, user_ID, purpose, codeHash(challenge_ID, code)]
  );
  try {
    await sendCodeEmail(email, code, purpose, CODE_MINUTES);
  } catch (err) {
    await pool.execute("DELETE FROM two_factor_codes WHERE challenge_ID = ?", [challenge_ID]).catch(() => {});
    throw err;
  }
}

/**
 * Checks a guess against a code row. The attempt is counted *before* comparing, in a
 * single UPDATE, so parallel requests can't get extra guesses.
 * Returns "ok" | "wrong" | "expired"; for "wrong", also how many tries are left.
 */
async function checkCode(pool, challenge_ID, purpose, user_ID, code) {
  const userClause = user_ID ? " AND user_ID = ?" : "";
  const params = user_ID ? [challenge_ID, purpose, user_ID] : [challenge_ID, purpose];
  const [upd] = await pool.execute(
    `UPDATE two_factor_codes SET attempts = attempts + 1
     WHERE challenge_ID = ? AND purpose = ?${userClause}
       AND attempts < ${MAX_ATTEMPTS} AND expires_at > UTC_TIMESTAMP()`,
    params
  );
  if (!upd.affectedRows) return { result: "expired" };

  const [rows] = await pool.execute("SELECT user_ID, code_hash, attempts FROM two_factor_codes WHERE challenge_ID = ?", [
    challenge_ID,
  ]);
  const row = rows[0];
  if (!row) return { result: "expired" };

  const given = Buffer.from(codeHash(challenge_ID, code));
  const stored = Buffer.from(row.code_hash);
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
    return { result: "wrong", left: MAX_ATTEMPTS - row.attempts };
  }

  // One-time use: only the request that actually deletes the row wins.
  const [del] = await pool.execute("DELETE FROM two_factor_codes WHERE challenge_ID = ?", [challenge_ID]);
  return del.affectedRows ? { result: "ok", user_ID: row.user_ID } : { result: "expired" };
}

const wrongCodeError = (left) =>
  bad(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many incorrect codes.");

/** Emails a fresh code for an existing row, enforcing the resend cooldown. */
async function resendCode(pool, challenge_ID, email, purpose) {
  const [rows] = await pool.execute(
    `SELECT TIMESTAMPDIFF(SECOND, sent_at, UTC_TIMESTAMP()) AS since_sent,
            TIMESTAMPDIFF(MINUTE, created_at, UTC_TIMESTAMP()) AS age
     FROM two_factor_codes WHERE challenge_ID = ?`,
    [challenge_ID]
  );
  if (!rows.length) return false;
  const { since_sent, age } = rows[0];
  if (age >= CHALLENGE_MINUTES) return false;
  if (since_sent < RESEND_SECONDS)
    throw new HttpError(429, `Please wait ${RESEND_SECONDS - since_sent} seconds before requesting another code.`);

  const code = newCode();
  await sendCodeEmail(email, code, purpose, CODE_MINUTES);
  await pool.execute(
    `UPDATE two_factor_codes
     SET code_hash = ?, attempts = 0, sent_at = UTC_TIMESTAMP(),
         expires_at = UTC_TIMESTAMP() + INTERVAL ${CODE_MINUTES} MINUTE
     WHERE challenge_ID = ?`,
    [codeHash(challenge_ID, code), challenge_ID]
  );
  return true;
}

// ------------------------------------------------------------------ Login (second step)

/**
 * Called after the password (or Google) check passed for a user with 2FA on.
 * Emails a login code and returns the Set-Cookie header for the pending attempt.
 */
async function startLogin(pool, req, user_ID) {
  const { user_email } = await getUser(pool, user_ID);

  const [[{ recent }]] = await pool.execute(
    `SELECT COUNT(*) AS recent FROM two_factor_codes
     WHERE user_ID = ? AND purpose = 'LOGIN' AND created_at > UTC_TIMESTAMP() - INTERVAL ${LOGIN_LIMIT_MINUTES} MINUTE`,
    [user_ID]
  );
  if (Number(recent) >= LOGIN_LIMIT)
    throw new HttpError(429, "Too many login codes were requested. Please wait a few minutes and try again.");

  const token = crypto.randomBytes(32).toString("base64url");
  await createCode(pool, user_ID, user_email, "LOGIN", sha256(token));
  return { cookie: cookieHeader(req, token, CHALLENGE_MINUTES * 60), email_hint: maskEmail(user_email) };
}

const loginExpired = () => new HttpError(401, "Your login code expired. Please log in again.");

/** POST /api/auth/2fa/verify  body: { code } */
async function verifyLogin({ req, body, setCookie }) {
  const code = readCode(body);
  const token = tokenFromRequest(req);
  if (!token) throw loginExpired();
  const pool = requirePool();

  const check = await checkCode(pool, sha256(token), "LOGIN", null, code);
  if (check.result === "expired") {
    setCookie(cookieHeader(req, "", 0));
    throw loginExpired();
  }
  if (check.result === "wrong") {
    if (check.left <= 0) {
      setCookie(cookieHeader(req, "", 0));
      throw new HttpError(401, "Too many incorrect codes. Please log in again.");
    }
    throw wrongCodeError(check.left);
  }

  setCookie(cookieHeader(req, "", 0));
  setCookie(await sessions.createSession(pool, req, check.user_ID));
  return { user_ID: check.user_ID };
}

/** POST /api/auth/2fa/resend — new code for the pending login attempt. */
async function resendLogin({ req, setCookie }) {
  const token = tokenFromRequest(req);
  if (!token) throw loginExpired();
  const pool = requirePool();

  const [rows] = await pool.execute(
    `SELECT c.user_ID, u.user_email FROM two_factor_codes c JOIN users u ON u.user_ID = c.user_ID
     WHERE c.challenge_ID = ? AND c.purpose = 'LOGIN'`,
    [sha256(token)]
  );
  if (!rows.length || !(await resendCode(pool, sha256(token), rows[0].user_email, "LOGIN"))) {
    setCookie(cookieHeader(req, "", 0));
    throw loginExpired();
  }
  return { email_hint: maskEmail(rows[0].user_email) };
}

// ------------------------------------------------------------------ Settings (turn on / off)

/** The user's pending ENABLE code row id, or null. */
async function pendingEnable(pool, user_ID) {
  const [rows] = await pool.execute(
    "SELECT challenge_ID FROM two_factor_codes WHERE user_ID = ? AND purpose = 'ENABLE' ORDER BY created_at DESC LIMIT 1",
    [user_ID]
  );
  return rows.length ? rows[0].challenge_ID : null;
}

/**
 * POST /api/auth/2fa/enable — emails a setup code. Calling it again resends
 * (after the cooldown) instead of piling up codes.
 */
async function startEnable({ user_ID }) {
  const pool = requirePool();
  const { user_email, status_2FA } = await getUser(pool, user_ID);
  if (status_2FA) throw bad("Two-factor authentication is already on.");

  const pending = await pendingEnable(pool, user_ID);
  if (!(pending && (await resendCode(pool, pending, user_email, "ENABLE")))) {
    await pool.execute("DELETE FROM two_factor_codes WHERE user_ID = ? AND purpose = 'ENABLE'", [user_ID]);
    await createCode(pool, user_ID, user_email, "ENABLE", sha256(crypto.randomBytes(32).toString("base64url")));
  }
  return { email_hint: maskEmail(user_email), expires_in_minutes: CODE_MINUTES };
}

/** POST /api/auth/2fa/enable/confirm  body: { code } */
async function confirmEnable({ body, user_ID }) {
  const code = readCode(body);
  const pool = requirePool();
  const pending = await pendingEnable(pool, user_ID);
  const check = pending ? await checkCode(pool, pending, "ENABLE", user_ID, code) : { result: "expired" };

  if (check.result === "expired") throw bad("That code has expired. Send a new code and try again.");
  if (check.result === "wrong")
    throw check.left > 0 ? wrongCodeError(check.left) : bad("Too many incorrect codes. Send a new code and try again.");

  await pool.execute("INSERT IGNORE INTO profiles (user_ID) VALUES (?)", [user_ID]);
  await pool.execute("UPDATE profiles SET status_2FA = TRUE WHERE user_ID = ?", [user_ID]);
  await pool.execute("DELETE FROM two_factor_codes WHERE user_ID = ? AND purpose = 'ENABLE'", [user_ID]);
  return { status_2FA: true };
}

/** POST /api/auth/2fa/disable */
async function disable({ user_ID }) {
  const pool = requirePool();
  await pool.execute("UPDATE profiles SET status_2FA = FALSE WHERE user_ID = ?", [user_ID]);
  await pool.execute("DELETE FROM two_factor_codes WHERE user_ID = ?", [user_ID]);
  return { status_2FA: false };
}

module.exports = { isEnabled, startLogin, verifyLogin, resendLogin, startEnable, confirmEnable, disable };
