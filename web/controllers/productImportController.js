import fs from "fs";
import path from "path";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCurrentBulkOperationStatus } from "../modules/bulkOperations/bulkOperationHelper.js";
import {
  createMultiLanguageForFileEdit,
} from "../utils/googleTranslator.js";
import { clearAllCachesForShop, clearKeyCaches } from "../utils/cacheUtils.js";
import { prisma } from "../config/database.js";
import { addbulkImportEditJob } from "../jobs/queues/bulkImportEditJob.js";
import crypto from "crypto";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
} from "../services/bulkEditExecutionStateService.js";
import { merchantOperationRepository } from "../repositories/merchantOperationRepository.js";
import { bulkEditHistoryRepository } from "../repositories/bulkEditHistoryRepository.js";
import { importStorageService } from "../modules/productImports/importStorageService.js";
import { Buffer } from "buffer";
import csv from "csv-parser";
import XLSX from "xlsx";
import { stableHash } from "../utils/idempotencyKey.js";

const MAX_SERVER_ROWS = 100000;
const MAX_SERVER_COLUMNS = 300;
const MAX_SERVER_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_CSV_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const ALLOWED_IMPORT_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);
const MAX_SERVER_XLSX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_VALIDATION_ERRORS = 100;
const PREVIEW_ROW_LIMIT = 50;
const FORMULA_PREFIX = /^[=+\-@\t\r\n]/;

const ACTIVE_SYNC_STAGES = new Set([
  "SHOPIFY_BULK_STARTING",
  "SHOPIFY_BULK_RUNNING",
  "MIRROR_STAGING",
  "RECONCILING",
]);

const FIELD_ALIASES = {
  id: new Set(["id", "product_id", "productid", "shopify_product_id"]),
  variant_id: new Set(["variant_id", "variantid", "shopify_variant_id"]),
  metaTitle: new Set(["meta_title", "metatitle", "seo_title"]),
  metaDescription: new Set(["meta_description", "metadescription", "seo_description"]),
  title: new Set(["title", "product_title", "producttitle"]),
  sku: new Set(["sku", "variant_sku"]),
  compareAtPrice: new Set(["compare_at_price", "compareatprice"]),
  price: new Set(["price", "variant_price"]),
  barcode: new Set(["barcode", "upc", "variant_barcode"]),
  vendor: new Set(["vendor", "brand"]),
  status: new Set(["status", "product_status"]),
  description: new Set(["description", "description_html", "body_html"]),
  handle: new Set(["handle", "product_handle"]),
  productType: new Set(["product_type", "producttype"]),
  taxable: new Set(["taxable"]),
  tags: new Set(["tags", "product_tags"]),
};

const IMPORTABLE_FIELDS = new Set(Object.keys(FIELD_ALIASES));

function buildImportIdempotencyKey({
  shop,
  uploadSessionId,
  fileHash,
  fallbackToken,
}) {
  const session = String(uploadSessionId || "").trim();
  const hash = String(fileHash || "").trim();
  const fallback = String(fallbackToken || "").trim();
  const seed = [shop, hash, session, fallback].filter(Boolean).join(":");
  const digest = crypto.createHash("sha256").update(seed).digest("hex");
  return `import:${digest}`;
}

async function validateLocalCsvBuffer(filePath) {
  const fd = await fs.promises.open(filePath, "r");
  try {
    const probeSize = 64 * 1024;
    const buffer = Buffer.alloc(probeSize);
    const { bytesRead } = await fd.read(buffer, 0, probeSize, 0);
    const probe = buffer.subarray(0, bytesRead);
    if (!probe.length) {
      throw new Error("CSV file is empty");
    }
    if (typeof Buffer.isUtf8 === "function" && !Buffer.isUtf8(probe)) {
      throw new Error("CSV must be valid UTF-8");
    }
  } finally {
    await fd.close();
  }
}

function containsFormulaLikeValue(row) {
  if (!row || typeof row !== "object") return false;
  return Object.values(row).some((value) => {
    if (value === null || value === undefined) return false;
    const normalized = String(value).trimStart();
    if (!normalized) return false;
    if (FORMULA_PREFIX.test(normalized)) return true;
    if (normalized.startsWith("'")) {
      return FORMULA_PREFIX.test(normalized.slice(1).trimStart());
    }
    return false;
  });
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function inferField(header) {
  const normalized = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.has(normalized)) return field;
  }
  return "";
}

function buildInferredMappings(headers = []) {
  return headers.reduce((acc, header) => {
    acc[header] = inferField(header);
    return acc;
  }, {});
}

