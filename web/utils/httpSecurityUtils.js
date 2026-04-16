import rateLimit from "express-rate-limit";
import client from "prom-client";
import logger from "./loggerUtils.js";

const DEFAULT_WEBHOOK_BODY_LIMIT = "2mb";

export const webhookReceivedTotal = new client.Counter({
  name: "shopify_webhook_received_total",
  help: "Total Shopify webhooks received by topic and shop",
  labelNames: ["topic", "shop", "status"],
});

export const webhookIngressDuration = new client.Histogram({
  name: "shopify_webhook_ingress_duration_seconds",
  help: "Webhook HTTP ingestion latency before Shopify acknowledgement",
  labelNames: ["topic", "shop", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

function parseAllowedOrigins() {
  return [
    process.env.SHOPIFY_APP_URL,
    process.env.HOST ? `https://${process.env.HOST}` : null,
    process.env.APP_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
  ]
    .map((origin) => origin?.trim())
    .filter(Boolean);
}

export function buildCorsOptions() {
  const explicitOrigins = new Set(parseAllowedOrigins());
  const shopifyAdminOrigin = /^https:\/\/admin\.shopify\.com$/i;
  const shopifyStoreAdminOrigin = /^https:\/\/[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

  return {
    origin(origin, callback) {
      if (
        !origin ||
        explicitOrigins.has(origin) ||
        shopifyAdminOrigin.test(origin) ||
        shopifyStoreAdminOrigin.test(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed"));
    },
    credentials: true,
  };
}

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE || 600),
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_PER_WINDOW || 1000),
  standardHeaders: true,
  legacyHeaders: false,
});

export function getWebhookRawBodyLimit() {
  return process.env.WEBHOOK_RAW_BODY_LIMIT || DEFAULT_WEBHOOK_BODY_LIMIT;
}

export function logWebhookIngress(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const topic = req.get("x-shopify-topic") || "unknown";
  const shop = req.get("x-shopify-shop-domain") || "unknown";
  const webhookId = req.get("x-shopify-webhook-id") || null;
  const payloadSize = Number(req.get("content-length") || 0);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const status = res.statusCode < 400 ? "success" : "failure";
    webhookReceivedTotal.inc({ topic, shop, status });
    webhookIngressDuration.observe(
      { topic, shop, status },
      durationMs / 1000,
    );
    logger.info("Shopify webhook ingestion completed", {
      requestId: res.getHeader("x-request-id"),
      topic,
      shop,
      webhookId,
      payloadSize,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}

export function requireAdminShop(req, res, next) {
  const allowedShops = new Set(
    (process.env.ADMIN_SHOPS || "")
      .split(",")
      .map((shop) => shop.trim())
      .filter(Boolean),
  );
  const shop = res.locals.shopify?.session?.shop;

  if (allowedShops.size > 0 && shop && allowedShops.has(shop)) {
    next();
    return;
  }

  res.status(403).json({ error: "Admin access denied" });
}
