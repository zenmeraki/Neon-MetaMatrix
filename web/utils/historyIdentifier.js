export function normalizeHistoryIdentifier(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      value !== "undefined" &&
      value !== "null"
    ) {
      return value;
    }
  }

  return null;
}
