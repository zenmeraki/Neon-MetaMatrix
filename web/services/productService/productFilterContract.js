import { stableStringify } from "../../utils/idempotencyUtils.js";

export const FILTER_VALUE_MAX_LENGTH = 500;
export const FILTER_MAX_COUNT = 50;

const FIELD_DEFINITIONS = {
  search: { scope: "product", type: "search" },
  title: { scope: "product", type: "string" },
  vendor: { scope: "product", type: "string" },
  handle: { scope: "product", type: "string" },
  description: { scope: "product", type: "string" },
  product_type: { scope: "product", type: "string", prismaField: "productType" },
  status: { scope: "product", type: "string", transformValue: (value) => String(value).toUpperCase() },
  inventory_q: { scope: "product", type: "number", prismaField: "totalInventory" },
  created_at: { scope: "product", type: "date", prismaField: "createdAt" },
  updated_at: { scope: "product", type: "date", prismaField: "updatedAt" },
  published_at: { scope: "product", type: "date", prismaField: "publishedAt" },
  product_id: { scope: "product", type: "string", prismaField: "id" },
  category: { scope: "product", type: "string", prismaField: "categoryName" },
  tag: { scope: "product", type: "array_string", prismaField: "tags" },
  theme_template: { scope: "product", type: "string", prismaField: "templateSuffix" },
  collection: { scope: "product", type: "collection", prismaField: "collectionsJson" },
  variant_count: { scope: "product", type: "number", prismaField: "variantCount" },
  vc: { scope: "product", type: "number", prismaField: "variantCount", canonicalField: "variant_count" },
  option_name_1: { scope: "product", type: "string", prismaField: "option1Name" },
  option_name_2: { scope: "product", type: "string", prismaField: "option2Name" },
  option_name_3: { scope: "product", type: "string", prismaField: "option3Name" },
  visible_online_store: { scope: "product", type: "boolean", prismaField: "visibleOnlineStore" },
  googleShoppingEnabled: { scope: "product", type: "boolean", prismaField: "googleShoppingEnabled" },
  google_shopping_enabled: { scope: "product", type: "boolean", prismaField: "googleShoppingEnabled", canonicalField: "googleShoppingEnabled" },
  googleShoppingAgeGroup: { scope: "product", type: "string", prismaField: "googleShoppingAgeGroup" },
  google_shopping_age_group: { scope: "product", type: "string", prismaField: "googleShoppingAgeGroup", canonicalField: "googleShoppingAgeGroup" },
  googleShoppingCategory: { scope: "product", type: "string", prismaField: "googleShoppingCategory" },
  google_shopping_category: { scope: "product", type: "string", prismaField: "googleShoppingCategory", canonicalField: "googleShoppingCategory" },
  googleShoppingColor: { scope: "product", type: "string", prismaField: "googleShoppingColor" },
  google_shopping_color: { scope: "product", type: "string", prismaField: "googleShoppingColor", canonicalField: "googleShoppingColor" },
  googleShoppingCondition: { scope: "product", type: "string", prismaField: "googleShoppingCondition" },
  google_shopping_condition: { scope: "product", type: "string", prismaField: "googleShoppingCondition", canonicalField: "googleShoppingCondition" },
  googleShoppingCustomLabel0: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel0" },
  google_shopping_custom_label_0: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel0", canonicalField: "googleShoppingCustomLabel0" },
  googleShoppingCustomLabel1: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel1" },
  google_shopping_custom_label_1: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel1", canonicalField: "googleShoppingCustomLabel1" },
  googleShoppingCustomLabel2: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel2" },
  google_shopping_custom_label_2: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel2", canonicalField: "googleShoppingCustomLabel2" },
  googleShoppingCustomLabel3: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel3" },
  google_shopping_custom_label_3: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel3", canonicalField: "googleShoppingCustomLabel3" },
  googleShoppingCustomLabel4: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel4" },
  google_shopping_custom_label_4: { scope: "product", type: "string", prismaField: "googleShoppingCustomLabel4", canonicalField: "googleShoppingCustomLabel4" },
  googleShoppingCustomProduct: { scope: "product", type: "boolean", prismaField: "googleShoppingCustomProduct" },
  google_shopping_custom_product: { scope: "product", type: "boolean", prismaField: "googleShoppingCustomProduct", canonicalField: "googleShoppingCustomProduct" },
  googleShoppingGender: { scope: "product", type: "string", prismaField: "googleShoppingGender" },
  google_shopping_gender: { scope: "product", type: "string", prismaField: "googleShoppingGender", canonicalField: "googleShoppingGender" },
  googleShoppingMpn: { scope: "product", type: "string", prismaField: "googleShoppingMpn" },
  google_shopping_mpn: { scope: "product", type: "string", prismaField: "googleShoppingMpn", canonicalField: "googleShoppingMpn" },
  googleShoppingMaterial: { scope: "product", type: "string", prismaField: "googleShoppingMaterial" },
  google_shopping_material: { scope: "product", type: "string", prismaField: "googleShoppingMaterial", canonicalField: "googleShoppingMaterial" },
  googleShoppingSize: { scope: "product", type: "string", prismaField: "googleShoppingSize" },
  google_shopping_size: { scope: "product", type: "string", prismaField: "googleShoppingSize", canonicalField: "googleShoppingSize" },
  googleShoppingSizeSystem: { scope: "product", type: "string", prismaField: "googleShoppingSizeSystem" },
  google_shopping_size_system: { scope: "product", type: "string", prismaField: "googleShoppingSizeSystem", canonicalField: "googleShoppingSizeSystem" },
  googleShoppingSizeType: { scope: "product", type: "string", prismaField: "googleShoppingSizeType" },
  google_shopping_size_type: { scope: "product", type: "string", prismaField: "googleShoppingSizeType", canonicalField: "googleShoppingSizeType" },
  categoryAgeGroup: { scope: "product", type: "string", prismaField: "categoryAgeGroup" },
  category_age_group: { scope: "product", type: "string", prismaField: "categoryAgeGroup", canonicalField: "categoryAgeGroup" },
  categoryColor: { scope: "product", type: "string", prismaField: "categoryColor" },
  category_color: { scope: "product", type: "string", prismaField: "categoryColor", canonicalField: "categoryColor" },
  categoryFabric: { scope: "product", type: "string", prismaField: "categoryFabric" },
  category_fabric: { scope: "product", type: "string", prismaField: "categoryFabric", canonicalField: "categoryFabric" },
  categoryFit: { scope: "product", type: "string", prismaField: "categoryFit" },
  category_fit: { scope: "product", type: "string", prismaField: "categoryFit", canonicalField: "categoryFit" },
  categorySize: { scope: "product", type: "string", prismaField: "categorySize" },
  category_size: { scope: "product", type: "string", prismaField: "categorySize", canonicalField: "categorySize" },
  categoryTargetGender: { scope: "product", type: "string", prismaField: "categoryTargetGender" },
  category_target_gender: { scope: "product", type: "string", prismaField: "categoryTargetGender", canonicalField: "categoryTargetGender" },
  categoryWaistRise: { scope: "product", type: "string", prismaField: "categoryWaistRise" },
  category_waist_rise: { scope: "product", type: "string", prismaField: "categoryWaistRise", canonicalField: "categoryWaistRise" },
  seo: { scope: "product", type: "seo" },
  seo_visibility: { scope: "product", type: "seo", canonicalField: "seo" },
  sku: { scope: "variant", type: "string", prismaField: "sku" },
  barcode: { scope: "variant", type: "string", prismaField: "barcode" },
  variant_title: { scope: "variant", type: "string", prismaField: "title" },
  price: { scope: "variant", type: "number", prismaField: "price" },
  compare_at_price: { scope: "variant", type: "number", prismaField: "compareAtPrice" },
  variant_inventory_q: { scope: "variant", type: "number", prismaField: "inventoryQuantity" },
  charge_tax: { scope: "variant", type: "boolean", prismaField: "taxable" },
  cost: { scope: "variant", type: "number", prismaField: "cost" },
  country_of_origin: { scope: "variant", type: "string", prismaField: "countryOfOrigin" },
  hs_tariff_code: { scope: "variant", type: "string", prismaField: "hsTariffCode" },
  inventory_policy: { scope: "variant", type: "string", prismaField: "inventoryPolicy" },
  inventory_out_of_stock_policy: { scope: "variant", type: "string", prismaField: "inventoryPolicy", canonicalField: "inventory_policy" },
  option_value_1: { scope: "variant", type: "string", prismaField: "option1Value" },
  option_value_2: { scope: "variant", type: "string", prismaField: "option2Value" },
  option_value_3: { scope: "variant", type: "string", prismaField: "option3Value" },
  physical_product: { scope: "variant", type: "boolean", prismaField: "physicalProduct" },
  track_quantity: { scope: "variant", type: "boolean", prismaField: "tracked" },
  profit_margin: { scope: "variant", type: "number", prismaField: "profitMargin" },
  weight: { scope: "variant", type: "number", prismaField: "weight" },
  weight_unit: { scope: "variant", type: "string", prismaField: "weightUnit" },
};

