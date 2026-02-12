const jwt = require("jsonwebtoken");
const { json, parseBody } = require("./_lib/http");
const { getUserByEmail, getUserByLoginId, normalizeEmail, normalizeLoginId } = require("./_lib/db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return json(500, { error: "Missing JWT_SECRET" });

    const body = parseBody(event);
    const email = normalizeEmail(body.email);
    const loginId = normalizeLoginId(body.loginId);
    const passwordHash = String(body.passwordHash || "").trim();

    if (!email && !loginId) {
      return json(400, { error: "Missing loginId or email" });
    }

    let user = null;
    if (email) user = await getUserByEmail(email);
    if (!user && loginId) user = await getUserByLoginId(loginId);

    if (!user) {
      return json(401, { error: "Invalid identity" });
    }

    if (passwordHash && user.passwordHash && user.passwordHash !== passwordHash) {
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

    return json(200, { token });
  } catch (error) {
    return json(500, { error: error.message || "Server error" });
  }
};
