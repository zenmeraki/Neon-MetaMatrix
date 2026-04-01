function normalizeTextValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function isEmptyOperator(operator) {
  return ["is empty", "is empty/blank", "is not empty"].includes(operator);
}

export function buildPrismaSortQuery(sortKey, sortOrder) {
  const order = sortOrder === "desc" ? "desc" : "asc";
  let primarySort;

  switch (sortKey) {
    case "CREATED_AT":
      primarySort = { createdAt: order };
      break;
    case "ID":
      primarySort = { id: order };
      break;
    case "INVENTORY_TOTAL":
      primarySort = { totalInventory: order };
      break;
    case "PRODUCT_TYPE":
      primarySort = { productType: order };
      break;
    case "PUBLISHED_AT":
      primarySort = { publishedAt: order };
      break;
    case "TITLE":
      primarySort = { title: order };
      break;
    case "UPDATED_AT":
      primarySort = { updatedAt: order };
      break;
    case "VENDOR":
      primarySort = { vendor: order };
      break;
    default:
      primarySort = { createdAt: "desc" };
      break;
  }

  if (Object.prototype.hasOwnProperty.call(primarySort, "id")) {
    return [primarySort];
  }

  return [primarySort, { id: order }];
}

export function buildPrismaStringFilter(field, operator, value) {
  const normalizedValue = normalizeTextValue(value);

  if (!normalizedValue && !isEmptyOperator(operator)) {
    return {};
  }

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
      return {};
  }
}

