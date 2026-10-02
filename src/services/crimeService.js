const oracledb = require("oracledb");
const { getConnection } = require("../db");
const { toBuffer, crimeFromRow } = require("../utils");

const CRIME_COLUMNS = `
  CRIME_ID, ID, USER_NAME, FULL_NAME, ZILLA, UPAZILLA, POLICE_STATION,
  AREA, ROAD_NAME, ROAD_NO, DATE_OF_INCIDENT, CATEGORY, DESCRIPTION,
  STATUS, MEDIA_FILE, HIDE_IDENTITY, ACCEPTED, POLICE_ID, UPGRADED_BY,
  ACCEPTED_BY, MEDIA_TYPE
`;

async function createCrime(userId, data) {
  let connection;

  try {
    connection = await getConnection();

    const userResult = await connection.execute(
      `SELECT ID, USER_NAME, FULL_NAME
       FROM REGISTERED_USERS
       WHERE ID = :id`,
      { id: userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!userResult.rows.length) {
      throw Object.assign(new Error("User not found"), { status: 404 });
    }

    const user = userResult.rows[0];

    const required = ["zilla", "upazilla", "police_station", "date_of_incident"];
    for (const field of required) {
      if (!data[field]) {
        throw Object.assign(new Error(`${field} is required`), { status: 400 });
      }
    }

    const media = toBuffer(data.media_file);

    const result = await connection.execute(
      `INSERT INTO REPORTED_CRIMES
       (ID, USER_NAME, FULL_NAME, ZILLA, UPAZILLA, POLICE_STATION,
        AREA, ROAD_NAME, ROAD_NO, DATE_OF_INCIDENT, CATEGORY, DESCRIPTION,
        STATUS, MEDIA_FILE, HIDE_IDENTITY, ACCEPTED, POLICE_ID,
        UPGRADED_BY, ACCEPTED_BY, MEDIA_TYPE)
       VALUES
       (:id, :user_name, :full_name, :zilla, :upazilla, :police_station,
        :area, :road_name, :road_no, :date_of_incident, :category, :description,
        'Pending', :media_file, :hide_identity, 'Not Accepted', NULL,
        NULL, NULL, :media_type)
       RETURNING CRIME_ID INTO :crime_id`,
      {
        id: user.ID,
        user_name: user.USER_NAME,
        full_name: user.FULL_NAME,
        zilla: data.zilla,
        upazilla: data.upazilla,
        police_station: data.police_station,
        area: data.area || null,
        road_name: data.road_name || null,
        road_no: data.road_no || null,
        date_of_incident: new Date(data.date_of_incident),
        category: data.category || null,
        description: data.description || null,
        media_file: { val: media, type: oracledb.BLOB },
        hide_identity: data.hide_identity || "NO",
        media_type: data.media_type || null,
        crime_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: true }
    );

    return getCrimeById(result.outBinds.crime_id[0]);
  } finally {
    if (connection) await connection.close();
  }
}

async function getCrimeById(crimeId) {
  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT ${CRIME_COLUMNS}
       FROM REPORTED_CRIMES
       WHERE CRIME_ID = :crime_id`,
      { crime_id: crimeId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return crimeFromRow(result.rows[0]);
  } finally {
    if (connection) await connection.close();
  }
}

async function listMyCrimes(userId) {
  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT ${CRIME_COLUMNS}
       FROM REPORTED_CRIMES
       WHERE ID = :id
       ORDER BY CRIME_ID DESC`,
      { id: userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return result.rows.map(crimeFromRow);
  } finally {
    if (connection) await connection.close();
  }
}

async function listAcceptedCrimes() {
  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT ${CRIME_COLUMNS}
       FROM REPORTED_CRIMES
       WHERE ACCEPTED = 'Accepted'
       ORDER BY CRIME_ID DESC`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return result.rows.map(crimeFromRow);
  } finally {
    if (connection) await connection.close();
  }
}

async function listPendingCrimes(policeUserId) {
  let connection;

  try {
    connection = await getConnection();

    const result = await connection.execute(
      `
      SELECT
        rc.CRIME_ID,
        rc.ID,
        rc.USER_NAME,
        rc.FULL_NAME,
        rc.ZILLA,
        rc.UPAZILLA,
        rc.POLICE_STATION,
        rc.AREA,
        rc.ROAD_NAME,
        rc.ROAD_NO,
        rc.DATE_OF_INCIDENT,
        rc.CATEGORY,
        rc.DESCRIPTION,
        rc.STATUS,
        rc.MEDIA_FILE,
        rc.HIDE_IDENTITY,
        rc.ACCEPTED,
        rc.POLICE_ID,
        rc.UPGRADED_BY,
        rc.ACCEPTED_BY,
        rc.MEDIA_TYPE
      FROM REPORTED_CRIMES rc
      JOIN REGISTERED_USERS u
        ON u.ID = :police_user_id
      JOIN POLICE_INFO p
        ON p.POLICE_ID = u.POLICE_ID
      WHERE UPPER(u.ROLE) = 'POLICE'
        AND (
          LOWER(rc.POLICE_STATION) = LOWER(p.POLICE_STATION)
          OR LOWER(rc.AREA) = LOWER(p.POSTING_AREA)
          OR LOWER(rc.UPAZILLA) = LOWER(p.POSTING_CITY)
        )
        AND NVL(rc.ACCEPTED, 'Not Accepted') = 'Accepted'
        AND NVL(rc.STATUS, 'Pending') IN ('Pending', 'Accepted', 'Under Investigation')
      ORDER BY rc.DATE_OF_INCIDENT DESC
      `,
      { police_user_id: policeUserId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return result.rows.map(crimeFromRow);
  } finally {
    if (connection) await connection.close();
  }
}

async function updateCrime(userId, crimeId, data) {
  let connection;
  try {
    connection = await getConnection();

    const current = await connection.execute(
      `SELECT CRIME_ID FROM REPORTED_CRIMES
       WHERE CRIME_ID = :crime_id AND ID = :user_id`,
      { crime_id: crimeId, user_id: userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!current.rows.length) {
      throw Object.assign(new Error("Crime report not found"), { status: 404 });
    }

    const allowed = [
      "zilla", "upazilla", "police_station", "area", "road_name",
      "road_no", "date_of_incident", "category", "description",
      "hide_identity", "media_type"
    ];

    const sets = [];
    const binds = { crime_id: crimeId };

    for (const field of allowed) {
      if (data[field] !== undefined) {
        const column = field.toUpperCase();
        sets.push(`${column} = :${field}`);
        binds[field] =
          field === "date_of_incident"
            ? new Date(data[field])
            : data[field];
      }
    }

    if (data.media_file !== undefined) {
      sets.push(`MEDIA_FILE = :media_file`);
      binds.media_file = { val: toBuffer(data.media_file), type: oracledb.BLOB };
    }

    if (!sets.length) {
      return getCrimeById(crimeId);
    }

    await connection.execute(
      `UPDATE REPORTED_CRIMES
       SET ${sets.join(", ")}
       WHERE CRIME_ID = :crime_id`,
      binds,
      { autoCommit: true }
    );

    return getCrimeById(crimeId);
  } finally {
    if (connection) await connection.close();
  }
}

async function deleteCrime(userId, crimeId) {
  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `DELETE FROM REPORTED_CRIMES
       WHERE CRIME_ID = :crime_id AND ID = :user_id`,
      { crime_id: crimeId, user_id: userId },
      { autoCommit: true }
    );

    if (!result.rowsAffected) {
      throw Object.assign(new Error("Crime report not found"), { status: 404 });
    }

    return { message: "Crime report deleted" };
  } finally {
    if (connection) await connection.close();
  }
}

async function acceptCrime(adminId, crimeId) {
  let connection;
  try {
    connection = await getConnection();

    const admin = await connection.execute(
      `SELECT USER_NAME FROM REGISTERED_USERS
       WHERE ID = :id AND UPPER(ROLE) = 'ADMIN'`,
      { id: adminId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!admin.rows.length) {
      throw Object.assign(new Error("Admin not found"), { status: 403 });
    }

    const result = await connection.execute(
      `UPDATE REPORTED_CRIMES
       SET ACCEPTED = 'Accepted',
           ACCEPTED_BY = :accepted_by
       WHERE CRIME_ID = :crime_id`,
      { accepted_by: admin.rows[0].USER_NAME, crime_id: crimeId },
      { autoCommit: true }
    );

    if (!result.rowsAffected) {
      throw Object.assign(new Error("Crime report not found"), { status: 404 });
    }

    return getCrimeById(crimeId);
  } finally {
    if (connection) await connection.close();
  }
}

async function updatePoliceStatus(policeUserId, crimeId, status) {
  const allowed = ["Accepted", "Pending", "Under Investigation"];

  if (!allowed.includes(status)) {
    throw Object.assign(
      new Error(`status must be one of: ${allowed.join(", ")}`),
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await getConnection();

    const police = await connection.execute(
      `SELECT USER_NAME, POLICE_ID
       FROM REGISTERED_USERS
       WHERE ID = :id AND UPPER(ROLE) = 'POLICE'`,
      { id: policeUserId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!police.rows.length) {
      throw Object.assign(new Error("Police user not found"), { status: 403 });
    }

    if (!police.rows[0].POLICE_ID) {
      throw Object.assign(new Error("Police ID is missing"), { status: 403 });
    }

    const result = await connection.execute(
      `UPDATE REPORTED_CRIMES
       SET STATUS = :status,
           POLICE_ID = :police_id,
           UPGRADED_BY = :upgraded_by
       WHERE CRIME_ID = :crime_id`,
      {
        status,
        police_id: police.rows[0].POLICE_ID,
        upgraded_by: police.rows[0].USER_NAME,
        crime_id: crimeId
      },
      { autoCommit: true }
    );

    if (!result.rowsAffected) {
      throw Object.assign(new Error("Crime report not found"), { status: 404 });
    }

    return getCrimeById(crimeId);
  } finally {
    if (connection) await connection.close();
  }
}

module.exports = {
  createCrime,
  getCrimeById,
  listMyCrimes,
  listAcceptedCrimes,
  listPendingCrimes,
  updateCrime,
  deleteCrime,
  acceptCrime,
  searchReports,
  updatePoliceStatus
};


async function searchReports(search) {
  const connection = await getConnection();

  try {
    const q = `%${String(search || "").trim().toLowerCase()}%`;

    const result = await connection.execute(
      `
      SELECT
        CRIME_ID,
        ID,
        USER_NAME,
        FULL_NAME,
        ZILLA,
        UPAZILLA,
        POLICE_STATION,
        AREA,
        ROAD_NAME,
        ROAD_NO,
        DATE_OF_INCIDENT,
        CATEGORY,
        DESCRIPTION,
        STATUS,
        HIDE_IDENTITY,
        ACCEPTED,
        POLICE_ID,
        UPGRADED_BY,
        ACCEPTED_BY,
        MEDIA_TYPE
      FROM REPORTED_CRIMES
      WHERE ACCEPTED = 'Accepted'
        AND (
          LOWER(USER_NAME) LIKE :q
          OR LOWER(FULL_NAME) LIKE :q
          OR LOWER(ZILLA) LIKE :q
          OR LOWER(UPAZILLA) LIKE :q
          OR LOWER(POLICE_STATION) LIKE :q
          OR LOWER(AREA) LIKE :q
          OR LOWER(ROAD_NAME) LIKE :q
        )
      ORDER BY DATE_OF_INCIDENT DESC
      `,
      { q },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return result.rows.map(crimeFromRow);
  } finally {
    await connection.close();
  }
}