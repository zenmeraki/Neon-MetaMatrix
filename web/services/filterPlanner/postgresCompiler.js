import { FILTER_FIELD_REGISTRY } from "./filterRegistry.js";

const EMPTY_STRING_OPERATORS = new Set([
  "is empty",
  "is empty/blank",
  "is not empty",
]);

const FLOAT_EQUALITY_EPSILON = 0.000001;

function requireField(field) {
  const config = FILTER_FIELD_REGISTRY[field];

  if (!config) {
    throw new Error(`Unsupported filter field: ${field}`);
  }

  return config;
}

function requireStringValue(column, value, operator) {
  if (value !== null && typeof value === "object") {
    throw new Error(`Invalid string value for ${column}`);
  }

  const v = String(value ?? "").trim();

  if (!v && !EMPTY_STRING_OPERATORS.has(operator)) {
    throw new Error(`Value required for ${column}`);
  }

  return v;
}

function buildStringFilter(column, operator, value) {
  if (operator === "in") {
    const values = Array.isArray(value)
      ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];

    if (!values.length) {
      throw new Error(`IN filter requires values for ${column}`);
    }

    return {
      OR: values.map((item) => ({
        [column]: { equals: item, mode: "insensitive" },
      })),
    };
  }

  const v = requireStringValue(column, value, operator);

  switch (operator) {
    case "equals":
    case "is":
      return { [column]: { equals: v, mode: "insensitive" } };

    case "is not":
    case "does not equal":
      return { NOT: { [column]: { equals: v, mode: "insensitive" } } };

    case "contains":
      return { [column]: { contains: v, mode: "insensitive" } };

    case "does not contain":
      return { NOT: { [column]: { contains: v, mode: "insensitive" } } };

    case "starts with":
      return { [column]: { startsWith: v, mode: "insensitive" } };

    case "ends with":
      return { [column]: { endsWith: v, mode: "insensitive" } };

    case "is empty":
    case "is empty/blank":
      return { OR: [{ [column]: null }, { [column]: "" }] };

    case "is not empty":
      return {
        AND: [{ [column]: { not: null } }, { NOT: { [column]: "" } }],
      };

    default:
      throw new Error(`Unsupported string operator: ${operator}`);
  }
}

function buildNumberEqualityFilter(column, num, negate = false) {
  if (Number.isInteger(num)) {
    return negate
      ? { NOT: { [column]: { equals: num } } }
      : { [column]: { equals: num } };
  }

  const range = {
    AND: [
      { [column]: { gte: num - FLOAT_EQUALITY_EPSILON } },
      { [column]: { lte: num + FLOAT_EQUALITY_EPSILON } },
    ],
  };

  return negate ? { NOT: range } : range;
}

function buildNumberFilter(column, operator, value) {
  if (operator === "in") {
    const values = Array.isArray(value)
      ? value
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item))
      : [];

    if (!values.length) {
      throw new Error(`IN filter requires numeric values for ${column}`);
    }

    return {
      [column]: {
        in: values,
      },
    };
  }

  if (EMPTY_STRING_OPERATORS.has(operator)) {
    if (operator === "is not empty") {
      return { [column]: { not: null } };
    }

    return { [column]: null };
  }

  const num = Number(value);

  if (!Number.isFinite(num)) {
    throw new Error(`Invalid number for ${column}: ${value}`);
  }

  switch (operator) {
    case "<":
    case "less than":
      return { [column]: { lt: num } };
    case "<=":
    case "less than or equal":
      return { [column]: { lte: num } };
    case ">":
    case "greater than":
      return { [column]: { gt: num } };
    case ">=":
    case "greater than or equal":
      return { [column]: { gte: num } };
    case "=":
    case "equals":
    case "is":
      return buildNumberEqualityFilter(column, num, false);
    case "!=":
    case "is not":
    case "does not equal":
      return buildNumberEqualityFilter(column, num, true);
    default:
      throw new Error(`Unsupported number operator: ${operator}`);
  }
}

function buildDateFilter(column, operator, value) {
  if (operator === "in") {
    const values = Array.isArray(value)
      ? value
          .map((item) => new Date(item))
          .filter((item) => !Number.isNaN(item.getTime()))
      : [];

    if (!values.length) {
      throw new Error(`IN filter requires date values for ${column}`);
    }

    return {
      OR: values.map((item) => ({
        AND: [
          { [column]: { gte: new Date(`${item.toISOString().slice(0, 10)}T00:00:00.000Z`) } },
          { [column]: { lt: new Date(`${item.toISOString().slice(0, 10)}T23:59:59.999Z`) } },
        ],
      })),
    };
  }

  switch (operator) {
    case "is empty":
    case "is empty/blank":
      return { [column]: null };
    case "is not empty":
      return { [column]: { not: null } };
    default:
      break;
  }

  if (value === undefined || value === null || value === "") {
    throw new Error(`Value required for ${column}`);
  }

  const now = new Date();

  switch (operator) {
    case "is before":
      return { [column]: { lt: new Date(value) } };
    case "is after":
      return { [column]: { gt: new Date(value) } };
    case "is on":
      return {
        AND: [
          { [column]: { gte: new Date(`${value}T00:00:00.000Z`) } },
          { [column]: { lt: new Date(`${value}T23:59:59.999Z`) } },
        ],
      };
    case "is before x days ago": {
      const before = new Date(now);
      before.setDate(now.getDate() - Number(value));
      return { [column]: { lt: before } };
    }
    case "is after x days ago": {
      const after = new Date(now);
      after.setDate(now.getDate() - Number(value));
      return { [column]: { gt: after } };
    }
    default:
      throw new Error(`Unsupported date operator: ${operator}`);
  }
}

