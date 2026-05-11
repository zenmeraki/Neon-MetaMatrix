import { storeLockService } from "../execution/storeLockService.js";

const DEFAULT_DOMAIN_LOCK_TTL_SECONDS = Math.max(
  Number(process.env.DOMAIN_WRITE_LOCK_TTL_SECONDS || 900),
  30,
);

const FIELD_DOMAIN_MAP = {
  price: "price-write-lock",
  compareAtPrice: "price-write-lock",
  cost: "price-write-lock",
  inventoryQuantity: "inventory-write-lock",
  inventoryPolicy: "inventory-write-lock",
  tracked: "inventory-write-lock",
  sku: "inventory-write-lock",
  barcode: "inventory-write-lock",
  taxable: "inventory-write-lock",
  taxCode: "inventory-write-lock",
  title: "seo-write-lock",
  description: "seo-write-lock",
  metaTitle: "seo-write-lock",
  metaDescription: "seo-write-lock",
  handle: "seo-write-lock",
  category: "seo-write-lock",
};

function normalizeFieldName(field) {
  return String(field || "").trim();
}

function extractIntentFields(intent) {
  const fields = new Set();
  if (intent?.operation?.field) {
    fields.add(normalizeFieldName(intent.operation.field));
  }
  if (Array.isArray(intent?.rules)) {
    for (const rule of intent.rules) {
      if (rule?.field) fields.add(normalizeFieldName(rule.field));
    }
  }
  return [...fields].filter(Boolean);
}

export function resolveMutationDomains(intent) {
  const fields = extractIntentFields(intent);
  const domains = new Set();

  for (const field of fields) {
    const mapped = FIELD_DOMAIN_MAP[field];
    if (mapped) {
      domains.add(mapped);
      continue;
    }

    if (field.startsWith("metafield:")) {
      domains.add("metafield-write-lock");
      continue;
    }

    domains.add("product-core-write-lock");
  }

  if (!domains.size) {
    domains.add("product-core-write-lock");
  }

  return [...domains].sort();
}

export async function acquireDomains({
  shop,
  operationId = null,
  domains,
  ttlSeconds = DEFAULT_DOMAIN_LOCK_TTL_SECONDS,
}) {
  const uniqueDomains = [...new Set((domains || []).map((entry) => String(entry || "").trim()).filter(Boolean))];
  const acquired = [];
  const ttlMs = Math.max(Number(ttlSeconds || 0), 1) * 1000;

  for (const domain of uniqueDomains) {
    const lock = await storeLockService.acquire(
      shop,
      `domain:${domain}`,
      ttlMs,
    );

    if (!lock?.acquired) {
      await releaseDomains({
        shop,
        operationId,
        domains: acquired.map((entry) => entry.domain),
        locks: acquired,
      });
      const error = new Error("LOCK_HELD");
      error.code = "LOCK_HELD";
      error.statusCode = 409;
      error.details = {
        shop,
        operationId,
        failedDomain: domain,
        requestedDomains: uniqueDomains,
      };
      throw error;
    }

    acquired.push({
      ...lock,
      domain,
    });
  }

  return {
    acquired: true,
    domains: uniqueDomains,
    locks: acquired,
  };
}

export async function releaseDomains({ domains = [], locks = [] }) {
  if (Array.isArray(locks) && locks.length) {
    for (const lock of [...locks].reverse()) {
      await storeLockService.release(lock.key, lock.token);
    }
    return;
  }

  // Keep interface parity for callers; explicit locks are required for safe release.
  void domains;
}
