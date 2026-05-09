import { stableHash } from "../../utils/idempotencyKey.js";

function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortObject(entry));
  }
  if (!value || typeof value !== "object") return value;

  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = stableSortObject(value[key]);
  }
  return sorted;
}

function normalizeFilterParams(filterParams = []) {
  const source = Array.isArray(filterParams) ? filterParams : [];
  return source
    .map((f) => ({
      field: String(f?.field || "").trim(),
      operation: String(f?.operation || f?.op || "").trim(),
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
    .map((a) => stableSortObject(a))
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
