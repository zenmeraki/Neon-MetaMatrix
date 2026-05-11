export function formatTelemetryNumber(value, locale) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString(locale) : "0";
}

export function formatTelemetryPercent(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0.0%";
  return `${num.toFixed(1)}%`;
}

export function formatTelemetryEta(etaLabel) {
  return etaLabel || "--";
}

export function formatTelemetryThroughput(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return num.toLocaleString();
}

export function normalizeTelemetryPhase(phase) {
  const raw = String(phase || "PENDING").toUpperCase();
  if (raw === "VERIFYING") return "FINALIZING";
  return raw;
}

export function getApiHealthTone(health) {
  const value = String(health || "").toUpperCase();
  if (value === "GOOD") return "success";
  if (value === "FAIR") return "attention";
  if (value === "DEGRADED" || value === "STOPPED") return "warning";
  return "info";
}

export function getSafetyShieldBadges(telemetry = {}) {
  const badges = [];
  if (telemetry.safeToCloseTab) {
    badges.push({ tone: "success", label: "SAFE TO CLOSE TAB" });
  }
  if (telemetry.undoSnapshot === "VERIFIED") {
    badges.push({ tone: "success", label: "UNDO SNAPSHOT VERIFIED" });
  }
  if (telemetry.throttlingDetected) {
    badges.push({ tone: "warning", label: "SHOPIFY THROTTLING DETECTED" });
  }
  if (telemetry.autoRecoveryActive) {
    badges.push({ tone: "info", label: "AUTO-RECOVERY ACTIVE" });
  }
  return badges;
}
