/**
 * Registry-driven filter model.
 *
 * Every filterable field must appear here with its canonical type. A field with
 * no entry cannot be used for targeting, preview, export, or scheduled runs —
 * attempting to do so throws UNKNOWN_FILTER_FIELD rather than silently returning
 * an empty where clause.
 *
 * Allowed operators per type are explicit. Passing "contains" for a NUMBER field
 * or "greater than" for a STRING field throws INVALID_FILTER_OPERATOR.
 *
 * Fields handled by upstream pre-query paths (collection, inventory_at_location)
 * are in SPECIAL_FILTER_FIELDS — they bypass the compiler entirely and are not
 * validated here.
 *
 * CURRENT_FILTER_ENGINE_VERSION must be bumped whenever a semantic change is made
 * that could cause a saved filterParams set to produce different results than when
 * it was last compiled. Saved filters carrying an older version should be
 * re-validated or rejected before being used for execution.
 */

export const CURRENT_FILTER_ENGINE_VERSION = 2;

/**
 * Asserts that a saved filter's engine version matches the current engine.
 * Throws FILTER_ENGINE_VERSION_MISMATCH if the versions differ so that callers
 * can reject stale saved filters rather than silently applying them.
 *
 * @param {number|null|undefined} savedVersion - The version stored on the saved filter
 * @param {object} [context] - Optional context fields attached to the error
 */
export function assertFilterVersionCurrent(savedVersion, context = {}) {
  const saved = typeof savedVersion === "number" ? savedVersion : 1;
  if (saved !== CURRENT_FILTER_ENGINE_VERSION) {
    const err = new Error(
      `Saved filter was compiled with engine version ${saved} but the current engine version is ${CURRENT_FILTER_ENGINE_VERSION}. Re-validate or rebuild the filter before executing.`,
    );
    err.code = "FILTER_ENGINE_VERSION_MISMATCH";
    err.savedVersion = saved;
    err.currentVersion = CURRENT_FILTER_ENGINE_VERSION;
    Object.assign(err, context);
    throw err;
  }
}

const FIELD_TYPE = {
  STRING: "STRING",
  NUMBER: "NUMBER",
  BOOLEAN: "BOOLEAN",
  DATE: "DATE",
  ARRAY_STRING: "ARRAY_STRING",
};

const ALLOWED_OPERATORS = {
  [FIELD_TYPE.STRING]: new Set([
    "equals", "is",
    "does not equal", "is not",
    "contains", "does not contain",
    "starts with", "ends with",
    "is empty", "is empty/blank", "is not empty",
  ]),
  [FIELD_TYPE.NUMBER]: new Set([
    "<", "<=", ">", ">=",
    "=", "equals", "is",
    "!=", "does not equal", "is not",
    "is empty", "is empty/blank", "is not empty",
  ]),
  [FIELD_TYPE.BOOLEAN]: new Set([
    "equals", "is", "=",
    "does not equal", "is not", "!=",
    "is empty", "is empty/blank", "is not empty",
  ]),
  [FIELD_TYPE.DATE]: new Set([
    "is before", "is after", "is on",
    "is before x days ago", "is after x days ago",
    "is empty", "is empty/blank", "is not empty",
  ]),
  [FIELD_TYPE.ARRAY_STRING]: new Set([
    "contains", "equals", "is",
    "does not contain", "does not equal", "is not",
    "is empty", "is empty/blank", "is not empty",
  ]),
};