function getMappedValue(row, mapping, targetField) {
  for (const [csvCol, field] of Object.entries(mapping || {})) {
    if (field === targetField && row?.[csvCol] !== undefined) {
      return row[csvCol];
    }
  }
  return "";
}

function getImportFileExtension(key) {
  const normalized = String(key || "").toLowerCase();
  if (normalized.endsWith(".csv")) return ".csv";
  if (normalized.endsWith(".xlsx")) return ".xlsx";
  if (normalized.endsWith(".xls")) return ".xls";
  return "";
}

async function readStreamToBufferWithLimit(stream, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of stream) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bufferChunk.length;
    if (total > maxBytes) {
      throw new Error(`Spreadsheet exceeds maximum allowed bytes (${maxBytes})`);
    }
    chunks.push(bufferChunk);
  }

  if (!chunks.length) {
    throw new Error("Spreadsheet file is empty");
  }

  return Buffer.concat(chunks);
}

function normalizeColumnMappings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const entries = Object.entries(input);
  if (entries.length > MAX_SERVER_COLUMNS) {
    throw new Error(`Column mapping exceeds maximum allowed columns (${MAX_SERVER_COLUMNS})`);
  }

  const normalized = {};
  for (const [key, value] of entries) {
    const column = String(key || "").trim();
    const field = String(value || "").trim();
    if (!column) continue;
    if (column.length > 512) {
      throw new Error("Column mapping key is too large");
    }
    if (field && !IMPORTABLE_FIELDS.has(field)) {
      throw new Error(`Unsupported mapped field: ${field}`);
    }
    normalized[column] = field;
  }

  return normalized;
}

function buildImportManifest({
  shop,
  source,
  fileName,
  fileKey,
  fileHash,
  uploadSessionId,
  columnMappings,
  mirrorBatchId,
}) {
  return {
    type: "PRODUCT_IMPORT",
    shop,
    source,
    fileName: String(fileName || "").trim(),
    fileKey: String(fileKey || "").trim(),
    fileHash: String(fileHash || "").trim(),
    uploadSessionId: String(uploadSessionId || "").trim(),
    mirrorBatchId: mirrorBatchId || null,
    columnMappings: normalizeColumnMappings(columnMappings),
    version: 1,
  };
}

function assertImportPreconditionsOrThrow(store, bulkStatus) {
  const bulk = String(bulkStatus || "").toUpperCase();
  if (bulk === "RUNNING" || bulk === "CREATED" || bulk === "CANCELING") {
    const error = new Error("Another bulk operation is already running");
    error.statusCode = 409;
    throw error;
  }
  const mirrorState = String(store?.mirrorHealthState || "");
  if (mirrorState && mirrorState !== "HEALTHY") {
    const error = new Error("Mirror is not healthy for import");
    error.statusCode = 409;
    throw error;
  }
  if (
    store?.isProductSyncing ||
    store?.isProductInitialySyning ||
    ACTIVE_SYNC_STAGES.has(String(store?.syncProgressStage || ""))
  ) {
    const error = new Error("Cannot run import while product sync is active");
    error.statusCode = 409;
    throw error;
  }
  if (!store?.activeMirrorBatchId) {
    const error = new Error("Active mirror batch required for import");
    error.statusCode = 409;
    throw error;
  }
}

