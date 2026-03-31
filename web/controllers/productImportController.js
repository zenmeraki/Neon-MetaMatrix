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

export const csvBulkProductsEdit = asyncHandler(async (req, res) => {
  const session = res.locals.shopify.session;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "CSV file is required",
    });
  }

  const columnMappings = req.body.columnMappings
    ? JSON.parse(req.body.columnMappings)
    : {};

  if (!Object.values(columnMappings).includes("id")) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      success: false,
      message: "Product ID mapping is required",
    });
  }

  const { status } = await getCurrentBulkOperationStatus(session);
  if (status === "RUNNING") {
    fs.unlinkSync(req.file.path);
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

    const parsedMappings = JSON.parse(columnMappings);

    const localFilePath = req.file.path;

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
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
};