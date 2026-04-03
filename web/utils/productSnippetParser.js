export function parseProductSnippetCode(code) {
  const trimmedCode = String(code || "").trim();
  if (!trimmedCode) {
    throw new Error("Snippet code is required");
  }

  try {
    const parsed = JSON.parse(trimmedCode);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Snippet root must be a JSON object");
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid snippet JSON: ${error.message}`);
    }

    throw error;
  }
}
