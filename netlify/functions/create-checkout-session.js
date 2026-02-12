const Stripe = require("stripe");
const { json, parseBody } = require("./_lib/http");
const { getUserById, getUserByEmail, getUserByLoginId, setUser } = require("./_lib/db");

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  const payloadPart = parts[1];
  const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    const jsonText = Buffer.from(padded, "base64").toString("utf8");
    return { payload: JSON.parse(jsonText) };
  } catch {
    return { error: "Session token payload is malformed. Please log in again." };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    const siteUrl = process.env.SITE_URL;

    if (!stripeKey) return json(500, { error: "Missing STRIPE_SECRET_KEY" });
    if (!priceId) return json(500, { error: "Missing STRIPE_PRICE_ID" });
    if (!siteUrl) return json(500, { error: "Missing SITE_URL" });

    const token = getBearerToken(event);
    if (!token || token.split(".").length !== 3) {
      return json(401, {
        error: "SESSION_EXPIRED",
        message: "Session expired. Please log in again."
      });
    }

    const decodedResult = decodeJwtPayload(token);
    if (decodedResult.error) {
      return json(401, {
        error: "SESSION_EXPIRED",
        message: "Session expired. Please log in again."
      });
    }
    const decoded = decodedResult.payload;

    if (!decoded || !decoded.sub) {
      return json(401, {
        error: "SESSION_EXPIRED",
        message: "Session expired. Please log in again."
      });
    }

    // Prefer canonical user id in token, but fall back to email/login claims
    // so legacy tokens do not break checkout.
    let user = await getUserById(decoded.sub);
    if (!user && decoded.email) {
      user = await getUserByEmail(decoded.email);
    }
    if (!user && decoded.loginId) {
      user = await getUserByLoginId(decoded.loginId);
    }
    if (!user) {
      return json(401, {
        error: "SESSION_EXPIRED",
        message: "Session expired. Please log in again."
      });
    }

    const stripe = new Stripe(stripeKey);
    const body = parseBody(event);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { user_id: user.id, login_id: user.loginId }
      });
      customerId = customer.id;

      await setUser({
        ...user,
        stripeCustomerId: customerId
      });
    }

    const successUrl = `${siteUrl}/?upgrade=success`;
    const cancelUrl = `${siteUrl}/?upgrade=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: body.successUrl || successUrl,
      cancel_url: body.cancelUrl || cancelUrl,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        email: user.email,
        login_id: user.loginId
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          email: user.email,
          login_id: user.loginId
        }
      }
    });

    return json(200, { url: session.url });
  } catch (error) {
    return json(500, { error: error.message || "Server error" });
  }
};
