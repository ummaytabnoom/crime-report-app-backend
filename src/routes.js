const { URL } = require("node:url");
const { execute, transaction, oracledb } = require("./db");
const {
  readBody,
  saveBase64File,
} = require("./body");

const {
  hashPassword,
  createToken,
  requireAuth,
  requireRole,
} = require("./security");

const { ok } = require("./http");

function normalize(value) {
  return value === undefined || value === null || value === ""
    ? null
    : value;
}

function route(method, pathname) {
  return `${method} ${pathname}`;
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const key = route(req.method, pathname);

  // ============================================================
  // OPTIONS
  // ============================================================

  if (req.method === "OPTIONS") {
    return ok(res, null);
  }

  // ============================================================
  // HEALTH
  // ============================================================

  if (key === "GET /api/health") {
    await execute(
      "SELECT 1 AS OK FROM DUAL",
      {},
      { autoCommit: false }
    );

    return ok(res, {
      server: "up",
      database: "up",
    });
  }

  // ============================================================
  // REGISTER
  // ============================================================

  if (key === "POST /api/auth/register") {
    const body = await readBody(req);

    const fullName = String(body.fullName || "").trim();
    const userName = String(body.userName || "").trim();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");

    if (!fullName || !userName || !email || !password) {
      const e = new Error(
        "fullName, userName, email and password are required"
      );

      e.statusCode = 400;
      throw e;
    }

    const existing = await execute(
      `SELECT ID
       FROM REGISTERED_USERS
       WHERE UPPER(USER_NAME)=UPPER(:userName)
          OR UPPER(EMAIL)=UPPER(:email)`,
      {
        userName,
        email,
      }
    );

    if (existing.rows.length) {
      const e = new Error(
        "Username or email already exists"
      );

      e.statusCode = 409;
      throw e;
    }

    const role = String(
      body.role || "public"
    ).toLowerCase();

    const allowedRoles = [
      "public",
      "admin",
      "police",
    ];

    if (!allowedRoles.includes(role)) {
      const e = new Error(
        "Invalid role. Allowed roles: public, admin, police"
      );

      e.statusCode = 400;
      throw e;
    }

    const result = await execute(
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
         :fullName,
         :userName,
         :email,
         :dob,
         :mobile,
         :role,
         :policeId,
         :password,
         NULL
       )
       RETURNING ID INTO :id`,
      {
        fullName,
        userName,
        email,

        dob: normalize(body.dob)
          ? new Date(body.dob)
          : null,

        mobile: normalize(body.mobile),
        role,
        policeId: normalize(body.policeId),
        password: hashPassword(password),

        id: {
          dir: oracledb.BIND_OUT,
          type: oracledb.NUMBER,
        },
      },
      {
        autoCommit: true,
      }
    );

    return ok(
      res,
      {
        id: result.outBinds.id[0],
        message: "Registration successful",
      },
      201
    );
  }

  // ============================================================
  // LOGIN
  // ============================================================

  if (key === "POST /api/auth/login") {
    const body = await readBody(req);

    const userName = String(
      body.userName || ""
    ).trim();

    const password = String(
      body.password || ""
    );

    if (!userName || !password) {
      const e = new Error(
        "userName and password are required"
      );

      e.statusCode = 400;
      throw e;
    }

    const result = await execute(
      `SELECT
         ID,
         FULL_NAME,
         USER_NAME,
         EMAIL,
         DOB,
         MOBILE,
         ROLE,
         POLICE_ID,
         PASSWORD
       FROM REGISTERED_USERS
       WHERE UPPER(USER_NAME)=UPPER(:userName)`,
      {
        userName,
      }
    );

    if (
      !result.rows.length ||
      result.rows[0].PASSWORD !==
        hashPassword(password)
    ) {
      const e = new Error(
        "Invalid username or password"
      );

      e.statusCode = 401;
      throw e;
    }

    const user = result.rows[0];

    const token = createToken({
      id: user.ID,
      userName: user.USER_NAME,
      role: user.ROLE,
      policeId: user.POLICE_ID,
    });

    delete user.PASSWORD;

    return ok(res, {
      token,
      user,
    });
  }

  // ============================================================
  // CURRENT USER
  // ============================================================

  if (key === "GET /api/auth/me") {
    const user = requireAuth(req);

    const result = await execute(
      `SELECT
         ID,
         FULL_NAME,
         USER_NAME,
         EMAIL,
         DOB,
         MOBILE,
         ROLE,
         POLICE_ID
       FROM REGISTERED_USERS
       WHERE ID=:id`,
      {
        id: user.id,
      }
    );

    if (!result.rows.length) {
      const e = new Error("User not found");
      e.statusCode = 404;
      throw e;
    }

    return ok(res, result.rows[0]);
  }

  // ============================================================
  // GET ALL CRIME REPORTS
  // ADMIN + POLICE
  // ============================================================

  if (key === "GET /api/crimes") {
    const user = requireAuth(req);

    requireRole(user, "admin", "police");

    let sql = `
      SELECT
        c.CRIME_ID,
        c.ID,
        c.USER_NAME,
        c.FULL_NAME,
        c.ZILLA,
        c.UPAZILLA,
        c.POLICE_STATION,
        c.AREA,
        c.ROAD_NAME,
        c.ROAD_NO,
        c.DATE_OF_INCIDENT,
        c.CATEGORY,
        c.DESCRIPTION,
        c.STATUS,
        c.HIDE_IDENTITY,
        c.ACCEPTED,
        c.POLICE_ID,
        c.UPGRADED_BY,
        c.ACCEPTED_BY,
        c.MEDIA_TYPE,

        u.EMAIL,
        u.MOBILE,
        u.DOB,
        u.ROLE

      FROM REPORTED_CRIMES c

      LEFT JOIN REGISTERED_USERS u
        ON c.ID = u.ID
    `;

    const binds = {};
    const conditions = [];

    // Police only see reports assigned to them
    if (
      String(user.role).toLowerCase() ===
      "police"
    ) {
      conditions.push(
        `c.POLICE_ID = :policeId`
      );

      binds.policeId = user.policeId;
    }

    // Search
    const q = String(
      url.searchParams.get("q") || ""
    ).trim();

    if (q) {
      conditions.push(`
        (
          UPPER(c.USER_NAME) LIKE UPPER(:q)
          OR UPPER(c.FULL_NAME) LIKE UPPER(:q)
          OR UPPER(c.CATEGORY) LIKE UPPER(:q)
          OR UPPER(c.ZILLA) LIKE UPPER(:q)
          OR UPPER(c.UPAZILLA) LIKE UPPER(:q)
          OR UPPER(c.POLICE_STATION) LIKE UPPER(:q)
          OR UPPER(c.STATUS) LIKE UPPER(:q)
        )
      `);

      binds.q = `%${q}%`;
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += `
      ORDER BY c.CRIME_ID DESC
    `;

    console.log("GET /api/crimes");
    console.log("USER:", user);
    console.log("BINDS:", binds);

    const result = await execute(
      sql,
      binds
    );

    // Convert Oracle CLOB
    const rows = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,

        DESCRIPTION:
          row.DESCRIPTION &&
          typeof row.DESCRIPTION.getData ===
            "function"
            ? await row.DESCRIPTION.getData()
            : row.DESCRIPTION,
      }))
    );

    console.log(
      "CRIMES FOUND:",
      rows.length
    );

    return ok(res, rows);
  }

  // ============================================================
  // GET MY CRIME REPORTS
  // ============================================================

  if (key === "GET /api/crimes/my") {
    const user = requireAuth(req);

    const result = await execute(
      `SELECT
         CRIME_ID,
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
       WHERE ID=:id
       ORDER BY CRIME_ID DESC`,
      {
        id: user.id,
      }
    );

    const rows = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,

        DESCRIPTION:
          row.DESCRIPTION &&
          typeof row.DESCRIPTION.getData ===
            "function"
            ? await row.DESCRIPTION.getData()
            : row.DESCRIPTION,
      }))
    );

    return ok(res, rows);
  }

  // ============================================================
  // CREATE CRIME REPORT
  // ============================================================

  if (key === "POST /api/crimes") {
    const user = requireAuth(req);

    const body = await readBody(req);

    const required = [
      "zilla",
      "upazilla",
      "policeStation",
      "dateOfIncident",
    ];

    for (const field of required) {
      if (!body[field]) {
        const e = new Error(
          `${field} is required`
        );

        e.statusCode = 400;
        throw e;
      }
    }

    const userResult = await execute(
      `SELECT
         USER_NAME,
         FULL_NAME
       FROM REGISTERED_USERS
       WHERE ID=:id`,
      {
        id: user.id,
      }
    );

    if (!userResult.rows.length) {
      const e = new Error(
        "User not found"
      );

      e.statusCode = 404;
      throw e;
    }

    const dbUser = userResult.rows[0];

    let media = null;

    if (body.mediaFile) {
      media = saveBase64File(
        body.mediaFile,
        body.fileName || "evidence"
      );
    }

    const hideIdentity =
      String(
        body.hideIdentity || "No"
      ).toLowerCase() === "yes"
        ? "Yes"
        : "No";

    const result = await execute(
      `INSERT INTO REPORTED_CRIMES
       (
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
         MEDIA_FILE,
         HIDE_IDENTITY,
         ACCEPTED,
         POLICE_ID,
         UPGRADED_BY,
         ACCEPTED_BY,
         MEDIA_TYPE
       )
       VALUES
       (
         :id,
         :userName,
         :fullName,
         :zilla,
         :upazilla,
         :policeStation,
         :area,
         :roadName,
         :roadNo,
         :incidentDate,
         :category,
         :description,
         'Pending',
         :mediaFile,
         :hideIdentity,
         'Not Accepted',
         NULL,
         NULL,
         NULL,
         :mediaType
       )
       RETURNING CRIME_ID INTO :crimeId`,
      {
        id: user.id,

        userName:
          dbUser.USER_NAME,

        fullName:
          dbUser.FULL_NAME,

        zilla:
          body.zilla,

        upazilla:
          body.upazilla,

        policeStation:
          body.policeStation,

        area:
          normalize(body.area),

        roadName:
          normalize(body.roadName),

        roadNo:
          normalize(body.roadNo),

        incidentDate:
          new Date(body.dateOfIncident),

        category:
          normalize(body.category),

        description:
          normalize(body.description),

        mediaFile:
          media
            ? media.buffer
            : null,

        hideIdentity,

        mediaType:
          media
            ? media.mime
            : normalize(
                body.mediaType
              ),

        crimeId: {
          dir: oracledb.BIND_OUT,
          type: oracledb.NUMBER,
        },
      },
      {
        autoCommit: true,
      }
    );

    return ok(
      res,
      {
        crimeId:
          result.outBinds
            .crimeId[0],

        message:
          "Crime report submitted",
      },
      201
    );
  }

  // ============================================================
  // GET SINGLE CRIME
  // ============================================================

  const crimeMatch =
    pathname.match(
      /^\/api\/crimes\/(\d+)$/
    );

  if (
    crimeMatch &&
    req.method === "GET"
  ) {
    const user = requireAuth(req);

    const crimeId = Number(
      crimeMatch[1]
    );

    const result = await execute(
      `SELECT
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
         MEDIA_TYPE,
         MEDIA_FILE
       FROM REPORTED_CRIMES
       WHERE CRIME_ID=:crimeId`,
      {
        crimeId,
      }
    );

    if (!result.rows.length) {
      const e = new Error(
        "Crime report not found"
      );

      e.statusCode = 404;
      throw e;
    }

    const crime = result.rows[0];

    const role = String(
      user.role
    ).toLowerCase();

    const allowed =
      role === "admin" ||
      (
        role === "police" &&
        crime.POLICE_ID ===
          user.policeId
      ) ||
      crime.ID === user.id;

    if (!allowed) {
      const e = new Error(
        "Forbidden"
      );

      e.statusCode = 403;
      throw e;
    }

    if (crime.MEDIA_FILE) {
      crime.MEDIA_FILE =
        Buffer.from(
          crime.MEDIA_FILE
        ).toString("base64");
    }

    return ok(res, crime);
  }

  // ============================================================
  // GET POLICE
  // ============================================================

  if (key === "GET /api/police") {
    const user = requireAuth(req);

    requireRole(user, "admin");

    const result = await execute(
      `SELECT
         POLICE_ID,
         NAME,
         FATHERS_NAME,
         MOTHERS_NAME,
         PERMANENT_ADDRESS,
         SELECTION_YEAR,
         POSTING_AREA,
         POSTING_YEAR,
         MERITAL_STATUS,
         INJURIES,
         POST_NAME,
         POSTING_CITY,
         POLICE_STATION
       FROM POLICE_INFO
       ORDER BY NAME`
    );

    return ok(res, result.rows);
  }

  // ============================================================
  // ASSIGN POLICE OFFICER
  // ============================================================

  const assignMatch =
    pathname.match(
      /^\/api\/admin\/crimes\/(\d+)\/assign$/
    );

  if (
    assignMatch &&
    req.method === "PATCH"
  ) {
    const user = requireAuth(req);

    requireRole(user, "admin");

    const body = await readBody(req);

    const policeId = String(
      body.policeId || ""
    ).trim();

    if (!policeId) {
      const e = new Error(
        "policeId is required"
      );

      e.statusCode = 400;
      throw e;
    }

    const police = await execute(
      `SELECT POLICE_ID
       FROM POLICE_INFO
       WHERE POLICE_ID=:policeId`,
      {
        policeId,
      }
    );

    if (!police.rows.length) {
      const e = new Error(
        "Police officer not found"
      );

      e.statusCode = 404;
      throw e;
    }

    await execute(
      `UPDATE REPORTED_CRIMES
       SET
         POLICE_ID=:policeId,
         STATUS='Assigned'
       WHERE CRIME_ID=:crimeId`,
      {
        policeId,
        crimeId:
          Number(assignMatch[1]),
      },
      {
        autoCommit: true,
      }
    );

    return ok(res, {
      message:
        "Police officer assigned",
    });
  }

 // ============================================================
// ALLOW / ACCEPT CRIME REPORT
// PATCH /api/admin/crimes/:id/accept
// ============================================================

const acceptMatch =
  pathname.match(
    /^\/api\/admin\/crimes\/(\d+)\/accept$/
  );

if (
  acceptMatch &&
  req.method === "PATCH"
) {
  const user = requireAuth(req);

  requireRole(user, "admin");

  const crimeId = Number(
    acceptMatch[1]
  );

  if (!Number.isInteger(crimeId)) {
    const e = new Error(
      "Invalid crime ID"
    );

    e.statusCode = 400;
    throw e;
  }

  // Check that the report exists
  const existing = await execute(
    `SELECT
       CRIME_ID,
       ACCEPTED
     FROM REPORTED_CRIMES
     WHERE CRIME_ID = :crimeId`,
    {
      crimeId,
    }
  );

  if (!existing.rows.length) {
    const e = new Error(
      "Crime report not found"
    );

    e.statusCode = 404;
    throw e;
  }

  // IMPORTANT:
  // Your database uses "Accepted" and "Not Accepted"
  // so we use "Accepted" here.
  await execute(
    `UPDATE REPORTED_CRIMES
     SET
       ACCEPTED = 'Accepted',
       ACCEPTED_BY = :acceptedBy
     WHERE CRIME_ID = :crimeId`,
    {
      acceptedBy: user.userName,
      crimeId,
    },
    {
      autoCommit: true,
    }
  );

  console.log(
    `Crime #${crimeId} accepted by ${user.userName}`
  );

  return ok(res, {
    message:
      "Crime report accepted successfully",
    crimeId,
  });
}


    // ============================================================
  // GET ALL USERS
  // ADMIN ONLY
  // GET /api/admin/users
  // ============================================================

  if (
    key === "GET /api/admin/users"
  ) {
    const user = requireAuth(req);

    requireRole(user, "admin");

    const q = String(
      url.searchParams.get("q") || ""
    ).trim();

    let sql = `
      SELECT
        ID,
        FULL_NAME,
        USER_NAME,
        EMAIL,
        DOB,
        MOBILE,
        ROLE,
        POLICE_ID,
        PROFILE_PICTURE
      FROM REGISTERED_USERS
    `;

    const binds = {};

sql += `
  WHERE ROLE = 'admin'
`;

if (q) {
  sql += `
    AND (
      UPPER(FULL_NAME) LIKE UPPER(:q)
      OR UPPER(USER_NAME) LIKE UPPER(:q)
      OR UPPER(EMAIL) LIKE UPPER(:q)
      OR UPPER(MOBILE) LIKE UPPER(:q)
    )
  `;

  binds.q = `%${q}%`;
}

    sql += `
      ORDER BY ID DESC
    `;

    const result = await execute(
  sql,
  binds
);

const rows = await Promise.all(
  result.rows.map(async (row) => ({
    ...row,

    PROFILE_PICTURE:
      row.PROFILE_PICTURE &&
      typeof row.PROFILE_PICTURE.getData === "function"
        ? (
            await row.PROFILE_PICTURE.getData()
          ).toString("base64")
        : row.PROFILE_PICTURE,
  }))
);

return ok(res, rows);
  }

  // ============================================================
