import { Worker } from "bullmq";
import fs from "fs";
import { promises as fsPromises } from "fs";
import csv from "csv-parser";
import crypto from "crypto";
import XLSX from "xlsx";
import { connection } from "../../config/redis.js";
import logger from "../../utils/loggerUtils.js";
import {
  buildProductSetMutation,
  diffProductFields,
  diffVariants,
} from "../../modules/bulkEdits/importEditUtils.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import ProductBulkService from "../../services/productService/productBulkEditService.js";
import { prisma } from "../../config/database.js";
import { getSession } from "../../utils/sessionHandler.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import {
  getJobAttempt,
  isRetryExhausted,
  recordRetryExhausted,
} from "../../utils/workerTelemetry.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
} from "../../services/bulkEditExecutionStateService.js";
import { toUnrecoverableIfNonRetryable } from "../../utils/nonRetryableJobCodes.js";
import { importStorageService } from "../../modules/productImports/importStorageService.js";
import { bulkEditHistoryRepository } from "../../repositories/bulkEditHistoryRepository.js";
import { stableCanonicalStringify } from "../../utils/stableCanonicalStringify.js";
import { requireJobData } from "../../utils/jobPayloadValidation.js";

const QUEUE_NAME = process.env.IMPORT_EDIT_QUEUE || "importEdit";
const WORKER_NAME = "bulkImportEditWorker";
const MAX_IMPORT_ROWS = 100000;
const MAX_IMPORT_COLUMNS = 300;
const MAX_IMPORT_XLSX_BYTES = 20 * 1024 * 1024;
const CHANGE_RECORD_INSERT_CHUNK_SIZE = 500;
const FORMULA_PREFIX = /^[=+\-@\t\r\n]/;

const normalizeBoolean = (value) =>
  value === true || value === "TRUE" || value === "true";
const normalizeNumber = (value) =>
  value !== undefined && value !== null && value !== "" ? Number(value) : undefined;

function extractProductOptions(existingProduct) {
  const options = [];
  const nameCols = ["option1Name", "option2Name", "option3Name"];
  const valueCols = ["option1Value", "option2Value", "option3Value"];

  for (let index = 0; index < 3; index += 1) {
    const name = existingProduct[nameCols[index]];
    if (!name) {
      continue;
    }

    const uniqueValues = [
      ...new Set(
        (existingProduct.variants || [])
          .map((variant) => variant[valueCols[index]])
          .filter(Boolean),
      ),
    ];

    options.push({
      id: `option${index + 1}`,
      name,
      values: uniqueValues,
    });
  }

  return options;
}

function mapExistingVariantsForDiff(existingVariants) {
  return (existingVariants || []).map((variant) => ({
    id: variant.id,
    title: variant.title,
    sku: variant.sku,
    barcode: variant.barcode,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    inventoryQuantity: variant.inventoryQuantity,
    inventoryPolicy: variant.inventoryPolicy,
    taxable: variant.taxable,
    taxCode: variant.taxCode,
    cost: variant.cost,
    countryOfOrigin: variant.countryOfOrigin,
    hsTariffCode: variant.hsTariffCode,
    weight: variant.weight,
    weightUnit: variant.weightUnit,
    option1: variant.option1Value,
    option2: variant.option2Value,
    option3: variant.option3Value,
    selectedOptions: Array.isArray(variant.selectedOptionsJson)
      ? variant.selectedOptionsJson
      : [],
    tracked: variant.tracked,
    physicalProduct: variant.physicalProduct,
    profitMargin: variant.profitMargin,
  }));
}

async function removeLocalFile(filePath) {
  if (!filePath) {
    return;
  }
  if (String(filePath).startsWith("s3://")) {
    return;
  }

  try {
    await fsPromises.unlink(filePath);
  } catch (_error) {}
}

async function claimImportHistory(historyId) {
  return claimImportHistoryForShop(historyId, null);
}

