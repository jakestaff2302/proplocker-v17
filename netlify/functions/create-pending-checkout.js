const Stripe = require("stripe");
const { json, parseBody } = require("./_lib/http");

let dbModule;
try {
  dbModule = require("./_lib/db");
} catch (e) {
  console.warn("[pending-checkout] db module failed to load:", e.message);
  dbModule = null;
}

/**
 * Creates a Stripe Checkout session for "payment-first" flow.
 * No JWT required — the user hasn't created an account yet.
 * A pending_token is generated to link the payment back to the signup flow.
 */
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

    const body = parseBody(event);
    const email = String(body.email || "").trim().toLowerCase();

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return json(400, { error: "Valid email is required" });
    }

    const stripe = new Stripe(stripeKey);

    // Create or find Stripe customer by email
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    let customer;
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
        metadata: { signup_flow: "payment_first" }
      });
    }

    // Generate a pending token to track this checkout
    const crypto = require("crypto");
    const pendingToken = crypto.randomBytes(32).toString("hex");

    // Store the pending token in Blobs if available
    if (dbModule) {
      try {
        const { getStore } = require("@netlify/blobs");
        const siteID = process.env.NETLIFY_SITE_ID;
        const token = process.env.NETLIFY_AUTH_TOKEN;
        if (siteID && token) {
          const pendingStore = getStore("proplocker_pending_signups", { siteID, token });
          await pendingStore.set(`pending:${pendingToken}`, JSON.stringify({
            email,
            stripeCustomerId: customer.id,
            createdAt: new Date().toISOString(),
            status: "pending_payment"
          }));
        }
      } catch (e) {
        console.warn("[pending-checkout] Failed to store pending token:", e.message);
      }
    }

    const successUrl = `${siteUrl}/?flow=payment_first&pending_token=${pendingToken}&status=success`;
    const cancelUrl = `${siteUrl}/?flow=payment_first&status=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        signup_flow: "payment_first",
        pending_token: pendingToken,
        email
      },
      subscription_data: {
        metadata: {
          signup_flow: "payment_first",
          pending_token: pendingToken,
          email
        }
      }
    });

    console.info("[pending-checkout] session created:", session.id, "for:", email);
    return json(200, { url: session.url, pendingToken });
  } catch (error) {
    console.error("[pending-checkout] error:", error.message);
    return json(500, { error: error.message || "Server error" });
  }
};
