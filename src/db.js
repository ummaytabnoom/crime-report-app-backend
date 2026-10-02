const oracledb = require("oracledb");
const config = require("./config");

oracledb.fetchAsString = [oracledb.CLOB];

let pool;

async function initDb() {
  pool = await oracledb.createPool({
    user: config.db.user,
    password: config.db.password,
    connectString: config.db.connectString,
    poolMin: 1,
    poolMax: 5,
    poolIncrement: 1
  });

  console.log("OracleDB connected");
}

async function getConnection() {
  if (!pool) throw new Error("Database pool is not initialized");
  return pool.getConnection();
}

async function closeDb() {
  if (pool) {
    await pool.close(10);
    pool = null;
  }
}

module.exports = { initDb, getConnection, closeDb };
