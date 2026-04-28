// FILE: web/utils/errorLogUtils.js

import { prisma } from "../config/database.js";

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { note: "non_serializable_payload" };
  }
}

export const logApiError = async ({
  shop,
  err,
  req,
  source,
  level = "error",
}) => {
  try {
    await prisma.errorLog.create({
      data: {
        shop: shop || "unknown",
        type: "api",
        level,
        message: err?.message || "Unknown error",
        stack: err?.stack || null,
        source: source || null,
        request: safeJson({
          method: req?.method,
          url: req?.originalUrl,
          statusCode: err?.statusCode || 500,
          headers: req?.headers,
          body: req?.body,
          query: req?.query,
          params: req?.params,
        }),
      },
    });
  } catch (e) {
    console.error("❌ API error log failed:", e?.message || e);
  }
};

export const logWorkerError = async ({
  err,
  shop,
  source,
  level = "error",
  metadata = null,
}) => {
  try {
    await prisma.errorLog.create({
      data: {
        shop: shop || "unknown",
        type: "worker",
        level,
        message: err?.message || "Unknown worker error",
        stack: err?.stack || null,
        source: source || null,
        request: safeJson(metadata),
      },
    });
  } catch (e) {
    console.error("❌ Worker error log failed:", e?.message || e);
  }
};

export const logWebhookError = async ({
  err,
  req,
  source,
  shop,
  level = "error",
}) => {
  try {
    await prisma.errorLog.create({
      data: {
        shop: shop || "unknown",
        type: "webhook",
        level,
        message: err?.message || "Unknown webhook error",
        stack: err?.stack || null,
        source: source || null,
        request: safeJson({
          method: req?.method,
          url: req?.originalUrl,
          statusCode: err?.statusCode || 500,
          headers: req?.headers,
          body: req?.body,
          query: req?.query,
          params: req?.params,
        }),
      },
    });
  } catch (e) {
    console.error("❌ Webhook error log failed:", e?.message || e);
  }
};