import fs from "fs";
import path from "path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const DEFAULT_STORAGE_DRIVER = process.env.EXPORT_STORAGE_DRIVER || "local";

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function normalizeKey(key) {
  return key.replace(/^\/+/, "");
}

function validateKey(key) {
  const normalized = normalizeKey(String(key || "").trim());
  const segments = normalized.split("/").filter(Boolean);

  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Export storage key is invalid");
  }

  return segments.join("/");
}

function sanitizePathSegment(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error(`${fieldName} is invalid`);
  }

  return sanitized;
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(String(fileName || "").trim());
  const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error("fileName is invalid");
  }

  return sanitized;
}

function assertPathInsideRoot(root, targetPath) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Resolved export path escapes local export root");
  }
}

class ExportStorageService {
  constructor({ driver = DEFAULT_STORAGE_DRIVER } = {}) {
    this.driver = driver;
    this.s3 = null;
    this.bucket = null;
    this.publicBaseUrl = "";
    this.localRoot =
      process.env.EXPORT_LOCAL_ROOT ||
      path.join(process.cwd(), "storage", "exports");
  }

  getDriver() {
    return this.driver || "local";
  }

  getS3Client() {
    if (this.s3) return this.s3;

    this.bucket = requireEnv("EXPORT_S3_BUCKET");
    this.publicBaseUrl = process.env.EXPORT_S3_PUBLIC_BASE_URL || "";
    this.s3 = new S3Client({
      region: requireEnv("EXPORT_S3_REGION"),
    });

    return this.s3;
  }

  buildExportKey({ shop, exportJobId, fileName }) {
    const safeShop = sanitizePathSegment(shop, "shop");
    const safeExportJobId = sanitizePathSegment(exportJobId, "exportJobId");
    const safeFileName = sanitizeFileName(fileName);

    return validateKey(`${safeShop}/exports/${safeExportJobId}/${safeFileName}`);
  }

  async uploadFile({ localPath, key, contentType = "text/csv" }) {
    if (!localPath) {
      throw new Error("localPath is required");
    }

    const resolvedLocalPath = path.resolve(localPath);

    const initialStat = await fs.promises.stat(resolvedLocalPath).catch(() => {
      throw new Error("Export file does not exist for upload");
    });

    if (!initialStat.isFile()) {
      throw new Error("Export upload path is not a file");
    }

    const normalizedKey = validateKey(key);
    const driver = this.getDriver();

    if (driver === "s3") {
      const s3 = this.getS3Client();
      const finalStat = await fs.promises.stat(resolvedLocalPath);

      if (!finalStat.isFile()) {
        throw new Error("Export upload path is not a file");
      }

      await s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: normalizedKey,
          Body: fs.createReadStream(resolvedLocalPath),
          ContentLength: finalStat.size,
          ContentType: contentType,
          ContentDisposition: "attachment",
        }),
      );

      return {
        driver: "s3",
        key: normalizedKey,
        url: this.publicBaseUrl
          ? `${this.publicBaseUrl.replace(/\/$/, "")}/${normalizedKey}`
          : null,
        sizeBytes: finalStat.size,
      };
    }

    const destination = path.join(this.localRoot, normalizedKey);
    assertPathInsideRoot(this.localRoot, destination);

    await fs.promises.mkdir(path.dirname(destination), {
      recursive: true,
    });

    await fs.promises.copyFile(resolvedLocalPath, destination);

    const copiedStat = await fs.promises.stat(destination);

    return {
      driver: "local",
      key: normalizedKey,
      url: `/exports/${normalizedKey}`,
      sizeBytes: copiedStat.size,
    };
  }

  async deleteFile({ key }) {
    const normalizedKey = validateKey(key);
    const driver = this.getDriver();

    if (driver === "s3") {
      const s3 = this.getS3Client();
      await s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: normalizedKey,
        }),
      );
      return { deleted: true, key: normalizedKey };
    }

    const targetPath = path.join(this.localRoot, normalizedKey);
    assertPathInsideRoot(this.localRoot, targetPath);
    await fs.promises.unlink(targetPath).catch(() => {});
    return { deleted: true, key: normalizedKey };
  }
}

let exportStorageServiceInstance = null;

export function getExportStorageService() {
  if (!exportStorageServiceInstance) {
    exportStorageServiceInstance = new ExportStorageService();
  }

  return exportStorageServiceInstance;
}

export { ExportStorageService };
export const exportStorageService = {
  buildExportKey: (...args) => getExportStorageService().buildExportKey(...args),
  uploadFile: (...args) => getExportStorageService().uploadFile(...args),
  deleteFile: (...args) => getExportStorageService().deleteFile(...args),
};
