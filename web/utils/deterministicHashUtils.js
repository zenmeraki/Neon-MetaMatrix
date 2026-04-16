import crypto from "crypto";

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = stableNormalize(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

export function sha256Hex(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

export function buildCanonicalFilterKey({
  shop,
  mirrorBatchId,
  filterParams = [],
  explicitProductIds = [],
  queryWhere = null,
  filterVersion = 1,
}) {
  return sha256Hex({
    shop,
    mirrorBatchId: mirrorBatchId || null,
    filterParams,
    explicitProductIds: [...new Set(explicitProductIds.filter(Boolean))].sort(),
    queryWhere,
    filterVersion,
  });
}

export function buildRulesHash(rules = []) {
  return sha256Hex({
    rules: Array.isArray(rules) ? rules : [],
    ruleEngineVersion: "product-set-v1",
  });
}
