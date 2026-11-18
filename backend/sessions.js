// Login sessions, stored in the MySQL `sessions` table so they survive server
// restarts / redeploys on Railway.
//
// The browser gets a random token in an HttpOnly cookie; the database only stores
// its SHA-256 hash, so a leaked sessions table can't be used to log in.

const crypto = require("crypto");

const COOKIE_NAME = "libra_session";
const SESSION_DAYS = 30;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function tokenFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return token && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}

function isHttps(req) {
  // Railway terminates TLS at its proxy and forwards the original protocol.
  return req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function cookieHeader(req, value, maxAgeSeconds) {
  const parts = [`${COOKIE_NAME}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

/** Creates a session row; returns the Set-Cookie header value. */
async function createSession(pool, req, user_ID) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.execute("DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP()"); // tidy up old ones
  await pool.execute(
    `INSERT INTO sessions (session_ID, user_ID, expires_at)
     VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${SESSION_DAYS} DAY))`,
    [hashToken(token), user_ID]
  );
  return cookieHeader(req, token, SESSION_DAYS * 86400);
}

/** user_ID for the request's session cookie, or null if missing / expired. */
async function userFromRequest(pool, req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const [rows] = await pool.execute(
    "SELECT user_ID FROM sessions WHERE session_ID = ? AND expires_at > UTC_TIMESTAMP()",
    [hashToken(token)]
  );
  return rows.length ? rows[0].user_ID : null;
}

/** Deletes the request's session; returns a Set-Cookie header that clears the cookie. */
async function destroySession(pool, req) {
  const token = tokenFromRequest(req);
  if (token) await pool.execute("DELETE FROM sessions WHERE session_ID = ?", [hashToken(token)]);
  return cookieHeader(req, "", 0);
}

/** Logs the user out everywhere except the current browser (used after a password change). */
async function destroyOtherSessions(pool, req, user_ID) {
  const token = tokenFromRequest(req);
  await pool.execute("DELETE FROM sessions WHERE user_ID = ? AND session_ID <> ?", [
    user_ID,
    token ? hashToken(token) : "",
  ]);
}

module.exports = { createSession, userFromRequest, destroySession, destroyOtherSessions, cookieHeader };