function buildCollectionFilter(operator, value) {
  const v = requireStringValue("collection", value, operator);

  switch (operator) {
    case "equals":
    case "is":
      return {
        collections: {
          some: {
            collection: { title: { equals: v, mode: "insensitive" } },
          },
        },
      };
    case "contains":
      return {
        collections: {
          some: {
            collection: { title: { contains: v, mode: "insensitive" } },
          },
        },
      };
    case "does not equal":
    case "is not":
      return {
        NOT: {
          collections: {
            some: {
              collection: { title: { equals: v, mode: "insensitive" } },
            },
          },
        },
      };
    case "does not contain":
      return {
        NOT: {
          collections: {
            some: {
              collection: { title: { contains: v, mode: "insensitive" } },
            },
          },
        },
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

function buildScalarFilter(config, node) {
  if (config.type === "number") {
    return buildNumberFilter(config.postgresColumn, node.operator, node.value);
  }

  if (config.type === "date") {
    return buildDateFilter(config.prismaField || config.postgresColumn, node.operator, node.value);
  }

  return buildStringFilter(config.prismaField || config.postgresColumn, node.operator, node.value);
}

function compilePredicateToPostgres(node, context) {
  const config = requireField(node.field);

  if (config.domain === "variant") {
    const inner = buildScalarFilter(config, node);

    return {
      variants: {
        some: {
          shop: context.shop,
          mirrorBatchId: context.mirrorBatchId,
          ...inner,
        },
      },
    };
  }

  if (config.domain === "collection") {
    return buildCollectionFilter(node.operator, node.value);
  }

  return buildScalarFilter(config, node);
}

function extractVariantSomeFilter(node, context) {
  const payload = node?.variants?.some;

  if (
    !payload ||
    payload.shop !== context.shop ||
    payload.mirrorBatchId !== context.mirrorBatchId
  ) {
    return null;
  }

  const { shop, mirrorBatchId, ...inner } = payload;
  void shop;
  void mirrorBatchId;

  return inner;
}

function coalesceVariantAndChildren(children, context) {
  const passthrough = [];
  const variantInnerFilters = [];

  for (const child of children) {
    const variantFilter = extractVariantSomeFilter(child, context);

    if (variantFilter) {
      variantInnerFilters.push(variantFilter);
      continue;
    }

    passthrough.push(child);
  }

  if (!variantInnerFilters.length) {
    return passthrough;
  }

  passthrough.push({
    variants: {
      some: {
        shop: context.shop,
        mirrorBatchId: context.mirrorBatchId,
        ...(variantInnerFilters.length === 1
          ? variantInnerFilters[0]
          : { AND: variantInnerFilters }),
      },
    },
  });

  return passthrough;
}

function compileNode(node, context) {
  if (!node || typeof node !== "object") {
    throw new Error("AST node is required");
  }

  if (node.type === "PREDICATE") {
    return compilePredicateToPostgres(node, context);
  }

  if (node.type === "AND" || node.type === "OR") {
    if (!Array.isArray(node.children)) {
      throw new Error(`AST ${node.type} node must include children`);
    }

    const compiledChildren = node.children.map((child) => compileNode(child, context));
    const normalizedChildren =
      node.type === "AND"
        ? coalesceVariantAndChildren(compiledChildren, context)
        : compiledChildren;
    return { [node.type]: normalizedChildren };
  }

  throw new Error(`Unsupported AST node type: ${node.type}`);
}

export function compileAstToPostgresWhere({ ast, shop, mirrorBatchId }) {
  if (!shop) throw new Error("shop is required");
  if (!mirrorBatchId) throw new Error("mirrorBatchId is required");

  const compiled = compileNode(ast || { type: "AND", children: [] }, {
    shop,
    mirrorBatchId,
  });

  if (compiled.AND) {
    return {
      shop,
      mirrorBatchId,
      ...(compiled.AND.length ? { AND: compiled.AND } : {}),
    };
  }

  return {
    shop,
    mirrorBatchId,
    AND: [compiled],
  };
}
