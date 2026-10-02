const oracledb = require("oracledb");
const bcrypt = require("bcryptjs");
const { getConnection } = require("../db");
const { toBuffer, userFromRow } = require("../utils");

const USER_COLUMNS = `
  ID, FULL_NAME, USER_NAME, EMAIL, DOB, MOBILE, ROLE, POLICE_ID,
  PROFILE_PICTURE
`;

async function findUserById(id) {
  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT ${USER_COLUMNS} FROM REGISTERED_USERS WHERE ID = :id`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return userFromRow(result.rows[0]);
  } finally {
    if (connection) await connection.close();
  }
}

async function register(data) {
  const {
    full_name,
    user_name,
    email,
    dob,
    mobile,
    role = "public",
    police_id,
    password,
    profile_picture,
  } = data;

  if (!full_name || !user_name || !email || !password) {
    throw Object.assign(
      new Error("full_name, user_name, email and password are required"),
      { status: 400 },
    );
  }

  const normalizedRole = String(role).toLowerCase();

  if (!["public", "police", "admin"].includes(normalizedRole)) {
    throw Object.assign(new Error("Invalid role"), { status: 400 });
  }

  let connection;

  try {
    connection = await getConnection();

    const duplicate = await connection.execute(
      `SELECT ID FROM REGISTERED_USERS
       WHERE LOWER(USER_NAME) = LOWER(:user_name)
          OR LOWER(EMAIL) = LOWER(:email)`,
      { user_name, email },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    if (duplicate.rows.length) {
      throw Object.assign(new Error("Username or email already exists"), {
        status: 409,
      });
    }

    if (normalizedRole === "police") {
      if (!police_id) {
        throw Object.assign(
          new Error("police_id is required for police registration"),
          { status: 400 },
        );
      }

      const police = await connection.execute(
        `SELECT POLICE_ID
         FROM POLICE_INFO
         WHERE POLICE_ID = :police_id`,
        { police_id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      if (!police.rows.length) {
        throw Object.assign(
          new Error("Police ID does not exist in POLICE_INFO"),
          { status: 400 },
        );
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const picture = toBuffer(profile_picture);

    const result = await connection.execute(
      `INSERT INTO REGISTERED_USERS
       (
         FULL_NAME,
         USER_NAME,
         EMAIL,
         DOB,
         MOBILE,
         ROLE,
         POLICE_ID,
         PASSWORD,
         PROFILE_PICTURE
       )
       VALUES
       (
         :full_name,
         :user_name,
         :email,
         :dob,
         :mobile,
         :role,
         :police_id,
         :password,
         :profile_picture
       )
       RETURNING ID INTO :id`,
      {
        full_name,
        user_name,
        email,
        dob: dob ? new Date(dob) : null,
        mobile: mobile || null,

        // ALWAYS STORED AS LOWERCASE
        role: normalizedRole,

        police_id: normalizedRole === "police" ? police_id : null,

        password: passwordHash,

        profile_picture: {
          val: picture,
          type: oracledb.BLOB,
        },

        id: {
          dir: oracledb.BIND_OUT,
          type: oracledb.NUMBER,
        },
      },
      { autoCommit: true },
    );

    return findUserById(result.outBinds.id[0]);
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

async function login(userNameOrEmail, password) {
  if (!userNameOrEmail || !password) {
    throw Object.assign(new Error("username/email and password are required"), {
      status: 400,
    });
  }

  let connection;

  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT ${USER_COLUMNS}, PASSWORD
       FROM REGISTERED_USERS
       WHERE LOWER(USER_NAME) = LOWER(:value)
          OR LOWER(EMAIL) = LOWER(:value)`,
      { value: userNameOrEmail },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    if (!result.rows.length) {
      throw Object.assign(new Error("Invalid username/email or password"), {
        status: 401,
      });
    }

    const row = result.rows[0];
    const valid = await bcrypt.compare(password, row.PASSWORD);

    if (!valid) {
      throw Object.assign(new Error("Invalid username/email or password"), {
        status: 401,
      });
    }

    return userFromRow(row);
  } finally {
    if (connection) await connection.close();
  }
}

async function listUsers() {
  let connection;
  try {
    connection = await getConnection();
    const result = await connection.execute(
      `SELECT ID, FULL_NAME, USER_NAME, EMAIL, DOB, MOBILE, ROLE, POLICE_ID
       FROM REGISTERED_USERS
       ORDER BY ID DESC`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return result.rows.map((row) => ({
      id: row.ID,
      full_name: row.FULL_NAME,
      user_name: row.USER_NAME,
      email: row.EMAIL,
      dob: row.DOB,
      mobile: row.MOBILE,
      role: row.ROLE,
      police_id: row.POLICE_ID,
    }));
  } finally {
    if (connection) await connection.close();
  }
}

async function updateRole(id, role) {
  const normalizedRole = String(role || "")
    .trim()
    .toLowerCase();

  if (!["public", "police", "admin"].includes(normalizedRole)) {
    throw Object.assign(
      new Error("Invalid role"),
      { status: 400 },
    );
  }

  let connection;

  try {
    connection = await getConnection();

    // A user can only become police if they have a verified POLICE_ID.
    if (normalizedRole === "police") {
      const police = await connection.execute(
        `SELECT POLICE_ID
         FROM REGISTERED_USERS
         WHERE ID = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      if (!police.rows.length) {
        throw Object.assign(
          new Error("User not found"),
          { status: 404 },
        );
      }

      if (!police.rows[0].POLICE_ID) {
        throw Object.assign(
          new Error(
            "This user has no verified POLICE_ID and cannot be changed to police",
          ),
          { status: 400 },
        );
      }
    }

    const result = await connection.execute(
      `UPDATE REGISTERED_USERS
       SET ROLE = :role
       WHERE ID = :id`,
      {
        role: normalizedRole,
        id,
      },
      { autoCommit: true },
    );

    if (!result.rowsAffected) {
      throw Object.assign(
        new Error("User not found"),
        { status: 404 },
      );
    }

    return findUserById(id);
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}
async function deleteUser(id) {
  let connection;
  try {
    connection = await getConnection();

    try {
      await connection.execute(`DELETE FROM REPORTED_CRIMES WHERE ID = :id`, {
        id,
      });
    } catch (error) {
      if (error.errorNum !== 2292) throw error;
      throw Object.assign(
        new Error("User cannot be deleted because related records still exist"),
        { status: 409 },
      );
    }

    const result = await connection.execute(
      `DELETE FROM REGISTERED_USERS WHERE ID = :id`,
      { id },
      { autoCommit: true },
    );

    if (!result.rowsAffected) {
      throw Object.assign(new Error("User not found"), { status: 404 });
    }

    return { message: "User deleted" };
  } finally {
    if (connection) await connection.close();
  }
}

module.exports = {
  register,
  login,
  findUserById,
  listUsers,
  updateRole,
  deleteUser,
};
