const { URL } = require("node:url");
const { execute, transaction, oracledb } = require("./db");
const { readBody, saveBase64File } = require("./body");
const { hashPassword, createToken, requireAuth, requireRole } = require("./security");
const { ok } = require("./http");

function normalize(value) {
  return value === undefined || value === null || value === "" ? null : value;
}

function route(method, pathname) {
  return `${method} ${pathname}`;
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const key = route(req.method, pathname);

  if (req.method === "OPTIONS") return ok(res, null);

  if (key === "GET /api/health") {
    await execute("SELECT 1 AS OK FROM DUAL", {}, { autoCommit: false });
    return ok(res, { server: "up", database: "up" });
  }

  if (key === "POST /api/auth/register") {
    const body = await readBody(req);
    const fullName = String(body.fullName || "").trim();
    const userName = String(body.userName || "").trim();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");

    if (!fullName || !userName || !email || !password) {
      const e = new Error("fullName, userName, email and password are required");
      e.statusCode = 400; throw e;
    }

    const existing = await execute(
      `SELECT ID FROM REGISTERED_USERS
       WHERE UPPER(USER_NAME)=UPPER(:userName) OR UPPER(EMAIL)=UPPER(:email)`,
      { userName, email }
    );
    if (existing.rows.length) {
      const e = new Error("Username or email already exists");
      e.statusCode = 409; throw e;
    }

    const result = await execute(
      `INSERT INTO REGISTERED_USERS
       (FULL_NAME, USER_NAME, EMAIL, DOB, MOBILE, ROLE, POLICE_ID, PASSWORD, PROFILE_PICTURE)
       VALUES (:fullName, :userName, :email, :dob, :mobile, :role, :policeId, :password, NULL)
       RETURNING ID INTO :id`,
      {
        fullName, userName, email,
        dob: normalize(body.dob) ? new Date(body.dob) : null,
        mobile: normalize(body.mobile),
        role: String(body.role || "USER").toUpperCase(),
        policeId: normalize(body.policeId),
        password: hashPassword(password),
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: true }
    );

    return ok(res, { id: result.outBinds.id[0], message: "Registration successful" }, 201);
  }

  if (key === "POST /api/auth/login") {
    const body = await readBody(req);
    const userName = String(body.userName || "").trim();
    const password = String(body.password || "");

    if (!userName || !password) {
      const e = new Error("userName and password are required");
      e.statusCode = 400; throw e;
    }

    const result = await execute(
      `SELECT ID, FULL_NAME, USER_NAME, EMAIL, DOB, MOBILE, ROLE, POLICE_ID, PASSWORD
       FROM REGISTERED_USERS
       WHERE UPPER(USER_NAME)=UPPER(:userName)`,
      { userName }
    );

    if (!result.rows.length || result.rows[0].PASSWORD !== hashPassword(password)) {
      const e = new Error("Invalid username or password");
      e.statusCode = 401; throw e;
    }

    const user = result.rows[0];
    const token = createToken({
      id: user.ID,
      userName: user.USER_NAME,
      role: user.ROLE,
      policeId: user.POLICE_ID
    });

    delete user.PASSWORD;
    return ok(res, { token, user });
  }

  if (key === "GET /api/me") {
    const user = requireAuth(req);
    const result = await execute(
      `SELECT ID, FULL_NAME, USER_NAME, EMAIL, DOB, MOBILE, ROLE, POLICE_ID
       FROM REGISTERED_USERS WHERE ID=:id`,
      { id: user.id }
    );
    if (!result.rows.length) {
      const e = new Error("User not found"); e.statusCode = 404; throw e;
    }
    return ok(res, result.rows[0]);
  }

  if (key === "POST /api/crimes") {
    const user = requireAuth(req);
    const body = await readBody(req);

    const required = ["zilla", "upazilla", "policeStation", "dateOfIncident"];
    for (const field of required) {
      if (!body[field]) {
        const e = new Error(`${field} is required`); e.statusCode = 400; throw e;
      }
    }

    const userResult = await execute(
      `SELECT USER_NAME, FULL_NAME FROM REGISTERED_USERS WHERE ID=:id`,
      { id: user.id }
    );
    if (!userResult.rows.length) {
      const e = new Error("User not found"); e.statusCode = 404; throw e;
    }

    const dbUser = userResult.rows[0];
    let media = null;
    if (body.mediaFile) {
      media = saveBase64File(body.mediaFile, body.fileName || "evidence");
    }

    const result = await execute(
      `INSERT INTO REPORTED_CRIMES
       (ID, USER_NAME, FULL_NAME, ZILLA, UPAZILLA, POLICE_STATION,
        AREA, ROAD_NAME, ROAD_NO, DATE_OF_INCIDENT, CATEGORY,
        DESCRIPTION, STATUS, MEDIA_FILE, HIDE_IDENTITY, ACCEPTED,
        POLICE_ID, UPGRADED_BY, ACCEPTED_BY, MEDIA_TYPE)
       VALUES
       (:id, :userName, :fullName, :zilla, :upazilla, :policeStation,
        :area, :roadName, :roadNo, :incidentDate, :category,
        :description, 'Pending', :mediaFile, :hideIdentity, 'Not Accepted',
        NULL, NULL, NULL, :mediaType)
       RETURNING CRIME_ID INTO :crimeId`,
      {
        id: user.id,
        userName: dbUser.USER_NAME,
        fullName: dbUser.FULL_NAME,
        zilla: body.zilla,
        upazilla: body.upazilla,
        policeStation: body.policeStation,
        area: normalize(body.area),
        roadName: normalize(body.roadName),
        roadNo: normalize(body.roadNo),
        incidentDate: new Date(body.dateOfIncident),
        category: normalize(body.category),
        description: normalize(body.description),
        mediaFile: media ? media.buffer : null,
        hideIdentity: String(body.hideIdentity || "No"),
        mediaType: media ? media.mime : normalize(body.mediaType),
        crimeId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: true }
    );

    return ok(res, {
      crimeId: result.outBinds.crimeId[0],
      message: "Crime report submitted"
    }, 201);
  }

  if (key === "GET /api/crimes/my") {
    const user = requireAuth(req);
    const result = await execute(
      `SELECT CRIME_ID, ZILLA, UPAZILLA, POLICE_STATION, AREA, ROAD_NAME,
              ROAD_NO, DATE_OF_INCIDENT, CATEGORY, DESCRIPTION, STATUS,
              HIDE_IDENTITY, ACCEPTED, POLICE_ID, UPGRADED_BY, ACCEPTED_BY,
              MEDIA_TYPE
       FROM REPORTED_CRIMES
       WHERE ID=:id
       ORDER BY CRIME_ID DESC`,
      { id: user.id }
    );
    return ok(res, result.rows);
  }

  if (key === "GET /api/crimes") {
    const user = requireAuth(req);
    requireRole(user, "ADMIN", "POLICE");

    let sql = `
      SELECT CRIME_ID, ID, USER_NAME, FULL_NAME, ZILLA, UPAZILLA,
             POLICE_STATION, AREA, ROAD_NAME, ROAD_NO, DATE_OF_INCIDENT,
             CATEGORY, DESCRIPTION, STATUS, HIDE_IDENTITY, ACCEPTED,
             POLICE_ID, UPGRADED_BY, ACCEPTED_BY, MEDIA_TYPE
      FROM REPORTED_CRIMES`;
    const binds = {};

    if (String(user.role).toUpperCase() === "POLICE") {
      sql += ` WHERE POLICE_ID=:policeId`;
      binds.policeId = user.policeId;
    }

    sql += ` ORDER BY CRIME_ID DESC`;
    const result = await execute(sql, binds);
    return ok(res, result.rows);
  }

  const crimeMatch = pathname.match(/^\/api\/crimes\/(\d+)$/);
  if (crimeMatch && req.method === "GET") {
    const user = requireAuth(req);
    const crimeId = Number(crimeMatch[1]);

    const result = await execute(
      `SELECT CRIME_ID, ID, USER_NAME, FULL_NAME, ZILLA, UPAZILLA,
              POLICE_STATION, AREA, ROAD_NAME, ROAD_NO, DATE_OF_INCIDENT,
              CATEGORY, DESCRIPTION, STATUS, HIDE_IDENTITY, ACCEPTED,
              POLICE_ID, UPGRADED_BY, ACCEPTED_BY, MEDIA_TYPE, MEDIA_FILE
       FROM REPORTED_CRIMES WHERE CRIME_ID=:crimeId`,
      { crimeId }
    );

    if (!result.rows.length) {
      const e = new Error("Crime report not found"); e.statusCode = 404; throw e;
    }

    const crime = result.rows[0];
    const role = String(user.role).toUpperCase();
    const allowed = role === "ADMIN" ||
      (role === "POLICE" && crime.POLICE_ID === user.policeId) ||
      crime.ID === user.id;

    if (!allowed) {
      const e = new Error("Forbidden"); e.statusCode = 403; throw e;
    }

    if (crime.MEDIA_FILE) {
      crime.MEDIA_FILE = Buffer.from(crime.MEDIA_FILE).toString("base64");
    }
    return ok(res, crime);
  }

  if (key === "GET /api/police") {
    const user = requireAuth(req);
    requireRole(user, "ADMIN");

    const result = await execute(
      `SELECT POLICE_ID, NAME, FATHERS_NAME, MOTHERS_NAME,
              PERMANENT_ADDRESS, SELECTION_YEAR, POSTING_AREA,
              POSTING_YEAR, MERITAL_STATUS, INJURIES, POST_NAME,
              POSTING_CITY, POLICE_STATION
       FROM POLICE_INFO ORDER BY NAME`
    );
    return ok(res, result.rows);
  }

  const assignMatch = pathname.match(/^\/api\/admin\/crimes\/(\d+)\/assign$/);
  if (assignMatch && req.method === "PATCH") {
    const user = requireAuth(req);
    requireRole(user, "ADMIN");

    const body = await readBody(req);
    const policeId = String(body.policeId || "").trim();
    if (!policeId) {
      const e = new Error("policeId is required"); e.statusCode = 400; throw e;
    }

    const police = await execute(
      `SELECT POLICE_ID FROM POLICE_INFO WHERE POLICE_ID=:policeId`,
      { policeId }
    );
    if (!police.rows.length) {
      const e = new Error("Police officer not found"); e.statusCode = 404; throw e;
    }

    await execute(
      `UPDATE REPORTED_CRIMES
       SET POLICE_ID=:policeId, STATUS='Assigned'
       WHERE CRIME_ID=:crimeId`,
      { policeId, crimeId: Number(assignMatch[1]) },
      { autoCommit: true }
    );

    return ok(res, { message: "Police officer assigned" });
  }

  const acceptMatch = pathname.match(/^\/api\/admin\/crimes\/(\d+)\/accept$/);
  if (acceptMatch && req.method === "PATCH") {
    const user = requireAuth(req);
    requireRole(user, "ADMIN");

    await execute(
      `UPDATE REPORTED_CRIMES
       SET ACCEPTED='ACCEPTED', ACCEPTED_BY=:acceptedBy
       WHERE CRIME_ID=:crimeId`,
      { acceptedBy: user.userName, crimeId: Number(acceptMatch[1]) },
      { autoCommit: true }
    );

    return ok(res, { message: "Crime report accepted" });
  }

  const statusMatch = pathname.match(/^\/api\/crimes\/(\d+)\/status$/);
  if (statusMatch && req.method === "PATCH") {
    const user = requireAuth(req);
    requireRole(user, "POLICE", "ADMIN");

    const crimeId = Number(statusMatch[1]);
    const body = await readBody(req);
    const status = String(body.status || "").trim();

    if (!status) {
      const e = new Error("status is required"); e.statusCode = 400; throw e;
    }

    if (String(user.role).toUpperCase() === "POLICE") {
      const owned = await execute(
        `SELECT CRIME_ID FROM REPORTED_CRIMES
         WHERE CRIME_ID=:crimeId AND POLICE_ID=:policeId`,
        { crimeId, policeId: user.policeId }
      );
      if (!owned.rows.length) {
        const e = new Error("This case is not assigned to you"); e.statusCode = 403; throw e;
      }
    }

    await execute(
      `UPDATE REPORTED_CRIMES
       SET STATUS=:status, UPGRADED_BY=:upgradedBy
       WHERE CRIME_ID=:crimeId`,
      { status, upgradedBy: user.userName, crimeId },
      { autoCommit: true }
    );

    return ok(res, { message: "Crime status updated" });
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userMatch && req.method === "DELETE") {
    const user = requireAuth(req);
    requireRole(user, "ADMIN");

    const targetId = Number(userMatch[1]);
    if (targetId === user.id) {
      const e = new Error("Admin cannot delete the current account");
      e.statusCode = 400; throw e;
    }

    await execute(
      `DELETE FROM REGISTERED_USERS WHERE ID=:id`,
      { id: targetId },
      { autoCommit: true }
    );
    return ok(res, { message: "User deleted" });
  }

  const profileMatch = pathname.match(/^\/api\/users\/(\d+)\/password$/);
  if (profileMatch && req.method === "PATCH") {
    const user = requireAuth(req);
    const targetId = Number(profileMatch[1]);
    if (targetId !== user.id) {
      const e = new Error("Forbidden"); e.statusCode = 403; throw e;
    }

    const body = await readBody(req);
    if (!body.password) {
      const e = new Error("password is required"); e.statusCode = 400; throw e;
    }

    await execute(
      `UPDATE REGISTERED_USERS SET PASSWORD=:password WHERE ID=:id`,
      { password: hashPassword(String(body.password)), id: targetId },
      { autoCommit: true }
    );

    return ok(res, { message: "Password changed" });
  }

  const e = new Error("Route not found");
  e.statusCode = 404;
  throw e;
}

module.exports = { handle };