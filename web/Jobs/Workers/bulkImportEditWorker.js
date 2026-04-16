import { Worker } from "bullmq";
import fs from "fs";
import { promises as fsPromises } from "fs";
import os from "os";
import path from "path";
import csv from "csv-parser";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";
import {
  buildProductSetMutation,
  diffProductFields,
  diffVariants,
} from "../../utils/importEditUtils.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import ProductBulkService from "../../services/productService/productBulkEditService.js";
import { prisma } from "../../Config/database.js";
import { getSession } from "../../utils/sessionHandler.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { getJobAttempt, isRetryExhausted, recordRetryExhausted } from "../../utils/workerTelemetry.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { recordMirrorAnomaly } from "../../services/mirrorAnomalyService.js";
import {
  acquireExclusiveShopWork,
  assertExclusiveShopWorkLeaseActive,
  releaseExclusiveShopWork,
  startExclusiveShopWorkRenewal,
} from "../../services/shopWorkLeaseService.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
  isTerminalExecutionState,
} from "../../services/bulkEditExecutionStateService.js";

const QUEUE_NAME = process.env.IMPORT_EDIT_QUEUE || "importEdit";
const WORKER_NAME = "bulkImportEditWorker";
const STALE_DISPATCH_MS = 20 * 60 * 1000;

class RetryableImportEditError extends Error {
  constructor(message, code = "retryable_import_edit") {
    super(message);
    this.name = "RetryableImportEditError";
    this.retryable = true;
    this.code = code;
  }
}

function isRetryableError(error) {
  return Boolean(error?.retryable);
}

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

  try {
    await fsPromises.unlink(filePath);
  } catch (_error) {}
}

