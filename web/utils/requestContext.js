import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

const requestContext = new AsyncLocalStorage();

export function getRequestContext() {
  return requestContext.getStore() || {};
}

export function requestContextMiddleware(req, res, next) {
  const requestId =
    req.get("x-request-id") ||
    req.get("x-correlation-id") ||
    crypto.randomUUID();

  res.setHeader("x-request-id", requestId);
  requestContext.run({ requestId }, next);
}
