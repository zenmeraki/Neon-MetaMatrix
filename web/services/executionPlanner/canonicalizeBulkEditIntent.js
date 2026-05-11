import { stableHash } from "../../utils/idempotencyKey.js";

const OPERATOR_ALIASES = Object.freeze({
  op: "eq",
  equals: "eq",
  "==": "eq",
  "===": "eq",
  "!=": "neq",
  "!==": "neq",
  notequals: "neq",
  containsany: "contains_any",
  containsall: "contains_all",
  isempty: "is_empty",
  isnotempty: "is_not_empty",
  greaterthan: "gt",
  greaterthanorequal: "gte",
  lessthan: "lt",
  lessthanorequal: "lte",
});

function normalizeScalar(value) {
  if (typeof value === "boolean") return value;
  if (value === null) return null;
  if (value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.trim();
  return value;
}

function stableSortObject(value) {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => stableSortObject(entry));
    if (normalized.every((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry))) {
      return normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return normalized;
  }
  if (!value || typeof value !== "object") return normalizeScalar(value);

  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = stableSortObject(value[key]);
  }
  return sorted;
}

function normalizeOperator(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, "");
  return OPERATOR_ALIASES[key] || String(raw || "").trim().toLowerCase();
}

function normalizeFilterParams(filterParams = []) {
  const source = Array.isArray(filterParams) ? filterParams : [];
  return source
    .map((f) => ({
      field: String(f?.field || "").trim(),
      operation: normalizeOperator(f?.operation || f?.op),
      value: stableSortObject(f?.value ?? null),
      source: String(f?.source || "").trim() || null,
    }))
    .sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
}

function normalizeActions(actions = []) {
  const source = Array.isArray(actions) ? actions : [];
  return source
    .map((a) => {
      const normalized = stableSortObject(a);
      if (normalized && typeof normalized === "object" && normalized.operation) {
        normalized.operation = stableSortObject({
          ...normalized.operation,
          action: normalizeOperator(normalized.operation.action || normalized.operation.editType),
          editType: normalizeOperator(normalized.operation.editType || normalized.operation.action),
        });
      }
      return normalized;
    })
    .sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
}

export function canonicalizeBulkEditIntent({
  shop,
  filterParams = [],
  actions = [],
  activeMirrorBatchId,
  stableSort = null,
  intentVersion = 1,
} = {}) {
  const canonical = stableSortObject({
    shop: String(shop || "").trim(),
    mirrorBatchId: String(activeMirrorBatchId || "").trim(),
    intentVersion: Number(intentVersion || 1),
    filterAst: normalizeFilterParams(filterParams),
    actionAst: normalizeActions(actions),
    stableSort: stableSortObject(stableSort || { by: "ordinal", direction: "asc" }),
  });

  return {
    canonicalIntentJson: canonical,
    canonicalFilterHash: stableHash(canonical.filterAst || []),
    canonicalActionHash: stableHash(canonical.actionAst || []),
    intentHash: stableHash(canonical),
    filterAst: canonical.filterAst,
    actionAst: canonical.actionAst,
    stableSort: canonical.stableSort,
    mirrorBatchId: canonical.mirrorBatchId,
    intentVersion: canonical.intentVersion,
  };
}
