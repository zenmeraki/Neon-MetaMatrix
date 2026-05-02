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

function normalizeOperator(operator) {
  return String(operator || "").trim().toLowerCase();
}

function normalizeStringValue(field, value, { allowEmpty = false } = {}) {
  if (value === null || value === undefined) {
    if (allowEmpty) return "";
    throw new Error(`Value required for ${field}`);
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    throw new Error(`Invalid value for ${field}`);
  }

  const normalized = String(value).trim();
  if (!normalized && !allowEmpty) {
    throw new Error(`Value required for ${field}`);
  }

  return normalized;
}

function normalizeStringList(field, value) {
  const values = Array.isArray(value)
    ? value.map((item) => normalizeStringValue(field, item)).filter(Boolean)
    : [];

  if (!values.length) {
    throw new Error(`IN filter requires values for ${field}`);
  }

  return [...new Set(values)];
}

function normalizeNumberValue(field, value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid number for ${field}: ${value}`);
  }

  return num;
}

function normalizeNumberList(field, value) {
  const values = Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : [];

  if (!values.length) {
    throw new Error(`IN filter requires numeric values for ${field}`);
  }

  return [...new Set(values)];
}

function normalizeDateValue(field, value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date for ${field}: ${value}`);
  }

  return date;
}

function buildCollectionTitleToken(value) {
  return `"title":${JSON.stringify(value)}`;
}

export function buildPrismaStringFilter(field, operator, value) {
  const op = normalizeOperator(operator);

  switch (op) {
    case "equals":
    case "is":
      return {
        [field]: {
          equals: normalizeStringValue(field, value),
          mode: "insensitive",
        },
      };

    case "is not":
    case "does not equal":
      return {
        OR: [
          { [field]: null },
          {
            NOT: {
              [field]: {
                equals: normalizeStringValue(field, value),
                mode: "insensitive",
              },
            },
          },
        ],
      };

    case "contains":
      return {
        [field]: {
          contains: normalizeStringValue(field, value),
          mode: "insensitive",
        },
      };

    case "does not contain":
      return {
        NOT: {
          [field]: {
            contains: normalizeStringValue(field, value),
            mode: "insensitive",
          },
        },
      };

    case "starts with":
      return {
        [field]: {
          startsWith: normalizeStringValue(field, value),
          mode: "insensitive",
        },
      };

    case "ends with":
      return {
        [field]: {
          endsWith: normalizeStringValue(field, value),
          mode: "insensitive",
        },
      };

    case "in": {
      const values = normalizeStringList(field, value);
      return {
        OR: values.map((item) => ({
          [field]: { equals: item, mode: "insensitive" },
        })),
      };
    }

    case "is empty":
    case "is empty/blank":
      return {
        OR: [{ [field]: null }, { [field]: "" }],
      };

    case "is not empty":
      return {
        AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }],
      };

    default:
      throw new Error(`Unsupported string operator for ${field}: ${operator}`);
  }
}

export function buildPrismaNumberFilter(field, operator, value) {
  const op = normalizeOperator(operator);

  switch (op) {
    case "<":
    case "less than":
      return { [field]: { lt: normalizeNumberValue(field, value) } };

    case "<=":
    case "less than or equal":
      return { [field]: { lte: normalizeNumberValue(field, value) } };

    case ">":
    case "greater than":
      return { [field]: { gt: normalizeNumberValue(field, value) } };

    case ">=":
    case "greater than or equal":
      return { [field]: { gte: normalizeNumberValue(field, value) } };

    case "=":
    case "equals":
    case "is":
      return { [field]: { equals: normalizeNumberValue(field, value) } };

    case "!=":
    case "does not equal":
    case "is not":
      return {
        OR: [
          { [field]: null },
          { NOT: { [field]: { equals: normalizeNumberValue(field, value) } } },
        ],
      };

    case "in":
      return { [field]: { in: normalizeNumberList(field, value) } };

    case "is empty":
    case "is empty/blank":
      return { [field]: null };

    case "is not empty":
      return { [field]: { not: null } };

    default:
      throw new Error(`Unsupported number operator for ${field}: ${operator}`);
  }
}

