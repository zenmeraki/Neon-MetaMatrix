//web/utils/webhookTransformers.js

const normalizeNullableString = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
};

const normalizeNullableBoolean = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;

  return undefined;
};

const normalizeNullableStringWithoutMetaobjectIds = (value) => {
  const normalized = normalizeNullableString(value);

  if (normalized === undefined || normalized === null) {
    return normalized;
  }

  if (normalized.startsWith("gid://shopify/Metaobject/")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(normalized);

    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          typeof item === "string" &&
          item.startsWith("gid://shopify/Metaobject/"),
      )
    ) {
      return undefined;
    }
  } catch {
    // Keep plain strings as-is.
  }

  return normalized;
};

const normalizeMetafieldKey = (value) =>
  normalizeNullableString(value)?.toLowerCase().replace(/-/g, "_");

const buildWebhookMetafieldLookup = (metafields = []) => {
  const lookup = new Map();

  for (const metafield of metafields) {
    const namespace = normalizeMetafieldKey(metafield?.namespace);
    const key = normalizeMetafieldKey(metafield?.key);

    if (!namespace || !key) continue;

    const compositeKey = `${namespace}.${key}`;
    if (!lookup.has(compositeKey)) {
      lookup.set(compositeKey, metafield);
    }
  }

  return lookup;
};

const getWebhookFieldValue = (payload, metafieldLookup, config) => {
  for (const fieldName of config.payloadFields || []) {
    const rawValue = payload?.[fieldName];
    if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
      return rawValue;
    }
  }

  for (const metafieldKey of config.metafieldKeys || []) {
    const rawValue = metafieldLookup.get(metafieldKey)?.value;
    if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
      return rawValue;
    }
  }

  return undefined;
};

