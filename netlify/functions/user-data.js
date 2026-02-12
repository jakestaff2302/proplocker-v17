const jwt = require("jsonwebtoken");
const { json, parseBody } = require("./_lib/http");
const {
  getUserByEmail,
  getUserByLoginId,
  normalizeEmail,
  normalizeLoginId,
  userToClient
} = require("./_lib/db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return json(500, { error: "Missing JWT_SECRET" });

    const body = parseBody(event);
    const identifier = String(body.identifier || "").trim();
    const passwordHash = String(body.passwordHash || "").trim();

    if (!identifier || !passwordHash) {
      return json(400, { error: "Missing identifier or passwordHash" });
    }

    const isEmail = identifier.includes("@");
    const user = isEmail
      ? await getUserByEmail(normalizeEmail(identifier))
      : await getUserByLoginId(normalizeLoginId(identifier));

    if (!user || user.passwordHash !== passwordHash) {
      return json(401, { error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        loginId: user.loginId
      },
      jwtSecret,
      { expiresIn: "30d" }
    );

    return json(200, {
      token,
      user: userToClient(user)
    });
  } catch (error) {
    return json(500, { error: error.message || "Server error" });
  }
};
