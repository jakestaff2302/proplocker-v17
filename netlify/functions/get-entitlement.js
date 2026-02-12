const Stripe = require("stripe");
const { json, verifyJwtFromEvent } = require("./_lib/http");
const { getUserById, setUser, isActiveStripeStatus } = require("./_lib/db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    let decoded;
    try {
      decoded = verifyJwtFromEvent(event);
    } catch {
      return json(200, { hasActiveSubscription: false });
    }

    if (!decoded || !decoded.sub) {
      return json(200, { hasActiveSubscription: false });
    }

    const user = await getUserById(decoded.sub);
    if (!user) return json(200, { hasActiveSubscription: false });

    let hasActive = Boolean(user.hasActiveSubscription);

    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      if (user.stripeSubscriptionId) {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        hasActive = isActiveStripeStatus(sub.status);

        await setUser({
          ...user,
          stripeCustomerId: sub.customer ? String(sub.customer) : user.stripeCustomerId,
          stripeSubscriptionId: sub.id,
          stripeSubscriptionStatus: sub.status,
          hasActiveSubscription: hasActive
        });
      } else if (user.stripeCustomerId) {
        const subs = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          status: "all",
          limit: 10
        });

        const active = subs.data.find((s) => isActiveStripeStatus(s.status));
        if (active) {
          hasActive = true;
          await setUser({
            ...user,
            stripeSubscriptionId: active.id,
            stripeSubscriptionStatus: active.status,
            hasActiveSubscription: true
          });
        } else {
          hasActive = false;
          await setUser({
            ...user,
            hasActiveSubscription: false
          });
        }
      }
    }

    return json(200, { hasActiveSubscription: hasActive });
  } catch (error) {
    return json(500, { error: error.message || "Server error" });
  }
};
