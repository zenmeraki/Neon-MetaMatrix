import {
  BillingInterval,
  DeliveryMethod,
} from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { PostgreSQLSessionStorage } from "@shopify/shopify-app-session-storage-postgresql";
import dotenv from "dotenv";
import PrivacyWebhookHandlers from "./privacy.js";
import logger from "./utils/loggerUtils.js";

dotenv.config();

const PINNED_SHOPIFY_API_VERSION = "2025-04";
const AUTH_PATH = "/api/auth";
const AUTH_CALLBACK_PATH = "/api/auth/callback";
const AUTH_RETURN_TO_COOKIE = "shopify_app_return_to";
const AUTH_HOST_COOKIE = "shopify_app_host";
const AUTH_CONTEXT_TTL_MS = 10 * 60 * 1000;

function getRequiredEnv(name, aliases = []) {
  const candidates = [name, ...aliases];
  for (const candidate of candidates) {
    const value = process.env[candidate];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  throw new Error(`${name} is not defined and is required for Shopify embedded auth`);
}

function normalizeAppUrl(rawValue) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) {
    throw new Error("SHOPIFY_APP_URL or HOST is required for Shopify embedded auth");
  }

  const withProtocol = /^https?:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Shopify app URL must use http or https");
  }

  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  if (!isLocalhost && url.protocol !== "https:") {
    throw new Error("Shopify embedded apps must use https outside localhost");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";

  return url;
}

function normalizeScopes(rawScopes) {
  const scopes = String(rawScopes || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (!scopes.length) {
    throw new Error("SCOPES is required for Shopify embedded auth");
  }

  return scopes;
}

function sanitizeHostParam(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > 2048) {
    return null;
  }

  return normalized;
}

function sanitizeReturnTo(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > 2048) {
    return null;
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return null;
  }

  if (normalized.startsWith(AUTH_PATH) || normalized.startsWith(AUTH_CALLBACK_PATH)) {
    return "/";
  }

  return normalized;
}

function parseCookieHeader(headerValue = "") {
  return headerValue
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        return cookies;
      }

      const key = decodeURIComponent(part.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

function readCookie(req, name) {
  const cookies = parseCookieHeader(req.headers?.cookie || "");
  return cookies[name] || null;
}

function resolveEmbeddedReturnTo(req, appUrl) {
  const directReturnTo = sanitizeReturnTo(req.query?.returnTo);
  if (directReturnTo) {
    return directReturnTo;
  }

  const referer = req.get?.("referer");
  if (!referer) {
    return "/";
  }

  try {
    const refererUrl = new URL(referer);
    if (refererUrl.origin !== appUrl.origin) {
      return "/";
    }

    return sanitizeReturnTo(`${refererUrl.pathname}${refererUrl.search}`) || "/";
  } catch {
    return "/";
  }
}

const DATABASE_URL = getRequiredEnv("DATABASE_URL");
const SHOPIFY_API_KEY = getRequiredEnv("SHOPIFY_API_KEY");
const SHOPIFY_API_SECRET = getRequiredEnv("SHOPIFY_API_SECRET", ["SHOPIFY_API_SECRET_KEY"]);
const SHOPIFY_SCOPES = normalizeScopes(getRequiredEnv("SCOPES"));
const SHOPIFY_APP_URL = normalizeAppUrl(
  process.env.SHOPIFY_APP_URL || process.env.HOST,
);
const SHOPIFY_HOST_NAME = SHOPIFY_APP_URL.host;
const SHOPIFY_HOST_SCHEME = SHOPIFY_APP_URL.protocol.replace(":", "");
const SHOPIFY_AUTH_CALLBACK_URL = new URL(AUTH_CALLBACK_PATH, SHOPIFY_APP_URL).toString();

logger.info("Shopify embedded auth bootstrap configured", {
  apiVersion: PINNED_SHOPIFY_API_VERSION,
  appUrl: SHOPIFY_APP_URL.toString(),
  callbackUrl: SHOPIFY_AUTH_CALLBACK_URL,
  embedded: true,
  offlineAuth: true,
});

const sessionStorage = new PostgreSQLSessionStorage(DATABASE_URL);

export const billingConfig = {
  "Free Version": {
    amount: 0,
    currencyCode: "USD",
    interval: BillingInterval.OneTime,
  },
  "Basic (Monthly)": {
    amount: 10,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
  "Advanced (Monthly)": {
    amount: 25,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
  "Pro (Monthly)": {
    amount: 50,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
  },
};

export function captureEmbeddedAuthContext(req, res, next) {
  const returnTo = resolveEmbeddedReturnTo(req, SHOPIFY_APP_URL);
  const host = sanitizeHostParam(req.query?.host);
  const secure = SHOPIFY_HOST_SCHEME === "https";

  res.cookie(AUTH_RETURN_TO_COOKIE, returnTo, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: AUTH_CONTEXT_TTL_MS,
  });

  if (host) {
    res.cookie(AUTH_HOST_COOKIE, host, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: AUTH_CONTEXT_TTL_MS,
    });
  }

  next();
}

export function redirectToEmbeddedAppAfterAuth(req, res) {
  const session = res.locals.shopify?.session;
  const shop = session?.shop || String(req.query?.shop || "").trim() || null;
  const host =
    sanitizeHostParam(req.query?.host) ||
    sanitizeHostParam(readCookie(req, AUTH_HOST_COOKIE));
  const returnTo =
    sanitizeReturnTo(readCookie(req, AUTH_RETURN_TO_COOKIE)) || "/";

  const redirectUrl = new URL(returnTo, SHOPIFY_APP_URL);

  if (shop && !redirectUrl.searchParams.has("shop")) {
    redirectUrl.searchParams.set("shop", shop);
  }

  if (host && !redirectUrl.searchParams.has("host")) {
    redirectUrl.searchParams.set("host", host);
  }

  res.clearCookie(AUTH_RETURN_TO_COOKIE, { path: "/" });
  res.clearCookie(AUTH_HOST_COOKIE, { path: "/" });

  return res.redirect(redirectUrl.toString());
}

const shopify = shopifyApp({
  api: {
    apiKey: SHOPIFY_API_KEY,
    apiSecretKey: SHOPIFY_API_SECRET,
    scopes: SHOPIFY_SCOPES,
    hostName: SHOPIFY_HOST_NAME,
    hostScheme: SHOPIFY_HOST_SCHEME,
    isEmbeddedApp: true,
    apiVersion: PINNED_SHOPIFY_API_VERSION,
    future: {
      customerAddressDefaultFix: true,
      lineItemBilling: true,
    },
    billing: billingConfig,
  },
  auth: {
    path: AUTH_PATH,
    callbackPath: AUTH_CALLBACK_PATH,
    isOnline: false,
  },
  webhooks: {
    path: "/api/webhooks",
    ...PrivacyWebhookHandlers,
  },
  sessionStorage,
});

export {
  AUTH_CALLBACK_PATH,
  AUTH_PATH,
  PINNED_SHOPIFY_API_VERSION,
  SHOPIFY_APP_URL,
  SHOPIFY_AUTH_CALLBACK_URL,
};

export default shopify;
