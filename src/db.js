const oracledb = require("oracledb");
const config = require("./config");

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;

let pool;

async function initDb() {
  pool = await oracledb.createPool({
    user: config.db.user,
    password: config.db.password,
    connectString: config.db.connectString,
    poolMin: config.db.poolMin,
    poolMax: config.db.poolMax,
    poolIncrement: config.db.poolIncrement
  });
}

async function closeDb() {
  if (pool) await pool.close(10);
}

async function execute(sql, binds = {}, options = {}) {
  const connection = await pool.getConnection();
  try {
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: false,
      ...options
    });
    if (options.autoCommit !== false) await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    await connection.close();
  }
}

async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    await connection.close();
  }
}

module.exports = { oracledb, initDb, closeDb, execute, transaction };