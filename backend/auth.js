// Auth routes. Currently: POST /api/auth/register (email + password).
// Validation mirrors Application/Registration_Page/registration.js, but the
// server is the source of truth — never trust the browser's checks alone.

const { getPool } = require("./db");
const { hashPassword } = require("./passwords");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 50; // per first / last name field
const USER_NAME_MAX = 60; // users.user_name VARCHAR(60)
const EMAIL_MAX = 255; // users.user_email VARCHAR(255)

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isValidBirthday(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  const real = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return real && y >= 1900 && date <= new Date();
}

/** Returns { user_name, user_email, password, birthday } or throws HttpError(400). */
function validateRegistration(body) {
  if (!body || typeof body !== "object") throw new HttpError(400, "Invalid request.");
  const str = (v) => (typeof v === "string" ? v : "");

  const first = str(body.first_name).trim();
  const last = str(body.last_name).trim();
  const email = str(body.user_email).trim().toLowerCase();
  const password = str(body.password);
  const birthday = str(body.birthday);

  if (!first) throw new HttpError(400, "First name is required.");
  if (first.length > NAME_MAX) throw new HttpError(400, `First name must be ${NAME_MAX} characters or fewer.`);
  if (!last) throw new HttpError(400, "Last name is required.");
  if (last.length > NAME_MAX) throw new HttpError(400, `Last name must be ${NAME_MAX} characters or fewer.`);
  const user_name = `${first} ${last}`;
  if (user_name.length > USER_NAME_MAX)
    throw new HttpError(400, `First and last name together must be ${USER_NAME_MAX - 1} characters or fewer.`);

  if (!EMAIL_RE.test(email) || email.length > EMAIL_MAX) throw new HttpError(400, "Enter a valid email address.");

  if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
  if (password.length > 100) throw new HttpError(400, "Password must be no more than 100 characters.");
  if (!/[A-Z]/.test(password)) throw new HttpError(400, "Password must contain at least one uppercase letter.");
  if (!/[0-9]/.test(password)) throw new HttpError(400, "Password must contain at least one number.");

  if (!isValidBirthday(birthday)) throw new HttpError(400, "Enter a valid date of birth.");

  return { user_name, user_email: email, password, birthday };
}

/** Creates the users row + matching profiles row in one transaction. */
async function register(body) {
  const data = validateRegistration(body);

  const pool = getPool();
  if (!pool) throw new HttpError(503, "Account creation is unavailable right now (database not configured).");

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

module.exports = { register, validateRegistration, HttpError };
