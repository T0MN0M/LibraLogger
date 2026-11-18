// MySQL connection pool (Railway MySQL service).
//
// Reads the connection from Railway's variables. In the Node service on Railway,
// add a variable reference to the MySQL service's MYSQL_URL (or the individual
// MYSQLHOST / MYSQLPORT / MYSQLUSER / MYSQLPASSWORD / MYSQLDATABASE variables).
// Never commit credentials.
//
// The pool is created lazily so the static site still runs when no database is
// configured (e.g. opening the site locally without MySQL).

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

/** Returns the shared pool, or null if no database is configured. */
function getPool() {
  if (pool) return pool;
  const config = connectionConfig();
  if (!config) return null;

  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    console.error("mysql2 is not installed. Run `npm install`.");
    return null;
  }

  const base = config.uri ? { uri: config.uri } : config;
  pool = mysql.createPool({
    ...base,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true, // return DATE/DATETIME as "YYYY-MM-DD..." strings, same as api.js
  });
  return pool;
}

module.exports = { getPool };
