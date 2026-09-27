const http = require("node:http");
const fs = require("node:fs");
const config = require("./config");
const { initDb, closeDb } = require("./db");
const { handle } = require("./routes");
const { sendError } = require("./http");

fs.mkdirSync(config.uploadDir, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

async function start() {
  await initDb();
  server.listen(config.port, () => {
    console.log(`Crime Report API running on http://localhost:${config.port}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    try { await closeDb(); } finally { process.exit(0); }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});