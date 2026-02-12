const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

let USERS_STORE = null;
let INDEX_STORE = null;
let STORES_READY = false;

function getBlobsConfig() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;

  const missing = [];
  if (!siteID) missing.push("NETLIFY_SITE_ID");
  if (!token) missing.push("NETLIFY_AUTH_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      `Netlify Blobs is not configured. Missing env var(s): ${missing.join(", ")}.`
    );
  }

  return { siteID, token };
}

function ensureStores() {
  if (STORES_READY && USERS_STORE && INDEX_STORE) {
    return { usersStore: USERS_STORE, indexStore: INDEX_STORE };
  }

  try {
    const { siteID, token } = getBlobsConfig();
    console.info("[db] Initializing Netlify Blobs stores", {
      storeNames: ["proplocker_users_v17", "proplocker_users_v17_index"],
      siteIdPrefix: String(siteID).slice(0, 8),
      hasToken: Boolean(token)
    });

    USERS_STORE = getStore("proplocker_users_v17", { siteID, token });
    INDEX_STORE = getStore("proplocker_users_v17_index", { siteID, token });
    STORES_READY = true;
    return { usersStore: USERS_STORE, indexStore: INDEX_STORE };
  } catch (error) {
    console.error("[db] Failed to initialize Netlify Blobs stores:", error.message);
    throw error;
  }
}

function userKey(userId) {
  return `user:${String(userId)}`;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeLoginId(loginId) {
  return String(loginId || "").trim();
}

function emailIndexKey(email) {
  return `email:${normalizeEmail(email)}`;
}

function loginIndexKey(loginId) {
  return `login:${normalizeLoginId(loginId)}`;
}

function stripeCustomerIndexKey(customerId) {
  return `stripe_customer:${String(customerId || "").trim()}`;
}

function stripeSubscriptionIndexKey(subscriptionId) {
  return `stripe_subscription:${String(subscriptionId || "").trim()}`;
}

async function setJson(store, key, value) {
  await store.set(key, JSON.stringify(value));
}

async function getJson(store, key) {
  const raw = await store.get(key, { type: "text" });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getUserById(userId) {
  if (!userId) return null;
  const { usersStore } = ensureStores();
  return getJson(usersStore, userKey(userId));
}

async function getUserIdByEmail(email) {
  const { indexStore } = ensureStores();
  return indexStore.get(emailIndexKey(email), { type: "text" });
}

async function getUserIdByLoginId(loginId) {
  const { indexStore } = ensureStores();
  return indexStore.get(loginIndexKey(loginId), { type: "text" });
}

async function getUserByEmail(email) {
  const userId = await getUserIdByEmail(email);
  return getUserById(userId);
}

async function getUserByLoginId(loginId) {
  const userId = await getUserIdByLoginId(loginId);
  return getUserById(userId);
}

async function getUserIdByStripeCustomerId(customerId) {
  const { indexStore } = ensureStores();
  return indexStore.get(stripeCustomerIndexKey(customerId), { type: "text" });
}

async function getUserIdByStripeSubscriptionId(subscriptionId) {
  const { indexStore } = ensureStores();
  return indexStore.get(stripeSubscriptionIndexKey(subscriptionId), { type: "text" });
}

async function setUser(user) {
  const saved = {
    id: user.id || crypto.randomUUID(),
    name: String(user.name || "").trim(),
    email: normalizeEmail(user.email),
    loginId: normalizeLoginId(user.loginId),
    passwordHash: String(user.passwordHash || "").trim(),
    hasActiveSubscription: Boolean(user.hasActiveSubscription),
    stripeCustomerId: user.stripeCustomerId ? String(user.stripeCustomerId) : null,
    stripeSubscriptionId: user.stripeSubscriptionId ? String(user.stripeSubscriptionId) : null,
    stripeSubscriptionStatus: user.stripeSubscriptionStatus ? String(user.stripeSubscriptionStatus) : null,
    createdAt: user.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const { usersStore, indexStore } = ensureStores();

  await setJson(usersStore, userKey(saved.id), saved);
  await indexStore.set(emailIndexKey(saved.email), saved.id);
  await indexStore.set(loginIndexKey(saved.loginId), saved.id);

  if (saved.stripeCustomerId) {
    await indexStore.set(stripeCustomerIndexKey(saved.stripeCustomerId), saved.id);
  }
  if (saved.stripeSubscriptionId) {
    await indexStore.set(stripeSubscriptionIndexKey(saved.stripeSubscriptionId), saved.id);
  }

  return saved;
}

function userToClient(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    loginId: user.loginId,
    login_id: user.loginId,
    hasActiveSubscription: Boolean(user.hasActiveSubscription),
    createdAt: user.createdAt
  };
}

function isActiveStripeStatus(status) {
  return status === "active" || status === "trialing";
}

module.exports = {
  getUserById,
  getUserByEmail,
  getUserByLoginId,
  getUserIdByEmail,
  getUserIdByLoginId,
  getUserIdByStripeCustomerId,
  getUserIdByStripeSubscriptionId,
  setUser,
  userToClient,
  normalizeEmail,
  normalizeLoginId,
  isActiveStripeStatus
};
