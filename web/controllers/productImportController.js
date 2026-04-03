import fs from "fs/promises";
import path from "path";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import { reserveImportExecution } from "../services/productImportService.js";

const ALLOWED_IMPORT_FIELDS = new Set([
  "id",
  "title",
  "vendor",
  "status",
  "description",
  "productType",
  "handle",
  "tags",
  "metaTitle",
  "metaDescription",
  "option1Name",
  "option2Name",
  "option3Name",
  "variant_id",
  "price",
  "compareAtPrice",
  "sku",
  "barcode",
  "taxable",
  "option1Value",
  "option2Value",
  "option3Value",
]);

async function removeUploadedFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (_error) {}
}

function buildHttpError(statusCode, userMessage, message = userMessage) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.userMessage = userMessage;
  return error;
}

function getSessionShop(res) {
  const session = res.locals.shopify?.session;
  const shop = session?.shop;

  if (!session || !shop) {
    throw buildHttpError(401, "Session expired. Please reload the app.");
  }

  return { session, shop };
}

function parseColumnMappings(rawValue) {
  if (!rawValue) {
    throw buildHttpError(400, "Column mappings are required.");
  }

  let parsed = rawValue;
  if (typeof rawValue === "string") {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      throw buildHttpError(400, "Column mappings must be valid JSON.");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw buildHttpError(400, "Column mappings must be an object.");
  }

  const entries = Object.entries(parsed);
  if (!entries.length) {
    throw buildHttpError(400, "Column mappings cannot be empty.");
  }

  if (entries.length > 100) {
    throw buildHttpError(400, "Column mappings are too large.");
  }

  const sanitized = {};
  const seenTargets = new Set();

  for (const [columnName, field] of entries) {
    if (typeof columnName !== "string" || !columnName.trim()) {
      throw buildHttpError(400, "Column mapping keys must be non-empty strings.");
    }

    if (field === "" || field === null || field === undefined) {
      continue;
    }

    if (typeof field !== "string") {
      throw buildHttpError(400, "Column mapping values must be strings.");
    }

    const normalizedField = field.trim();
    if (!ALLOWED_IMPORT_FIELDS.has(normalizedField)) {
      throw buildHttpError(400, `Unsupported mapped field: ${normalizedField}`);
    }

    if (seenTargets.has(normalizedField)) {
      throw buildHttpError(400, `Duplicate mapped field: ${normalizedField}`);
    }

    seenTargets.add(normalizedField);
    sanitized[columnName.trim()] = normalizedField;
  }

  if (!Object.keys(sanitized).length) {
    throw buildHttpError(400, "At least one valid column mapping is required.");
  }

  if (!Object.values(sanitized).includes("id")) {
    throw buildHttpError(400, "Product ID mapping is required.");
  }

  return sanitized;
}

function validateCsvFile(file) {
  if (!file) {
    throw buildHttpError(400, "CSV file is required.");
  }

  const extension = path.extname(file.originalname || "").toLowerCase();
  if (extension !== ".csv") {
    throw buildHttpError(400, "Only CSV files are allowed.");
  }
}

async function ensureNoActiveBulkOperation(session, filePath) {
  const { status } = await getCurrentBulkOperationStatus(session);
  if (status === "RUNNING") {
    await removeUploadedFile(filePath);
    throw buildHttpError(409, "Another bulk operation is already running.");
  }
}

async function queueCsvImport(req, res) {
  try {
    const { session, shop } = getSessionShop(res);
    validateCsvFile(req.file);

    const columnMappings = parseColumnMappings(req.body.columnMappings);
    await ensureNoActiveBulkOperation(session, req.file.path);

    const result = await reserveImportExecution({
      shop,
      originalname: req.file.originalname,
      size: req.file.size,
      columnMappings,
      filePath: req.file.path,
      includeImportDocPath: false,
    });
    await clearKeyCaches(`${shop}:fetchHistories`);

    return {
      success: true,
      message: result.reused
        ? "An identical CSV import is already queued."
        : "CSV import queued successfully",
      importId: result.editHistory.id,
      spreadsheetFileId: result.importDoc?.id || null,
      reused: result.reused,
      data: result.importDoc || {
        editHistoryId: result.editHistory.id,
        reused: true,
      },
    };
  } catch (error) {
    await removeUploadedFile(req.file?.path);
    throw error;
  }
}

export const csvBulkProductsEdit = asyncHandler(async (req, res) => {
  const response = await queueCsvImport(req, res);

  res.status(200).json(response);
});

export const importCsvController = asyncHandler(async (req, res) => {
  const response = await queueCsvImport(req, res);

  res.status(200).json(response);
});
