import crypto from "crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function sanitizeSegment(value, fieldName) {
  const safe = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new Error(`${fieldName} is invalid`);
  }
  return safe;
}

function normalizeKey(key) {
  return String(key || "").replace(/^\/+/, "").trim();
}

class ImportStorageService {
  constructor() {
    this.s3 = null;
    this.bucket = null;
  }

  getClient() {
    if (this.s3) return this.s3;
    this.bucket = requireEnv("IMPORT_S3_BUCKET");
    this.s3 = new S3Client({
      region: requireEnv("IMPORT_S3_REGION"),
    });
    return this.s3;
  }

  buildCsvImportKey({ shop, fileName }) {
    const safeShop = sanitizeSegment(shop, "shop");
    const lowerName = String(fileName || "").toLowerCase();
    let ext = ".bin";
    if (lowerName.endsWith(".csv")) ext = ".csv";
    else if (lowerName.endsWith(".xlsx")) ext = ".xlsx";
    else if (lowerName.endsWith(".xls")) ext = ".xls";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${safeShop}/imports/${stamp}-${crypto.randomUUID()}${ext}`;
  }

  assertKeyForShop({ shop, key }) {
    const normalized = normalizeKey(key);
    const safeShop = sanitizeSegment(shop, "shop");
    if (!normalized.startsWith(`${safeShop}/imports/`)) {
      throw new Error("Invalid import object key for shop");
    }
    return normalized;
  }

  async initMultipartUpload({ shop, key, contentType = "text/csv" }) {
    const s3 = this.getClient();
    const safeKey = this.assertKeyForShop({ shop, key });
    const result = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: safeKey,
        ContentType: contentType,
      }),
    );
    return {
      key: safeKey,
      uploadId: result.UploadId,
    };
  }

  async uploadPart({ shop, key, uploadId, partNumber, body }) {
    const s3 = this.getClient();
    const safeKey = this.assertKeyForShop({ shop, key });
    const safePartNumber = Number(partNumber);
    if (!Number.isInteger(safePartNumber) || safePartNumber < 1 || safePartNumber > 10000) {
      throw new Error("partNumber must be between 1 and 10000");
    }

    const result = await s3.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: safeKey,
        UploadId: uploadId,
        PartNumber: safePartNumber,
        Body: body,
      }),
    );

    return {
      partNumber: safePartNumber,
      eTag: result.ETag,
    };
  }

  async completeMultipartUpload({ shop, key, uploadId, parts }) {
    const s3 = this.getClient();
    const safeKey = this.assertKeyForShop({ shop, key });

    const completed = (Array.isArray(parts) ? parts : [])
      .map((part) => ({
        ETag: part?.eTag || part?.ETag,
        PartNumber: Number(part?.partNumber || part?.PartNumber),
      }))
      .filter((part) => part.ETag && Number.isInteger(part.PartNumber))
      .sort((left, right) => left.PartNumber - right.PartNumber);

    if (!completed.length) {
      throw new Error("Multipart completion requires at least one uploaded part");
    }

    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: safeKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: completed,
        },
      }),
    );

    return { key: safeKey };
  }

  async abortMultipartUpload({ shop, key, uploadId }) {
    const s3 = this.getClient();
    const safeKey = this.assertKeyForShop({ shop, key });
    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: safeKey,
        UploadId: uploadId,
      }),
    );
  }

  async getObjectReadStream({ shop, key }) {
    const s3 = this.getClient();
    const safeKey = this.assertKeyForShop({ shop, key });
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: safeKey,
      }),
    );
    if (!result?.Body) {
      throw new Error("S3 object body is empty");
    }
    return result.Body;
  }

  async deleteObject({ shop, key }) {
    const s3 = this.getClient();
    const safeKey = this.assertKeyForShop({ shop, key });
    await s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: safeKey,
      }),
    );
  }
}

let importStorageServiceInstance = null;

function getImportStorageService() {
  if (!importStorageServiceInstance) {
    importStorageServiceInstance = new ImportStorageService();
  }
  return importStorageServiceInstance;
}

export const importStorageService = {
  buildCsvImportKey: (...args) => getImportStorageService().buildCsvImportKey(...args),
  initMultipartUpload: (...args) => getImportStorageService().initMultipartUpload(...args),
  uploadPart: (...args) => getImportStorageService().uploadPart(...args),
  completeMultipartUpload: (...args) => getImportStorageService().completeMultipartUpload(...args),
  abortMultipartUpload: (...args) => getImportStorageService().abortMultipartUpload(...args),
  getObjectReadStream: (...args) => getImportStorageService().getObjectReadStream(...args),
  deleteObject: (...args) => getImportStorageService().deleteObject(...args),
};

export { ImportStorageService };
