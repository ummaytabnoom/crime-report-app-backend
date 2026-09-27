const path = require("node:path");

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  db: {
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    connectString: required("DB_CONNECT_STRING", "localhost:1521/XE"),
    poolMin: Number(process.env.DB_POOL_MIN || 1),
    poolMax: Number(process.env.DB_POOL_MAX || 10),
    poolIncrement: Number(process.env.DB_POOL_INCREMENT || 1)
  },
  jwtSecret: required("JWT_SECRET"),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "uploads"),
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024)
};