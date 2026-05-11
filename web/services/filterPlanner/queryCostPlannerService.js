const HIGH_SCAN_THRESHOLD = 1_000_000;
const MEDIUM_SCAN_THRESHOLD = 100_000;

export function classifyQueryCost(estimatedRows = 0) {
  const rows = Number(estimatedRows || 0);

  if (rows >= HIGH_SCAN_THRESHOLD) return "HIGH";
  if (rows >= MEDIUM_SCAN_THRESHOLD) return "MEDIUM";
  return "LOW";
}

export function orderPredicatesBySelectivity(predicates = []) {
  return [...predicates].sort((left, right) => {
    const leftRows = Number(left?.estimatedRows ?? Number.MAX_SAFE_INTEGER);
    const rightRows = Number(right?.estimatedRows ?? Number.MAX_SAFE_INTEGER);
    return leftRows - rightRows;
  });
}

export function choosePlanner({ estimatedRows = 0, hasClickHouse = false }) {
  const queryCost = classifyQueryCost(estimatedRows);

  return {
    queryCost,
    estimatedScanRows: Number(estimatedRows || 0),
    engine: hasClickHouse && queryCost === "HIGH" ? "CLICKHOUSE" : "POSTGRES",
  };
}
