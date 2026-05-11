import axios from "axios";
import FormData from "form-data";
import { Readable } from "stream";

function codedError(code, message = code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeJsonlRows(content) {
  if (typeof content === "string") {
    return content
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean);
  }

  if (Array.isArray(content)) {
    return content
      .map((row) => (typeof row === "string" ? row.trim() : JSON.stringify(row)))
      .filter(Boolean);
  }

  if (content && Array.isArray(content.lines)) {
    return content.lines
      .map((row) => (typeof row === "string" ? row.trim() : JSON.stringify(row)))
      .filter(Boolean);
  }

  throw codedError("INVALID_BULK_MUTATION_JSONL_PAYLOAD");
}

function buildJsonlUploadSource(content) {
  const rows = normalizeJsonlRows(content);

  if (!rows.length) {
    throw codedError("EMPTY_BULK_MUTATION_JSONL_PAYLOAD");
  }

  const knownLength = rows.reduce(
    (total, row) => total + Buffer.byteLength(row, "utf8") + 1,
    0,
  );

  const stream = Readable.from(
    (function* jsonlGenerator() {
      for (const row of rows) {
        yield `${row}\n`;
      }
    })(),
  );

  return { stream, knownLength };
}

export async function uploadToShopifyStagedTarget(target, content) {
  if (!target?.url || !Array.isArray(target?.parameters)) {
    throw codedError("INVALID_STAGED_UPLOAD_TARGET");
  }

  const payload = buildJsonlUploadSource(content);

  const form = new FormData();

  for (const param of target.parameters) {
    if (!param?.name || param.value == null) {
      throw codedError("INVALID_STAGED_UPLOAD_PARAMETER");
    }

    form.append(param.name, param.value);
  }

  form.append("file", payload.stream, {
    filename: "products.jsonl",
    contentType: "text/jsonl",
    knownLength: payload.knownLength,
  });

  const headers = {
    ...form.getHeaders(),
  };
  const contentLength = await new Promise((resolve) => {
    form.getLength((err, length) => {
      if (err) resolve(null);
      else resolve(length);
    });
  });
  if (Number.isFinite(contentLength) && contentLength > 0) {
    headers["Content-Length"] = contentLength;
  }

  try {
    await axios.post(target.url, form, {
      headers,
      timeout: 120_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const key = target.parameters.find((item) => item.name === "key")?.value;

    if (!key) {
      throw codedError("STAGED_UPLOAD_KEY_MISSING");
    }

    return key;
  } catch (error) {
    if (error?.code?.startsWith?.("STAGED_")) {
      throw error;
    }

    if (
      error?.code === "INVALID_STAGED_UPLOAD_PARAMETER" ||
      error?.code === "INVALID_BULK_MUTATION_JSONL_PAYLOAD" ||
      error?.code === "EMPTY_BULK_MUTATION_JSONL_PAYLOAD"
    ) {
      throw error;
    }

    throw codedError(
      "SHOPIFY_STAGED_UPLOAD_FAILED",
      "Upload to staged target failed",
      {
        status: error?.response?.status || null,
        statusText: error?.response?.statusText || null,
        responseData: error?.response?.data || null,
        message: error?.message || null,
      },
    );
  }
}
