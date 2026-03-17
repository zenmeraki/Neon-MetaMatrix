import axios from "axios";
import FormData from "form-data";

export async function uploadToShopifyStagedTarget(target, content) {
  const form = new FormData();

  try {
    // Add all parameters required by Shopify's staged upload target
    target.parameters.forEach((param) => {
      form.append(param.name, param.value);
    });

    // Attach the file buffer
    form.append("file", Buffer.from(content), {
      filename: "products.jsonl",
      contentType: "text/jsonl",
    });

    // Attempt the upload
    const response = await axios.post(target.url, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return target.parameters?.find((item) => item.name == "key").value; // or return success status if needed
  } catch (error) {
    if (error.response) {
      // Shopify or S3 returned an error
    } else if (error.request) {
      // Request was made but no response
    } else {
      // Something else went wrong
    }

    throw new Error("Upload to staged target failed. See logs for details.");
  }
}
export const generateCron = (date) => {
      const d = new Date(date);
      return `${d.getUTCMinutes()} ${d.getUTCHours()} ${d.getUTCDate()} ${d.getUTCMonth() + 1
        } *`;
    };
