import axios from "axios";
import fs from "fs";
import FormData from "form-data";

function getStagedUploadKey(target) {
  return target.parameters?.find((item) => item.name === "key")?.value;
}

async function postStagedUpload(target, form) {
  await axios.post(target.url, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  return getStagedUploadKey(target);
}

export async function uploadToShopifyStagedTarget(target, content) {
  const form = new FormData();

  try {
    target.parameters.forEach((param) => {
      form.append(param.name, param.value);
    });

    form.append("file", Buffer.from(content), {
      filename: "products.jsonl",
      contentType: "text/jsonl",
    });

    return postStagedUpload(target, form);
  } catch (error) {
    throw new Error("Upload to staged target failed. See logs for details.");
  }
}

export async function uploadFileToShopifyStagedTarget(
  target,
  filePath,
  filename = "products.jsonl",
) {
  const form = new FormData();

  try {
    target.parameters.forEach((param) => {
      form.append(param.name, param.value);
    });

    form.append("file", fs.createReadStream(filePath), {
      filename,
      contentType: "text/jsonl",
    });

    return postStagedUpload(target, form);
  } catch (error) {
    throw new Error("Upload to staged target failed. See logs for details.");
  }
}

export const generateCron = (date) => {
      const d = new Date(date);
      return `${d.getUTCMinutes()} ${d.getUTCHours()} ${d.getUTCDate()} ${d.getUTCMonth() + 1
        } *`;
    };