async function claimImportHistoryForShop(historyId, shop) {
  const result = await bulkEditHistoryRepository.applyProjectionUpdate({
    where: {
      id: historyId,
      ...(shop ? { shop } : {}),
      status: "pending",
    },
    data: {
      status: "processing",
      executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
    },
  });

  return result.count === 1;
}

function buildMappedProductRows(columnMappings, row, productMap) {
  const mapped = {};
  for (const [csvCol, field] of Object.entries(columnMappings || {})) {
    if (field && row[csvCol] !== undefined) {
      mapped[field] = row[csvCol];
    }
  }

  if (!mapped.id) {
    return;
  }

  const productId = mapped.id;
  if (!productMap.has(productId)) {
    productMap.set(productId, {
      productSet: {
        id: productId,
        ...(mapped.title && { title: mapped.title }),
        ...(mapped.vendor && { vendor: mapped.vendor }),
        ...(mapped.status && { status: mapped.status.toUpperCase() }),
        ...(mapped.description && { descriptionHtml: mapped.description }),
        ...(mapped.productType && { productType: mapped.productType }),
        ...(mapped.handle && { handle: mapped.handle }),
        ...(mapped.tags && {
          tags: mapped.tags
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }),
        ...((mapped.metaTitle || mapped.metaDescription) && {
          seo: {
            ...(mapped.metaTitle && { title: mapped.metaTitle }),
            ...(mapped.metaDescription && { description: mapped.metaDescription }),
          },
        }),
        options: [],
        variants: [],
      },
    });

    const product = productMap.get(productId).productSet;
    if (mapped.option1Name) product.options.push({ name: mapped.option1Name });
    if (mapped.option2Name) product.options.push({ name: mapped.option2Name });
    if (mapped.option3Name) product.options.push({ name: mapped.option3Name });
  }

  if (mapped.variant_id) {
    productMap.get(productId).productSet.variants.push({
      id: mapped.variant_id,
      ...(mapped.price && { price: normalizeNumber(mapped.price) }),
      ...(mapped.compareAtPrice && {
        compareAtPrice: normalizeNumber(mapped.compareAtPrice),
      }),
      ...(mapped.sku && { sku: mapped.sku }),
      ...(mapped.barcode && { barcode: mapped.barcode }),
      ...(mapped.taxable !== undefined && {
        taxable: normalizeBoolean(mapped.taxable),
      }),
      ...(mapped.option1Value && { option1: mapped.option1Value }),
      ...(mapped.option2Value && { option2: mapped.option2Value }),
      ...(mapped.option3Value && { option3: mapped.option3Value }),
    });
  }
}

function containsFormulaLikeValue(row) {
  if (!row || typeof row !== "object") return false;
  return Object.values(row).some((value) => {
    if (value === null || value === undefined) return false;
    const text = String(value).trimStart();
    return FORMULA_PREFIX.test(text);
  });
}

