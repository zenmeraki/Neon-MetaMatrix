import axios from "axios";
import FormData from "form-data";

export async function uploadToShopifyStagedTarget(target, content) {
  if (!target?.url || !Array.isArray(target?.parameters)) {
    throw new Error("INVALID_STAGED_UPLOAD_TARGET");
  }

  const payload =
    typeof content === "string"
      ? content
      : Array.isArray(content)
      ? content.map((row) => JSON.stringify(row)).join("\n")
      : "";

  if (!payload.trim()) {
    throw new Error("EMPTY_BULK_MUTATION_JSONL_PAYLOAD");
  }

  const form = new FormData();

  for (const param of target.parameters) {
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
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const key = target.parameters.find((item) => item.name === "key")?.value;

    if (!key) {
      throw new Error("STAGED_UPLOAD_KEY_MISSING");
    }

    return key;
  } catch (error) {
    console.error("Shopify staged upload failed", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
    });

    throw new Error(
      `Upload to staged target failed: ${
        error.response?.status || error.message
      }`
    );
  }
}