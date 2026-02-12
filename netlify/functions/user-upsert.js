const { json, parseBody } = require("./_lib/http");
const {
  getUserByEmail,
  getUserByLoginId,
  normalizeEmail,
  normalizeLoginId,
  setUser,
  userToClient
} = require("./_lib/db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const loginId = normalizeLoginId(body.loginId);
    const passwordHash = String(body.passwordHash || "").trim();

    if (!name || !email || !loginId || !passwordHash) {
      return json(400, { error: "Missing required fields: name, email, passwordHash, loginId" });
    }

    const [byEmail, byLoginId] = await Promise.all([
      getUserByEmail(email),
      getUserByLoginId(loginId)
    ]);

    if (byEmail && byLoginId && byEmail.id !== byLoginId.id) {
      return json(409, { error: "loginId is already in use" });
    }

    const existing = byEmail || byLoginId;
    const saved = await setUser({
      ...(existing || {}),
      name,
      email,
      loginId,
      passwordHash,
      hasActiveSubscription: existing ? existing.hasActiveSubscription : false
    });

    return json(200, userToClient(saved));
  } catch (error) {
    return json(500, { error: error.message || "Server error" });
  }
};