async function ensureLocalCsvFile({ filePath, fileUrl, historyId }) {
  if (filePath && fs.existsSync(filePath)) {
    return filePath;
  }

  if (!fileUrl) {
    throw new Error("Import CSV file is no longer available");
  }

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download import CSV: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const localPath = path.join(
    os.tmpdir(),
    `import-edit-${historyId}-${Date.now()}.csv`,
  );
  await fsPromises.writeFile(localPath, Buffer.from(arrayBuffer));
  return localPath;
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function isStaleDispatch(batch) {
  const dispatchStartedAt = batch?.dispatchStartedAt;
  if (!dispatchStartedAt) {
    return false;
  }

  return Date.now() - new Date(dispatchStartedAt).getTime() > STALE_DISPATCH_MS;
}

async function claimImportHistoryForShop({ historyId, shop, executionId, jobId, attempt }) {
  return prisma.$transaction(async (tx) => {
    const history = await tx.editHistory.findUnique({
      where: { id: historyId },
      select: {
        id: true,
        shop: true,
        status: true,
        executionState: true,
        executionIdentity: true,
        bulkOperationId: true,
        batch: true,
        error: true,
        targetCatalogBatchId: true,
        targetMirrorBatchId: true,
        processingBatchId: true,
      },
    });

    if (!history) {
      throw new Error("History document not found");
    }

    if (!shop || history.shop !== shop) {
      throw new Error("Cross-shop import execution blocked");
    }

    if (executionId && history.executionIdentity && executionId !== history.executionIdentity) {
      throw new Error("Import execution identity mismatch");
    }

    if (
      isTerminalExecutionState(history.executionState) ||
      ["completed", "failed", "cancelled", "partial"].includes(history.status)
    ) {
      return { state: "terminal", history };
    }

    if (
      history.executionState === BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY &&
      history.bulkOperationId
    ) {
      return { state: "awaiting_shopify", history };
    }

    if (history.executionState === BULK_EDIT_EXECUTION_STATES.DISPATCHING) {
      if (!history.bulkOperationId && isStaleDispatch(asObject(history.batch))) {
        return { state: "stale_dispatch_reconciliation_required", history };
      }

      return { state: "already_dispatching", history };
    }

    const batch = asObject(history.batch);
    const updated = await tx.editHistory.updateMany({
      where: {
        id: historyId,
        shop,
        status: "pending",
        bulkOperationId: null,
        executionState: {
          in: [
            BULK_EDIT_EXECUTION_STATES.PLANNED,
            BULK_EDIT_EXECUTION_STATES.QUEUED,
          ],
        },
      },
      data: {
        status: "processing",
        executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
        failureStage: null,
        batch: {
          ...batch,
          dispatchStartedAt: new Date().toISOString(),
          dispatchJobId: jobId || null,
          dispatchAttempt: attempt,
          activeExecutionId: executionId || history.executionIdentity || history.id,
        },
      },
    });

    if (updated.count !== 1) {
      return { state: "not_claimed", history };
    }

    const claimedHistory = await tx.editHistory.findUnique({
      where: { id: historyId },
      select: {
        id: true,
        shop: true,
        status: true,
        executionState: true,
        executionIdentity: true,
        bulkOperationId: true,
        batch: true,
        error: true,
        targetCatalogBatchId: true,
        targetMirrorBatchId: true,
        processingBatchId: true,
      },
    });

    return { state: "claimed", history: claimedHistory };
  });
}

async function reconcileStaleImportDispatch({ history, session, shop, historyId }) {
  const current = await getCurrentBulkOperationStatus(session);
  const batch = asObject(history.batch);
  const dispatchStartedAt = batch.dispatchStartedAt
    ? new Date(batch.dispatchStartedAt)
    : null;
  const createdAt = current.createdAt ? new Date(current.createdAt) : null;
  const currentBelongsToDispatch =
    current.id &&
    current.type === "MUTATION" &&
    (!dispatchStartedAt || !createdAt || createdAt >= dispatchStartedAt);

  if (currentBelongsToDispatch) {
    const updated = await prisma.editHistory.updateMany({
      where: {
        id: historyId,
        shop,
        executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
        bulkOperationId: null,
      },
      data: {
        bulkOperationId: current.id,
        executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
        failureStage: null,
        batch: {
          ...batch,
          dispatchReconciledAt: new Date().toISOString(),
          lastSubmittedBulkOperationId: current.id,
          lastSubmittedBulkOperationStatus: current.status,
        },
      },
    });

    return {
      reconciled: updated.count === 1,
      bulkOperationId: current.id,
    };
  }

  await recordMirrorAnomaly({
    shop,
    severity: "critical",
    type: "bulk_import_edit_stale_dispatch_unresolved",
    entityType: "editHistory",
    entityId: historyId,
    message: "Stale import-edit dispatch could not be safely reconciled with Shopify",
    details: {
      currentBulkOperationId: current.id,
      currentBulkOperationStatus: current.status,
      currentBulkOperationCreatedAt: current.createdAt,
      dispatchStartedAt: batch.dispatchStartedAt || null,
    },
  }).catch(() => {});

  return { reconciled: false, bulkOperationId: null };
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

const bulkImportEditWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { historyId, shop, filePath, fileUrl = null, columnMappings, executionId = null } = job.data;
    const attempt = getJobAttempt(job);
    let shopLease = null;
    let leaseRenewal = null;
    let submittedBulkOperationId = null;
    let submittedBulkOperationStatus = null;
    let submittedTargetMirrorBatchId = null;
    let submittedBatchId = null;
    let submittedFormattedProductCount = 0;
    let submittedChangeRecordCount = 0;
    let submittedTotalRows = 0;
    let activeFilePath = filePath;

    try {
      const lock = await acquireExclusiveShopWork({
        shop,
        activity: "bulk_import_edit_execution",
        worker: WORKER_NAME,
        queue: QUEUE_NAME,
        jobId: job.id,
        entityType: "editHistory",
        entityId: historyId,
        executionId,
      });

      if (!lock.acquired) {
        throw new RetryableImportEditError(
          "Another heavy job is already running for this shop",
          "shop_work_conflict",
        );
      }

      shopLease = lock;
      leaseRenewal = startExclusiveShopWorkRenewal(lock, {
        onRenewalError: (error) => {
          logger.error("Failed to renew bulk import edit shop lease", {
            shop,
            historyId,
            message: error.message,
          });
        },
      });

      const claimResult = await claimImportHistoryForShop({
        historyId,
        shop,
        executionId,
        jobId: job.id,
        attempt,
      });
      const history = claimResult.history;

      if (["terminal", "awaiting_shopify", "already_dispatching", "not_claimed"].includes(claimResult.state)) {
        return {
          skipped: true,
          reason: claimResult.state,
        };
      }

      const session = await getSession(history.shop);
      if (!session?.shop || session.shop !== history.shop) {
        throw new Error("Shop session not available for import edit execution");
      }

      if (claimResult.state === "stale_dispatch_reconciliation_required") {
        const reconciled = await reconcileStaleImportDispatch({
          history,
          session,
          shop,
          historyId,
        });

        return {
          skipped: true,
          reason: reconciled.reconciled
            ? "stale_dispatch_reconciled"
            : "stale_dispatch_unresolved",
          bulkOperationId: reconciled.bulkOperationId,
        };
      }

      const productMap = new Map();
      let totalRows = 0;
      activeFilePath = await ensureLocalCsvFile({ filePath, fileUrl, historyId });

      await new Promise((resolve, reject) => {
        fs.createReadStream(activeFilePath)
          .pipe(csv())
          .on("data", (row) => {
            totalRows += 1;
            buildMappedProductRows(columnMappings, row, productMap);
          })
          .on("end", resolve)
          .on("error", reject);
      });

      const productIds = [...productMap.keys()];
      const store = await prisma.store.findUnique({
        where: { shopUrl: history.shop },
        select: { activeMirrorBatchId: true },
      });
      const targetCatalogBatchId =
        history.targetCatalogBatchId ||
        history.targetMirrorBatchId ||
        store?.activeMirrorBatchId ||
        null;

      if (!targetCatalogBatchId) {
        throw new Error("Import edit requires an active target catalog batch");
      }

      assertExclusiveShopWorkLeaseActive(shopLease);
      const existingProducts = await prisma.product.findMany({
        where: {
          shop: history.shop,
          id: { in: productIds },
          catalogBatchId: targetCatalogBatchId,
        },
        include: {
          variants: {
            where: { catalogBatchId: targetCatalogBatchId },
            orderBy: { id: "asc" },
          },
        },
      });

      const existingById = existingProducts.reduce((accumulator, product) => {
        accumulator[product.id] = product;
        return accumulator;
      }, {});

      const formattedProducts = [];
      const changeRecords = [];
      const batchId = String(job.id);

      for (const { productSet } of productMap.values()) {
        const existingProduct = existingById[productSet.id];
        if (!existingProduct) {
          continue;
        }

        const existingProductForDiff = {
          ...existingProduct,
          descriptionHtml: existingProduct.description,
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
        await prisma.editHistory.updateMany({
          where: {
            id: historyId,
            shop: history.shop,
            executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
            bulkOperationId: null,
          },
          data: {
            totalRows,
            totalItems: 0,
            status: "failed",
            executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
            error: {
              message: "No valid changes were detected in the import file",
            },
          },
        });
        await removeLocalFile(activeFilePath);
        return {
          skipped: true,
          reason: "no_valid_changes",
        };
      }

      if (changeRecords.length) {
        await prisma.changeRecord.deleteMany({
          where: { editHistoryId: historyId, shop: history.shop, batchId },
        });
        await prisma.changeRecord.createMany({
          data: changeRecords,
        });
      }

      assertExclusiveShopWorkLeaseActive(shopLease);
      const currentBulkOperation = await getCurrentBulkOperationStatus(session);
      if (["CREATED", "RUNNING", "CANCELING"].includes(currentBulkOperation.status)) {
        throw new RetryableImportEditError(
          "A Shopify bulk mutation is already running for this shop",
          "shopify_bulk_busy",
        );
      }

      const service = new ProductBulkService(session);
      assertExclusiveShopWorkLeaseActive(shopLease);
      const result = await service._bulkOperationHelper({
        formattedProducts: formattedProducts.join("\n"),
        field: "mixed",
        fields: ["mixed"],
      });

      if (!result?.bulkOperation?.id) {
        throw new Error("Missing bulkOperationId in Shopify response");
      }

      submittedBulkOperationId = result.bulkOperation.id;
      submittedBulkOperationStatus = result.bulkOperation.status || null;
      submittedTargetMirrorBatchId = targetCatalogBatchId;
      submittedBatchId = batchId;
      submittedFormattedProductCount = formattedProducts.length;
      submittedChangeRecordCount = changeRecords.length;
      submittedTotalRows = totalRows;

      await prisma.editHistory.update({
        where: { id: historyId },
        data: {
          totalRows,
          totalItems: formattedProducts.length,
          targetCatalogBatchId,
          targetMirrorBatchId: targetCatalogBatchId,
          bulkOperationId: submittedBulkOperationId,
          processingBatchId: batchId,
          executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
          batch: {
            ...asObject(history.batch),
            lastProductId: null,
            hasMore: false,
            size: 0,
            currentBatchId: batchId,
            currentBatchTargetCount: formattedProducts.length,
            currentBatchCount: changeRecords.length,
            lastSubmittedBulkOperationId: submittedBulkOperationId,
            lastSubmittedBulkOperationStatus: submittedBulkOperationStatus,
            dispatchCompletedAt: new Date().toISOString(),
          },
        },
      });

      await prisma.spreadsheetFile.updateMany({
        where: { editHistoryId: historyId },
        data: { totalRows },
      });

      await clearKeyCaches(`${history.shop}:fetchHistories`);
      await removeLocalFile(activeFilePath);

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

      if (submittedBulkOperationId) {
        try {
          await prisma.editHistory.updateMany({
            where: {
              id: historyId,
              ...(shop ? { shop } : {}),
              executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
              bulkOperationId: null,
            },
            data: {
              status: "processing",
              totalRows: submittedTotalRows,
              totalItems: submittedFormattedProductCount,
              targetCatalogBatchId: submittedTargetMirrorBatchId,
              targetMirrorBatchId: submittedTargetMirrorBatchId,
              bulkOperationId: submittedBulkOperationId,
              processingBatchId: submittedBatchId,
              executionState: BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY,
              failureStage: null,
              batch: {
                lastProductId: null,
                hasMore: false,
                size: 0,
                currentBatchId: submittedBatchId,
                currentBatchTargetCount: submittedFormattedProductCount,
                currentBatchCount: submittedChangeRecordCount,
                lastSubmittedBulkOperationId: submittedBulkOperationId,
                lastSubmittedBulkOperationStatus: submittedBulkOperationStatus,
                dispatchRecoveredAt: new Date().toISOString(),
              },
            },
          });

          await prisma.spreadsheetFile.updateMany({
            where: { editHistoryId: historyId },
            data: { totalRows: submittedTotalRows },
          }).catch(() => {});

          await removeLocalFile(activeFilePath);
          return {
            success: true,
            recovered: true,
            historyId,
            bulkOperationId: submittedBulkOperationId,
          };
        } catch (recoveryError) {
          logger.error("Failed to persist submitted import edit bulk operation", {
            worker: WORKER_NAME,
            queue: QUEUE_NAME,
            jobId: job.id,
            shop,
            historyId,
            bulkOperationId: submittedBulkOperationId,
            message: recoveryError.message,
          });
          throw error;
        }
      }

      if (!isRetryableError(error)) {
        await removeLocalFile(activeFilePath);
      } else if (activeFilePath && activeFilePath !== filePath) {
        await removeLocalFile(activeFilePath);
      }

      if (isRetryableError(error)) {
        const existing = await prisma.editHistory.findFirst({
          where: { id: historyId, ...(shop ? { shop } : {}) },
          select: { error: true },
        });

        await prisma.editHistory.updateMany({
          where: {
            id: historyId,
            ...(shop ? { shop } : {}),
            executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
            bulkOperationId: null,
          },
          data: {
            status: "pending",
            executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
            failureStage: error.code || "retryable_import_edit",
            error: appendExecutionError(
              existing?.error,
              buildExecutionError({
                code: error.code || "retryable_import_edit",
                stage: "queue_execution",
                message: error.message,
                retryable: true,
                details: {
                  stack: error.stack || null,
                  failedAt: new Date().toISOString(),
                  attempt,
                },
              }),
            ),
          },
        });
        await clearKeyCaches(`${shop}:fetchHistories`).catch(() => {});
      } else {
        const existing = await prisma.editHistory.findFirst({
          where: { id: historyId, ...(shop ? { shop } : {}) },
          select: { error: true },
        });

        await prisma.editHistory.updateMany({
          where: { id: historyId, ...(shop ? { shop } : {}) },
          data: {
            status: "failed",
            executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
            error: appendExecutionError(
              existing?.error,
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
        await clearKeyCaches(`${shop}:fetchHistories`).catch(() => {});
      }

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

      throw error;
    } finally {
      if (leaseRenewal) {
        clearInterval(leaseRenewal);
      }
      await releaseExclusiveShopWork(shopLease);
    }
  },
  { connection, concurrency: 1 },
);

bulkImportEditWorker.on("failed", (job, error) => {
  logger.error("Bulk import worker failed", {
    worker: WORKER_NAME,
    queue: QUEUE_NAME,
    jobId: job?.id,
    shop: job?.data?.shop,
    historyId: job?.data?.historyId,
    executionId: job?.data?.executionId || null,
    attempt: getJobAttempt(job),
    message: error.message,
  });
});

bulkImportEditWorker.on("failed", async (job) => {
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
    await removeLocalFile(job?.data?.filePath);
  }
});

export default bulkImportEditWorker;
