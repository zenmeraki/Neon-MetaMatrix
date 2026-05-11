import { prisma } from "../../config/database.js";

const ANOMALY_SEVERITY = {
  BLOCKER: "BLOCKER",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
};

function normalizeString(value) {
  return String(value || "").trim();
}

function isBlank(value) {
  return normalizeString(value).length === 0;
}

function isValidBarcode(value) {
  const normalized = normalizeString(value);
  if (!normalized) return true;
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(normalized);
}

function addIssue(issues, issue) {
  if (!issue || Number(issue.count || 0) <= 0) return;
  issues.push({
    code: issue.code,
    severity: issue.severity,
    count: Number(issue.count || 0),
    samples: Array.isArray(issue.samples) ? issue.samples.slice(0, 10) : [],
    message: issue.message,
  });
}

function summarizeIssues(issues = []) {
  return issues.reduce(
    (acc, issue) => {
      const severity = String(issue?.severity || "").toUpperCase();
      acc.total += Number(issue?.count || 0);
      if (severity === ANOMALY_SEVERITY.BLOCKER) acc.blocker += Number(issue?.count || 0);
      if (severity === ANOMALY_SEVERITY.HIGH) acc.high += Number(issue?.count || 0);
      if (severity === ANOMALY_SEVERITY.MEDIUM) acc.medium += Number(issue?.count || 0);
      return acc;
    },
    { total: 0, blocker: 0, high: 0, medium: 0 },
  );
}

export function analyzeRows({ products = [], variants = [] } = {}) {
  const normalizedProducts = Array.isArray(products) ? products : [];
  const normalizedVariants = Array.isArray(variants) ? variants : [];
  const issues = [];

  const skuIndex = new Map();
  for (const variant of normalizedVariants) {
    const sku = normalizeString(variant?.sku);
    if (!sku) continue;
    const bucket = skuIndex.get(sku) || [];
    bucket.push(variant?.id || null);
    skuIndex.set(sku, bucket);
  }
  const duplicateSkuEntries = [...skuIndex.entries()].filter(([, ids]) => ids.length > 1);
  addIssue(issues, {
    code: "DUPLICATE_SKU",
    severity: ANOMALY_SEVERITY.HIGH,
    count: duplicateSkuEntries.reduce((sum, [, ids]) => sum + ids.length, 0),
    samples: duplicateSkuEntries.slice(0, 10).map(([sku, ids]) => ({
      sku,
      variantIds: ids.slice(0, 5),
    })),
    message: "Duplicate SKU values detected in target variants.",
  });

  const invalidBarcodeVariants = normalizedVariants.filter(
    (variant) => !isValidBarcode(variant?.barcode),
  );
  addIssue(issues, {
    code: "INVALID_BARCODE",
    severity: ANOMALY_SEVERITY.BLOCKER,
    count: invalidBarcodeVariants.length,
    samples: invalidBarcodeVariants.slice(0, 10).map((variant) => ({
      variantId: variant?.id || null,
      barcode: variant?.barcode || null,
    })),
    message: "Invalid barcode format detected.",
  });

  const emptyTitleProducts = normalizedProducts.filter((product) => isBlank(product?.title));
  addIssue(issues, {
    code: "EMPTY_TITLE",
    severity: ANOMALY_SEVERITY.BLOCKER,
    count: emptyTitleProducts.length,
    samples: emptyTitleProducts.slice(0, 10).map((product) => ({
      productId: product?.id || null,
    })),
    message: "Products with empty title detected.",
  });

  const compareAtInvalidVariants = normalizedVariants.filter((variant) => {
    const price = Number(variant?.price);
    const compareAtPrice = Number(variant?.compareAtPrice);
    if (!Number.isFinite(price) || !Number.isFinite(compareAtPrice)) return false;
    return compareAtPrice <= price;
  });
  addIssue(issues, {
    code: "COMPARE_AT_PRICE_NOT_ABOVE_PRICE",
    severity: ANOMALY_SEVERITY.BLOCKER,
    count: compareAtInvalidVariants.length,
    samples: compareAtInvalidVariants.slice(0, 10).map((variant) => ({
      variantId: variant?.id || null,
      price: variant?.price ?? null,
      compareAtPrice: variant?.compareAtPrice ?? null,
    })),
    message: "compareAtPrice must be greater than price.",
  });

  const missingVendorOrType = normalizedProducts.filter(
    (product) => isBlank(product?.vendor) || isBlank(product?.productType),
  );
  addIssue(issues, {
    code: "MISSING_VENDOR_OR_TYPE",
    severity: ANOMALY_SEVERITY.HIGH,
    count: missingVendorOrType.length,
    samples: missingVendorOrType.slice(0, 10).map((product) => ({
      productId: product?.id || null,
      vendor: product?.vendor || null,
      productType: product?.productType || null,
    })),
    message: "Products missing vendor or product type.",
  });

  const missingGoogleFields = normalizedProducts.filter((product) => {
    const enabled = Boolean(product?.googleShoppingEnabled);
    if (!enabled) return false;
    return (
      isBlank(product?.googleShoppingAgeGroup) ||
      isBlank(product?.googleShoppingGender) ||
      isBlank(product?.googleShoppingCategory)
    );
  });
  addIssue(issues, {
    code: "GOOGLE_SHOPPING_FIELDS_MISSING",
    severity: ANOMALY_SEVERITY.HIGH,
    count: missingGoogleFields.length,
    samples: missingGoogleFields.slice(0, 10).map((product) => ({
      productId: product?.id || null,
      googleShoppingAgeGroup: product?.googleShoppingAgeGroup || null,
      googleShoppingGender: product?.googleShoppingGender || null,
      googleShoppingCategory: product?.googleShoppingCategory || null,
    })),
    message: "Google Shopping fields missing (age group/gender/category).",
  });

  const trackedNoQuantityVariants = normalizedVariants.filter(
    (variant) => Boolean(variant?.tracked) && Number(variant?.inventoryQuantity || 0) <= 0,
  );
  addIssue(issues, {
    code: "TRACKED_INVENTORY_WITHOUT_QUANTITY",
    severity: ANOMALY_SEVERITY.MEDIUM,
    count: trackedNoQuantityVariants.length,
    samples: trackedNoQuantityVariants.slice(0, 10).map((variant) => ({
      variantId: variant?.id || null,
      inventoryQuantity: variant?.inventoryQuantity ?? null,
    })),
    message: "Tracked variants without positive inventory quantity.",
  });

  const summary = summarizeIssues(issues);
  return {
    summary,
    issues,
    blocksExecution: summary.blocker > 0,
    requiresAcknowledgement: summary.high > 0 || summary.medium > 0,
  };
}

