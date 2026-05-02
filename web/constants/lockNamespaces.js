export const LOCK_NS = {
  WRITE_CATALOG: "write_catalog",
  PRODUCT_SYNC: "product_sync",
  BULK_EDIT_WRITE: "bulk_edit_write",
  EXPORT: "export",
  SCHEDULED_EDIT: "scheduled_edit",
  AUTOMATIC_RULE: "automatic_rule",
  UNDO: "undo",
  IMPORT: "import",
};

export function buildShopLockKey(shop, namespace) {
  if (!shop) {
    throw new Error("shop is required to build a shop lock key");
  }

  if (!namespace) {
    throw new Error("namespace is required to build a shop lock key");
  }

  return `shop:${shop}:lock:${namespace}`;
}
