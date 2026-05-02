import { getFilterFieldConfig } from "./filterRegistry.js";

export const CLICKHOUSE_MIN_ROWS = Number(
  process.env.CLICKHOUSE_MIN_ROWS || 25_000,
);
export const EXPORT_CLICKHOUSE_MIN_ROWS = Number(
  process.env.EXPORT_CLICKHOUSE_MIN_ROWS || 5_000,
);
export const FACET_CLICKHOUSE_MIN_ROWS = Number(
  process.env.FACET_CLICKHOUSE_MIN_ROWS || 10_000,
);

function isClickHouseEnabled() {
  return String(process.env.ENABLE_CLICKHOUSE || "").trim().toLowerCase() === "true";
}

function getNodeSelectivity(node) {
  if (!node || typeof node !== "object") {
    return 1;
  }

  if (typeof node.meta?.selectivity === "number" && node.meta.selectivity > 0) {
    return Math.min(node.meta.selectivity, 1);
  }

  const fieldConfig = getFilterFieldConfig(node.field);
  if (typeof fieldConfig?.selectivity === "number" && fieldConfig.selectivity > 0) {
    return Math.min(fieldConfig.selectivity, 1);
  }

  return 0.5;
}

function estimateNodeSelectivity(node) {
  if (!node || typeof node !== "object") {
    return 1;
  }

  if (node.type === "OR" && Array.isArray(node.children)) {
    const childSelectivities = node.children.map((child) => estimateNodeSelectivity(child));
    const nonMatchProbability = childSelectivities.reduce(
      (score, selectivity) => score * (1 - Math.min(Math.max(selectivity, 0), 1)),
      1,
    );

    return Math.min(Math.max(1 - nonMatchProbability, 0), 1);
  }

  if (node.type === "AND" && Array.isArray(node.children)) {
    return node.children.reduce(
      (score, child) => score * estimateNodeSelectivity(child),
      1,
    );
  }

  return getNodeSelectivity(node);
}

export function estimateSelectivity(ast) {
  if (!ast || typeof ast !== "object") return 1;
  return Math.min(Math.max(estimateNodeSelectivity(ast), 0), 1);
}

function normalizeEstimatedTotalRows(estimatedTotalRows) {
  const normalized = Number(estimatedTotalRows);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("estimatedTotalRows must be a non-negative finite number");
  }

  return normalized;
}

export function chooseExecutionEngine({
  ast,
  estimatedTotalRows,
  operation,
  requiresTransactionalFreshness = false,
}) {
  const safeEstimatedTotalRows = normalizeEstimatedTotalRows(estimatedTotalRows);

  if (requiresTransactionalFreshness) {
    return {
      engine: "postgres",
      reason: "transactional_freshness_required",
      estimatedMatchedRows: safeEstimatedTotalRows,
      selectivity: 1,
    };
  }

  const selectivity = estimateSelectivity(ast);
  const estimatedMatchedRows = Math.ceil(safeEstimatedTotalRows * selectivity);

  if (!isClickHouseEnabled()) {
    return {
      engine: "postgres",
      reason: "clickhouse_not_enabled",
      estimatedMatchedRows,
      selectivity,
    };
  }

  if (operation === "export" && estimatedMatchedRows >= EXPORT_CLICKHOUSE_MIN_ROWS) {
    return {
      engine: "clickhouse",
      reason: "large_export",
      estimatedMatchedRows,
      selectivity,
    };
  }

  if (operation === "facet" && estimatedMatchedRows >= FACET_CLICKHOUSE_MIN_ROWS) {
    return {
      engine: "clickhouse",
      reason: "large_facet_query",
      estimatedMatchedRows,
      selectivity,
    };
  }

  if (estimatedMatchedRows >= CLICKHOUSE_MIN_ROWS) {
    return {
      engine: "clickhouse",
      reason: "large_read_query",
      estimatedMatchedRows,
      selectivity,
    };
  }

  return {
    engine: "postgres",
    reason: "small_or_selective_query",
    estimatedMatchedRows,
    selectivity,
  };
}
