import axios from "axios";
import FormData from "form-data";

function codedError(code, message = code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function normalizeJsonlPayload(content) {
  let rows;

  if (typeof content === "string") {
    rows = content
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean);
  } else if (Array.isArray(content)) {
    rows = content.map((row) =>
      typeof row === "string" ? row.trim() : JSON.stringify(row),
    );
  } else {
    throw codedError("INVALID_BULK_MUTATION_JSONL_PAYLOAD");
  }

  rows = rows.filter(Boolean);

  if (!rows.length) {
    throw codedError("EMPTY_BULK_MUTATION_JSONL_PAYLOAD");
  }

  return `${rows.join("\n")}\n`;
}

export async function uploadToShopifyStagedTarget(target, content) {
  if (!target?.url || !Array.isArray(target?.parameters)) {
    throw codedError("INVALID_STAGED_UPLOAD_TARGET");
  }

  const payload = normalizeJsonlPayload(content);

  const form = new FormData();

  for (const param of target.parameters) {
    if (!param?.name || param.value == null) {
      throw codedError("INVALID_STAGED_UPLOAD_PARAMETER");
    }

    form.append(param.name, param.value);
  }

  form.append("file", Buffer.from(payload, "utf8"), {
    filename: "products.jsonl",
    contentType: "text/jsonl",
  });

  const headers = {
    ...form.getHeaders(),
    "Content-Length": await new Promise((resolve, reject) => {
      form.getLength((err, length) => {
        if (err) reject(err);
        else resolve(length);
      });
    }),
  };

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
