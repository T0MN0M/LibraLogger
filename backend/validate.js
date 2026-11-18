// Small input helpers shared by the API routes.
const { HttpError } = require("./errors");

const bad = (msg) => new HttpError(400, msg);
const str = (v) => (typeof v === "string" ? v : "");

/** True for a real "YYYY-MM-DD" date. Options: { min year, notFuture }. */
function isISODate(s, { minYear = 1900, notFuture = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  const real = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
  return real && y >= minYear && y <= 9999 && (!notFuture || date <= new Date());
}

/** MySQL DATE -> "YYYY-MM-DD" whether mysql2 returned a string or a Date. */
function isoDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

/** Same rules as the registration page. Throws HttpError(400). */
function checkPassword(password) {
  if (password.length < 8) throw bad("Password must be at least 8 characters.");
  if (password.length > 100) throw bad("Password must be no more than 100 characters.");
  if (!/[A-Z]/.test(password)) throw bad("Password must contain at least one uppercase letter.");
  if (!/[0-9]/.test(password)) throw bad("Password must contain at least one number.");
}

/** Positive integer id from a route param / query, or throws 404. */
function idParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, "Not found.");
  return n;
}

module.exports = { bad, str, isISODate, isoDate, checkPassword, idParam };
