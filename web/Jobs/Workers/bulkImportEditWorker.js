import { Worker } from "bullmq";
import fs from "fs";
import { promises as fsPromises } from "fs";
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
import { prisma } from "../../config/database.js";
import { getSession } from "../../utils/sessionHandler.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";
import { getJobAttempt, isRetryExhausted, recordRetryExhausted } from "../../utils/workerTelemetry.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
} from "../../services/bulkEditExecutionStateService.js";
import {
  RetryableWorkerError,
  assertShopActiveForWorker,
  isRetryableWorkerError,
  isSkippableWorkerError,
} from "../../services/workerSafetyService.js";

const QUEUE_NAME = process.env.IMPORT_EDIT_QUEUE || "importEdit";
const WORKER_NAME = "bulkImportEditWorker";
const STALE_DISPATCH_MS = 20 * 60 * 1000;

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

async function claimImportHistory(historyId) {
  return claimImportHistoryForShop(historyId, null);
}

function normalizeBatchState(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isStaleDispatch(batch) {
  const startedAt = batch?.dispatchStartedAt;
  if (!startedAt) {
    return false;
  }

  const startedTs = new Date(startedAt).getTime();
  if (Number.isNaN(startedTs)) {
    return false;
  }

  return Date.now() - startedTs > STALE_DISPATCH_MS;
}

async function claimImportHistoryForShop(historyId, shop) {
  const history = await prisma.editHistory.findUnique({
    where: { id: historyId },
    select: {
      id: true,
      shop: true,
      status: true,
      executionState: true,
      bulkOperationId: true,
      batch: true,
      error: true,
    },
  });

  if (!history) {
    throw new Error("History document not found");
  }

  if (shop && history.shop !== shop) {
    throw new Error("Cross-shop import execution blocked");
  }

  if (
    history.executionState === BULK_EDIT_EXECUTION_STATES.AWAITING_SHOPIFY &&
    history.bulkOperationId
  ) {
    return { state: "awaiting_shopify", history };
  }

  if (
    ["completed", "cancelled", "partial"].includes(history.status) ||
    history.executionState === BULK_EDIT_EXECUTION_STATES.COMPLETED
  ) {
    return { state: "terminal", history };
  }

  const batch = normalizeBatchState(history.batch);
  if (
    history.status === "processing" &&
    history.executionState === BULK_EDIT_EXECUTION_STATES.DISPATCHING &&
    !history.bulkOperationId
  ) {
    if (isStaleDispatch(batch)) {
      await prisma.editHistory.updateMany({
        where: {
          id: historyId,
          ...(shop ? { shop } : {}),
          bulkOperationId: null,
          executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
        },
        data: {
          status: "failed",
          executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
          error: appendExecutionError(
            history.error,
            buildExecutionError({
              code: "import_dispatch_stalled",
              stage: "dispatch",
              message: "Import dispatch stalled before Shopify confirmed the mutation",
              retryable: false,
              details: {
                dispatchStartedAt: batch.dispatchStartedAt || null,
                dispatchJobId: batch.dispatchJobId || null,
                dispatchAttempt: batch.dispatchAttempt || null,
              },
            }),
          ),
        },
      });

      return { state: "stale_dispatch_failed", history };
    }

    throw new RetryableWorkerError(
      "Import dispatch is already in progress",
      "import_dispatch_in_progress",
    );
  }

  const result = await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      ...(shop ? { shop } : {}),
      status: { in: ["pending", "failed"] },
      bulkOperationId: null,
      executionState: {
        in: [
          BULK_EDIT_EXECUTION_STATES.PLANNED,
          BULK_EDIT_EXECUTION_STATES.QUEUED,
          BULK_EDIT_EXECUTION_STATES.FAILED,
        ],
      },
    },
    data: {
      status: "processing",
      executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
    },
  });

  return { state: result.count === 1 ? "claimed" : "already_claimed", history };
}

async function reserveImportDispatch({
  historyId,
  shop,
  batchId,
  executionId,
  attempt,
  jobId,
  totalRows,
  targetCount,
  changeCount,
}) {
  const history = await prisma.editHistory.findUnique({
    where: { id: historyId },
    select: {
      batch: true,
      bulkOperationId: true,
    },
  });

  if (history?.bulkOperationId) {
    throw new RetryableWorkerError(
      "Import batch already dispatched to Shopify",
      "import_bulk_operation_already_started",
    );
  }

  const batch = normalizeBatchState(history?.batch);
  const updated = await prisma.editHistory.updateMany({
    where: {
      id: historyId,
      shop,
      status: "processing",
      bulkOperationId: null,
      executionState: {
        in: [
          BULK_EDIT_EXECUTION_STATES.QUEUED,
          BULK_EDIT_EXECUTION_STATES.DISPATCHING,
        ],
      },
    },
    data: {
      executionState: BULK_EDIT_EXECUTION_STATES.DISPATCHING,
      processingBatchId: batchId,
      batch: {
        ...batch,
        currentBatchId: batchId,
        dispatchStartedAt: new Date().toISOString(),
        dispatchJobId: jobId,
        dispatchAttempt: attempt,
        dispatchExecutionId: executionId,
        totalRows,
        currentBatchTargetCount: targetCount,
        currentBatchCount: changeCount,
      },
    },
  });

  if (!updated.count) {
    throw new RetryableWorkerError(
      "Import dispatch reservation was lost",
      "import_dispatch_claim_lost",
    );
  }
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
    const { historyId, shop, filePath, columnMappings, executionId = null } = job.data;
    const attempt = getJobAttempt(job);

    try {
      await assertShopActiveForWorker(shop);

      const claim = await claimImportHistoryForShop(historyId, shop);
      if (claim.state !== "claimed") {
        return {
          skipped: true,
          reason: claim.state,
        };
      }

      const history = claim.history;
      await clearKeyCaches(`${history.shop}:fetchHistories`);

      const productMap = new Map();
      let totalRows = 0;

      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on("data", (row) => {
            totalRows += 1;
            buildMappedProductRows(columnMappings, row, productMap);
          })
          .on("end", resolve)
          .on("error", reject);
      });

      const productIds = [...productMap.keys()];
      const existingProducts = await prisma.product.findMany({
        where: {
          shop: history.shop,
          id: { in: productIds },
        },
        include: { variants: true },
      });

      const existingById = existingProducts.reduce((accumulator, product) => {
        accumulator[product.id] = product;
        return accumulator;
      }, {});

      const formattedProducts = [];
      const changeRecords = [];
      const batchId = executionId || `import:${historyId}`;

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
      await prisma.editHistory.update({
        where: { id: historyId },
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
        await removeLocalFile(filePath);
        return {
          skipped: true,
          reason: "no_valid_changes",
        };
      }

      if (changeRecords.length) {
        await prisma.changeRecord.deleteMany({
          where: {
            editHistoryId: historyId,
            shop: history.shop,
            batchId,
          },
        });

        await prisma.changeRecord.createMany({
          data: changeRecords,
        });
      }

      await reserveImportDispatch({
        historyId,
        shop: history.shop,
        batchId,
        executionId,
        attempt,
        jobId: String(job.id),
        totalRows,
        targetCount: formattedProducts.length,
        changeCount: changeRecords.length,
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

      await prisma.editHistory.update({
        where: { id: historyId },
        data: {
          totalRows,
          totalItems: formattedProducts.length,
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

      if (!isRetryableWorkerError(error)) {
        await prisma.editHistory.updateMany({
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

      if (isSkippableWorkerError(error)) {
        return {
          skipped: true,
          reason: error.code,
        };
      }

      throw error;
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
  }
});

export default bulkImportEditWorker;
