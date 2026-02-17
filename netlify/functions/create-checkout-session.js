const Stripe = require("stripe");
const { json, parseBody, verifyJwtFromEvent } = require("./_lib/http");

let dbModule;
try {
  dbModule = require("./_lib/db");
} catch (e) {
  console.warn("[checkout] db module failed to load:", e.message);
  dbModule = null;
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

    let decoded;
    try {
      decoded = verifyJwtFromEvent(event);
    } catch {
      return json(401, {
        error: "SESSION_EXPIRED",
        message: "Missing or invalid token. Please log in again."
      });
    }

    if (!decoded || !decoded.sub) {
      return json(401, {
        error: "SESSION_EXPIRED",
        message: "Missing or invalid token. Please log in again."
      });
    }

    console.info("[checkout] JWT verified for sub:", decoded.sub, "email:", decoded.email);

    // Attempt to resolve user from Blobs, but do not block checkout if Blobs is unavailable
    let user = null;
    let blobsAvailable = false;
    if (dbModule) {
      try {
        user = await dbModule.getUserById(decoded.sub);
        if (!user && decoded.email) {
          user = await dbModule.getUserByEmail(decoded.email);
        }
        if (!user && decoded.loginId) {
          user = await dbModule.getUserByLoginId(decoded.loginId);
        }
        blobsAvailable = true;
      } catch (dbError) {
        const msg = String(dbError?.message || "");
        const isBlobsConfigError =
          msg.includes("Netlify Blobs is not configured") ||
          msg.includes("NETLIFY_SITE_ID") ||
          msg.includes("NETLIFY_AUTH_TOKEN");

        if (isBlobsConfigError) {
          console.warn("[checkout] Blobs not configured, proceeding with JWT claims only");
        } else {
          console.error("[checkout] DB error:", dbError.message);
        }
      }
    }

    // Build user info from either Blobs user or JWT claims
    const userEmail = user?.email || decoded.email || null;
    const userName = user?.name || null;
    const userId = user?.id || decoded.sub;
    const userLoginId = user?.loginId || decoded.loginId || null;

    if (!userEmail) {
      return json(400, {
        error: "NO_EMAIL",
        message: "Could not determine user email. Please log in again."
      });
    }

    const stripe = new Stripe(stripeKey);
    const body = parseBody(event);

    // Resolve or create Stripe customer
    let customerId = user?.stripeCustomerId || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        name: userName || undefined,
        metadata: { user_id: userId, login_id: userLoginId || "" }
      });
      customerId = customer.id;
      console.info("[checkout] Stripe customer created:", customerId);

      // Persist back to Blobs if available
      if (blobsAvailable && user && dbModule) {
        try {
          await dbModule.setUser({
            ...user,
            stripeCustomerId: customerId
          });
        } catch (e) {
          console.warn("[checkout] Failed to persist stripeCustomerId:", e.message);
        }
      }
    }

    const successUrl = `${siteUrl}/?upgrade=success`;
    const cancelUrl = `${siteUrl}/?upgrade=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: body.successUrl || successUrl,
      cancel_url: body.cancelUrl || cancelUrl,
      client_reference_id: userId,
      metadata: {
        user_id: userId,
        email: userEmail,
        login_id: userLoginId || ""
      },
      subscription_data: {
        metadata: {
          user_id: userId,
          email: userEmail,
          login_id: userLoginId || ""
        }
      }
    });

    console.info("[checkout] session created:", session.id);
    return json(200, { url: session.url });
  } catch (error) {
    console.error("[checkout] error:", error.message);
    return json(500, { error: error.message || "Server error" });
  }
};