const PRODUCT_EXTRA_FIELD_CONFIG = {
  googleShoppingEnabled: {
    payloadFields: ["googleShoppingEnabled", "google_shopping_enabled"],
    metafieldKeys: [
      "google.enabled",
      "google_shopping.enabled",
      "mm_google_shopping.enabled",
      "custom.google_shopping_enabled",
      "custom.googleshoppingenabled",
    ],
    normalize: normalizeNullableBoolean,
  },
  googleShoppingAgeGroup: {
    payloadFields: ["googleShoppingAgeGroup", "google_shopping_age_group"],
    metafieldKeys: [
      "google.age_group",
      "google_shopping.age_group",
      "mm_google_shopping.age_group",
      "custom.google_shopping_age_group",
      "custom.googleshoppingagegroup",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingCategory: {
    payloadFields: ["googleShoppingCategory", "google_shopping_category"],
    metafieldKeys: [
      "google.google_product_category",
      "google_shopping.category",
      "mm_google_shopping.google_product_category",
      "mm_google_shopping.category",
      "custom.google_shopping_category",
      "custom.googleshoppingcategory",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingColor: {
    payloadFields: ["googleShoppingColor", "google_shopping_color"],
    metafieldKeys: [
      "google.color",
      "google_shopping.color",
      "mm_google_shopping.color",
      "custom.google_shopping_color",
      "custom.googleshoppingcolor",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingCondition: {
    payloadFields: ["googleShoppingCondition", "google_shopping_condition"],
    metafieldKeys: [
      "google.condition",
      "google_shopping.condition",
      "mm_google_shopping.condition",
      "custom.google_shopping_condition",
      "custom.googleshoppingcondition",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingCustomLabel0: {
    payloadFields: ["googleShoppingCustomLabel0", "google_shopping_custom_label_0"],
    metafieldKeys: [
      "google.custom_label_0",
      "google_shopping.custom_label_0",
      "mm_google_shopping.custom_label_0",
      "custom.google_shopping_custom_label_0",
      "custom.googleshoppingcustomlabel0",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingCustomLabel1: {
    payloadFields: ["googleShoppingCustomLabel1", "google_shopping_custom_label_1"],
    metafieldKeys: [
      "google.custom_label_1",
      "google_shopping.custom_label_1",
      "mm_google_shopping.custom_label_1",
      "custom.google_shopping_custom_label_1",
      "custom.googleshoppingcustomlabel1",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingCustomLabel2: {
    payloadFields: ["googleShoppingCustomLabel2", "google_shopping_custom_label_2"],
    metafieldKeys: [
      "google.custom_label_2",
      "google_shopping.custom_label_2",
      "mm_google_shopping.custom_label_2",
      "custom.google_shopping_custom_label_2",
      "custom.googleshoppingcustomlabel2",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingCustomLabel3: {
    payloadFields: ["googleShoppingCustomLabel3", "google_shopping_custom_label_3"],
    metafieldKeys: [
      "google.custom_label_3",
      "google_shopping.custom_label_3",
      "mm_google_shopping.custom_label_3",
      "custom.google_shopping_custom_label_3",
      "custom.googleshoppingcustomlabel3",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingCustomLabel4: {
    payloadFields: ["googleShoppingCustomLabel4", "google_shopping_custom_label_4"],
    metafieldKeys: [
      "google.custom_label_4",
      "google_shopping.custom_label_4",
      "mm_google_shopping.custom_label_4",
      "custom.google_shopping_custom_label_4",
      "custom.googleshoppingcustomlabel4",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingCustomProduct: {
    payloadFields: ["googleShoppingCustomProduct", "google_shopping_custom_product"],
    metafieldKeys: [
      "google.custom_product",
      "google_shopping.custom_product",
      "mm_google_shopping.custom_product",
      "custom.google_shopping_custom_product",
      "custom.googleshoppingcustomproduct",
    ],
    normalize: normalizeNullableBoolean,
  },
  googleShoppingGender: {
    payloadFields: ["googleShoppingGender", "google_shopping_gender"],
    metafieldKeys: [
      "google.gender",
      "google_shopping.gender",
      "mm_google_shopping.gender",
      "custom.google_shopping_gender",
      "custom.googleshoppinggender",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingMpn: {
    payloadFields: ["googleShoppingMpn", "google_shopping_mpn"],
    metafieldKeys: [
      "google.mpn",
      "google_shopping.mpn",
      "mm_google_shopping.mpn",
      "custom.google_shopping_mpn",
      "custom.googleshoppingmpn",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingMaterial: {
    payloadFields: ["googleShoppingMaterial", "google_shopping_material"],
    metafieldKeys: [
      "google.material",
      "google_shopping.material",
      "mm_google_shopping.material",
      "custom.google_shopping_material",
      "custom.googleshoppingmaterial",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingSize: {
    payloadFields: ["googleShoppingSize", "google_shopping_size"],
    metafieldKeys: [
      "google.size",
      "google_shopping.size",
      "mm_google_shopping.size",
      "custom.google_shopping_size",
      "custom.googleshoppingsize",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingSizeSystem: {
    payloadFields: ["googleShoppingSizeSystem", "google_shopping_size_system"],
    metafieldKeys: [
      "google.size_system",
      "google_shopping.size_system",
      "mm_google_shopping.size_system",
      "custom.google_shopping_size_system",
      "custom.googleshoppingsizesystem",
    ],
    normalize: normalizeNullableString,
  },
  googleShoppingSizeType: {
    payloadFields: ["googleShoppingSizeType", "google_shopping_size_type"],
    metafieldKeys: [
      "google.size_type",
      "google_shopping.size_type",
      "mm_google_shopping.size_type",
      "custom.google_shopping_size_type",
      "custom.googleshoppingsizetype",
    ],
    normalize: normalizeNullableString,
  },
  categoryAgeGroup: {
    payloadFields: ["categoryAgeGroup", "category_age_group"],
    metafieldKeys: [
      "shopify.age_group",
      "custom.category_age_group",
      "custom.categoryagegroup",
    ],
    normalize: normalizeNullableStringWithoutMetaobjectIds,
  },
  categoryColor: {
    payloadFields: ["categoryColor", "category_color"],
    metafieldKeys: [
      "shopify.color",
      "shopify.color_pattern",
      "custom.category_color",
      "custom.categorycolor",
    ],
    normalize: normalizeNullableStringWithoutMetaobjectIds,
  },
  categoryFabric: {
    payloadFields: ["categoryFabric", "category_fabric"],
    metafieldKeys: [
      "shopify.fabric",
      "custom.category_fabric",
      "custom.categoryfabric",
    ],
    normalize: normalizeNullableStringWithoutMetaobjectIds,
  },
  categoryFit: {
    payloadFields: ["categoryFit", "category_fit"],
    metafieldKeys: [
      "shopify.fit",
      "custom.category_fit",
      "custom.categoryfit",
    ],
    normalize: normalizeNullableStringWithoutMetaobjectIds,
  },
  categorySize: {
    payloadFields: ["categorySize", "category_size"],
    metafieldKeys: [
      "shopify.size",
      "custom.category_size",
      "custom.categorysize",
    ],
    normalize: normalizeNullableStringWithoutMetaobjectIds,
  },
  categoryTargetGender: {
    payloadFields: ["categoryTargetGender", "category_target_gender"],
    metafieldKeys: [
      "shopify.target_gender",
      "custom.category_target_gender",
      "custom.categorytargetgender",
    ],
    normalize: normalizeNullableStringWithoutMetaobjectIds,
  },
  categoryWaistRise: {
    payloadFields: ["categoryWaistRise", "category_waist_rise"],
    metafieldKeys: [
      "shopify.waist_rise",
      "custom.category_waist_rise",
      "custom.categorywaistrise",
    ],
    normalize: normalizeNullableStringWithoutMetaobjectIds,
  },
};

const mapStatus = (status) => {
  const statusMap = {
    active: "ACTIVE",
    archived: "ARCHIVED",
    draft: "DRAFT",
  };
  return statusMap[status?.toLowerCase()] || "DRAFT";
};

const calculateTotalInventory = (variants = []) => {
  return variants.reduce((total, variant) => {
    return total + (variant.inventory_quantity || 0);
  }, 0);
};

const transformOptions = (options = []) => {
  if (!options || options.length === 0) return [];

  return options.map((option, index) => ({
    id: `gid://shopify/ProductOption/${option.id}`,
    name: option.name,
    position: option.position || index + 1,
    values: option.values || [],
  }));
};

const transformSelectedOptions = (variant = {}, options = []) => {
  return options
    .map((option, index) => {
      const value = variant[`option${index + 1}`];

      if (!value) return null;

      return {
        name: option?.name || `Option${index + 1}`,
        value,
      };
    })
    .filter(Boolean);
};

const mapExtendedWebhookFields = (payload) => {
  const metafieldLookup = buildWebhookMetafieldLookup(payload?.metafields || []);

  return Object.fromEntries(
    Object.entries(PRODUCT_EXTRA_FIELD_CONFIG).map(([fieldName, config]) => {
      const rawValue = getWebhookFieldValue(payload, metafieldLookup, config);
      return [fieldName, config.normalize(rawValue)];
    }),
  );
};

export const transformWebhookPayload = (payload, shop) => {
  const transformed = {
    title: payload.title,
    handle: payload.handle,
    status: mapStatus(payload.status),
    productType: payload.product_type || null,
    vendor: payload.vendor || null,
    tags: payload.tags ? payload.tags.split(", ") : [],
    templateSuffix: payload.template_suffix || null,
    description: payload.body_html || null,
    createdAt: payload.created_at ? new Date(payload.created_at) : null,
    updatedAt: payload.updated_at ? new Date(payload.updated_at) : new Date(),
    publishedAt: payload.published_at ? new Date(payload.published_at) : null,
    totalInventory: calculateTotalInventory(payload.variants),
    optionsJson: transformOptions(payload.options),
    collectionsJson: [],
    categoryId: payload.category?.admin_graphql_api_id || null,
    categoryName: payload.category?.name || null,
    featuredImageUrl: payload.image?.src || null,
    featuredImageAltText: payload.image?.alt || null,
    seoTitle: null,
    seoDescription: null,
    ...mapExtendedWebhookFields(payload),
  };

  return transformed;
};

export const extractVariantsForPrisma = (payload, productId, shop) => {
  if (!payload.variants || !Array.isArray(payload.variants)) {
    return [];
  }

  const options = payload.options || [];

  return payload.variants.map((variant, index) => ({
    shop,
    id: variant.admin_graphql_api_id,
    productId,
    title: variant.title,
    sku: variant.sku || null,
    barcode: variant.barcode || null,
    price: variant.price ? parseFloat(variant.price) : null,
    compareAtPrice: variant.compare_at_price
      ? parseFloat(variant.compare_at_price)
      : null,
    inventoryQuantity: variant.inventory_quantity || 0,
    inventoryPolicy: variant.inventory_policy === "continue" ? "CONTINUE" : "DENY",
    taxable: variant.taxable || false,
    taxCode: variant.tax_code || null,
    position: variant.position || index + 1,
    selectedOptionsJson: transformSelectedOptions(variant, options),
  }));
};
