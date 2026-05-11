import crypto from "crypto";

function createCorrelationId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function requestContextMiddleware(req, res, next) {
  const incoming =
    req.headers["x-correlation-id"] ||
    req.headers["x-request-id"] ||
    req.headers["x-diagnostic-id"];

  const correlationId =
    typeof incoming === "string" && incoming.trim()
      ? incoming.trim()
      : createCorrelationId();

  req.correlationId = correlationId;
  res.locals.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);

  next();
}

