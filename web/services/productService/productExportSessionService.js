import shopify from "../../shopify.js";

function assertShop(shop) {
  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required to resolve offline session");
  }

  return shop.trim();
}

function normalizeShop(shop) {
  return assertShop(shop).toLowerCase();
}

function normalizeExpiryMillis(expires) {
  if (expires === null || expires === undefined || expires === "") {
    return null;
  }

  if (expires instanceof Date) {
    const millis = expires.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  const numeric = Number(expires);
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = new Date(expires).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isExpired(session) {
  const expiryMillis = normalizeExpiryMillis(session?.expires);

  if (expiryMillis === null) return false;

  return expiryMillis <= Date.now();
}

class ProductExportSessionService {
  static async getOfflineSession(shop) {
    const safeShop = assertShop(shop);
    const sessionStorage = shopify?.config?.sessionStorage;
    const loadSession = sessionStorage?.loadSession;

    if (!shopify) {
      throw new Error("Shopify module is unavailable");
    }

    if (typeof loadSession !== "function") {
      throw new Error("Shopify session storage is not configured");
    }

    if (typeof shopify?.api?.session?.getOfflineId !== "function") {
      throw new Error("Shopify offline session helper is unavailable");
    }

    const offlineSessionId = shopify.api.session.getOfflineId(safeShop);
    const session = await sessionStorage.loadSession(offlineSessionId);

    if (!session) {
      return {
        session: null,
        reason: "missing",
      };
    }

    if (normalizeShop(session.shop) !== normalizeShop(safeShop)) {
      throw new Error(
        `Offline session shop mismatch. requested=${safeShop}, session=${session.shop}`,
      );
    }

    if (isExpired(session)) {
      return {
        session: null,
        reason: "expired",
      };
    }

    return {
      session,
      reason: null,
    };
  }

  static async getOfflineSessionOrThrow(shop) {
    const { session, reason } = await this.getOfflineSession(shop);

    if (session) {
      return session;
    }

    if (reason === "expired") {
      throw new Error(`Offline session expired for shop ${assertShop(shop)}`);
    }

    throw new Error(`Offline session not found for shop ${assertShop(shop)}`);
  }
}

export default ProductExportSessionService;
