const crypto = require("node:crypto");
const config = require("./config");

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(password, "utf8")
    .digest("hex");
}

function createToken(payload, expiresInSeconds = 8 * 60 * 60) {
  const header = Buffer.from(
    JSON.stringify({
      alg: "HS256",
      typ: "JWT",
    })
  ).toString("base64url");

  const now = Math.floor(Date.now() / 1000);

  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  const parts = String(token || "").split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid token");
  }

  const [header, body, signature] = parts;

  const expected = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${header}.${body}`)
    .digest("base64url");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  ) {
    throw new Error("Invalid token");
  }

  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8")
  );

  if (
    !payload.exp ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Token expired");
  }

  return payload;
}

function authorization(req) {
  const value = req.headers.authorization || "";

  if (!value.startsWith("Bearer ")) {
    return null;
  }

  return value.slice(7);
}

function requireAuth(req) {
  const token = authorization(req);

  if (!token) {
    const error = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  try {
    return verifyToken(token);
  } catch {
    const error = new Error("Invalid or expired token");
    error.statusCode = 401;
    throw error;
  }
}

function requireRole(user, ...roles) {
  const currentRole = String(user?.role || "")
    .trim()
    .toLowerCase();

  const allowedRoles = roles.map((role) =>
    String(role).trim().toLowerCase()
  );

  console.log("CURRENT ROLE:", currentRole);
  console.log("ALLOWED ROLES:", allowedRoles);

  if (!allowedRoles.includes(currentRole)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }

  return user;
}

module.exports = {
  hashPassword,
  createToken,
  verifyToken,
  requireAuth,
  requireRole,
};