async function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export const csvBulkProductsEdit = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "CSV file is required",
    });
  }

  const columnMappings = normalizeColumnMappings(
    req.body.columnMappings ? JSON.parse(req.body.columnMappings) : {},
  );

  if (!Object.values(columnMappings).includes("id")) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      success: false,
      message: "Product ID mapping is required",
    });
  }

  await validateLocalCsvBuffer(req.file.path);
  const fileHash = await computeFileSha256(req.file.path);

  const [bulkState, store] = await Promise.all([
    getCurrentBulkOperationStatus(session),
    prisma.store.findUnique({
      where: { shopUrl: session.shop },
      select: {
        activeMirrorBatchId: true,
        mirrorHealthState: true,
        isProductSyncing: true,
        isProductInitialySyning: true,
        syncProgressStage: true,
      },
    }),
  ]);
  assertImportPreconditionsOrThrow(store, bulkState?.status);

  const manifest = buildImportManifest({
    shop: session.shop,
    source: "csv_import",
    fileName: req.file.originalname || path.basename(req.file.path),
    fileKey: req.file.path,
    fileHash,
    uploadSessionId: req.file.filename,
    columnMappings,
    mirrorBatchId: store?.activeMirrorBatchId || null,
  });
  const importIdempotencyKey = buildImportIdempotencyKey({
    shop: session.shop,
    uploadSessionId: req.file.filename,
    fileHash,
    fallbackToken: req.file.path,
  });
  const executionIdentity = `import:${stableHash(manifest)}`;

  const { editHistory, importHistory } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:start:${session.shop}`}))::text`;

    const txStore = await tx.store.findUnique({
      where: { shopUrl: session.shop },
      select: {
        activeMirrorBatchId: true,
        mirrorHealthState: true,
        isProductSyncing: true,
        isProductInitialySyning: true,
        syncProgressStage: true,
      },
    });
    const txBulkState = await getCurrentBulkOperationStatus(session);
    assertImportPreconditionsOrThrow(txStore, txBulkState?.status);

    const op = await merchantOperationRepository.createPlannedOperationForEdit({
      shop: session.shop,
      type: "IMPORT",
      title: "Import edit",
      source: "write_through",
      idempotencyKey: importIdempotencyKey,
      totalItems: 0,
      startedAt: new Date(),
    }, tx);

    const existing = await tx.editHistory.findFirst({
      where: { shop: session.shop, operationId: op.id },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const existingDoc = await tx.spreadsheetFile.findFirst({
        where: { shop: session.shop, editHistoryId: existing.id },
      });
      return { editHistory: existing, importHistory: existingDoc };
    }

    const createdHistory = await bulkEditHistoryRepository.create({
      operationId: op.id,
      shop: session.shop,
      title: createMultiLanguageForFileEdit(req.file.originalname),
      editedType: "mixed",
      startedAt: new Date(),
      executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      executionIdentity,
      isSpreadsheetEdit: true,
      undo: buildPlannedUndoState({ allowed: true }),
      rules: [{ field: "mixed" }],
      batch: {
        lastProductId: null,
        hasMore: false,
        size: 0,
        importManifest: manifest,
        importIdempotencyKey,
      },
    }, tx);

    const createdDoc = await tx.spreadsheetFile.create({
      data: {
        shop: session.shop,
        operationId: createdHistory.operationId,
        editHistoryId: createdHistory.id,
        fileUrl: null,
        columnMappings,
        totalRows: 0,
      },
    });
    return { editHistory: createdHistory, importHistory: createdDoc };
  });

  try {
    await addbulkImportEditJob({
      shop: session.shop,
      filePath: req.file.path,
      historyId: editHistory.id,
      columnMappings,
      source: "csv_import",
      executionId: editHistory.executionIdentity,
    });
  } catch (enqueueError) {
    await prisma.editHistory.updateMany({
      where: { id: editHistory.id, shop: session.shop },
      data: {
        status: "failed",
        executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
        failureStage: "queue_enqueue_failed",
      },
    }).catch(() => {});
    throw enqueueError;
  }

  await clearAllCachesForShop(session.shop);

  res.status(200).json({
    success: true,
    message: "CSV import queued successfully",
    data: importHistory,
    importId: editHistory.id,
    importBatchId: editHistory.id,
    targetSnapshotId: editHistory.id,
  });
});

export const importCsvController = async (req, res) => {
  return res.status(410).json({
    success: false,
    message: "Direct CSV upload is disabled. Use staged CSV import endpoints.",
  });
};

export const initCsvImportUploadController = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const shop = session?.shop;
  const { fileName, contentType, fileSizeBytes } = req.body || {};
  const normalizedName = String(fileName || "").trim();
  const normalizedType = String(contentType || "").trim().toLowerCase();
  const sizeBytes = Number(fileSizeBytes || 0);
  const extension = getImportFileExtension(normalizedName);

  if (!ALLOWED_IMPORT_EXTENSIONS.has(extension)) {
    return res.status(400).json({
      success: false,
      message: "Only .csv, .xlsx, and .xls files are allowed",
    });
  }
  if (normalizedType && !ALLOWED_CSV_MIME_TYPES.has(normalizedType)) {
    return res.status(400).json({ success: false, message: "Invalid spreadsheet content type" });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SERVER_FILE_BYTES) {
    return res.status(400).json({
      success: false,
      message: `CSV file size must be between 1 byte and ${MAX_SERVER_FILE_BYTES} bytes`,
    });
  }
  if ((extension === ".xlsx" || extension === ".xls") && sizeBytes > MAX_SERVER_XLSX_FILE_BYTES) {
    return res.status(400).json({
      success: false,
      message: `Excel file size must be <= ${MAX_SERVER_XLSX_FILE_BYTES} bytes`,
    });
  }

  const key = importStorageService.buildCsvImportKey({
    shop,
    fileName: normalizedName || "products.csv",
  });
  const result = await importStorageService.initMultipartUpload({
    shop,
    key,
    contentType: contentType || "application/octet-stream",
  });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

