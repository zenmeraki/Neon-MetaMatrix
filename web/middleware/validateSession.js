import { errorResponse } from "../utils/responseUtils.js";

export function validateSession(req, res, next) {
  const session = res.locals.shopify?.session;
  if (!session) {
    return res.status(403).json(errorResponse("Session expired"));
  }
  next();
}