export function buildPrismaBooleanFilter(field, operator, value) {
  const op = normalizeOperator(operator);
  let normalized;

  if (typeof value === "boolean") {
    normalized = value;
  } else {
    const s = String(value).trim().toLowerCase();
    normalized = ["true", "1", "yes", "active"].includes(s);
  }

  switch (op) {
    case "equals":
    case "is":
    case "=":
      return { [field]: normalized };

    case "does not equal":
    case "is not":
    case "!=":
      return { NOT: { [field]: normalized } };

    case "is empty":
    case "is empty/blank":
      return { [field]: null };

    case "is not empty":
      return { [field]: { not: null } };

    default:
      throw new Error(`Unsupported boolean operator for ${field}: ${operator}`);
  }
}

export function buildPrismaDateFilter(field, operator, value) {
  const op = normalizeOperator(operator);
  const now = new Date();

  switch (op) {
    case "is before":
      return { [field]: { lt: normalizeDateValue(field, value) } };

    case "is after":
      return { [field]: { gt: normalizeDateValue(field, value) } };

    case "is on": {
      const date = normalizeStringValue(field, value);
      return {
        AND: [
          { [field]: { gte: normalizeDateValue(field, `${date}T00:00:00.000Z`) } },
          { [field]: { lt: normalizeDateValue(field, `${date}T23:59:59.999Z`) } },
        ],
      };
    }

    case "is before x days ago": {
      const before = new Date(now);
      before.setDate(now.getDate() - normalizeNumberValue(field, value));
      return { [field]: { lt: before } };
    }

    case "is after x days ago": {
      const after = new Date(now);
      after.setDate(now.getDate() - normalizeNumberValue(field, value));
      return { [field]: { gt: after } };
    }

    case "is empty":
    case "is empty/blank":
      return { [field]: null };

    case "is not empty":
      return { [field]: { not: null } };

    default:
      throw new Error(`Unsupported date operator for ${field}: ${operator}`);
  }
}

export function buildPrismaArrayStringFilter(field, operator, value) {
  const op = normalizeOperator(operator);

  switch (op) {
    case "contains":
    case "equals":
    case "is":
      return { [field]: { has: normalizeStringValue(field, value) } };

    case "in":
      return { [field]: { hasSome: normalizeStringList(field, value) } };

    case "does not contain":
    case "does not equal":
    case "is not":
      return { NOT: { [field]: { has: normalizeStringValue(field, value) } } };

    case "is empty":
    case "is empty/blank":
      return {
        OR: [{ [field]: { isEmpty: true } }, { [field]: { equals: [] } }],
      };

    case "is not empty":
      return { NOT: { [field]: { equals: [] } } };

    default:
      throw new Error(`Unsupported array operator for ${field}: ${operator}`);
  }
}

export function buildPrismaCollectionFilter(operator, value) {
  const op = normalizeOperator(operator);
  const v = normalizeStringValue("collection", value, {
    allowEmpty: ["is empty", "is empty/blank", "is not empty"].includes(op),
  });
  const exactToken = buildCollectionTitleToken(v);

  switch (op) {
    case "equals":
    case "is":
      return {
        collectionsJson: {
          string_contains: exactToken,
        },
      };

    case "contains":
      return {
        collectionsJson: {
          string_contains: v,
        },
      };

    case "does not equal":
    case "is not":
      return {
        OR: [
          { collectionsJson: { equals: null } },
          { collectionsJson: { equals: [] } },
          {
            NOT: {
              collectionsJson: {
                string_contains: exactToken,
              },
            },
          },
        ],
      };

    case "does not contain":
      return {
        OR: [
          { collectionsJson: { equals: null } },
          { collectionsJson: { equals: [] } },
          {
            NOT: {
              collectionsJson: {
                string_contains: v,
              },
            },
          },
        ],
      };

    case "is empty":
    case "is empty/blank":
      return {
        OR: [
          { collectionsJson: { equals: null } },
          { collectionsJson: { equals: [] } },
        ],
      };

    case "is not empty":
      return {
        AND: [
          { collectionsJson: { not: null } },
          { NOT: { collectionsJson: { equals: [] } } },
        ],
      };

    default:
      throw new Error(`Unsupported collection operator: ${operator}`);
  }
}

function buildVariantSome(shop, inner) {
  return {
    variants: {
      some: {
        shop,
        ...inner,
      },
    },
  };
}

