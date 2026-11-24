// "Sign in / Sign up with Google" — OAuth 2.0 authorization-code flow, done on
// the server with Node's built-in fetch (no extra dependency).
//
//   1. GET /api/auth/google           -> sets a random `state` cookie, redirects to Google
//   2. Google redirects back to
//      GET /api/auth/google/callback  -> checks state, swaps the code for an ID token,
//                                        finds or creates the user, sets the session cookie,
//                                        redirects to the Dashboard
//
// One flow covers both sign-up and log-in: a new Google account gets a users row,
// an existing one just logs in. If a password account already uses the same
// (Google-verified) email, the Google login is linked to it.
//
// Railway variables (Node service):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   from Google Cloud Console -> Credentials
//   GOOGLE_REDIRECT_URI (optional)           defaults to https://<host>/api/auth/google/callback
// The redirect URI must be listed under "Authorized redirect URIs" for the OAuth client.

const crypto = require("crypto");
const { requirePool } = require("./db");
const sessions = require("./sessions");
const twofa = require("./twofa");
const { HttpError } = require("./errors");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_COOKIE = "libra_oauth_state";
const STATE_MAX_AGE = 600; // seconds the user has to finish on Google's page

const LOGIN_PAGE = "/Application/Login_Page/login.html";
const DASHBOARD_PAGE = "/Application/Dashboard/dashboard.html";

// Accounts created through Google have no password. This value is never a valid
// scrypt hash, so verifyPassword() always rejects it and password login is impossible.
const NO_PASSWORD = "!google";

const USER_NAME_MAX = 60;
const EMAIL_MAX = 255;

function config(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: process.env.GOOGLE_REDIRECT_URI || defaultRedirectUri(req) };
}

function defaultRedirectUri(req) {
  // Railway terminates TLS at its proxy; Google rejects the URI unless it is registered,
  // so a spoofed Host header can't redirect the code anywhere else.
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (req.socket.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}/api/auth/google/callback`;
}

function stateCookie(req, value, maxAge) {
  const parts = [`${STATE_COOKIE}=${value}`, "Path=/api/auth/google", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (req.socket.encrypted || proto === "https") parts.push("Secure");
  return parts.join("; ");
}

function readStateCookie(req) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === STATE_COOKIE) return v.join("=");
  }
  return null;
}

const loginError = (msg) => `${LOGIN_PAGE}?google_error=${encodeURIComponent(msg)}`;

/** GET /api/auth/google — send the browser to Google's consent screen. */
async function start({ req, setCookie, redirect }) {
  const cfg = config(req);
  if (!cfg) return redirect(loginError("Google sign-in isn't set up on this server yet."));

  const state = crypto.randomBytes(24).toString("base64url");
  setCookie(stateCookie(req, state, STATE_MAX_AGE));
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return redirect(`${AUTH_URL}?${params}`);
}

/** Swaps the authorization code for tokens and returns the ID token's claims. */
async function exchangeCode(cfg, code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id_token) {
    console.error("Google token exchange failed:", res.status, body.error, body.error_description);
    throw new HttpError(502, "Google sign-in failed. Please try again.");
  }

  // The ID token came straight from Google's token endpoint over TLS (authenticated
  // with our client secret), so per Google's docs its signature needn't be re-checked.
  // We still check who it was issued for and by.
  const claims = JSON.parse(Buffer.from(body.id_token.split(".")[1] || "", "base64url").toString("utf8"));
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issuerOk || claims.aud !== cfg.clientId || !claims.sub || Number(claims.exp) * 1000 < Date.now()) {
    throw new HttpError(502, "Google sign-in failed. Please try again.");
  }
  return claims;
}

function nameFromClaims(claims, email) {
  const first = String(claims.given_name || "").trim();
  const last = String(claims.family_name || "").trim();
  const name = (first && last ? `${first} ${last}` : String(claims.name || first || email.split("@")[0]).trim()) || "Libra User";
  return name.slice(0, USER_NAME_MAX);
}

/** Returns the user_ID for this Google account, creating or linking the account as needed. */
async function findOrCreateUser(pool, claims) {
  const sub = String(claims.sub);
  const email = String(claims.email || "").trim().toLowerCase();

  const [linked] = await pool.execute(
    "SELECT user_ID FROM oauth_accounts WHERE provider = 'google' AND provider_sub = ?",
    [sub]
  );
  if (linked.length) return linked[0].user_ID;

  // Only trust the email for linking / creating if Google has verified it.
  if (!email || claims.email_verified !== true || email.length > EMAIL_MAX) {
    throw new HttpError(400, "Your Google account needs a verified email address to use Libra Logger.");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.execute(
      "SELECT user_ID, is_verified FROM users WHERE user_email = ? FOR UPDATE",
      [email]
    );
    let user_ID;
    if (existing.length) {
      user_ID = existing[0].user_ID;
      if (!existing[0].is_verified) {
        // Nobody had proven they own this email until now, so someone else could have
        // registered it with their own password. Drop that password and its sessions;
        // the owner signs in with Google from here on.
        await conn.execute("UPDATE users SET hash_password = ?, is_verified = TRUE WHERE user_ID = ?", [
          NO_PASSWORD,
          user_ID,
        ]);
        await conn.execute("DELETE FROM sessions WHERE user_ID = ?", [user_ID]);
      }
    } else {
      const [result] = await conn.execute(
        "INSERT INTO users (user_name, user_email, hash_password, is_verified) VALUES (?, ?, ?, TRUE)",
        [nameFromClaims(claims, email), email, NO_PASSWORD]
      );
      user_ID = result.insertId;
      // Google doesn't share a birthday by default; the user can set it in Settings.
      await conn.execute("INSERT INTO profiles (user_ID) VALUES (?)", [user_ID]);
    }
    await conn.execute(
      "INSERT INTO oauth_accounts (provider, provider_sub, user_ID) VALUES ('google', ?, ?)",
      [sub, user_ID]
    );
    await conn.commit();
    return user_ID;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** GET /api/auth/google/callback?code=...&state=... */
async function callback({ req, query, setCookie, redirect }) {
  const expected = readStateCookie(req);
  setCookie(stateCookie(req, "", 0)); // one-time use

  // User pressed "Cancel" on Google's page.
  if (query.error) return redirect(loginError(query.error === "access_denied" ? "Google sign-in was cancelled." : "Google sign-in failed."));

  const cfg = config(req);
  if (!cfg) return redirect(loginError("Google sign-in isn't set up on this server yet."));
  const state = String(query.state || "");
  const stateOk =
    expected && state.length === expected.length && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!stateOk || !query.code) return redirect(loginError("Google sign-in expired. Please try again."));

  try {
    const pool = requirePool();
    const claims = await exchangeCode(cfg, String(query.code));
    const user_ID = await findOrCreateUser(pool, claims);
    // 2FA on: email a code and let the Login page ask for it (see backend/twofa.js).
    if (await twofa.isEnabled(pool, user_ID)) {
      const { cookie } = await twofa.startLogin(pool, req, user_ID);
      setCookie(cookie);
      return redirect(`${LOGIN_PAGE}?twofa=1`);
    }
    setCookie(await sessions.createSession(pool, req, user_ID));
    return redirect(DASHBOARD_PAGE);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error("Google callback failed:", err);
    return redirect(loginError(err instanceof HttpError ? err.message : "Google sign-in failed. Please try again."));
  }
}

/** True if this stored hash belongs to a Google-only account (no password set). */
const isPasswordless = (hash) => hash === NO_PASSWORD;

module.exports = { start, callback, isPasswordless };
