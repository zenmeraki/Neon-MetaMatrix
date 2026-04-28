import crypto from "crypto";
import { FIELD_CONFIGS } from "../helpers/productBulkOperationHelpers/constants.js";

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = sortObject(value[key]);
      return accumulator;
    }, {});
}

function normalizeVariants(variants = []) {
  return variants
    .map((variant) => ({
      id: variant.id,
      title: variant.title ?? null,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
      price: variant.price ?? null,
      compareAtPrice: variant.compareAtPrice ?? null,
      inventoryQuantity: variant.inventoryQuantity ?? null,
      inventoryPolicy: variant.inventoryPolicy ?? null,
      taxable: variant.taxable ?? null,
      cost: variant.cost ?? null,
      countryOfOrigin: variant.countryOfOrigin ?? null,
      hsTariffCode: variant.hsTariffCode ?? null,
      weight: variant.weight ?? null,
      weightUnit: variant.weightUnit ?? null,
      option1Value: variant.option1Value ?? null,
      option2Value: variant.option2Value ?? null,
      option3Value: variant.option3Value ?? null,
      tracked: variant.tracked ?? null,
      physicalProduct: variant.physicalProduct ?? null,
      profitMargin: variant.profitMargin ?? null,
      selectedOptionsJson: variant.selectedOptionsJson ?? null,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function buildAutomaticRuleFingerprint({ product, actions, applyMode }) {
  const fieldNames = Array.from(new Set((actions || []).map((action) => action?.field).filter(Boolean)));
  const needsVariants = fieldNames.some((field) => FIELD_CONFIGS?.[field]?.isVariantLevel);

  const snapshot = {
    id: product.id,
    title: product.title ?? null,
    handle: product.handle ?? null,
    status: product.status ?? null,
    vendor: product.vendor ?? null,
    productType: product.productType ?? null,
    tags: Array.isArray(product.tags) ? [...product.tags].sort() : [],
    description: product.description ?? null,
    seoTitle: product.seoTitle ?? null,
    seoDescription: product.seoDescription ?? null,
    option1Name: product.option1Name ?? null,
    option2Name: product.option2Name ?? null,
    option3Name: product.option3Name ?? null,
    optionsJson: product.optionsJson ?? null,
    collectionsJson: product.collectionsJson ?? null,
    ...(needsVariants ? { variants: normalizeVariants(product.variants) } : {}),
  };

  for (const fieldName of fieldNames) {
    const config = FIELD_CONFIGS?.[fieldName];
    if (!config?.getValue || config.isVariantLevel) {
      continue;
    }

    try {
      snapshot[fieldName] = config.getValue(product);
    } catch (_error) {
      snapshot[fieldName] = null;
    }
  }

  const payload = sortObject({
    applyMode,
    actions,
    product: snapshot,
  });

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