export function getProductPrismaWhere(filterParams = [], shop) {
  if (typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required for product filters");
  }

  if (!Array.isArray(filterParams)) {
    throw new Error("filterParams must be an array");
  }

  const where = { shop };
  const AND = [];

  for (const [index, rawFilter] of filterParams.entries()) {
    if (!rawFilter) continue;

    const field = rawFilter?.field;
    const operator = normalizeOperator(rawFilter?.operator);
    const value = rawFilter?.value;

    if (!field) {
      throw new Error(`filterParams[${index}].field is required`);
    }

    switch (field) {
      case "search":
        if (!normalizeStringValue("search", value)) break;
        AND.push({
          OR: [
            { title: { contains: value, mode: "insensitive" } },
            { vendor: { contains: value, mode: "insensitive" } },
            { productType: { contains: value, mode: "insensitive" } },
            { handle: { contains: value, mode: "insensitive" } },
            { descriptionText: { contains: value, mode: "insensitive" } },
            { categoryName: { contains: value, mode: "insensitive" } },
          ],
        });
        break;

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

      case "status":
        AND.push(
          buildPrismaStringFilter("status", operator, String(value).toUpperCase()),
        );
        break;

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

      case "collection":
        AND.push(buildPrismaCollectionFilter(operator, value));
        break;

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
        AND.push(buildVariantSome(shop, buildPrismaStringFilter("sku", operator, value)));
        break;

      case "barcode":
        AND.push(buildVariantSome(shop, buildPrismaStringFilter("barcode", operator, value)));
        break;

      case "variant_title":
        AND.push(buildVariantSome(shop, buildPrismaStringFilter("title", operator, value)));
        break;

      case "price":
        AND.push(buildVariantSome(shop, buildPrismaNumberFilter("price", operator, value)));
        break;

      case "compare_at_price":
        AND.push(
          buildVariantSome(shop, buildPrismaNumberFilter("compareAtPrice", operator, value)),
        );
        break;

      case "variant_inventory_q":
        AND.push(
          buildVariantSome(shop, buildPrismaNumberFilter("inventoryQuantity", operator, value)),
        );
        break;

      case "charge_tax":
        AND.push(buildVariantSome(shop, buildPrismaBooleanFilter("taxable", operator, value)));
        break;

      case "cost":
        AND.push(buildVariantSome(shop, buildPrismaNumberFilter("cost", operator, value)));
        break;

      case "country_of_origin":
        AND.push(
          buildVariantSome(shop, buildPrismaStringFilter("countryOfOrigin", operator, value)),
        );
        break;

      case "hs_tariff_code":
        AND.push(buildVariantSome(shop, buildPrismaStringFilter("hsTariffCode", operator, value)));
        break;

      case "inventory_policy":
      case "inventory_out_of_stock_policy":
        AND.push(
          buildVariantSome(shop, buildPrismaStringFilter("inventoryPolicy", operator, value)),
        );
        break;

      case "option_value_1":
        AND.push(buildVariantSome(shop, buildPrismaStringFilter("option1Value", operator, value)));
        break;

      case "option_value_2":
        AND.push(buildVariantSome(shop, buildPrismaStringFilter("option2Value", operator, value)));
        break;

      case "option_value_3":
        AND.push(buildVariantSome(shop, buildPrismaStringFilter("option3Value", operator, value)));
        break;

      case "physical_product":
        AND.push(
          buildVariantSome(shop, buildPrismaBooleanFilter("physicalProduct", operator, value)),
        );
        break;

      case "track_quantity":
        AND.push(buildVariantSome(shop, buildPrismaBooleanFilter("tracked", operator, value)));
        break;

      case "seo":
      case "seo_visibility": {
        const isPositive =
          operator === "is" ||
          operator === "equals" ||
          operator === "is not empty" ||
          String(value).toLowerCase() === "true";

        const isNegative =
          operator === "is not" ||
          operator === "does not equal" ||
          operator === "is empty" ||
          operator === "is empty/blank" ||
          String(value).toLowerCase() === "false";

        if (isPositive) {
          AND.push({
            OR: [{ seoTitle: { not: null } }, { seoDescription: { not: null } }],
          });
        } else if (isNegative) {
          AND.push({
            AND: [{ seoTitle: null }, { seoDescription: null }],
          });
        } else {
          throw new Error(`Unsupported seo operator: ${rawFilter?.operator}`);
        }
        break;
      }
      case "profit_margin":
        AND.push(buildVariantSome(shop, buildPrismaNumberFilter("profitMargin", operator, value)));
        break;

      case "weight":
        AND.push(buildVariantSome(shop, buildPrismaNumberFilter("weight", operator, value)));
        break;

      case "weight_unit":
        AND.push(buildVariantSome(shop, buildPrismaStringFilter("weightUnit", operator, value)));
        break;

      default:
        throw new Error(`Unsupported product filter field: ${field}`);
    }
  }

  if (AND.length > 0) {
    where.AND = AND;
  }

  return where;
}
