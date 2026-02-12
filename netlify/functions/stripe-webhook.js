const Stripe = require("stripe");
const {
  getUserById,
  getUserIdByStripeCustomerId,
  getUserIdByStripeSubscriptionId,
  getUserByEmail,
  setUser,
  isActiveStripeStatus
} = require("./_lib/db");

function rawBody(event) {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

async function resolveUserFromObject(obj) {
  const metadataUserId = obj && obj.metadata && obj.metadata.user_id;
  if (metadataUserId) return getUserById(metadataUserId);

  if (obj && obj.client_reference_id) {
    const byRef = await getUserById(obj.client_reference_id);
    if (byRef) return byRef;
  }

  if (obj && obj.subscription) {
    const subId = typeof obj.subscription === "string" ? obj.subscription : obj.subscription.id;
    const bySubId = await getUserIdByStripeSubscriptionId(subId);
    if (bySubId) return getUserById(bySubId);
  }

  if (obj && obj.customer) {
    const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer.id;
    const byCustomerId = await getUserIdByStripeCustomerId(customerId);
    if (byCustomerId) return getUserById(byCustomerId);
  }

  if (obj && obj.customer_email) {
    const byEmail = await getUserByEmail(obj.customer_email);
    if (byEmail) return byEmail;
  }

  return null;
}

async function applySubscriptionToUser(user, subscription) {
  if (!user || !subscription) return;

  const customerId = subscription.customer
    ? (typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id)
    : user.stripeCustomerId;

  await setUser({
    ...user,
    stripeCustomerId: customerId || null,
    stripeSubscriptionId: subscription.id || user.stripeSubscriptionId,
    stripeSubscriptionStatus: subscription.status || null,
    hasActiveSubscription: isActiveStripeStatus(subscription.status || "")
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return { statusCode: 500, body: "Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET" };
  }

  const stripe = new Stripe(stripeKey);

  let stripeEvent;
  try {
    const headers = event.headers || {};
    const signature = headers["stripe-signature"] || headers["Stripe-Signature"];
    stripeEvent = stripe.webhooks.constructEvent(rawBody(event), signature, webhookSecret);
  } catch (error) {
    return { statusCode: 400, body: `Webhook signature verification failed: ${error.message}` };
  }

  try {
    const type = stripeEvent.type;
    const object = stripeEvent.data.object;

    if (type === "checkout.session.completed") {
      const user = await resolveUserFromObject(object);
      if (user) {
        const subscriptionId =
          typeof object.subscription === "string" ? object.subscription : object.subscription && object.subscription.id;

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await applySubscriptionToUser(user, subscription);
        } else {
          await setUser({
            ...user,
            stripeCustomerId: object.customer ? String(object.customer) : user.stripeCustomerId,
            hasActiveSubscription: true
          });
        }
      }
    }

    if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const user = await resolveUserFromObject(object);
      if (user) {
        await applySubscriptionToUser(user, object);
      }
    }

    if (type === "invoice.paid" || type === "invoice.payment_failed") {
      const user = await resolveUserFromObject(object);
      if (user) {
        const subscriptionId =
          typeof object.subscription === "string" ? object.subscription : object.subscription && object.subscription.id;

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await applySubscriptionToUser(user, subscription);
        } else if (type === "invoice.payment_failed") {
          await setUser({
            ...user,
            hasActiveSubscription: false
          });
        }
      }
    }

    return { statusCode: 200, body: "ok" };
  } catch (error) {
    return { statusCode: 500, body: error.message || "Webhook handler error" };
  }
};
