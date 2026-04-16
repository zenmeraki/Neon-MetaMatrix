import fs from "fs/promises";
import crypto from "crypto";
import { prisma } from "../../Config/database.js";
import { addbulkImportEditJob } from "../../Jobs/Queues/bulkImportEditJob.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { createMultiLanguageForFileEdit } from "../../utils/googleTranslator.js";
import { uploadCsvToCloudinary } from "../../utils/uploadCsvToCloudinary.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
} from "../shopWorkLeaseService.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
} from "../bulkEditExecutionStateService.js";
import * as importEditRepository from "../../repositories/importEditRepository.js";

const CSV_IMPORT_REQUIRED_PRODUCT_ID_FIELD = "id";
const CSV_IMPORT_ALLOWED_TARGET_FIELDS = new Set([
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
const CSV_IMPORT_PRODUCT_FIELDS = new Set([
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
]);
const CSV_IMPORT_VARIANT_FIELDS = new Set([
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

function buildHttpError(message, httpStatus = 400, code = "CSV_IMPORT_VALIDATION_ERROR") {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.code = code;
  return error;
}

async function removeLocalFile(filePath) {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}

function sanitizeImportFilename(filename) {
  const fallbackName = "import.csv";
  if (!filename || typeof filename !== "string") return fallbackName;

  const sanitized = filename
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:"*?<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 140);

  return sanitized || fallbackName;
}

function buildImportRules(columnMappings) {
  const mappedFields = Object.values(columnMappings).filter(Boolean);
  const productFields = mappedFields.filter((field) =>
    CSV_IMPORT_PRODUCT_FIELDS.has(field),
  );
  const variantFields = mappedFields.filter((field) =>
    CSV_IMPORT_VARIANT_FIELDS.has(field),
  );
  const entityScope =
    productFields.length && variantFields.length
      ? "mixed"
      : productFields.length
        ? "product"
        : variantFields.length
          ? "variant"
          : "identifier_only";

  return [
    {
      field: "csv_import",
      importType: "csv",
      entityScope,
      identifierField: CSV_IMPORT_REQUIRED_PRODUCT_ID_FIELD,
      mappedFields,
      productFields,
      variantFields,
      expectedRowCount: null,
      columnMappings,
    },
  ];
}

function parseColumnMappings(rawColumnMappings) {
  if (!rawColumnMappings) {
    throw buildHttpError("columnMappings missing");
  }

  let parsedMappings;
  try {
    parsedMappings =
      typeof rawColumnMappings === "string"
        ? JSON.parse(rawColumnMappings)
        : rawColumnMappings;
  } catch {
    throw buildHttpError("Invalid columnMappings JSON");
  }

  if (
    !parsedMappings ||
    typeof parsedMappings !== "object" ||
    Array.isArray(parsedMappings)
  ) {
    throw buildHttpError("columnMappings must be an object");
  }

  if (!Object.values(parsedMappings).includes(CSV_IMPORT_REQUIRED_PRODUCT_ID_FIELD)) {
    throw buildHttpError("Product ID mapping is required");
  }

  const seenTargets = new Set();
  for (const [sourceColumn, targetField] of Object.entries(parsedMappings)) {
    if (!sourceColumn || typeof sourceColumn !== "string") {
      throw buildHttpError("columnMappings contains an invalid source column");
    }

    if (!targetField) {
      continue;
    }

    if (typeof targetField !== "string") {
      throw buildHttpError("columnMappings target fields must be strings");
    }

    if (!CSV_IMPORT_ALLOWED_TARGET_FIELDS.has(targetField)) {
      throw buildHttpError(`Unsupported column mapping target: ${targetField}`);
    }

    if (seenTargets.has(targetField)) {
      throw buildHttpError(`Duplicate column mapping target: ${targetField}`);
    }
    seenTargets.add(targetField);
  }

  return parsedMappings;
}

export class ProductImportService {
  constructor(session) {
    this.session = session;
  }

  async startCsvImport({ shop, session = this.session, file, rawColumnMappings }) {
    const sessionShop = shop || session?.shop || this.session?.shop;

    if (!sessionShop) {
      throw buildHttpError("Unauthorized", 401, "UNAUTHORIZED");
    }

    if (!file?.path) {
      throw buildHttpError("CSV file is required");
    }

    let parsedMappings;
    let reservedLease = null;
    try {
      parsedMappings = parseColumnMappings(rawColumnMappings);

      const executionIdentity = crypto.randomUUID();
      const safeOriginalName = sanitizeImportFilename(file.originalname);
      reservedLease = await acquireExclusiveShopWork({
        shop: sessionShop,
        activity: "csv_import_enqueue",
        worker: "productImportService",
        queue: "importEdit",
        entityType: "editHistory",
        executionId: executionIdentity,
        ttlMs: 5 * 60 * 1000,
      });

      if (!reservedLease.acquired) {
        throw buildHttpError(
          "Import already in progress for this shop",
          409,
          "SHOP_WORK_CONFLICT",
        );
      }

      const storedFileUrl = await uploadCsvToCloudinary(
        file.path,
        `import-${executionIdentity}`,
        `${executionIdentity}-${safeOriginalName}`,
        { folder: "product-imports" },
      );
      const { editHistory, spreadsheetFile } = await prisma.$transaction(
        async (tx) =>
          importEditRepository.createImportEditHistoryWithFile({
            shop: sessionShop,
            title: createMultiLanguageForFileEdit(safeOriginalName),
            executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
            executionIdentity,
            undo: {
              ...buildPlannedUndoState({ allowed: false }),
              intended: true,
              eligibility: "pending_import_execution",
            },
            rules: buildImportRules(parsedMappings),
            batch: {
              lastProductId: null,
              hasMore: false,
              size: 0,
            },
            columnMappings: parsedMappings,
            fileUrl: storedFileUrl,
            client: tx,
          }),
      );

      try {
        await addbulkImportEditJob(
          {
            shop: sessionShop,
            filePath: file.path,
            historyId: editHistory.id,
            columnMappings: parsedMappings,
            fileUrl: storedFileUrl,
            source: "csv_import",
            executionId: editHistory.executionIdentity,
          },
          {
            jobId: `import-edit:${editHistory.id}`,
          },
        );
      } catch (error) {
        await importEditRepository.markImportEditQueueDispatchFailed({
          historyId: editHistory.id,
          shop: sessionShop,
          failedState: BULK_EDIT_EXECUTION_STATES.FAILED,
          error: error.message,
        }).catch(() => {});
        await releaseExclusiveShopWork(reservedLease);
        reservedLease = null;
        throw error;
      }

      await importEditRepository.markImportEditQueued({
        historyId: editHistory.id,
        shop: sessionShop,
        queuedState: BULK_EDIT_EXECUTION_STATES.QUEUED,
      }).catch(() => {});

      await clearKeyCaches(`${sessionShop}:fetchHistories`).catch(() => {});

      return {
        success: true,
        importId: editHistory.id,
        historyId: editHistory.id,
        spreadsheetFileId: spreadsheetFile.id,
        status: "queued",
      };
    } catch (error) {
      await releaseExclusiveShopWork(reservedLease);
      await removeLocalFile(file?.path);
      throw error;
    }
  }
}

export const bulkImportService = {
  startCsvImport(input) {
    return new ProductImportService(input?.session).startCsvImport(input);
  },
};