const FILTER_FIELD_REGISTRY = {
  // Product — string
  title: FIELD_TYPE.STRING,
  vendor: FIELD_TYPE.STRING,
  handle: FIELD_TYPE.STRING,
  description: FIELD_TYPE.STRING,
  product_type: FIELD_TYPE.STRING,
  status: FIELD_TYPE.STRING,
  category: FIELD_TYPE.STRING,
  theme_template: FIELD_TYPE.STRING,
  product_id: FIELD_TYPE.STRING,
  option_name_1: FIELD_TYPE.STRING,
  option_name_2: FIELD_TYPE.STRING,
  option_name_3: FIELD_TYPE.STRING,
  // Variant — string
  sku: FIELD_TYPE.STRING,
  barcode: FIELD_TYPE.STRING,
  variant_title: FIELD_TYPE.STRING,
  country_of_origin: FIELD_TYPE.STRING,
  hs_tariff_code: FIELD_TYPE.STRING,
  inventory_policy: FIELD_TYPE.STRING,
  inventory_out_of_stock_policy: FIELD_TYPE.STRING,
  option_value_1: FIELD_TYPE.STRING,
  option_value_2: FIELD_TYPE.STRING,
  option_value_3: FIELD_TYPE.STRING,
  weight_unit: FIELD_TYPE.STRING,
  // Google Shopping — string
  googleShoppingAgeGroup: FIELD_TYPE.STRING,
  google_shopping_age_group: FIELD_TYPE.STRING,
  googleShoppingCategory: FIELD_TYPE.STRING,
  google_shopping_category: FIELD_TYPE.STRING,
  googleShoppingColor: FIELD_TYPE.STRING,
  google_shopping_color: FIELD_TYPE.STRING,
  googleShoppingCondition: FIELD_TYPE.STRING,
  google_shopping_condition: FIELD_TYPE.STRING,
  googleShoppingCustomLabel0: FIELD_TYPE.STRING,
  google_shopping_custom_label_0: FIELD_TYPE.STRING,
  googleShoppingCustomLabel1: FIELD_TYPE.STRING,
  google_shopping_custom_label_1: FIELD_TYPE.STRING,
  googleShoppingCustomLabel2: FIELD_TYPE.STRING,
  google_shopping_custom_label_2: FIELD_TYPE.STRING,
  googleShoppingCustomLabel3: FIELD_TYPE.STRING,
  google_shopping_custom_label_3: FIELD_TYPE.STRING,
  googleShoppingCustomLabel4: FIELD_TYPE.STRING,
  google_shopping_custom_label_4: FIELD_TYPE.STRING,
  googleShoppingGender: FIELD_TYPE.STRING,
  google_shopping_gender: FIELD_TYPE.STRING,
  googleShoppingMpn: FIELD_TYPE.STRING,
  google_shopping_mpn: FIELD_TYPE.STRING,
  googleShoppingMaterial: FIELD_TYPE.STRING,
  google_shopping_material: FIELD_TYPE.STRING,
  googleShoppingSize: FIELD_TYPE.STRING,
  google_shopping_size: FIELD_TYPE.STRING,
  googleShoppingSizeSystem: FIELD_TYPE.STRING,
  google_shopping_size_system: FIELD_TYPE.STRING,
  googleShoppingSizeType: FIELD_TYPE.STRING,
  google_shopping_size_type: FIELD_TYPE.STRING,
  // Category — string
  categoryAgeGroup: FIELD_TYPE.STRING,
  category_age_group: FIELD_TYPE.STRING,
  categoryColor: FIELD_TYPE.STRING,
  category_color: FIELD_TYPE.STRING,
  categoryFabric: FIELD_TYPE.STRING,
  category_fabric: FIELD_TYPE.STRING,
  categoryFit: FIELD_TYPE.STRING,
  category_fit: FIELD_TYPE.STRING,
  categorySize: FIELD_TYPE.STRING,
  category_size: FIELD_TYPE.STRING,
  categoryTargetGender: FIELD_TYPE.STRING,
  category_target_gender: FIELD_TYPE.STRING,
  categoryWaistRise: FIELD_TYPE.STRING,
  category_waist_rise: FIELD_TYPE.STRING,
  // Product — number
  inventory_q: FIELD_TYPE.NUMBER,
  variant_count: FIELD_TYPE.NUMBER,
  vc: FIELD_TYPE.NUMBER,
  // Variant — number
  variant_inventory_q: FIELD_TYPE.NUMBER,
  price: FIELD_TYPE.NUMBER,
  compare_at_price: FIELD_TYPE.NUMBER,
  cost: FIELD_TYPE.NUMBER,
  profit_margin: FIELD_TYPE.NUMBER,
  weight: FIELD_TYPE.NUMBER,
  // Product — boolean
  visible_online_store: FIELD_TYPE.BOOLEAN,
  googleShoppingEnabled: FIELD_TYPE.BOOLEAN,
  google_shopping_enabled: FIELD_TYPE.BOOLEAN,
  googleShoppingCustomProduct: FIELD_TYPE.BOOLEAN,
  google_shopping_custom_product: FIELD_TYPE.BOOLEAN,
  seo: FIELD_TYPE.BOOLEAN,
  seo_visibility: FIELD_TYPE.BOOLEAN,
  // Variant — boolean
  charge_tax: FIELD_TYPE.BOOLEAN,
  physical_product: FIELD_TYPE.BOOLEAN,
  track_quantity: FIELD_TYPE.BOOLEAN,
  // Product — date
  created_at: FIELD_TYPE.DATE,
  updated_at: FIELD_TYPE.DATE,
  published_at: FIELD_TYPE.DATE,
  // Product — array string
  tag: FIELD_TYPE.ARRAY_STRING,
};

