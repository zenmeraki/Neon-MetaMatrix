import * as catalogSyncService from "../services/sync/catalogSyncService.js";
import * as syncStatusService from "../services/sync/syncStatusService.js";
import { logApiError } from "../utils/errorLogUtils.js";

/**
 * Controller responsibilities only:
 * - validate session / shop
 * - parse request inputs
 * - call service layer
 * - shape HTTP response
 * - log errors
 *
 * Not controller responsibilities:
 * - bulk orchestration
 * - Prisma sync state assembly
 * - Shopify bulk API calls
 * - cache invalidation policy
 * - sync truth decisions
 */

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/**
 * Query param is canonical; body is a fallback for callers that cannot set
 * query params. When req.query.force is defined (even as "false"), it wins.
 * Undefined query param → check body. This makes the precedence explicit and
 * avoids the silent-ignore bug of (query || body) where a query value of
 * "false" would still suppress a body value of "true".
 */
const getForceFlag = (req) => {
  const raw =
    req.query.force !== undefined ? req.query.force : req.body?.force;
  return String(raw ?? "").trim().toLowerCase() === "true";
};

const getSession = (res) => res.locals?.shopify?.session || null;

// ---------------------------------------------------------------------------
// Error response helpers
// ---------------------------------------------------------------------------

/**
 * Build a safe HTTP error response body.
 *
 * Rules:
 * - 4xx → service threw an expected, caller-visible error; expose code +
 *   message + details so the client can act on it.
 * - 5xx in production → generic message only; never leak internals.
 * - 5xx in development → include raw message to aid debugging.
 */
const buildErrorBody = (error) => {
  const status = error.httpStatus || error.statusCode || 500;
  const isClientError = status < 500;

  return {
    status,
    body: {
      error: error.code || (isClientError ? "Bad Request" : "Internal Server Error"),
      message:
        isClientError || process.env.NODE_ENV === "development"
          ? error.message
          : "An unexpected error occurred",
      ...(error.details != null ? { details: error.details } : {}),
    },
  };
};

/**
 * Log the error (fire-and-forget) and send the HTTP error response.
 *
 * logApiError is NOT awaited — a logging failure must never swallow the
 * original error or delay the response. The .catch() ensures that if the
 * logging write itself throws, it is silently discarded rather than
 * propagating a secondary error that would replace the original one.
 */
const replyWithError = (error, res, req, source, shop) => {
  logApiError({ shop, err: error, req, source }).catch(() => {});
  const { status, body } = buildErrorBody(error);
  return res.status(status).json(body);
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const syncProductData = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(401).json({ error: "Shopify session missing" });
    }

    const result = await catalogSyncService.startProductCatalogSync({
      shop: session.shop,
      session,
      force: getForceFlag(req),
      isInitialSync: false,
    });

    return res.status(200).json(result);
  } catch (error) {
    return replyWithError(
      error,
      res,
      req,
      "syncController.syncProductData",
      session?.shop,
    );
  }
};

export const getSyncStatus = async (req, res) => {
  const session = getSession(res);

  try {
    // Never fall back to req.query.shop — accepting an arbitrary shop from
    // the query string would allow any authenticated user to read any other
    // shop's sync state (IDOR). The session is the only trusted source.
    const shop = session?.shop;

    if (!shop) {
      return res.status(401).json({ error: "Shopify session missing" });
    }

    const result = await syncStatusService.getShopSyncStatus({ shop });

    return res.status(200).json(result);
  } catch (error) {
    return replyWithError(
      error,
      res,
      req,
      "syncController.getSyncStatus",
      session?.shop,
    );
  }
};

export const trackProductSync = async (req, res) => {
  const session = getSession(res);

  try {
    const shop = session?.shop;

    if (!shop) {
      return res.status(401).json({
        success: false,
        error: "Shopify session missing",
      });
    }

    const result = await syncStatusService.getTrackableProductSyncStatus({
      shop,
      session,
    });

    return res.status(200).json(result);
  } catch (error) {
    return replyWithError(
      error,
      res,
      req,
      "syncController.trackProductSync",
      session?.shop,
    );
  }
};

/**
 * Starts a product-type bulk sync.
 * Previously named clearProductTypes — renamed to reflect what it actually
 * does (starts a sync, not a clear).
 */
export const syncProductTypes = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(401).json({ error: "Shopify session missing" });
    }

    const result = await catalogSyncService.startProductTypeSync({
      shop: session.shop,
      session,
    });

    return res.status(200).json(result);
  } catch (error) {
    return replyWithError(
      error,
      res,
      req,
      "syncController.syncProductTypes",
      session?.shop,
    );
  }
};