// DELETE CRIME REPORT
// DELETE /api/admin/crimes/:id/delete
// ============================================================

const deleteCrimeMatch =
  pathname.match(
    /^\/api\/admin\/crimes\/(\d+)\/delete$/
  );

if (
  deleteCrimeMatch &&
  req.method === "DELETE"
) {
  const user = requireAuth(req);

  requireRole(user, "admin");

  const crimeId = Number(
    deleteCrimeMatch[1]
  );

  if (!Number.isInteger(crimeId)) {
    const e = new Error(
      "Invalid crime ID"
    );

    e.statusCode = 400;
    throw e;
  }

  // Check that the report exists
  const existing = await execute(
    `SELECT CRIME_ID
     FROM REPORTED_CRIMES
     WHERE CRIME_ID = :crimeId`,
    {
      crimeId,
    }
  );

  if (!existing.rows.length) {
    const e = new Error(
      "Crime report not found"
    );

    e.statusCode = 404;
    throw e;
  }



  // Delete
  await execute(
    `DELETE FROM REPORTED_CRIMES
     WHERE CRIME_ID = :crimeId`,
    {
      crimeId,
    },
    {
      autoCommit: true,
    }
  );

  console.log(
    `Crime #${crimeId} deleted by ${user.userName}`
  );

  return ok(res, {
    message:
      "Crime report deleted successfully",
    crimeId,
  });
}

  // ============================================================

  // ============================================================
  // UPGRADE POLICE USER TO ADMIN
  // ADMIN ONLY
  // PATCH /api/admin/users/:id/role
  // ============================================================

  const upgradeUserMatch =
    pathname.match(
      /^\/api\/admin\/users\/(\d+)\/role$/
    );

  if (
    upgradeUserMatch &&
    req.method === "PATCH"
  ) {
    const user = requireAuth(req);

    requireRole(user, "admin");

    const targetId = Number(
      upgradeUserMatch[1]
    );

    if (!Number.isInteger(targetId)) {
      const e = new Error(
        "Invalid user ID"
      );

      e.statusCode = 400;
      throw e;
    }

    // Find target user
    const existing = await execute(
      `SELECT
         ID,
         FULL_NAME,
         USER_NAME,
         ROLE
       FROM REGISTERED_USERS
       WHERE ID=:id`,
      {
        id: targetId,
      }
    );

    if (!existing.rows.length) {
      const e = new Error(
        "User not found"
      );

      e.statusCode = 404;
      throw e;
    }

    const targetUser =
      existing.rows[0];

    // Only police users can be upgraded
    if (
      String(targetUser.ROLE)
        .trim()
        .toLowerCase() !== "police"
    ) {
      const e = new Error(
        "Only police users can be upgraded to admin"
      );

      e.statusCode = 400;
      throw e;
    }

    await execute(
      `UPDATE REGISTERED_USERS
       SET ROLE='admin'
       WHERE ID=:id`,
      {
        id: targetId,
      },
      {
        autoCommit: true,
      }
    );

    console.log(
      `User #${targetId} (${targetUser.USER_NAME}) upgraded to admin by ${user.userName}`
    );

    return ok(res, {
      message:
        "Police user upgraded to admin successfully",

      user: {
        ID: targetUser.ID,
        FULL_NAME:
          targetUser.FULL_NAME,
        USER_NAME:
          targetUser.USER_NAME,
        ROLE: "admin",
      },
    });
  }


  // UPDATE CRIME STATUS
  // ============================================================

  const statusMatch =
    pathname.match(
      /^\/api\/crimes\/(\d+)\/status$/
    );

  if (
    statusMatch &&
    req.method === "PATCH"
  ) {
    const user = requireAuth(req);

    requireRole(
      user,
      "police",
      "admin"
    );

    const crimeId = Number(
      statusMatch[1]
    );

    const body = await readBody(req);

    const status = String(
      body.status || ""
    ).trim();

    if (!status) {
      const e = new Error(
        "status is required"
      );

      e.statusCode = 400;
      throw e;
    }

    if (
      String(user.role).toLowerCase() ===
      "police"
    ) {
      const owned = await execute(
        `SELECT CRIME_ID
         FROM REPORTED_CRIMES
         WHERE CRIME_ID=:crimeId
           AND POLICE_ID=:policeId`,
        {
          crimeId,
          policeId:
            user.policeId,
        }
      );

      if (!owned.rows.length) {
        const e = new Error(
          "This case is not assigned to you"
        );

        e.statusCode = 403;
        throw e;
      }
    }

    await execute(
      `UPDATE REPORTED_CRIMES
       SET
         STATUS=:status,
         UPGRADED_BY=:upgradedBy
       WHERE CRIME_ID=:crimeId`,
      {
        status,
        upgradedBy:
          user.userName,
        crimeId,
      },
      {
        autoCommit: true,
      }
    );

    return ok(res, {
      message:
        "Crime status updated",
    });
  }

  // ============================================================
  // DELETE USER
  // ============================================================

  const userMatch =
    pathname.match(
      /^\/api\/admin\/users\/(\d+)$/
    );

  if (
    userMatch &&
    req.method === "DELETE"
  ) {
    const user = requireAuth(req);

    requireRole(user, "admin");

    const targetId = Number(
      userMatch[1]
    );

    if (targetId === user.id) {
      const e = new Error(
        "Admin cannot delete the current account"
      );

      e.statusCode = 400;
      throw e;
    }

    await execute(
      `DELETE FROM REGISTERED_USERS
       WHERE ID=:id`,
      {
        id: targetId,
      },
      {
        autoCommit: true,
      }
    );

    return ok(res, {
      message:
        "User deleted",
    });
  }

  // ============================================================
  // CHANGE PASSWORD
  // ============================================================

  const profileMatch =
    pathname.match(
      /^\/api\/users\/(\d+)\/password$/
    );

  if (
    profileMatch &&
    req.method === "PATCH"
  ) {
    const user = requireAuth(req);

    const targetId = Number(
      profileMatch[1]
    );

    if (targetId !== user.id) {
      const e = new Error(
        "Forbidden"
      );

      e.statusCode = 403;
      throw e;
    }

    const body = await readBody(req);

    if (!body.password) {
      const e = new Error(
        "password is required"
      );

      e.statusCode = 400;
      throw e;
    }

    await execute(
      `UPDATE REGISTERED_USERS
       SET PASSWORD=:password
       WHERE ID=:id`,
      {
        password:
          hashPassword(
            String(body.password)
          ),

        id: targetId,
      },
      {
        autoCommit: true,
      }
    );

    return ok(res, {
      message:
        "Password changed",
    });
  }

  // ============================================================
  // ROUTE NOT FOUND
  // ============================================================

  const e = new Error(
    "Route not found"
  );

  e.statusCode = 404;

  throw e;
}

module.exports = {
  handle,
};
