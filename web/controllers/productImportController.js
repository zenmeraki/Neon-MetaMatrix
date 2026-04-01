import fs from "fs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import {
  createMultiLanguageForFileEdit,
} from "../utils/googleTranslator.js";
import { clearAllCachesForShop, clearKeyCaches } from "../utils/cacheUtils.js";
import { prisma } from "../config/database.js";
import { addbulkImportEditJob } from "../Jobs/Queues/bulkImportEditJob.js";
import crypto from "crypto";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
} from "../services/bulkEditExecutionStateService.js";
import { logApiError } from "../utils/errorLogUtils.js";

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

  await fs.promises.unlink(filePath).catch(() => {});
}

async function assertSafeCsvFile(filePath) {
  const fileHandle = await fs.promises.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) {
      throw new Error("Invalid CSV file");
    }
  } finally {
    await fileHandle.close();
  }
}

function parseAndValidateColumnMappings(rawColumnMappings) {
  let parsedMappings;

  try {
    parsedMappings =
      typeof rawColumnMappings === "string"
        ? JSON.parse(rawColumnMappings)
        : rawColumnMappings;
  } catch {
    throw new Error("Invalid column mappings");
  }

  if (!parsedMappings || typeof parsedMappings !== "object" || Array.isArray(parsedMappings)) {
    throw new Error("Invalid column mappings");
  }

  const values = Object.values(parsedMappings);
  if (!values.includes("id")) {
    throw new Error("Product ID mapping is required");
  }

  if (values.some((value) => !ALLOWED_IMPORT_FIELDS.has(String(value)))) {
    throw new Error("Unsupported import column mapping");
  }

  return parsedMappings;
}

export const csvBulkProductsEdit = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "CSV file is required",
    });
  }

  let columnMappings = {};

  try {
    columnMappings = req.body.columnMappings
      ? parseAndValidateColumnMappings(req.body.columnMappings)
      : {};
    await assertSafeCsvFile(req.file.path);
  } catch (error) {
    await removeUploadedFile(req.file.path);
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  const { status } = await getCurrentBulkOperationStatus(session);
  if (status === "RUNNING") {
    await removeUploadedFile(req.file.path);
    return res.status(400).json({
      success: false,
      message: "Another bulk operation is already running",
    });
  }

  const editHistory = await prisma.editHistory.create({
    data: {
      shop: session.shop,
      title: createMultiLanguageForFileEdit(req.file.originalname),
      editedType: "mixed",
      startedAt: new Date(),
      executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
      executionIdentity: crypto.randomUUID(),
      isSpreadsheetEdit: true,
      undo: buildPlannedUndoState({ allowed: true }),
      rules: [{ field: "mixed" }],
      batch: {
        lastProductId: null,
        hasMore: false,
        size: 0,
      },
    },
  });

  const importHistory = await prisma.spreadsheetFile.create({
    data: {
      shop: session.shop,
      editHistoryId: editHistory.id,
      fileUrl: null,
      columnMappings: columnMappings,
      totalRows: 0,
    },
  });

  await addbulkImportEditJob({
    shop: session.shop,
    filePath: req.file.path,
    historyId: editHistory.id,
    columnMappings,
    source: "csv_import",
    executionId: editHistory.executionIdentity,
  });

  await clearAllCachesForShop(session.shop);

  res.status(200).json({
    success: true,
    message: "CSV import queued successfully",
    data: importHistory,
  });
});

export const importCsvController = async (req, res) => {
  try {
    const { columnMappings } = req.body;
    const session = res.locals.shopify.session;
    const shop = session.shop;

    if (!req.file) {
      return res.status(400).json({ message: "CSV file required" });
    }

    if (!columnMappings) {
      return res.status(400).json({ message: "columnMappings missing" });
    }

    const parsedMappings = parseAndValidateColumnMappings(columnMappings);

    const localFilePath = req.file.path;
    await assertSafeCsvFile(localFilePath);

  const newHistory = await prisma.editHistory.create({
      data: {
        shop,
        title: createMultiLanguageForFileEdit(req.file.originalname),
        editedType: "mixed",
        startedAt: new Date(),
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
        executionIdentity: crypto.randomUUID(),
        isSpreadsheetEdit: true,
        undo: buildPlannedUndoState({ allowed: true }),
        rules: [{ field: "mixed" }],
        batch: {
          lastProductId: null,
          hasMore: false,
          size: 0,
        },
      },
    });

    const importDoc = await prisma.spreadsheetFile.create({
      data: {
        shop,
        editHistoryId: newHistory.id,
        columnMappings: parsedMappings,
        fileUrl: localFilePath,
      },
    });

    await clearKeyCaches(`${shop}:fetchHistories`);

    await addbulkImportEditJob({
      historyId: newHistory.id,
      shop,
      filePath: localFilePath,
      columnMappings: parsedMappings,
      source: "csv_import",
      executionId: newHistory.executionIdentity,
    });

    return res.json({
      success: true,
      importId: newHistory.id,
      spreadsheetFileId: importDoc.id,
    });
  } catch (err) {
    await removeUploadedFile(req.file?.path);
    await logApiError({
      shop: res.locals.shopify?.session?.shop,
      err,
      req,
      source: "productImportController.importCsvController",
    });
    return res.status(500).json({ message: "Failed to queue CSV import" });
  }
};