export function buildPrismaNumberFilter(field, operator, value) {
  if (value === "" || value === null || value === undefined) {
    if (operator === "is empty" || operator === "is empty/blank") {
      return { [field]: null };
    }

    if (operator === "is not empty") {
      return { [field]: { not: null } };
    }

    return {};
  }

  const num = Number(value);
  if (Number.isNaN(num)) return {};

  switch (operator) {
    case "<":
    case "less than":
      return { [field]: { lt: num } };

    case "<=":
    case "less than or equal":
      return { [field]: { lte: num } };

    case ">":
    case "greater than":
      return { [field]: { gt: num } };

    case ">=":
    case "greater than or equal":
      return { [field]: { gte: num } };

    case "=":
    case "equals":
    case "is":
      return { [field]: { equals: num } };

    case "!=":
    case "does not equal":
    case "is not":
      return { NOT: { [field]: { equals: num } } };

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
  let normalized;

  if (typeof value === "boolean") {
    normalized = value;
  } else {
    const s = String(value).trim().toLowerCase();
    if (!["true", "1", "yes", "active", "false", "0", "no", "inactive"].includes(s)) {
      return {};
    }
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

    case "is empty":
    case "is empty/blank":
      return { [field]: null };

    case "is not empty":
      return { [field]: { not: null } };

    default:
      return { [field]: normalized };
  }
}

export function buildPrismaDateFilter(field, operator, value) {
  const now = new Date();
  const parsedDate = value ? new Date(value) : null;

  if (
    !["is before x days ago", "is after x days ago", "is empty", "is empty/blank", "is not empty"].includes(operator) &&
    (!(parsedDate instanceof Date) || Number.isNaN(parsedDate.getTime()))
  ) {
    return {};
  }

  switch (operator) {
    case "is before":
      return { [field]: { lt: parsedDate } };

    case "is after":
      return { [field]: { gt: parsedDate } };

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
      return Number.isNaN(before.getTime()) ? {} : { [field]: { lt: before } };
    }

    case "is after x days ago": {
      const after = new Date();
      after.setDate(now.getDate() - Number(value));
      return Number.isNaN(after.getTime()) ? {} : { [field]: { gt: after } };
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
  const normalizedValue = normalizeTextValue(value);

  if (!normalizedValue && !isEmptyOperator(operator)) {
    return {};
  }

  switch (operator) {
    case "contains":
    case "equals":
    case "is":
      return { [field]: { has: normalizedValue } };

    case "does not contain":
    case "does not equal":
    case "is not":
      return { NOT: { [field]: { has: normalizedValue } } };

    case "is empty":
    case "is empty/blank":
      return {
        OR: [{ [field]: { isEmpty: true } }, { [field]: { equals: [] } }],
      };

    case "is not empty":
      return { NOT: { [field]: { equals: [] } } };

    default:
      return {};
  }
}

export function buildPrismaCollectionFilter(operator, value) {
  const normalizedValue = normalizeTextValue(value);

  if (!normalizedValue && !["is empty", "is empty/blank"].includes(operator)) {
    return {};
  }

  switch (operator) {
    case "equals":
    case "is":
      return {
        collectionsJson: {
          path: "$[*].title",
          array_contains: [normalizedValue],
        },
      };

    case "contains":
      return {
        OR: [
          {
            collectionsJson: {
              path: "$[*].title",
              array_contains: [normalizedValue],
            },
          },
          {
            collectionsJson: {
              string_contains: normalizedValue,
            },
          },
        ],
      };

    case "does not equal":
    case "is not":
    case "does not contain":
      return {
        NOT: {
          OR: [
            {
              collectionsJson: {
                path: "$[*].title",
                array_contains: [normalizedValue],
              },
            },
            {
              collectionsJson: {
                string_contains: normalizedValue,
              },
            },
          ],
        },
      };

    case "is empty":
    case "is empty/blank":
      return {
        OR: [{ collectionsJson: null }, { collectionsJson: { equals: [] } }],
      };

    default:
      return {};
  }
}

function buildProductIdFilter(operator, value) {
  const normalizedValue = normalizeTextValue(value);

  if (!normalizedValue && !isEmptyOperator(operator)) {
    return {};
  }

  const exactId = { id: { equals: normalizedValue } };
  const gidSuffix = { id: { endsWith: `/${normalizedValue}` } };

  switch (operator) {
    case "equals":
    case "is":
      return { OR: [exactId, gidSuffix] };

    case "does not equal":
    case "is not":
      return { NOT: { OR: [exactId, gidSuffix] } };

    case "contains":
      return { id: { contains: normalizedValue } };

    case "does not contain":
      return { NOT: { id: { contains: normalizedValue } } };

    case "starts with":
      return { id: { startsWith: normalizedValue } };

    case "ends with":
      return { OR: [{ id: { endsWith: normalizedValue } }, gidSuffix] };

    case "is empty":
    case "is empty/blank":
      return { OR: [{ id: null }, { id: "" }] };

    case "is not empty":
      return { AND: [{ id: { not: null } }, { NOT: { id: "" } }] };

    default:
      return {};
  }
}

function pushIfValid(target, condition) {
  if (condition && typeof condition === "object" && Object.keys(condition).length > 0) {
    target.push(condition);
  }
}

export function getProductPrismaWhere(filterParams = [], shop) {
  const where = { shop };
  const productAND = [];
  const variantAND = [];

  for (const rawFilter of filterParams) {
    const field = rawFilter?.field;
    const operator = rawFilter?.operator;
    const value = rawFilter?.value;

    if (!field) continue;

    switch (field) {
      case "search":
        pushIfValid(productAND, {
          OR: [
            { title: { contains: value, mode: "insensitive" } },
            { vendor: { contains: value, mode: "insensitive" } },
            { productType: { contains: value, mode: "insensitive" } },
            { handle: { contains: value, mode: "insensitive" } },
            { description: { contains: value, mode: "insensitive" } },
            { categoryName: { contains: value, mode: "insensitive" } },
          ],
        });
        break;

      case "title":
        pushIfValid(productAND, buildPrismaStringFilter("title", operator, value));
        break;
      case "vendor":
        pushIfValid(productAND, buildPrismaStringFilter("vendor", operator, value));
        break;
      case "handle":
        pushIfValid(productAND, buildPrismaStringFilter("handle", operator, value));
        break;
      case "description":
        pushIfValid(productAND, buildPrismaStringFilter("description", operator, value));
        break;
      case "product_type":
        pushIfValid(productAND, buildPrismaStringFilter("productType", operator, value));
        break;
      case "status":
        pushIfValid(productAND, buildPrismaStringFilter("status", operator, String(value).toUpperCase()));
        break;
      case "inventory_q":
        pushIfValid(productAND, buildPrismaNumberFilter("totalInventory", operator, value));
        break;
      case "created_at":
        pushIfValid(productAND, buildPrismaDateFilter("createdAt", operator, value));
        break;
      case "updated_at":
        pushIfValid(productAND, buildPrismaDateFilter("updatedAt", operator, value));
        break;
      case "published_at":
        pushIfValid(productAND, buildPrismaDateFilter("publishedAt", operator, value));
        break;
      case "product_id":
        pushIfValid(productAND, buildProductIdFilter(operator, value));
        break;
      case "category":
        pushIfValid(productAND, buildPrismaStringFilter("categoryName", operator, value));
        break;
      case "tag":
        pushIfValid(productAND, buildPrismaArrayStringFilter("tags", operator, value));
        break;
      case "theme_template":
        pushIfValid(productAND, buildPrismaStringFilter("templateSuffix", operator, value));
        break;
      case "collection":
        pushIfValid(productAND, buildPrismaCollectionFilter(operator, value));
        break;
      case "variant_count":
      case "vc":
        pushIfValid(productAND, buildPrismaNumberFilter("variantCount", operator, value));
        break;
      case "option_name_1":
        pushIfValid(productAND, buildPrismaStringFilter("option1Name", operator, value));
        break;
      case "option_name_2":
        pushIfValid(productAND, buildPrismaStringFilter("option2Name", operator, value));
        break;
      case "option_name_3":
        pushIfValid(productAND, buildPrismaStringFilter("option3Name", operator, value));
        break;
      case "visible_online_store":
        pushIfValid(productAND, buildPrismaBooleanFilter("visibleOnlineStore", operator, value));
        break;
      case "googleShoppingEnabled":
      case "google_shopping_enabled":
        pushIfValid(productAND, buildPrismaBooleanFilter("googleShoppingEnabled", operator, value));
        break;
      case "googleShoppingAgeGroup":
      case "google_shopping_age_group":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingAgeGroup", operator, value));
        break;
      case "googleShoppingCategory":
      case "google_shopping_category":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingCategory", operator, value));
        break;
      case "googleShoppingColor":
      case "google_shopping_color":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingColor", operator, value));
        break;
      case "googleShoppingCondition":
      case "google_shopping_condition":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingCondition", operator, value));
        break;
      case "googleShoppingCustomLabel0":
      case "google_shopping_custom_label_0":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingCustomLabel0", operator, value));
        break;
      case "googleShoppingCustomLabel1":
      case "google_shopping_custom_label_1":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingCustomLabel1", operator, value));
        break;
      case "googleShoppingCustomLabel2":
      case "google_shopping_custom_label_2":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingCustomLabel2", operator, value));
        break;
      case "googleShoppingCustomLabel3":
      case "google_shopping_custom_label_3":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingCustomLabel3", operator, value));
        break;
      case "googleShoppingCustomLabel4":
      case "google_shopping_custom_label_4":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingCustomLabel4", operator, value));
        break;
      case "googleShoppingCustomProduct":
      case "google_shopping_custom_product":
        pushIfValid(productAND, buildPrismaBooleanFilter("googleShoppingCustomProduct", operator, value));
        break;
      case "googleShoppingGender":
      case "google_shopping_gender":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingGender", operator, value));
        break;
      case "googleShoppingMpn":
      case "google_shopping_mpn":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingMpn", operator, value));
        break;
      case "googleShoppingMaterial":
      case "google_shopping_material":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingMaterial", operator, value));
        break;
      case "googleShoppingSize":
      case "google_shopping_size":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingSize", operator, value));
        break;
      case "googleShoppingSizeSystem":
      case "google_shopping_size_system":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingSizeSystem", operator, value));
        break;
      case "googleShoppingSizeType":
      case "google_shopping_size_type":
        pushIfValid(productAND, buildPrismaStringFilter("googleShoppingSizeType", operator, value));
        break;
      case "categoryAgeGroup":
      case "category_age_group":
        pushIfValid(productAND, buildPrismaStringFilter("categoryAgeGroup", operator, value));
        break;
      case "categoryColor":
      case "category_color":
        pushIfValid(productAND, buildPrismaStringFilter("categoryColor", operator, value));
        break;
      case "categoryFabric":
      case "category_fabric":
        pushIfValid(productAND, buildPrismaStringFilter("categoryFabric", operator, value));
        break;
      case "categoryFit":
      case "category_fit":
        pushIfValid(productAND, buildPrismaStringFilter("categoryFit", operator, value));
        break;
      case "categorySize":
      case "category_size":
        pushIfValid(productAND, buildPrismaStringFilter("categorySize", operator, value));
        break;
      case "categoryTargetGender":
      case "category_target_gender":
        pushIfValid(productAND, buildPrismaStringFilter("categoryTargetGender", operator, value));
        break;
      case "categoryWaistRise":
      case "category_waist_rise":
        pushIfValid(productAND, buildPrismaStringFilter("categoryWaistRise", operator, value));
        break;

      case "sku":
        pushIfValid(variantAND, buildPrismaStringFilter("sku", operator, value));
        break;
      case "barcode":
        pushIfValid(variantAND, buildPrismaStringFilter("barcode", operator, value));
        break;
      case "variant_title":
        pushIfValid(variantAND, buildPrismaStringFilter("title", operator, value));
        break;
      case "price":
        pushIfValid(variantAND, buildPrismaNumberFilter("price", operator, value));
        break;
      case "compare_at_price":
        pushIfValid(variantAND, buildPrismaNumberFilter("compareAtPrice", operator, value));
        break;
      case "variant_inventory_q":
        pushIfValid(variantAND, buildPrismaNumberFilter("inventoryQuantity", operator, value));
        break;
      case "charge_tax":
        pushIfValid(variantAND, buildPrismaBooleanFilter("taxable", operator, value));
        break;
      case "cost":
        pushIfValid(variantAND, buildPrismaNumberFilter("cost", operator, value));
        break;
      case "country_of_origin":
        pushIfValid(variantAND, buildPrismaStringFilter("countryOfOrigin", operator, value));
        break;
      case "hs_tariff_code":
        pushIfValid(variantAND, buildPrismaStringFilter("hsTariffCode", operator, value));
        break;
      case "inventory_policy":
      case "inventory_out_of_stock_policy":
        pushIfValid(variantAND, buildPrismaStringFilter("inventoryPolicy", operator, value));
        break;
      case "option_value_1":
        pushIfValid(variantAND, buildPrismaStringFilter("option1Value", operator, value));
        break;
      case "option_value_2":
        pushIfValid(variantAND, buildPrismaStringFilter("option2Value", operator, value));
        break;
      case "option_value_3":
        pushIfValid(variantAND, buildPrismaStringFilter("option3Value", operator, value));
        break;
      case "physical_product":
        pushIfValid(variantAND, buildPrismaBooleanFilter("physicalProduct", operator, value));
        break;
      case "track_quantity":
        pushIfValid(variantAND, buildPrismaBooleanFilter("tracked", operator, value));
        break;
      case "profit_margin":
        pushIfValid(variantAND, buildPrismaNumberFilter("profitMargin", operator, value));
        break;
      case "weight":
        pushIfValid(variantAND, buildPrismaNumberFilter("weight", operator, value));
        break;
      case "weight_unit":
        pushIfValid(variantAND, buildPrismaStringFilter("weightUnit", operator, value));
        break;
      case "seo":
      case "seo_visibility":
        if (value === "true") {
          pushIfValid(productAND, {
            OR: [{ seoTitle: { not: null } }, { seoDescription: { not: null } }],
          });
        } else {
          pushIfValid(productAND, {
            AND: [{ seoTitle: null }, { seoDescription: null }],
          });
        }
        break;
      default:
        break;
    }
  }

  if (variantAND.length > 0) {
    productAND.push({
      variants: {
        some: variantAND.length === 1 ? variantAND[0] : { AND: variantAND },
      },
    });
  }

  if (productAND.length > 0) {
    where.AND = productAND;
  }

  return where;
}
