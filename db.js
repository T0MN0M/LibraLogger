const mysql = require('mysql2/promise');

// Railway automatically provides these environment variables when your services are linked
const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Optional: Test the connection when the file runs
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log("Connected to Railway MySQL successfully!");
    connection.release();
  } catch (err) {
    console.error("Database connection failed:", err.message);
  }
}

testConnection();

module.exports = pool;