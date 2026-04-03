import {
  getFilterFieldDefinition,
  normalizeCanonicalFilterParams,
} from "./productFilterContract.js";

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
  const variantAND = [];
  const normalizedFilters = normalizeCanonicalFilterParams(filterParams);

  function pushProductClause(clause) {
    if (clause && Object.keys(clause).length > 0) {
      AND.push(clause);
    }
  }

  function pushVariantClause(clause) {
    if (clause && Object.keys(clause).length > 0) {
      variantAND.push(clause);
    }
  }

  for (const rawFilter of normalizedFilters) {
    const field = rawFilter.field;
    const operator = rawFilter.operator;
    const value = rawFilter.value;
    const definition = getFilterFieldDefinition(field);

    if (!field || !definition) continue;

    switch (field) {
      case "search":
        pushProductClause({
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

      case "collection":
      case "seo":
        if (value === "true") {
          pushProductClause({
            OR: [{ seoTitle: { not: null } }, { seoDescription: { not: null } }],
          });
        } else {
          pushProductClause({
            AND: [{ seoTitle: null }, { seoDescription: null }],
          });
        }
        break;
      default: {
        let clause = {};

        switch (definition.type) {
          case "string":
            clause = buildPrismaStringFilter(definition.prismaField, operator, value);
            break;
          case "number":
            clause = buildPrismaNumberFilter(definition.prismaField, operator, value);
            break;
          case "boolean":
            clause = buildPrismaBooleanFilter(definition.prismaField, operator, value);
            break;
          case "date":
            clause = buildPrismaDateFilter(definition.prismaField, operator, value);
            break;
          case "array_string":
            clause = buildPrismaArrayStringFilter(
              definition.prismaField,
              operator,
              value,
            );
            break;
          case "collection":
            clause = buildPrismaCollectionFilter(operator, value);
            break;
          default:
            clause = {};
            break;
        }

        if (definition.scope === "variant") {
          pushVariantClause(clause);
        } else {
          pushProductClause(clause);
        }
        break;
      }

    }
  }

  if (variantAND.length > 0) {
    AND.push({
      variants: {
        some:
          variantAND.length === 1
            ? variantAND[0]
            : { AND: variantAND },
      },
    });
  }

  if (AND.length > 0) {
    where.AND = AND;
  }

  return where;
}
