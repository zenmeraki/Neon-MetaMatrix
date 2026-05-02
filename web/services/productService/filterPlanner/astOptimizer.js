import { getFilterFieldConfig } from "../../filterPlanner/filterRegistry.js";
import { OPERATOR_COST } from "../../filterPlanner/filterOperators.js";

const FIELD_BASE_SELECTIVITY = {
  product_id: 0.001,
  id: 0.001,
  sku: 0.005,
  barcode: 0.005,
  handle: 0.01,

  title: 0.2,
  vendor: 0.12,
  product_type: 0.12,
  productType: 0.12,
  status: 0.33,
  collection: 0.15,
  tag: 0.18,

  price: 0.25,
  compare_at_price: 0.3,
  compareAtPrice: 0.3,
  inventory_q: 0.25,
  variant_inventory_q: 0.25,

  created_at: 0.35,
  createdAt: 0.35,
  updated_at: 0.4,
  updatedAt: 0.4,
  published_at: 0.35,
  publishedAt: 0.35,

  search: 0.5,
};

function normalizeOperator(operator) {
  return String(operator || "").trim().toLowerCase();
}

function getNodeKind(node) {
  if (!node) return "unknown";
  if (node.type === "condition" || node.type === "PREDICATE") return "condition";
  if (node.type === "group" || node.type === "AND" || node.type === "OR") return "group";
  return "unknown";
}

function getNodeCombinator(node) {
  if (!node) return "AND";
  return String(node.combinator || node.type || "AND").toUpperCase();
}

function computeOrSelectivity(children = []) {
  const nonMatchProbability = children.reduce(
    (acc, child) => acc * (1 - (child.optimizer?.selectivity ?? 0.5)),
    1,
  );

  return 1 - nonMatchProbability;
}

function estimatePredicateCost(node) {
  let definition = null;

  try {
    definition = getFilterFieldConfig(node.field);
  } catch {
    definition = null;
  }

  const base =
    FIELD_BASE_SELECTIVITY[node.field] ??
    FIELD_BASE_SELECTIVITY[definition?.postgresColumn] ??
    FIELD_BASE_SELECTIVITY[definition?.prismaField] ??
    FIELD_BASE_SELECTIVITY[definition?.clickhouseColumn] ??
    (typeof definition?.selectivity === "number" ? definition.selectivity : 0.5);

  const operatorCost = OPERATOR_COST[normalizeOperator(node.operator)] ?? 0.5;

  const scopePenalty =
    definition?.domain === "product"
      ? 0
      : definition?.domain === "variant"
        ? 0.08
        : definition?.domain === "collection"
          ? 0.15
          : 0.1;

  return Math.min(base * operatorCost + scopePenalty, 1);
}

function optimizeNode(node, trace = null, path = "root") {
  if (!node) return null;

  const kind = getNodeKind(node);

  if (kind === "condition") {
    const selectivity = estimatePredicateCost(node);
    trace?.push({
      path,
      type: "condition",
      field: node.field,
      operator: node.operator,
      selectivity,
    });

    return {
      ...node,
      optimizer: {
        selectivity,
      },
      meta: {
        ...(node.meta || {}),
        selectivity: selectivity,
      },
    };
  }

  if (kind !== "group") {
    throw new Error(`Unsupported AST node type for optimization: ${node.type}`);
  }

  const optimizedChildren = (node.children || [])
    .map((child, index) => optimizeNode(child, trace, `${path}.children[${index}]`))
    .filter(Boolean);
  const combinator = getNodeCombinator(node);

  if (combinator === "AND") {
    optimizedChildren.sort((a, b) => {
      const aCost = a.optimizer?.selectivity ?? 0.5;
      const bCost = b.optimizer?.selectivity ?? 0.5;
      return aCost - bCost;
    });
  }

  if (combinator === "OR") {
    optimizedChildren.sort((a, b) => {
      const aCost = a.optimizer?.selectivity ?? 0.5;
      const bCost = b.optimizer?.selectivity ?? 0.5;
      return bCost - aCost;
    });
  }

  const selectivity =
    combinator === "AND"
      ? optimizedChildren.reduce(
          (acc, child) => acc * (child.optimizer?.selectivity ?? 0.5),
          1,
        )
      : computeOrSelectivity(optimizedChildren);

  trace?.push({
    path,
    type: "group",
    combinator,
    childCount: optimizedChildren.length,
    selectivity,
  });

  return {
    ...node,
    type: node.type === "AND" || node.type === "OR" ? combinator : node.type,
    combinator,
    children: optimizedChildren,
    optimizer: {
      selectivity,
    },
    meta: {
      ...(node.meta || {}),
      selectivity,
    },
  };
}

export function optimizeFilterAst(ast, options = {}) {
  const trace = options?.trace ? [] : null;
  const optimizedAst = optimizeNode(ast, trace);

  if (options?.trace) {
    return {
      ast: optimizedAst,
      trace,
    };
  }

  return optimizedAst;
}