export const uploadCsvImportPartController = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const shop = session?.shop;
  const key = req.query?.key;
  const uploadId = req.query?.uploadId;
  const partNumber = req.params.partNumber;

  const result = await importStorageService.uploadPart({
    shop,
    key,
    uploadId,
    partNumber,
    body: req,
  });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

export const completeCsvImportUploadController = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const shop = session?.shop;
  const { key, uploadId, parts } = req.body || {};

  const result = await importStorageService.completeMultipartUpload({
    shop,
    key,
    uploadId,
    parts,
  });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

export const abortCsvImportUploadController = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const shop = session?.shop;
  const { key, uploadId } = req.body || {};
  await importStorageService.abortMultipartUpload({ shop, key, uploadId });
  return res.status(200).json({ success: true });
});

export const queueCsvImportFromS3Controller = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const shop = session?.shop;
  const { key, columnMappings, fileName, uploadSessionId, fileHash } = req.body || {};

  if (!key) {
    return res.status(400).json({ success: false, message: "key is required" });
  }

  const parsedMappings = normalizeColumnMappings(
    typeof columnMappings === "string" ? JSON.parse(columnMappings) : columnMappings,
  );

  if (!parsedMappings || !Object.values(parsedMappings).includes("id")) {
    return res.status(400).json({
      success: false,
      message: "Product ID mapping is required",
    });
  }
  if (!Object.values(parsedMappings).includes("variant_id")) {
    return res.status(400).json({
      success: false,
      message: "Variant ID mapping is required",
    });
  }
  if (!uploadSessionId || !fileHash) {
    return res.status(400).json({
      success: false,
      message: "uploadSessionId and fileHash are required",
    });
  }

  const [bulkState, store] = await Promise.all([
    getCurrentBulkOperationStatus(session),
    prisma.store.findUnique({
      where: { shopUrl: shop },
      select: {
        activeMirrorBatchId: true,
        mirrorHealthState: true,
        isProductSyncing: true,
        isProductInitialySyning: true,
        syncProgressStage: true,
      },
    }),
  ]);
  assertImportPreconditionsOrThrow(store, bulkState?.status);

  const importIdempotencyKey = buildImportIdempotencyKey({
    shop,
    uploadSessionId,
    fileHash,
    fallbackToken: key,
  });
  const manifest = buildImportManifest({
    shop,
    source: "csv_import",
    fileName: fileName || key.split("/").pop() || "import.csv",
    fileKey: key,
    fileHash,
    uploadSessionId,
    columnMappings: parsedMappings,
    mirrorBatchId: store?.activeMirrorBatchId || null,
  });
  const executionIdentity = `import:${stableHash(manifest)}`;

  const { newHistory, importDoc } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:start:${shop}`}))::text`;

    const txStore = await tx.store.findUnique({
      where: { shopUrl: shop },
      select: {
        activeMirrorBatchId: true,
        mirrorHealthState: true,
        isProductSyncing: true,
        isProductInitialySyning: true,
        syncProgressStage: true,
      },
    });
    const txBulkState = await getCurrentBulkOperationStatus(session);
    assertImportPreconditionsOrThrow(txStore, txBulkState?.status);

    const plannedOp = await merchantOperationRepository.createPlannedOperationForEdit({
      shop,
      type: "IMPORT",
      title: "Import edit",
      source: "write_through",
      idempotencyKey: importIdempotencyKey,
      totalItems: 0,
      startedAt: new Date(),
    }, tx);

    const existing = await tx.editHistory.findFirst({
      where: { shop, operationId: plannedOp.id },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const existingDoc = await tx.spreadsheetFile.findFirst({
        where: { shop, editHistoryId: existing.id },
      });
      return { newHistory: existing, importDoc: existingDoc };
    }

    const createdHistory = await bulkEditHistoryRepository.create({
      operationId: plannedOp.id,
      shop,
      title: createMultiLanguageForFileEdit(fileName || key.split("/").pop() || "import.csv"),
      editedType: "mixed",
      startedAt: new Date(),
      executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      executionIdentity,
      isSpreadsheetEdit: true,
      undo: buildPlannedUndoState({ allowed: true }),
      rules: [{ field: "mixed" }],
      batch: {
        lastProductId: null,
        hasMore: false,
        size: 0,
        importIdempotencyKey,
        importManifest: manifest,
        maxRows: MAX_SERVER_ROWS,
        maxColumns: MAX_SERVER_COLUMNS,
      },
    }, tx);

    const createdDoc = await tx.spreadsheetFile.create({
      data: {
        shop,
        operationId: createdHistory.operationId,
        editHistoryId: createdHistory.id,
        columnMappings: parsedMappings,
        fileUrl: key,
      },
    });
    return { newHistory: createdHistory, importDoc: createdDoc };
  });

  await clearKeyCaches(`${shop}:fetchHistories`);

  try {
    await addbulkImportEditJob({
      historyId: newHistory.id,
      shop,
      filePath: `s3://${key}`,
      s3Key: key,
      columnMappings: parsedMappings,
      source: "csv_import",
      executionId: newHistory.executionIdentity,
    });
  } catch (enqueueError) {
    await prisma.editHistory.updateMany({
      where: { id: newHistory.id, shop },
      data: {
        status: "failed",
        executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
        failureStage: "queue_enqueue_failed",
      },
    }).catch(() => {});
    throw enqueueError;
  }

  return res.status(200).json({
    success: true,
    importId: newHistory.id,
    importBatchId: newHistory.id,
    targetSnapshotId: newHistory.id,
    spreadsheetFileId: importDoc.id,
  });
});