const NEGATIVE_OPERATORS = new Set([
  "does not equal",
  "is not",
  "!=",
  "does not contain",
]);

export function getFilterFieldDefinition(field) {
  return FIELD_DEFINITIONS[field] || null;
}

export function isVariantScopedField(field) {
  return getFilterFieldDefinition(field)?.scope === "variant";
}

export function isNegativeFilterOperator(operator) {
  return NEGATIVE_OPERATORS.has(String(operator || "").trim().toLowerCase());
}

function normalizeFilterValue(value) {
  if (typeof value === "string") {
    return value.trim().slice(0, FILTER_VALUE_MAX_LENGTH);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return value;
}

export function normalizeCanonicalFilterParams(filterParams = [], { maxCount = FILTER_MAX_COUNT } = {}) {
  if (filterParams === undefined || filterParams === null) {
    return [];
  }

  if (!Array.isArray(filterParams)) {
    throw new Error("filterParams must be an array");
  }

  if (filterParams.length > maxCount) {
    throw new Error("Too many filter conditions");
  }

  return filterParams.map((rawFilter, index) => {
    if (!rawFilter || typeof rawFilter !== "object" || Array.isArray(rawFilter)) {
      throw new Error(`Invalid filter at position ${index + 1}`);
    }

    const rawField = typeof rawFilter.field === "string" ? rawFilter.field.trim() : "";
    const rawOperator = typeof rawFilter.operator === "string" ? rawFilter.operator.trim() : "";
    if (!rawField) {
      throw new Error(`Invalid filter field at position ${index + 1}`);
    }

    const definition = getFilterFieldDefinition(rawField);
    if (!definition) {
      throw new Error(`Unsupported filter field: ${rawField}`);
    }

    const canonicalField = definition.canonicalField || rawField;
    const normalizedValue = definition.transformValue
      ? definition.transformValue(normalizeFilterValue(rawFilter.value))
      : normalizeFilterValue(rawFilter.value);

    return {
      field: canonicalField,
      operator: rawOperator,
      value: normalizedValue,
    };
  });
}

export function serializeCanonicalFilterParams(filterParams = []) {
  return stableStringify(normalizeCanonicalFilterParams(filterParams));
}
