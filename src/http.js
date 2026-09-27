function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
  });
  res.end(body);
}

function sendError(res, error) {
  const status = error.statusCode || 500;
  if (status === 500) console.error(error);
  sendJson(res, status, {
    success: false,
    message: status === 500 ? "Internal server error" : error.message
  });
}

function ok(res, data, status = 200) {
  sendJson(res, status, { success: true, data });
}

module.exports = { sendJson, sendError, ok };