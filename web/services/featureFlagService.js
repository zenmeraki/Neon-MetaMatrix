function normalizeFlagName(name) {
  return String(name || "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
}

export const featureFlags = {
  isEnabled(name, defaultValue = false) {
    const key = `FEATURE_${normalizeFlagName(name)}`;
    const value = process.env[key];

    if (value === undefined) return defaultValue;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
  },

  get newBulkEngine() {
    return this.isEnabled("newBulkEngine", false);
  },

  get shadowBulkEngine() {
    return this.isEnabled("shadowBulkEngine", false);
  },
};
