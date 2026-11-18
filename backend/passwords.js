// Password hashing with Node's built-in scrypt (no extra dependency).
// Stored format in users.hash_password:
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// The parameters are stored with the hash so they can be raised later
// without breaking existing accounts.

const crypto = require("crypto");

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

function scrypt(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N: n, r, p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** For the login endpoint: true if `password` matches the stored hash. */
async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

module.exports = { hashPassword, verifyPassword };
