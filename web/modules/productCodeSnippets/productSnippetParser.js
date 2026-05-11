function codedError(code, message = code, meta = undefined) {
  const error = new Error(message);
  error.code = code;
  if (meta !== undefined) error.meta = meta;
  return error;
}

export function parseProductSnippetCode(code) {
  const trimmedCode = String(code || "").trim();
  if (!trimmedCode) {
    throw codedError("SNIPPET_CODE_REQUIRED");
  }

  try {
    const parsed = JSON.parse(trimmedCode);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw codedError("SNIPPET_ROOT_OBJECT_REQUIRED");
    }

    return parsed;
  } catch (error) {
    if (error?.code) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw codedError("SNIPPET_INVALID_JSON", "Invalid snippet JSON", {
        message: error.message,
      });
    }

    throw codedError("SNIPPET_PARSE_FAILED", "Snippet parse failed");
  }
}
