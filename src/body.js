const fs = require("node:fs");
const config = require("./config");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on("data", chunk => {
      total += chunk.length;
      if (total > config.maxBodyBytes) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const type = String(req.headers["content-type"] || "").split(";")[0];

      if (!raw.length) return resolve({});

      if (type === "application/json") {
        try {
          resolve(JSON.parse(raw.toString("utf8")));
        } catch {
          reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
        }
      } else {
        resolve(Object.fromEntries(new URLSearchParams(raw.toString("utf8"))));
      }
    });

    req.on("error", reject);
  });
}

function saveBase64File(base64, filename) {
  if (!base64) return null;

  const match = String(base64).match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    const error = new Error("mediaFile must be a data URL containing base64");
    error.statusCode = 400;
    throw error;
  }

  const mime = match[1].toLowerCase();
  const allowed = new Set([
    "image/jpeg", "image/png", "image/webp",
    "video/mp4", "video/webm"
  ]);

  if (!allowed.has(mime)) {
    const error = new Error("Unsupported media type");
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(match[2], "base64");
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${filename || "evidence"}`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const fullPath = require("node:path").join(config.uploadDir, safeName);
  fs.writeFileSync(fullPath, buffer);

  return { path: fullPath, mime, buffer };
}

module.exports = { readBody, saveBase64File };