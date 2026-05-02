const PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/(\d+)$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function extractProductIdDigits(gid) {
  const match = String(gid || "").trim().match(PRODUCT_GID_PATTERN);

  if (!match) {
    throw new Error(`Invalid Shopify product GID: ${gid}`);
  }

  return match[1];
}

export function productGidToBigIntId(gid) {
  return BigInt(extractProductIdDigits(gid));
}

export function productGidToNumericId(gid) {
  const value = productGidToBigIntId(gid);

  if (value > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`Shopify product GID exceeds JavaScript safe integer range: ${gid}`);
  }

  return Number(value);
}

export function numericIdToProductGid(id) {
  const normalized = String(id ?? "").trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid Shopify numeric product ID: ${id}`);
  }

  return `gid://shopify/Product/${normalized}`;
}
