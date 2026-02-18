const jwt = require("jsonwebtoken");
const { json, parseBody } = require("./_lib/http");
const {
  getUserByEmail,
  getUserByLoginId,
  normalizeEmail,
  normalizeLoginId,
  setUser,
  userToClient
} = require("./_lib/db");

/**
 * Completes the signup flow after payment.
 * Validates the pending_token, creates the user account,
 * links the Stripe customer/subscription, and issues a JWT.
 */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const loginId = normalizeLoginId(body.loginId);
    const passwordHash = String(body.passwordHash || "").trim();
    const pendingToken = String(body.pendingToken || "").trim();

    if (!name || !email || !loginId || !passwordHash) {
      return json(400, { error: "Missing required fields: name, email, passwordHash, loginId" });
    }

    if (!pendingToken) {
      return json(400, { error: "Missing pending token. Payment must be completed first." });
    }

    // Validate pending token from Blobs
    let pendingData = null;
    const { getStore } = require("@netlify/blobs");
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_AUTH_TOKEN;

    if (siteID && token) {
      try {
        const pendingStore = getStore("proplocker_pending_signups", { siteID, token });
        const raw = await pendingStore.get(`pending:${pendingToken}`, { type: "text" });
        if (raw) {
          pendingData = JSON.parse(raw);
        }
      } catch (e) {
        console.warn("[complete-signup] Failed to read pending token:", e.message);
      }
    }

    if (!pendingData) {
      return json(400, { error: "Invalid or expired pending token. Please restart the signup process." });
    }

    // Verify email matches the pending checkout
    if (pendingData.email && normalizeEmail(pendingData.email) !== email) {
      return json(400, { error: "Email does not match the payment record. Use the same email from checkout." });
    }

    // Check for duplicate loginId or email conflicts
    const [byEmail, byLoginId] = await Promise.all([
      getUserByEmail(email),
      getUserByLoginId(loginId)
    ]);

    if (byEmail && byLoginId && byEmail.id !== byLoginId.id) {
      return json(409, { error: "loginId is already in use" });
    }

    if (byEmail) {
      return json(409, { error: "An account with this email already exists. Please log in instead." });
    }

    // Create the user with Stripe data from pending record
    const saved = await setUser({
      name,
      email,
      loginId,
      passwordHash,
      hasActiveSubscription: pendingData.status === "payment_confirmed" || pendingData.hasActiveSubscription === true,
      stripeCustomerId: pendingData.stripeCustomerId || null,
      stripeSubscriptionId: pendingData.stripeSubscriptionId || null,
      stripeSubscriptionStatus: pendingData.stripeSubscriptionStatus || null
    });

    // Update pending record to completed
    if (siteID && token) {
      try {
        const pendingStore = getStore("proplocker_pending_signups", { siteID, token });
        await pendingStore.set(`pending:${pendingToken}`, JSON.stringify({
          ...pendingData,
          status: "account_created",
          userId: saved.id,
          completedAt: new Date().toISOString()
        }));
      } catch (e) {
        console.warn("[complete-signup] Failed to update pending record:", e.message);
      }
    }

    // Also update the user record with stripe subscription index
    // so webhook events can find this user later
    if (pendingData.stripeSubscriptionId) {
      try {
        const indexStore = getStore("proplocker_users_v17_index", { siteID, token });
        await indexStore.set(`stripe_subscription:${pendingData.stripeSubscriptionId}`, saved.id);
      } catch (e) {
        console.warn("[complete-signup] Failed to set stripe subscription index:", e.message);
      }
    }

    // Issue JWT
    const jwtSecret = process.env.JWT_SECRET;
    let jwtToken = null;
    if (jwtSecret) {
      jwtToken = jwt.sign(
        { sub: saved.id, email: saved.email, loginId: saved.loginId },
        jwtSecret,
        { expiresIn: "30d" }
      );
    }

    console.info("[complete-signup] account created for:", email, "userId:", saved.id);
    return json(200, {
      user: userToClient(saved),
      token: jwtToken,
      mode: jwtToken ? "cloud" : "local"
    });
  } catch (error) {
    console.error("[complete-signup] error:", error.message);
    return json(500, { error: error.message || "Server error" });
  }
};
