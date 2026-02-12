const jwt = require("jsonwebtoken");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function getBearerToken(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

function verifyJwtFromEvent(event) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET");
  const token = getBearerToken(event);
  if (!token) return null;
  return jwt.verify(token, secret);
}

module.exports = {
  CORS_HEADERS,
  json,
  parseBody,
  getBearerToken,
  verifyJwtFromEvent
};