export const catalogAnomalyService = {
  analyzeRows,

  async detectForFrozenTarget({
    shop,
    targetSnapshotId,
    ownerType = "AD_HOC_PRODUCT_TARGET",
  }) {
    const normalizedSnapshotId =
      typeof targetSnapshotId === "string" ? targetSnapshotId.trim() : "";
    if (!shop || !normalizedSnapshotId) {
      return {
        summary: { total: 0, blocker: 0, high: 0, medium: 0 },
        issues: [],
        blocksExecution: false,
        requiresAcknowledgement: false,
      };
    }

    const rows = await prisma.targetSnapshot.findMany({
      where: {
        shop,
        ownerType,
        ownerId: normalizedSnapshotId,
      },
      select: {
        productId: true,
        variantId: true,
        mirrorBatchId: true,
      },
      take: 200000,
    });

    if (!rows.length) {
      return {
        summary: { total: 0, blocker: 0, high: 0, medium: 0 },
        issues: [],
        blocksExecution: false,
        requiresAcknowledgement: false,
      };
    }

    const productIds = [...new Set(rows.map((row) => row.productId).filter(Boolean))];
    const variantIds = [...new Set(rows.map((row) => row.variantId).filter(Boolean))];
    const mirrorBatchId = rows.find((row) => row.mirrorBatchId)?.mirrorBatchId || null;

    const [products, variants] = await Promise.all([
      prisma.product.findMany({
        where: {
          shop,
          id: { in: productIds },
          ...(mirrorBatchId ? { mirrorBatchId } : {}),
        },
        select: {
          id: true,
          title: true,
          vendor: true,
          productType: true,
          googleShoppingEnabled: true,
          googleShoppingAgeGroup: true,
          googleShoppingGender: true,
          googleShoppingCategory: true,
        },
      }),
      variantIds.length
        ? prisma.variant.findMany({
            where: {
              shop,
              id: { in: variantIds },
              ...(mirrorBatchId ? { mirrorBatchId } : {}),
            },
            select: {
              id: true,
              sku: true,
              barcode: true,
              price: true,
              compareAtPrice: true,
              tracked: true,
              inventoryQuantity: true,
            },
          })
        : prisma.variant.findMany({
            where: {
              shop,
              productId: { in: productIds },
              ...(mirrorBatchId ? { mirrorBatchId } : {}),
            },
            select: {
              id: true,
              sku: true,
              barcode: true,
              price: true,
              compareAtPrice: true,
              tracked: true,
              inventoryQuantity: true,
            },
          }),
    ]);

    return analyzeRows({ products, variants });
  },
};

