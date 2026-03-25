export function normalizeNullableString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export function normalizeNullableFloat(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export function normalizeNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.trunc(n);
}

export function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

export function getOptionNameByPosition(options = [], position) {
  const found = options.find((o) => Number(o?.position) === position);
  return normalizeNullableString(found?.name);
}

export function getOptionValueByIndex(selectedOptions = [], index) {
  if (!Array.isArray(selectedOptions) || !selectedOptions[index]) return null;
  return normalizeNullableString(selectedOptions[index]?.value);
}

export function extractCollections(collections) {
  if (!collections) return [];
  if (Array.isArray(collections)) return collections;
  if (Array.isArray(collections.edges)) {
    return collections.edges
      .map((edge) => edge?.node)
      .filter(Boolean)
      .map((node) => ({
        id: node.id,
        title: node.title,
      }));
  }
  return [];
}

export function extractVariants(variants) {
  if (!variants) return [];
  if (Array.isArray(variants)) return variants;
  if (Array.isArray(variants.edges)) {
    return variants.edges.map((edge) => edge?.node).filter(Boolean);
  }
  return [];
}

export function flattenProduct(product, shop) {
  const options = Array.isArray(product.options) ? product.options : [];
  const variants = Array.isArray(product.variants) ? product.variants : [];

  return {
    shop,
    id: product.id,
    title: product.title ?? "",
    handle: normalizeNullableString(product.handle),
    status: product.status ?? "DRAFT",
    productType: normalizeNullableString(product.productType),
    vendor: normalizeNullableString(product.vendor),
    tags: Array.isArray(product.tags) ? product.tags : [],
    templateSuffix: normalizeNullableString(product.templateSuffix),
    description: normalizeNullableString(product.descriptionHtml),
    createdAt: product.createdAt ? new Date(product.createdAt) : null,
    updatedAt: product.updatedAt ? new Date(product.updatedAt) : null,
    publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
    seoTitle: normalizeNullableString(product.seo?.title),
    seoDescription: normalizeNullableString(product.seo?.description),
    totalInventory: normalizeNullableInt(product.totalInventory) ?? 0,
    categoryId: normalizeNullableString(product.category?.id),
    categoryName: normalizeNullableString(product.category?.name),
    featuredImageUrl: normalizeNullableString(
      product.featuredMedia?.preview?.image?.url,
    ),
    featuredImageAltText: normalizeNullableString(
      product.featuredMedia?.alt || product.featuredMedia?.preview?.image?.altText,
    ),
    optionsJson: options,
    collectionsJson: Array.isArray(product.collections) ? product.collections : [],
    option1Name: getOptionNameByPosition(options, 1),
    option2Name: getOptionNameByPosition(options, 2),
    option3Name: getOptionNameByPosition(options, 3),
    variantCount: variants.length,
    visibleOnlineStore: !!product.onlineStoreUrl,
  };
}

export function flattenVariant(productId, variant, shop) {
  const price = normalizeNullableFloat(variant.price);
  const cost = normalizeNullableFloat(variant.inventoryItem?.unitCost?.amount);

  let profitMargin = null;
  if (price !== null && cost !== null && price > 0) {
    profitMargin = Number((((price - cost) / price) * 100).toFixed(2));
  }

  const selectedOptions = Array.isArray(variant.selectedOptions)
    ? variant.selectedOptions
    : [];

  return {
    shop,
    id: variant.id,
    productId,
    title: normalizeNullableString(variant.title),
    sku: normalizeNullableString(variant.sku),
    barcode: normalizeNullableString(variant.barcode),
    price,
    compareAtPrice: normalizeNullableFloat(variant.compareAtPrice),
    cost,
    inventoryQuantity: normalizeNullableInt(variant.inventoryQuantity),
    inventoryPolicy: normalizeNullableString(variant.inventoryPolicy),
    taxable: normalizeBoolean(variant.taxable),
    taxCode: normalizeNullableString(variant.taxCode),
    weight: normalizeNullableFloat(
      variant.inventoryItem?.measurement?.weight?.value,
    ),
    weightUnit: normalizeNullableString(
      variant.inventoryItem?.measurement?.weight?.unit,
    ),
    countryOfOrigin: normalizeNullableString(
      variant.inventoryItem?.countryCodeOfOrigin,
    ),
    hsTariffCode: normalizeNullableString(
      variant.inventoryItem?.harmonizedSystemCode,
    ),
    position: normalizeNullableInt(variant.position),
    selectedOptionsJson: selectedOptions,
    option1Value: getOptionValueByIndex(selectedOptions, 0),
    option2Value: getOptionValueByIndex(selectedOptions, 1),
    option3Value: getOptionValueByIndex(selectedOptions, 2),
    tracked: normalizeBoolean(variant.inventoryItem?.tracked),
    physicalProduct: normalizeBoolean(variant.inventoryItem?.requiresShipping),
    profitMargin,
  };
}