export const validateCsvImportFromS3Controller = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;
  const shop = session?.shop;
  const { key, columnMappings } = req.body || {};

  if (!key) {
    return res.status(400).json({ success: false, message: "key is required" });
  }

  const parsedMappings = normalizeColumnMappings(
    typeof columnMappings === "string" ? JSON.parse(columnMappings) : columnMappings,
  );
  const sourceStream = await importStorageService.getObjectReadStream({ shop, key });
  const extension = getImportFileExtension(key);
  if (!ALLOWED_IMPORT_EXTENSIONS.has(extension)) {
    return res.status(400).json({
      success: false,
      message: "Unsupported import file extension",
    });
  }

  let totalRows = 0;
  let validRows = 0;
  let invalidRows = 0;
  let headers = [];
  let headerColumns = 0;
  const errors = [];
  const previewRows = [];
  let effectiveMappings = {};

  if (extension === ".csv") {
    await new Promise((resolve, reject) => {
      sourceStream
        .pipe(csv({ maxRowBytes: 1024 * 1024 }))
        .on("data", (row) => {
          totalRows += 1;
          if (totalRows > MAX_SERVER_ROWS) {
            reject(new Error(`CSV exceeds maximum allowed rows (${MAX_SERVER_ROWS})`));
            return;
          }

          if (!headers.length) {
            headers = Object.keys(row || {});
            headerColumns = headers.length;
            if (!headerColumns) {
              reject(new Error("CSV header row is missing"));
              return;
            }
            if (headerColumns > MAX_SERVER_COLUMNS) {
              reject(new Error(`CSV exceeds maximum allowed columns (${MAX_SERVER_COLUMNS})`));
              return;
            }
            const inferredMappings = buildInferredMappings(headers);
            effectiveMappings =
              parsedMappings && typeof parsedMappings === "object" && Object.keys(parsedMappings).length
                ? parsedMappings
                : inferredMappings;
          }

          if (containsFormulaLikeValue(row)) {
            invalidRows += 1;
            if (errors.length < MAX_VALIDATION_ERRORS) {
              errors.push({
                row: totalRows,
                code: "FORMULA_INJECTION",
                message: "Potential spreadsheet formula payload detected",
              });
            }
            return;
          }

          if (previewRows.length < PREVIEW_ROW_LIMIT) {
            previewRows.push(row);
          }
          const productId = String(getMappedValue(row, effectiveMappings, "id") || "").trim();
          const variantId = String(getMappedValue(row, effectiveMappings, "variant_id") || "").trim();
          if (!productId || !variantId) {
            invalidRows += 1;
            if (errors.length < MAX_VALIDATION_ERRORS) {
              errors.push({
                row: totalRows,
                code: "MISSING_REQUIRED_IDENTIFIERS",
                message: "Both product id and variant_id are required",
              });
            }
            return;
          }
          validRows += 1;
        })
        .on("end", resolve)
        .on("error", reject);
    });
  } else {
    const workbookBuffer = await readStreamToBufferWithLimit(sourceStream, MAX_SERVER_XLSX_FILE_BYTES);
    const workbook = XLSX.read(workbookBuffer, { type: "buffer", raw: false });
    const sheetName = workbook.SheetNames?.[0];
    if (!sheetName) {
      throw new Error("Spreadsheet does not contain any worksheets");
    }
    const worksheet = workbook.Sheets[sheetName];
    const worksheetRef = String(worksheet?.["!ref"] || "");
    const range = worksheetRef ? XLSX.utils.decode_range(worksheetRef) : null;
    totalRows = range ? Math.max(range.e.r - range.s.r, 0) : 0;
    if (totalRows > MAX_SERVER_ROWS) {
      throw new Error(`Spreadsheet exceeds maximum allowed rows (${MAX_SERVER_ROWS})`);
    }

    const previewRowsSafe = XLSX.utils.sheet_to_json(worksheet, {
      defval: "",
      raw: false,
      blankrows: false,
      sheetRows: Math.min(MAX_SERVER_ROWS + 1, PREVIEW_ROW_LIMIT + 1),
    });

    if (previewRowsSafe.length) {
      headers = Object.keys(previewRowsSafe[0] || {});
      headerColumns = headers.length;
      if (!headerColumns) {
        throw new Error("Spreadsheet header row is missing");
      }
      if (headerColumns > MAX_SERVER_COLUMNS) {
        throw new Error(`Spreadsheet exceeds maximum allowed columns (${MAX_SERVER_COLUMNS})`);
      }
      const inferredMappings = buildInferredMappings(headers);
      effectiveMappings =
        parsedMappings && typeof parsedMappings === "object" && Object.keys(parsedMappings).length
          ? parsedMappings
          : inferredMappings;
    }
    for (let index = 0; index < previewRowsSafe.length; index += 1) {
      const row = previewRowsSafe[index];
      if (containsFormulaLikeValue(row)) {
        invalidRows += 1;
        if (errors.length < MAX_VALIDATION_ERRORS) {
          errors.push({
            row: index + 1,
            code: "FORMULA_INJECTION",
            message: "Potential spreadsheet formula payload detected",
          });
        }
        continue;
      }
      if (previewRows.length < PREVIEW_ROW_LIMIT) {
        previewRows.push(row);
      }
      const productId = String(getMappedValue(row, effectiveMappings, "id") || "").trim();
      const variantId = String(getMappedValue(row, effectiveMappings, "variant_id") || "").trim();
      if (!productId || !variantId) {
        invalidRows += 1;
        if (errors.length < MAX_VALIDATION_ERRORS) {
          errors.push({
            row: index + 1,
            code: "MISSING_REQUIRED_IDENTIFIERS",
            message: "Both product id and variant_id are required",
          });
        }
        continue;
      }
      validRows += 1;
    }
    if (totalRows > previewRowsSafe.length) {
      invalidRows += Math.max(totalRows - previewRowsSafe.length, 0);
      if (errors.length < MAX_VALIDATION_ERRORS) {
        errors.push({
          row: previewRowsSafe.length + 1,
          code: "XLSX_VALIDATION_SAMPLE_LIMIT",
          message: "Large XLSX files are partially validated in preview mode; queue performs strict execution validation",
        });
      }
    }
  }

  const inferredMappings = buildInferredMappings(headers);
  if (!Object.keys(effectiveMappings).length) {
    effectiveMappings =
      parsedMappings && typeof parsedMappings === "object" && Object.keys(parsedMappings).length
        ? parsedMappings
        : inferredMappings;
  }

  const mappedFields = [...new Set(Object.values(effectiveMappings || {}).filter(Boolean))];
  const hasRequiredMappings =
    mappedFields.includes("id") && mappedFields.includes("variant_id");

  return res.status(200).json({
    success: true,
    data: {
      headers,
      inferredMappings,
      effectiveMappings,
      previewRows,
      headerColumns,
      totalRows,
      validRows,
      invalidRows,
      fieldsChanged: mappedFields.filter((field) => !["id", "variant_id"].includes(field)),
      undoAvailable: true,
      canQueue: hasRequiredMappings && validRows > 0 && invalidRows === 0,
      missingRequiredMappings: [
        !mappedFields.includes("id") ? "id" : null,
        !mappedFields.includes("variant_id") ? "variant_id" : null,
      ].filter(Boolean),
      errors: errors.slice(0, 20),
    },
  });
});