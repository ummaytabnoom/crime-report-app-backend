const { getConnection } = require("./db");

async function getActor(req, res, next) {
  const userId = Number(req.header("x-user-id"));

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      message: "x-user-id header is required"
    });
  }

  let connection;

  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT ID, FULL_NAME, USER_NAME, ROLE, POLICE_ID
       FROM REGISTERED_USERS
       WHERE ID = :id`,
      { id: userId },
      { outFormat: require("oracledb").OUT_FORMAT_OBJECT }
    );

    if (!result.rows.length) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  } finally {
    if (connection) await connection.close();
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(String(req.user.ROLE || "").toLowerCase())) {
      return res.status(403).json({ message: "Permission denied" });
    }
    next();
  };
}

module.exports = { getActor, requireRole };
