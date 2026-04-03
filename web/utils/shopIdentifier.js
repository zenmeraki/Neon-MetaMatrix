export function normalizeShopDomain(shopOrShopUrl) {
  return shopOrShopUrl ? String(shopOrShopUrl).trim() : null;
}

export function buildStoreShopWhere(shop) {
  return {
    shopUrl: normalizeShopDomain(shop),
  };
}

export function readShopFromStore(store) {
  return normalizeShopDomain(store?.shopUrl || null);
}
