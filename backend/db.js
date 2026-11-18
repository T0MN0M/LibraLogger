// MySQL connection pool (Railway MySQL service).
//
// Reads the connection from Railway's variables. In the Node service on Railway,
// add a variable reference to the MySQL service's MYSQL_URL (or the individual
// MYSQLHOST / MYSQLPORT / MYSQLUSER / MYSQLPASSWORD / MYSQLDATABASE variables).
// Never commit credentials.
//
// The pool is created lazily so the static site still runs when no database is
// configured (e.g. opening the site locally without MySQL).

const fs = require("fs");
const path = require("path");
const { HttpError } = require("./errors");

let pool = null;

function connectionConfig() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (url) return { uri: url };
  if (process.env.MYSQLHOST) {
    return {
      host: process.env.MYSQLHOST,
      port: Number(process.env.MYSQLPORT) || 3306,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE,
    };
  }
  return null;
}

function loadDriver() {
  try {
    return require("mysql2/promise");
  } catch {
    console.error("mysql2 is not installed. Run `npm install`.");
    return null;
  }
}

/** Returns the shared pool, or null if no database is configured. */
function getPool() {
  if (pool) return pool;
  const config = connectionConfig();
  const mysql = config && loadDriver();
  if (!mysql) return null;

  pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true, // return DATE/DATETIME as "YYYY-MM-DD..." strings, same as api.js
  });
  return pool;
}

/** Like getPool(), but throws a user-facing 503 when there's no database. */
function requirePool() {
  const p = getPool();
  if (!p) throw new HttpError(503, "The server's database isn't configured right now. Please try again later.");
  return p;
}

/**
 * Runs Database/schema.sql at startup. Every statement in it is safe to re-run
 * (CREATE TABLE IF NOT EXISTS, idempotent seed inserts), so this just adds any
 * tables or seed rows that are missing — e.g. the `sessions` table on an older database.
 */
async function ensureSchema() {
  const config = connectionConfig();
  const mysql = config && loadDriver();
  if (!mysql) {
    console.warn("No MySQL configured; API routes will return 503.");
    return;
  }
  const sql = fs.readFileSync(path.join(__dirname, "..", "Database", "schema.sql"), "utf8");
  const conn = await mysql.createConnection({ ...config, multipleStatements: true });
  try {
    await conn.query(sql);
    console.log("Database schema is up to date.");
  } finally {
    await conn.end();
  }
}

module.exports = { getPool, requirePool, ensureSchema };