/**
 * Fields that are intercepted by upstream pre-query paths before reaching
 * getProductPrismaWhere. They are not compiled into the main Prisma WHERE
 * clause and must not be validated here.
 */
const SPECIAL_FILTER_FIELDS = new Set([
  "search",
  "collection",
  "inventory_at_location",
]);

/**
 * Validate that every filter in the list uses a known field and an operator
 * that is legal for that field's type.
 *
 * Throws UNKNOWN_FILTER_FIELD for unregistered fields.
 * Throws INVALID_FILTER_OPERATOR for cross-type operator misuse.
 *
 * Existence operators (is empty, is not empty) are legal for all types and do
 * not require a value, so they are always allowed when the field is registered.
 */
export function validateFilterParams(filterParams) {
  if (!Array.isArray(filterParams)) return;

  for (const filter of filterParams) {
    const { field, operator } = filter || {};
    if (!field) continue;
    if (SPECIAL_FILTER_FIELDS.has(field)) continue;

    const fieldType = FILTER_FIELD_REGISTRY[field];
    if (!fieldType) {
      const err = new Error(
        `Unknown filter field: "${field}". Add it to FILTER_FIELD_REGISTRY with an explicit type before using it for targeting.`,
      );
      err.code = "UNKNOWN_FILTER_FIELD";
      err.field = field;
      throw err;
    }

    if (operator) {
      const allowed = ALLOWED_OPERATORS[fieldType];
      if (!allowed.has(operator)) {
        const err = new Error(
          `Operator "${operator}" is not valid for field "${field}" (type: ${fieldType}). ` +
          `Allowed operators: ${[...allowed].join(", ")}`,
        );
        err.code = "INVALID_FILTER_OPERATOR";
        err.field = field;
        err.operator = operator;
        err.fieldType = fieldType;
        throw err;
      }
    }
  }
}

/**
 * Expose the field type for a registered field. Returns null for special
 * fields or fields not in the registry.
 */
export function getFilterFieldType(field) {
  return FILTER_FIELD_REGISTRY[field] || null;
}

export function buildPrismaSortQuery(sortKey, sortOrder) {
  const order = sortOrder === "desc" ? "desc" : "asc";

  switch (sortKey) {
    case "CREATED_AT":
      return { createdAt: order };

    case "ID":
      return { id: order };

    case "INVENTORY_TOTAL":
      return { totalInventory: order };

    case "PRODUCT_TYPE":
      return { productType: order };

    case "PUBLISHED_AT":
      return { publishedAt: order };

    case "TITLE":
      return { title: order };

    case "UPDATED_AT":
      return { updatedAt: order };

    case "VENDOR":
      return { vendor: order };

    default:
      return { createdAt: "desc" };
  }
}

