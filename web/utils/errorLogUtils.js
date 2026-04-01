import { prisma } from "../config/database.js";

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-shopify-access-token",
  "x-forwarded-for",
]);

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 20;

function truncateString(value) {
  const stringValue = String(value ?? "");
  return stringValue.length > MAX_STRING_LENGTH
    ? `${stringValue.slice(0, MAX_STRING_LENGTH)}...[truncated]`
    : stringValue;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 3) {
    return "[truncated]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)]),
    );
  }

  return truncateString(value);
}

function sanitizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_KEYS.has(String(key).toLowerCase())
        ? "[redacted]"
        : sanitizeValue(value),
    ]),
  );
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { note: "non_serializable_payload" };
  }
}

function buildRequestLogPayload({ req, err, includeHeaders = false }) {
  return safeJson({
    method: req?.method,
    url: req?.originalUrl,
    statusCode: err?.statusCode || err?.status || 500,
    headers: includeHeaders ? sanitizeHeaders(req?.headers) : undefined,
    body: sanitizeValue(req?.body),
    query: sanitizeValue(req?.query),
    params: sanitizeValue(req?.params),
    requestId: req?.requestId || req?.headers?.["x-request-id"] || null,
  });
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
        stack: process.env.NODE_ENV === "production" ? null : err?.stack || null,
        source: source || null,
        request: buildRequestLogPayload({ req, err }),
      },
    });
  } catch (e) {
    console.error("API error log failed", e?.message || e);
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
        stack: process.env.NODE_ENV === "production" ? null : err?.stack || null,
        source: source || null,
        request: safeJson(sanitizeValue(metadata)),
      },
    });
  } catch (e) {
    console.error("Worker error log failed", e?.message || e);
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
        stack: process.env.NODE_ENV === "production" ? null : err?.stack || null,
        source: source || null,
        request: buildRequestLogPayload({ req, err, includeHeaders: true }),
      },
    });
  } catch (e) {
    console.error("Webhook error log failed", e?.message || e);
  }
};
