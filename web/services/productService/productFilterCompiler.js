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
  switch (operator) {
    case "equals":
    case "is":
      return { [field]: { equals: value, mode: "insensitive" } };

    case "does not equal":
    case "is not":
      return { NOT: { [field]: { equals: value, mode: "insensitive" } } };

    case "contains":
      return { [field]: { contains: value, mode: "insensitive" } };

    case "does not contain":
      return { NOT: { [field]: { contains: value, mode: "insensitive" } } };

    case "starts with":
      return { [field]: { startsWith: value, mode: "insensitive" } };

    case "ends with":
      return { [field]: { endsWith: value, mode: "insensitive" } };

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
  switch (operator) {
    case "contains":
    case "equals":
    case "is":
      return { [field]: { has: value } };

    case "does not contain":
    case "does not equal":
    case "is not":
      return { NOT: { [field]: { has: value } } };

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
  switch (operator) {
    case "equals":
    case "is":
      return {
        collectionsJson: {
          path: "$[*].title",
          array_contains: [value],
        },
      };

    case "contains":
      return {
        OR: [
          {
            collectionsJson: {
              path: "$[*].title",
              array_contains: [value],
            },
          },
          {
            collectionsJson: {
              string_contains: value,
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
                array_contains: [value],
              },
            },
            {
              collectionsJson: {
                string_contains: value,
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

export function getProductPrismaWhere(filterParams = [], shop) {
  const where = { shop };
  const AND = [];

  for (const rawFilter of filterParams) {
    const field = rawFilter?.field;
    const operator = rawFilter?.operator;
    const value = rawFilter?.value;

    if (!field) continue;

    switch (field) {
      case "search":
        AND.push({
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
        AND.push(buildPrismaStringFilter("title", operator, value));
        break;

      case "vendor":
        AND.push(buildPrismaStringFilter("vendor", operator, value));
        break;

      case "handle":
        AND.push(buildPrismaStringFilter("handle", operator, value));
        break;

      case "description":
        AND.push(buildPrismaStringFilter("description", operator, value));
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
        AND.push({
          variants: {
            some: buildPrismaStringFilter("sku", operator, value),
          },
        });
        break;

      case "barcode":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("barcode", operator, value),
          },
        });
        break;

      case "variant_title":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("title", operator, value),
          },
        });
        break;

      case "price":
        AND.push({
          variants: {
            some: buildPrismaNumberFilter("price", operator, value),
          },
        });
        break;

      case "compare_at_price":
        AND.push({
          variants: {
            some: buildPrismaNumberFilter("compareAtPrice", operator, value),
          },
        });
        break;

      case "variant_inventory_q":
        AND.push({
          variants: {
            some: buildPrismaNumberFilter("inventoryQuantity", operator, value),
          },
        });
        break;

      case "charge_tax":
        AND.push({
          variants: {
            some: buildPrismaBooleanFilter("taxable", operator, value),
          },
        });
        break;

      case "cost":
        AND.push({
          variants: {
            some: buildPrismaNumberFilter("cost", operator, value),
          },
        });
        break;

      case "country_of_origin":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("countryOfOrigin", operator, value),
          },
        });
        break;

      case "hs_tariff_code":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("hsTariffCode", operator, value),
          },
        });
        break;

      case "inventory_policy":
      case "inventory_out_of_stock_policy":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("inventoryPolicy", operator, value),
          },
        });
        break;

      case "option_value_1":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("option1Value", operator, value),
          },
        });
        break;

      case "option_value_2":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("option2Value", operator, value),
          },
        });
        break;

      case "option_value_3":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("option3Value", operator, value),
          },
        });
        break;

      case "physical_product":
        AND.push({
          variants: {
            some: buildPrismaBooleanFilter("physicalProduct", operator, value),
          },
        });
        break;

      case "track_quantity":
        AND.push({
          variants: {
            some: buildPrismaBooleanFilter("tracked", operator, value),
          },
        });
        break;

      case "seo":
      case "seo_visibility":
        if (value === "true") {
          AND.push({
            OR: [{ seoTitle: { not: null } }, { seoDescription: { not: null } }],
          });
        } else {
          AND.push({
            AND: [{ seoTitle: null }, { seoDescription: null }],
          });
        }
        break;

      case "profit_margin":
        AND.push({
          variants: {
            some: buildPrismaNumberFilter("profitMargin", operator, value),
          },
        });
        break;

      case "weight":
        AND.push({
          variants: {
            some: buildPrismaNumberFilter("weight", operator, value),
          },
        });
        break;

      case "weight_unit":
        AND.push({
          variants: {
            some: buildPrismaStringFilter("weightUnit", operator, value),
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