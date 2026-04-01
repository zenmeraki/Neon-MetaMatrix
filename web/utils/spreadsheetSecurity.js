const DANGEROUS_PREFIX_PATTERN = /^[=+\-@\t\r]/;
const SAFE_FILENAME_PATTERN = /[^a-zA-Z0-9._-]/g;
const MAX_FILENAME_LENGTH = 80;

export function sanitizeForSpreadsheetCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  return DANGEROUS_PREFIX_PATTERN.test(stringValue)
    ? `'${stringValue}`
    : stringValue;
}

export function sanitizeCsvFilename(value, fallback = "export.csv") {
  const raw = String(value || "").trim();
  const normalized = (raw || fallback)
    .replace(SAFE_FILENAME_PATTERN, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, MAX_FILENAME_LENGTH);

  const baseName = normalized || fallback;
  return baseName.toLowerCase().endsWith(".csv")
    ? baseName
    : `${baseName}.csv`;
}
