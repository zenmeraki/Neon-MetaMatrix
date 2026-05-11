function normalizeCanonical(value) {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCanonical(item));
  }

  if (typeof value === "object") {
    const normalized = {};
    const keys = Object.keys(value).sort();

    for (const key of keys) {
      normalized[key] = normalizeCanonical(value[key]);
    }

    return normalized;
  }

  return value;
}

export function stableCanonicalStringify(value) {
  return JSON.stringify(normalizeCanonical(value));
}

