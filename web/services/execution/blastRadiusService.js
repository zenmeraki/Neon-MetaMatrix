const DEFAULT_HIGH_RISK_THRESHOLD = Math.max(
  Number(process.env.BLAST_RADIUS_HIGH_RISK_THRESHOLD || 80),
  1,
);

const BULK_EDIT_CRITICAL_FIELDS = new Set([
  "price",
  "compareAtPrice",
  "status",
  "inventoryPolicy",
  "inventory",
  "taxable",
]);

const EXPORT_CRITICAL_FIELDS = new Set([
  "price",
  "compareAtPrice",
  "status",
  "inventoryQuantity",
  "inventoryPolicy",
  "costPerItem",
]);

function toUniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

function normalizeRiskReasons(reasons = []) {
  return toUniqueStrings(reasons).slice(0, 10);
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function hasGlobalScope(filterParams = []) {
  return !Array.isArray(filterParams) || filterParams.length === 0;
}

function buildEditBlastRadius({
  targetCount = 0,
  field = "",
  filterParams = [],
  threshold = DEFAULT_HIGH_RISK_THRESHOLD,
}) {
  const normalizedField = String(field || "").trim();
  const criticalFields = BULK_EDIT_CRITICAL_FIELDS.has(normalizedField)
    ? [normalizedField]
    : [];
  const reasons = [];
  let score = 0;
  const productsAffected = Math.max(Number(targetCount || 0), 0);
  const variantsAffected = productsAffected;

  if (productsAffected >= 100_000) {
    score += 60;
    reasons.push("target_count_extreme");
  } else if (productsAffected >= 25_000) {
    score += 45;
    reasons.push("target_count_very_high");
  } else if (productsAffected >= 10_000) {
    score += 35;
    reasons.push("target_count_high");
  } else if (productsAffected >= 2_000) {
    score += 20;
    reasons.push("target_count_medium");
  } else if (productsAffected >= 500) {
    score += 10;
    reasons.push("target_count_elevated");
  }

  if (criticalFields.length > 0) {
    score += 35;
    reasons.push("critical_field_mutation");
  }

  if (hasGlobalScope(filterParams)) {
    score += 15;
    reasons.push("global_scope_without_filters");
  }

  const riskScore = clampScore(score);
  return {
    productsAffected,
    variantsAffected,
    criticalFields,
    riskScore,
    reasons: normalizeRiskReasons(reasons),
    threshold,
    requiresExplicitConfirmation: riskScore >= threshold,
  };
}

function buildExportBlastRadius({
  targetCount = 0,
  fields = [],
  filterParams = [],
  threshold = DEFAULT_HIGH_RISK_THRESHOLD,
}) {
  const selectedFields = toUniqueStrings(fields);
  const criticalFields = selectedFields.filter((field) =>
    EXPORT_CRITICAL_FIELDS.has(field),
  );
  const reasons = [];
  let score = 0;
  const productsAffected = Math.max(Number(targetCount || 0), 0);
  const variantsAffected = productsAffected;

  if (productsAffected >= 250_000) {
    score += 55;
    reasons.push("export_target_extreme");
  } else if (productsAffected >= 100_000) {
    score += 40;
    reasons.push("export_target_very_high");
  } else if (productsAffected >= 25_000) {
    score += 25;
    reasons.push("export_target_high");
  } else if (productsAffected >= 10_000) {
    score += 15;
    reasons.push("export_target_medium");
  }

  if (selectedFields.length >= 25) {
    score += 20;
    reasons.push("wide_export_field_set");
  } else if (selectedFields.length >= 12) {
    score += 10;
    reasons.push("moderate_export_field_set");
  }

  if (criticalFields.length > 0) {
    score += 20;
    reasons.push("critical_fields_in_export");
  }

  if (hasGlobalScope(filterParams)) {
    score += 10;
    reasons.push("global_scope_without_filters");
  }

  const riskScore = clampScore(score);
  return {
    productsAffected,
    variantsAffected,
    criticalFields,
    riskScore,
    reasons: normalizeRiskReasons(reasons),
    threshold,
    requiresExplicitConfirmation: riskScore >= threshold,
  };
}

function isHighRiskConfirmed(value) {
  if (value === true) return true;
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "CONFIRM_HIGH_RISK";
}

export const blastRadiusService = {
  buildEditBlastRadius,
  buildExportBlastRadius,
  isHighRiskConfirmed,
  getHighRiskThreshold() {
    return DEFAULT_HIGH_RISK_THRESHOLD;
  },
};