function getImportFileExtension(pathOrKey) {
  const value = String(pathOrKey || "").toLowerCase();
  if (value.endsWith(".csv")) return ".csv";
  if (value.endsWith(".xlsx")) return ".xlsx";
  if (value.endsWith(".xls")) return ".xls";
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

function buildImportPlannerFingerprint({ columnMappings, productIds }) {
  const normalizedMappings = Object.entries(columnMappings || {})
    .map(([csvColumn, targetField]) => [String(csvColumn).trim(), String(targetField || "").trim()])
    .sort(([left], [right]) => left.localeCompare(right));
  const normalizedIds = [...(productIds || [])].map((id) => String(id)).sort();
  return crypto
    .createHash("sha256")
    .update(stableCanonicalStringify({
      source: "csv_import",
      mapping: normalizedMappings,
      productIds: normalizedIds,
    }))
    .digest("hex");
}

async function createManyChangeRecordsInChunks(records) {
  for (let index = 0; index < records.length; index += CHANGE_RECORD_INSERT_CHUNK_SIZE) {
    const chunk = records.slice(index, index + CHANGE_RECORD_INSERT_CHUNK_SIZE);
    await prisma.changeRecord.createMany({
      data: chunk,
    });
  }
}

const bulkImportEditWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const {
      historyId,
      shop,
      filePath,
      s3Key = null,
      columnMappings,
      executionId = null,
    } = requireJobData(job, ["historyId", "shop"], "bulk import edit");
    const attempt = getJobAttempt(job);

    try {
      const history = await prisma.editHistory.findUnique({
        where: { id: historyId },
        select: {
          id: true,
          shop: true,
          status: true,
          targetMirrorBatchId: true,
        },
      });

      if (!history) {
        throw new Error("History document not found");
      }

      if (!shop || history.shop !== shop) {
        throw new Error("Cross-shop import execution blocked");
      }

      if (history.status === "processing" && job.attemptsMade > 0) {
        return {
          skipped: true,
          reason: "already_processing",
        };
      }

      const claimed = await claimImportHistoryForShop(historyId, shop);
      if (!claimed && history.status !== "processing") {
        return {
          skipped: true,
          reason: "already_claimed",
        };
      }

      await clearKeyCaches(`${history.shop}:fetchHistories`);

      const productMap = new Map();
      let totalRows = 0;

      const importExt = getImportFileExtension(s3Key || filePath);
      const sourceStream = s3Key
        ? await importStorageService.getObjectReadStream({ shop: history.shop, key: s3Key })
        : fs.createReadStream(filePath);

      if (importExt === ".csv" || !importExt) {
        await new Promise((resolve, reject) => {
          let headerColumns = null;
          const mappedColumnCount = Object.values(columnMappings || {}).filter(Boolean).length;
          sourceStream
            .pipe(csv())
            .on("data", (row) => {
              totalRows += 1;
              if (totalRows > MAX_IMPORT_ROWS) {
                reject(new Error(`CSV exceeds maximum allowed rows (${MAX_IMPORT_ROWS})`));
                return;
              }

              if (headerColumns === null) {
                headerColumns = Object.keys(row || {}).length;
                if (!headerColumns) {
                  reject(new Error("CSV header row is missing"));
                  return;
                }
                if (headerColumns > MAX_IMPORT_COLUMNS) {
                  reject(new Error(`CSV exceeds maximum allowed columns (${MAX_IMPORT_COLUMNS})`));
                  return;
                }
                if (headerColumns <= 1 && mappedColumnCount > 1) {
                  reject(new Error("CSV delimiter/header format is invalid"));
                  return;
                }
              }

              if (containsFormulaLikeValue(row)) {
                reject(new Error("CSV contains potential spreadsheet formula injection payloads"));
                return;
              }
              buildMappedProductRows(columnMappings, row, productMap);
            })
            .on("end", resolve)
            .on("error", reject);
        });
      } else if (importExt === ".xlsx" || importExt === ".xls") {
        const workbookBuffer = await readStreamToBufferWithLimit(sourceStream, MAX_IMPORT_XLSX_BYTES);
        const workbook = XLSX.read(workbookBuffer, { type: "buffer", raw: false });
        const sheetName = workbook.SheetNames?.[0];
        if (!sheetName) {
          throw new Error("Spreadsheet does not contain any worksheets");
        }
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, {
          defval: "",
          raw: false,
          blankrows: false,
        });
        if (rows.length > MAX_IMPORT_ROWS) {
          throw new Error(`Spreadsheet exceeds maximum allowed rows (${MAX_IMPORT_ROWS})`);
        }
        const headers = rows.length ? Object.keys(rows[0] || {}) : [];
        if (!headers.length) {
          throw new Error("Spreadsheet header row is missing");
        }
        if (headers.length > MAX_IMPORT_COLUMNS) {
          throw new Error(`Spreadsheet exceeds maximum allowed columns (${MAX_IMPORT_COLUMNS})`);
        }

        for (const row of rows) {
          totalRows += 1;
          if (containsFormulaLikeValue(row)) {
            throw new Error("Spreadsheet contains potential formula injection payloads");
          }
          buildMappedProductRows(columnMappings, row, productMap);
        }
      } else {
        throw new Error("Unsupported import file type");
      }

      const productIds = [...productMap.keys()];
      const store = await prisma.store.findUnique({
        where: { shopUrl: history.shop },
        select: { activeMirrorBatchId: true },
      });
      const mirrorBatchId = history.targetMirrorBatchId || store?.activeMirrorBatchId || null;

      if (!mirrorBatchId) {
        throw new Error("IMPORT_TARGET_MIRROR_BATCH_REQUIRED");
      }

      const existingProducts = await prisma.product.findMany({
        where: {
          shop: history.shop,
          mirrorBatchId,
          id: { in: productIds },
        },
        include: { variants: true },
      });

      const hydratedBatchIds = new Set(
        existingProducts.map((product) => product.mirrorBatchId).filter(Boolean),
      );
      if (
        existingProducts.length > 0 &&
        (hydratedBatchIds.size !== 1 || !hydratedBatchIds.has(mirrorBatchId))
      ) {
        throw new Error("IMPORT_PRODUCTS_MIRROR_BATCH_MISMATCH");
      }

      const existingById = existingProducts.reduce((accumulator, product) => {
        accumulator[product.id] = product;
        return accumulator;
      }, {});

      const formattedProducts = [];
      const changeRecords = [];
      const batchId = String(job.id);
      const targetSnapshotId = historyId;
      const plannerFingerprint = buildImportPlannerFingerprint({
        columnMappings,
        productIds,
      });
      const targetSnapshots = [];
      let snapshotOrdinal = 0;

      for (const { productSet } of productMap.values()) {
        const existingProduct = existingById[productSet.id];
        if (!existingProduct) {
          continue;
        }

        snapshotOrdinal += 1;
        targetSnapshots.push({
          id: crypto.randomUUID(),
          ownerType: "edit_history",
          ownerId: targetSnapshotId,
          shop: history.shop,
          productId: productSet.id,
          ordinal: snapshotOrdinal,
          mirrorBatchId,
          plannerFingerprint,
          plannerVersion: 1,
          canonicalQueryHash: plannerFingerprint,
          canonicalOrderBy: { mode: "csv_input_order" },
          updatedAt: new Date(),
        });

       const existingProductForDiff = {
  ...existingProduct,
  descriptionHtml: existingProduct.descriptionHtml,
  seo: {
    title: existingProduct.seoTitle,
    description: existingProduct.seoDescription,
  },
  options: extractProductOptions(existingProduct),
  variants: mapExistingVariantsForDiff(existingProduct.variants),
};

        const productFieldChanges = diffProductFields(existingProductForDiff, productSet);
        const variantFieldChanges = diffVariants(
          existingProductForDiff.variants,
          productSet.variants,
        );

        if (!productFieldChanges.length && !variantFieldChanges.length) {
          continue;
        }

        formattedProducts.push(
          JSON.stringify(
            buildProductSetMutation({
              productSet,
              existingProduct: existingProductForDiff,
            }),
          ),
        );

        changeRecords.push({
          options: existingProductForDiff.options.map((option) => ({
            id: option.id,
            name: option.name,
            values: option.values,
          })),
          editHistoryId: historyId,
          productId: productSet.id,
          shop: history.shop,
          title: existingProduct.title,
          image: existingProduct.featuredImageUrl,
          scope: "mixed",
          batchId,
          productFieldChanges,
          variantFieldChanges,
          status: "pending",
        });
      }

      if (!formattedProducts.length) {
        await bulkEditHistoryRepository.applyProjectionUpdate({
          where: { id: historyId, shop: history.shop },
          data: {
            totalRows,
            totalItems: 0,
            targetSnapshotCount: 0,
            targetMirrorBatchId: mirrorBatchId,
            status: "completed",
            executionState: BULK_EDIT_EXECUTION_STATES.COMPLETED,
            completedAt: new Date(),
            error: null,
            batch: {
              hasMore: false,
              currentBatchId: null,
              currentBatchTargetCount: 0,
              currentBatchCount: 0,
              completionReason: "NO_VALID_CHANGES",
              plannerFingerprint,
              mirrorBatchId,
            },
          },
        });
        await removeLocalFile(filePath);
        return {
          success: true,
          noop: true,
          reason: "no_valid_changes",
        };
      }

      if (changeRecords.length) {
        await createManyChangeRecordsInChunks(changeRecords);
      }

      await prisma.$transaction(async (tx) => {
        await tx.targetSnapshot.deleteMany({
          where: {
            ownerType: "edit_history",
            ownerId: targetSnapshotId,
            shop: history.shop,
          },
        });
        if (targetSnapshots.length) {
          await tx.targetSnapshot.createMany({
            data: targetSnapshots,
            skipDuplicates: true,
          });
        }
      });

      const session = await getSession(history.shop);
      const service = new ProductBulkService(session);
      const result = await service._bulkOperationHelper({
        formattedProducts: formattedProducts.join("\n"),
        field: "mixed",
        fields: ["mixed"],
      });

      if (!result?.bulkOperation?.id) {
        throw new Error("Missing bulkOperationId in Shopify response");
      }

      await bulkEditHistoryRepository.applyProjectionUpdate({
        where: { id: historyId, shop: history.shop },
        data: {
          totalRows,
          totalItems: formattedProducts.length,
          targetSnapshotCount: targetSnapshots.length,
          targetMirrorBatchId: mirrorBatchId,
          bulkOperationId: result.bulkOperation.id,
          processingBatchId: batchId,
          executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
          batch: {
            lastProductId: null,
            hasMore: false,
            size: 0,
            currentBatchId: batchId,
            currentBatchTargetCount: formattedProducts.length,
            currentBatchCount: changeRecords.length,
            sourceTargetSnapshotId: targetSnapshotId,
            plannerFingerprint,
            importBatchId: batchId,
            mirrorBatchId,
          },
        },
      });

      await prisma.spreadsheetFile.updateMany({
        where: { editHistoryId: historyId },
        data: { totalRows },
      });

      await clearKeyCaches(`${history.shop}:fetchHistories`);
      await removeLocalFile(filePath);

      return {
        success: true,
        historyId,
        totalRows,
        totalItems: formattedProducts.length,
      };
    } catch (error) {
      logger.error("Bulk import edit worker failed", {
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        shop,
        historyId,
        executionId,
        attempt,
        message: error.message,
      });

      await removeLocalFile(filePath);

      await bulkEditHistoryRepository.applyProjectionUpdate({
        where: { id: historyId, ...(shop ? { shop } : {}) },
        data: {
          status: "failed",
          executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
          error: appendExecutionError(
            null,
            buildExecutionError({
              code: "bulk_import_worker_failure",
              stage: "queue_execution",
              message: error.message,
              retryable: false,
              details: {
                stack: error.stack || null,
                failedAt: new Date().toISOString(),
              },
            }),
          ),
        },
      });

      await logWorkerError({
        shop,
        err: error,
        source: "bulkImportEditWorker",
        metadata: {
          queue: QUEUE_NAME,
          worker: WORKER_NAME,
          jobId: job?.id || null,
          historyId,
          executionId,
          attempt,
        },
      });

      throw toUnrecoverableIfNonRetryable(error);
    }
  },
  { connection, concurrency: 1 },
);

bulkImportEditWorker.on("failed", async (job, error) => {
  logger.error("Bulk import worker failed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    historyId: job?.data?.historyId,
    executionId: job?.data?.executionId || null,
    attempt: getJobAttempt(job),
    message: error.message,
    stack: error.stack,
  });

  if (isRetryExhausted(job)) {
    await recordRetryExhausted({
      job,
      shop: job?.data?.shop,
      worker: WORKER_NAME,
      queue: QUEUE_NAME,
      entityType: "editHistory",
      entityId: job?.data?.historyId,
      executionId: job?.data?.executionId || null,
      message: "Bulk import edit worker exhausted retries",
    });
  }
});

export default bulkImportEditWorker;
