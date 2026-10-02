const app = require("./app");
const config = require("./config");
const { initDb, closeDb } = require("./db");

async function start() {
  try {
    await initDb();

    const server = app.listen(config.port, () => {
      console.log(`Crime Report API running on http://localhost:${config.port}`);
    });

    const shutdown = async () => {
      console.log("\nShutting down...");
      server.close(async () => {
        await closeDb();
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
