const SHOPIFY_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShopQuery(shop) {
  if (typeof shop !== "string") return null;

  const normalized = shop.trim().toLowerCase();
  if (!normalized || normalized === "undefined" || normalized === "null") {
    return null;
  }

  return SHOPIFY_DOMAIN_PATTERN.test(normalized) ? normalized : null;
}

export function hasValidShopQuery(req) {
  return Boolean(normalizeShopQuery(req.query?.shop));
}

export function resolveShopifyApiKey(rawConfig = "") {
  if (process.env.SHOPIFY_API_KEY) {
    return process.env.SHOPIFY_API_KEY;
  }

  const match = rawConfig.match(/^\s*client_id\s*=\s*"([^"]+)"/m);
  return match?.[1] || "";
}
