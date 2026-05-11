function stripHtml(html) {
  if (!html) return null;

  const namedEntities = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    copy: "©",
    reg: "®",
    trade: "™",
    eacute: "é",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    ndash: "-",
    mdash: "-",
  };

  const decodeEntity = (entity) => {
    if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
      const codePoint = Number.parseInt(entity.slice(3, -1), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    if (entity.startsWith("&#")) {
      const codePoint = Number.parseInt(entity.slice(2, -1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return namedEntities[entity.slice(1, -1).toLowerCase()] ?? entity;
  };

  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#\d+|#x[\da-fA-F]+|[a-zA-Z]+);/g, decodeEntity)
    .replace(/\s{2,}/g, " ")
    .trim() || null;
}

export function normalizeNullableString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export function normalizeNullableFloat(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.trunc(n);
}

export function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function isMetaobjectReferenceString(value) {
  return (
    typeof value === "string" &&
    value.includes("gid://shopify/Metaobject/")
  );
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

export function extractMetafields(metafields) {
  if (!metafields) return [];
  if (Array.isArray(metafields)) return metafields.filter(Boolean);
  if (Array.isArray(metafields.edges)) {
    return metafields.edges.map((edge) => edge?.node).filter(Boolean);
  }
  return [];
}

function normalizeMetafieldKey(value) {
  return normalizeNullableString(value)?.toLowerCase().replace(/-/g, "_") || null;
}

function buildMetafieldLookup(metafields = []) {
  const lookup = new Map();

  for (const metafield of metafields) {
    const namespace = normalizeMetafieldKey(metafield?.namespace);
    const key = normalizeMetafieldKey(metafield?.key);

    if (!namespace || !key) continue;

    const compositeKey = `${namespace}.${key}`;
    lookup.set(compositeKey, metafield);
  }

  return lookup;
}

function getMetafieldValue(lookup, candidates = []) {
  for (const candidate of candidates) {
    const metafield = lookup.get(candidate);
    const value = metafield?.value;

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function parseNullableBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;

  return null;
}

export function resolveMetaobjectRefs(rawValue, metaobjectLookup) {
  if (!rawValue || !metaobjectLookup) return null;

  const normalized = normalizeNullableString(rawValue);
  if (normalized && normalized.startsWith("gid://shopify/Metaobject/")) {
    return metaobjectLookup.get(normalized) || null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return isMetaobjectReferenceString(normalized) ? null : normalized;
    }

    const labels = parsed
      .map((gid) => metaobjectLookup.get(gid))
      .filter(Boolean);

    return labels.length > 0 ? labels.join(", ") : null;
  } catch {
    return isMetaobjectReferenceString(normalized) ? null : normalized;
  }
}

function mapExtendedProductFields(product, metaobjectLookup = new Map()) {
  const metafieldLookup = buildMetafieldLookup(extractMetafields(product.metafields));

  const getString = (candidates) =>
    resolveMetaobjectRefs(
      getMetafieldValue(metafieldLookup, candidates),
      metaobjectLookup,
    );
  const getResolvedString = (candidates) => normalizeNullableString(getString(candidates));

  return {
    googleShoppingEnabled: parseNullableBoolean(
      getMetafieldValue(metafieldLookup, [
        "google.enabled",
        "google_shopping.enabled",
        "mm_google_shopping.enabled",
        "custom.google_shopping_enabled",
        "custom.googleshoppingenabled",
      ]),
    ),
    googleShoppingAgeGroup: getResolvedString([
      "google.age_group",
      "google_shopping.age_group",
      "mm_google_shopping.age_group",
      "custom.google_shopping_age_group",
      "custom.googleshoppingagegroup",
    ]),
    googleShoppingCategory: getResolvedString([
      "google.google_product_category",
      "google_shopping.category",
      "mm_google_shopping.google_product_category",
      "mm_google_shopping.category",
      "custom.google_shopping_category",
      "custom.googleshoppingcategory",
    ]),
    googleShoppingColor: getResolvedString([
      "google.color",
      "google_shopping.color",
      "mm_google_shopping.color",
      "custom.google_shopping_color",
      "custom.googleshoppingcolor",
    ]),
    googleShoppingCondition: getResolvedString([
      "google.condition",
      "google_shopping.condition",
      "mm_google_shopping.condition",
      "custom.google_shopping_condition",
      "custom.googleshoppingcondition",
    ]),
    googleShoppingCustomLabel0: getResolvedString([
      "google.custom_label_0",
      "google_shopping.custom_label_0",
      "mm_google_shopping.custom_label_0",
      "custom.google_shopping_custom_label_0",
      "custom.googleshoppingcustomlabel0",
    ]),
    googleShoppingCustomLabel1: getResolvedString([
      "google.custom_label_1",
      "google_shopping.custom_label_1",
      "mm_google_shopping.custom_label_1",
      "custom.google_shopping_custom_label_1",
      "custom.googleshoppingcustomlabel1",
    ]),
    googleShoppingCustomLabel2: getResolvedString([
      "google.custom_label_2",
      "google_shopping.custom_label_2",
      "mm_google_shopping.custom_label_2",
      "custom.google_shopping_custom_label_2",
      "custom.googleshoppingcustomlabel2",
    ]),
    googleShoppingCustomLabel3: getResolvedString([
      "google.custom_label_3",
      "google_shopping.custom_label_3",
      "mm_google_shopping.custom_label_3",
      "custom.google_shopping_custom_label_3",
      "custom.googleshoppingcustomlabel3",
    ]),
    googleShoppingCustomLabel4: getResolvedString([
      "google.custom_label_4",
      "google_shopping.custom_label_4",
      "mm_google_shopping.custom_label_4",
      "custom.google_shopping_custom_label_4",
      "custom.googleshoppingcustomlabel4",
    ]),
    googleShoppingCustomProduct: parseNullableBoolean(
      getMetafieldValue(metafieldLookup, [
        "google.custom_product",
        "google_shopping.custom_product",
        "mm_google_shopping.custom_product",
        "custom.google_shopping_custom_product",
        "custom.googleshoppingcustomproduct",
      ]),
    ),
    googleShoppingGender: getResolvedString([
      "google.gender",
      "google_shopping.gender",
      "mm_google_shopping.gender",
      "custom.google_shopping_gender",
      "custom.googleshoppinggender",
    ]),
    googleShoppingMpn: getResolvedString([
      "google.mpn",
      "google_shopping.mpn",
      "mm_google_shopping.mpn",
      "custom.google_shopping_mpn",
      "custom.googleshoppingmpn",
    ]),
    googleShoppingMaterial: getResolvedString([
      "google.material",
      "google_shopping.material",
      "mm_google_shopping.material",
      "custom.google_shopping_material",
      "custom.googleshoppingmaterial",
    ]),
    googleShoppingSize: getResolvedString([
      "google.size",
      "google_shopping.size",
      "mm_google_shopping.size",
      "custom.google_shopping_size",
      "custom.googleshoppingsize",
    ]),
    googleShoppingSizeSystem: getResolvedString([
      "google.size_system",
      "google_shopping.size_system",
      "mm_google_shopping.size_system",
      "custom.google_shopping_size_system",
      "custom.googleshoppingsizesystem",
    ]),
    googleShoppingSizeType: getResolvedString([
      "google.size_type",
      "google_shopping.size_type",
      "mm_google_shopping.size_type",
      "custom.google_shopping_size_type",
      "custom.googleshoppingsizetype",
    ]),
    categoryAgeGroup: getString([
      "shopify.age_group",
      "custom.category_age_group",
      "custom.categoryagegroup",
    ]),
    categoryColor: getString([
      "shopify.color",
      "shopify.color_pattern",
      "custom.category_color",
      "custom.categorycolor",
    ]),
    categoryFabric: getString([
      "shopify.fabric",
      "custom.category_fabric",
      "custom.categoryfabric",
    ]),
    categoryFit: getString([
      "shopify.fit",
      "custom.category_fit",
      "custom.categoryfit",
    ]),
    categorySize: getString([
      "shopify.size",
      "custom.category_size",
      "custom.categorysize",
    ]),
    categoryTargetGender: getString([
      "shopify.target_gender",
      "custom.category_target_gender",
      "custom.categorytargetgender",
    ]),
    categoryWaistRise: getString([
      "shopify.waist_rise",
      "custom.category_waist_rise",
      "custom.categorywaistrise",
    ]),
  };
}

export function flattenProduct(product, shop, metaobjectLookup = new Map()) {
  const options = Array.isArray(product.options) ? product.options : [];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const collections = Array.isArray(product.collections) ? product.collections : [];
  const tags = Array.isArray(product.tags)
    ? product.tags.map((tag) => normalizeNullableString(tag)).filter(Boolean)
    : [];

  const extendedFields = mapExtendedProductFields(product, metaobjectLookup);

  return {
    shop,
    id: product.id,
    title: product.title ?? "",
    handle: normalizeNullableString(product.handle),
    status: product.status ?? "DRAFT",
    productType: normalizeNullableString(product.productType),
    vendor: normalizeNullableString(product.vendor),
    tags,
    templateSuffix: normalizeNullableString(product.templateSuffix),
    descriptionText: normalizeNullableString(stripHtml(product.descriptionHtml)),
    descriptionHtml: normalizeNullableString(product.descriptionHtml),
    createdAt: product.createdAt ? new Date(product.createdAt) : null,
    updatedAt: product.updatedAt ? new Date(product.updatedAt) : null,
    publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
    seoTitle: normalizeNullableString(product.seo?.title),
    seoDescription: normalizeNullableString(product.seo?.description),
    totalInventory: normalizeNullableInt(product.totalInventory),
    categoryId: normalizeNullableString(product.category?.id),
    categoryName: normalizeNullableString(product.category?.name),
    ...extendedFields,
    featuredImageUrl: normalizeNullableString(
      product.featuredMedia?.preview?.image?.url,
    ),
    featuredImageAltText: normalizeNullableString(
      product.featuredMedia?.alt || product.featuredMedia?.preview?.image?.altText,
    ),
    optionsJson: options,
    collectionsJson: collections,
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

export function flattenProductMetafield(productId, metafield, shop) {
  const ownerId = normalizeNullableString(
    metafield?.owner?.id || metafield?.ownerId || productId,
  );
  const namespace = normalizeNullableString(metafield?.namespace);
  const key = normalizeNullableString(metafield?.key);

  if (!ownerId || !namespace || !key) {
    return null;
  }

  return {
    shop,
    ownerId,
    shopifyId: normalizeNullableString(metafield?.id),
    namespace,
    key,
    type: normalizeNullableString(metafield?.type),
    value:
      metafield?.value === undefined || metafield?.value === null
        ? null
        : String(metafield.value),
  };
}