export function buildPrismaStringFilter(field, operator, value) {
  // Existence operators do not use the value — short-circuit first.
  if (operator === "is empty" || operator === "is empty/blank") {
    return { OR: [{ [field]: null }, { [field]: "" }] };
  }

  if (operator === "is not empty") {
    return { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
  }

  // All remaining operators are value-dependent. Normalize and guard: a null,
  // undefined, or whitespace-only value is not a valid search term and must
  // produce a no-op rather than silently matching null rows or empty strings.
  const normalizedValue = String(value ?? "").trim();
  if (normalizedValue === "") return {};

  switch (operator) {
    case "equals":
    case "is":
      return { [field]: { equals: normalizedValue, mode: "insensitive" } };

    case "does not equal":
    case "is not":
      return { NOT: { [field]: { equals: normalizedValue, mode: "insensitive" } } };

    case "contains":
      return { [field]: { contains: normalizedValue, mode: "insensitive" } };

    case "does not contain":
      return { NOT: { [field]: { contains: normalizedValue, mode: "insensitive" } } };

    case "starts with":
      return { [field]: { startsWith: normalizedValue, mode: "insensitive" } };

    case "ends with":
      return { [field]: { endsWith: normalizedValue, mode: "insensitive" } };

    default:
      return {};
  }
}

export function buildPrismaNumberFilter(field, operator, value) {
  const decimal = String(value ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(decimal)) return {};

  switch (operator) {
    case "<":
    case "less than":
      return { [field]: { lt: decimal } };

    case "<=":
    case "less than or equal":
      return { [field]: { lte: decimal } };

    case ">":
    case "greater than":
      return { [field]: { gt: decimal } };

    case ">=":
    case "greater than or equal":
      return { [field]: { gte: decimal } };

    case "=":
    case "equals":
    case "is":
      return { [field]: { equals: decimal } };

    case "!=":
    case "does not equal":
    case "is not":
      return { NOT: { [field]: { equals: decimal } } };

    case "is empty":
    case "is empty/blank":
      return { [field]: null };

    case "is not empty":
      return { [field]: { not: null } };

    default:
      return {};
  }
}

export function buildPrismaBooleanFilter(field, operator, value) {
  // Existence operators do not depend on value.
  if (operator === "is empty" || operator === "is empty/blank") {
    return { [field]: null };
  }

  if (operator === "is not empty") {
    return { [field]: { not: null } };
  }

  // Value-dependent operators: normalize the boolean explicitly. An
  // unrecognized or missing operator must not silently produce a filter.
  let normalized;
  if (typeof value === "boolean") {
    normalized = value;
  } else {
    const s = String(value ?? "").trim().toLowerCase();
    normalized = ["true", "1", "yes", "active"].includes(s);
  }

  switch (operator) {
    case "equals":
    case "is":
    case "=":
      return { [field]: normalized };

    case "does not equal":
    case "is not":
    case "!=":
      return { NOT: { [field]: normalized } };

    default:
      return {};
  }
}

export function buildPrismaDateFilter(field, operator, value) {
  const now = new Date();

  switch (operator) {
    case "is before":
      return { [field]: { lt: new Date(value) } };

    case "is after":
      return { [field]: { gt: new Date(value) } };

    case "is on":
      return {
        AND: [
          { [field]: { gte: new Date(`${value}T00:00:00.000Z`) } },
          { [field]: { lt: new Date(`${value}T23:59:59.999Z`) } },
        ],
      };

    case "is before x days ago": {
      const before = new Date();
      before.setDate(now.getDate() - Number(value));
      return { [field]: { lt: before } };
    }

    case "is after x days ago": {
      const after = new Date();
      after.setDate(now.getDate() - Number(value));
      return { [field]: { gt: after } };
    }

    case "is empty":
    case "is empty/blank":
      return { [field]: null };

    case "is not empty":
      return { [field]: { not: null } };

    default:
      return {};
  }
}

export function buildPrismaArrayStringFilter(field, operator, value) {
  // Existence operators: a null column and an empty array are both "empty".
  // NOT of "empty" must exclude null (a null array is not "has items").
  if (operator === "is empty" || operator === "is empty/blank") {
    return { OR: [{ [field]: null }, { [field]: { isEmpty: true } }] };
  }

  if (operator === "is not empty") {
    return { AND: [{ [field]: { not: null } }, { NOT: { [field]: { isEmpty: true } } }] };
  }

  // Value-dependent operators: normalize the search term. Collapse internal
  // whitespace so " Summer  Sale " matches the stored "Summer Sale". Tags are
  // stored with the same normalization (see productSyncTransformers.normalizeTag).
  // Null or blank values are a no-op — don't silently match or exclude rows.
  const normalizedValue = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (normalizedValue === "") return {};

  switch (operator) {
    case "contains":
    case "equals":
    case "is":
      return { [field]: { has: normalizedValue } };

    case "does not contain":
    case "does not equal":
    case "is not":
      return { NOT: { [field]: { has: normalizedValue } } };

    default:
      return {};
  }
}


/**
 * Wraps a variant sub-filter with a catalogBatchId scope so that variant
 * relation joins are always constrained to the active catalog snapshot batch,
 * not the mirrorBatchId dimension used by the Prisma relation key.
 */
function scopeVariantFilter(filter, catalogBatchId) {
  if (!catalogBatchId) return filter;
  return { AND: [filter, { catalogBatchId }] };
}

export function getProductPrismaWhere(filterParams = [], shop, catalogBatchId = null) {
  validateFilterParams(filterParams);
  const where = { shop };
  const AND = [];

  for (const rawFilter of filterParams) {
    const field = rawFilter?.field;
    const operator = rawFilter?.operator;
    const value = rawFilter?.value;

    if (!field) continue;

    switch (field) {
      case "search": {
        const searchTerm = String(value ?? "").trim();
        if (!searchTerm) break;
        AND.push({
          OR: [
            { title: { contains: searchTerm, mode: "insensitive" } },
            { vendor: { contains: searchTerm, mode: "insensitive" } },
            { productType: { contains: searchTerm, mode: "insensitive" } },
            { handle: { contains: searchTerm, mode: "insensitive" } },
            { descriptionText: { contains: searchTerm, mode: "insensitive" } },
            { categoryName: { contains: searchTerm, mode: "insensitive" } },
          ],
        });
        break;
      }

      case "title":
        AND.push(buildPrismaStringFilter("title", operator, value));
        break;

      case "vendor":
        AND.push(buildPrismaStringFilter("vendor", operator, value));
        break;

      case "handle":
        AND.push(buildPrismaStringFilter("handle", operator, value));
        break;

      case "description":
        AND.push(buildPrismaStringFilter("descriptionText", operator, value));
        break;

      case "product_type":
        AND.push(buildPrismaStringFilter("productType", operator, value));
        break;

      case "status": {
        // Status is a canonical enum (ACTIVE, DRAFT, ARCHIVED). Normalize the
        // incoming value to uppercase so frontend casing variations don't drift.
        // Guard null/undefined before calling toUpperCase.
        const normalizedStatus = String(value ?? "").trim().toUpperCase();
        if (normalizedStatus) {
          AND.push(buildPrismaStringFilter("status", operator, normalizedStatus));
        }
        break;
      }

      case "inventory_q":
        AND.push(buildPrismaNumberFilter("totalInventory", operator, value));
        break;

      case "created_at":
        AND.push(buildPrismaDateFilter("createdAt", operator, value));
        break;

      case "updated_at":
        AND.push(buildPrismaDateFilter("updatedAt", operator, value));
        break;

      case "published_at":
        AND.push(buildPrismaDateFilter("publishedAt", operator, value));
        break;

      case "product_id":
        AND.push(buildPrismaStringFilter("id", operator, value));
        break;

      case "category":
        AND.push(buildPrismaStringFilter("categoryName", operator, value));
        break;

      case "tag":
        AND.push(buildPrismaArrayStringFilter("tags", operator, value));
        break;

      case "theme_template":
        AND.push(buildPrismaStringFilter("templateSuffix", operator, value));
        break;

      // "collection" filters are handled upstream via resolveCollectionFilterWhere
      // in productTargetingService.js before reaching this compiler. They must
      // not be compiled here — the Product model has no Prisma relation named
      // "collections"; routing them here would produce a runtime error.

      case "variant_count":
      case "vc":
        AND.push(buildPrismaNumberFilter("variantCount", operator, value));
        break;

      case "option_name_1":
        AND.push(buildPrismaStringFilter("option1Name", operator, value));
        break;

      case "option_name_2":
        AND.push(buildPrismaStringFilter("option2Name", operator, value));
        break;

      case "option_name_3":
        AND.push(buildPrismaStringFilter("option3Name", operator, value));
        break;

      case "visible_online_store":
        AND.push(buildPrismaBooleanFilter("visibleOnlineStore", operator, value));
        break;

      case "googleShoppingEnabled":
      case "google_shopping_enabled":
        AND.push(
          buildPrismaBooleanFilter("googleShoppingEnabled", operator, value),
        );
        break;

      case "googleShoppingAgeGroup":
      case "google_shopping_age_group":
        AND.push(
          buildPrismaStringFilter("googleShoppingAgeGroup", operator, value),
        );
        break;

      case "googleShoppingCategory":
      case "google_shopping_category":
        AND.push(
          buildPrismaStringFilter("googleShoppingCategory", operator, value),
        );
        break;

      case "googleShoppingColor":
      case "google_shopping_color":
        AND.push(
          buildPrismaStringFilter("googleShoppingColor", operator, value),
        );
        break;

      case "googleShoppingCondition":
      case "google_shopping_condition":
        AND.push(
          buildPrismaStringFilter("googleShoppingCondition", operator, value),
        );
        break;

      case "googleShoppingCustomLabel0":
      case "google_shopping_custom_label_0":
        AND.push(
          buildPrismaStringFilter("googleShoppingCustomLabel0", operator, value),
        );
        break;

      case "googleShoppingCustomLabel1":
      case "google_shopping_custom_label_1":
        AND.push(
          buildPrismaStringFilter("googleShoppingCustomLabel1", operator, value),
        );
        break;

      case "googleShoppingCustomLabel2":
      case "google_shopping_custom_label_2":
        AND.push(
          buildPrismaStringFilter("googleShoppingCustomLabel2", operator, value),
        );
        break;

      case "googleShoppingCustomLabel3":
      case "google_shopping_custom_label_3":
        AND.push(
          buildPrismaStringFilter("googleShoppingCustomLabel3", operator, value),
        );
        break;

      case "googleShoppingCustomLabel4":
      case "google_shopping_custom_label_4":
        AND.push(
          buildPrismaStringFilter("googleShoppingCustomLabel4", operator, value),
        );
        break;

      case "googleShoppingCustomProduct":
      case "google_shopping_custom_product":
        AND.push(
          buildPrismaBooleanFilter("googleShoppingCustomProduct", operator, value),
        );
        break;

      case "googleShoppingGender":
      case "google_shopping_gender":
        AND.push(
          buildPrismaStringFilter("googleShoppingGender", operator, value),
        );
        break;

      case "googleShoppingMpn":
      case "google_shopping_mpn":
        AND.push(buildPrismaStringFilter("googleShoppingMpn", operator, value));
        break;

      case "googleShoppingMaterial":
      case "google_shopping_material":
        AND.push(
          buildPrismaStringFilter("googleShoppingMaterial", operator, value),
        );
        break;

      case "googleShoppingSize":
      case "google_shopping_size":
        AND.push(
          buildPrismaStringFilter("googleShoppingSize", operator, value),
        );
        break;

      case "googleShoppingSizeSystem":
      case "google_shopping_size_system":
        AND.push(
          buildPrismaStringFilter("googleShoppingSizeSystem", operator, value),
        );
        break;

      case "googleShoppingSizeType":
      case "google_shopping_size_type":
        AND.push(
          buildPrismaStringFilter("googleShoppingSizeType", operator, value),
        );
        break;

      case "categoryAgeGroup":
      case "category_age_group":
        AND.push(buildPrismaStringFilter("categoryAgeGroup", operator, value));
        break;

      case "categoryColor":
      case "category_color":
        AND.push(buildPrismaStringFilter("categoryColor", operator, value));
        break;

      case "categoryFabric":
      case "category_fabric":
        AND.push(buildPrismaStringFilter("categoryFabric", operator, value));
        break;

      case "categoryFit":
      case "category_fit":
        AND.push(buildPrismaStringFilter("categoryFit", operator, value));
        break;

      case "categorySize":
      case "category_size":
        AND.push(buildPrismaStringFilter("categorySize", operator, value));
        break;

      case "categoryTargetGender":
      case "category_target_gender":
        AND.push(
          buildPrismaStringFilter("categoryTargetGender", operator, value),
        );
        break;

      case "categoryWaistRise":
      case "category_waist_rise":
        AND.push(buildPrismaStringFilter("categoryWaistRise", operator, value));
        break;

      case "sku":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("sku", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "barcode":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("barcode", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "variant_title":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("title", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "price":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaNumberFilter("price", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "compare_at_price":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaNumberFilter("compareAtPrice", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "variant_inventory_q":
        // Filters on the denormalized total inventory quantity on the Variant row.
        // For per-location inventory filtering use the inventory_at_location filter
        // which queries VariantInventoryLevel directly.
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaNumberFilter("inventoryQuantity", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "charge_tax":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaBooleanFilter("taxable", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "cost":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaNumberFilter("cost", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "country_of_origin":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("countryOfOrigin", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "hs_tariff_code":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("hsTariffCode", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "inventory_policy":
      case "inventory_out_of_stock_policy":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("inventoryPolicy", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "option_value_1":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("option1Value", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "option_value_2":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("option2Value", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "option_value_3":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("option3Value", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "physical_product":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaBooleanFilter("physicalProduct", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "track_quantity":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaBooleanFilter("tracked", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "seo":
      case "seo_visibility": {
        // Normalize value consistently with buildPrismaBooleanFilter: accept
        // "true"/"1"/"yes"/"active" as truthy, anything else (including "false",
        // "0", null) as falsy. Don't rely on string === "true" only.
        const seoTruthy = typeof value === "boolean"
          ? value
          : ["true", "1", "yes", "active"].includes(
              String(value ?? "").trim().toLowerCase(),
            );
        if (seoTruthy) {
          AND.push({
            OR: [{ seoTitle: { not: null } }, { seoDescription: { not: null } }],
          });
        } else {
          AND.push({
            AND: [{ seoTitle: null }, { seoDescription: null }],
          });
        }
        break;
      }

      case "profit_margin":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaNumberFilter("profitMargin", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "weight":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaNumberFilter("weight", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      case "weight_unit":
        AND.push({
          variants: {
            some: scopeVariantFilter(
              buildPrismaStringFilter("weightUnit", operator, value),
              catalogBatchId,
            ),
          },
        });
        break;

      default:
        break;
    }
  }

  if (AND.length > 0) {
    where.AND = AND;
  }

  return where;
}
