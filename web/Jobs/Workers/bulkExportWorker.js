// web/Jobs/Workers/bulkExportWorker.js
import logger from "../../utils/loggerUtils.js";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { uploadCsvToCloudinary } from "../../utils/uploadCsvToCloudinary.js";
import fs from "fs";
import path from "path";
import os from "os";
import { format } from "@fast-csv/format";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { prisma } from "../../Config/database.js";
import { finalizeScheduledExportRunFromExportJob } from "../../services/scheduledExportExecutionService.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE;

/* =========================
   MEMORY LOGGER
========================= */

const logMemoryUsage = (label = "") => {
  const used = process.memoryUsage();

  logger.info(`[Memory] ${label}`, {
    rssMB: (used.rss / 1024 / 1024).toFixed(2),
    heapTotalMB: (used.heapTotal / 1024 / 1024).toFixed(2),
    heapUsedMB: (used.heapUsed / 1024 / 1024).toFixed(2),
    externalMB: (used.external / 1024 / 1024).toFixed(2),
  });
};

/* =========================
   FIELD RESOLVERS (PRISMA)
========================= */

const PRODUCT_FIELD_RESOLVERS = {
  title: (p) => p.title ?? "",
  description: (p) => p.description ?? "",
  vendor: (p) => p.vendor ?? "",
  productType: (p) => p.productType ?? "",
  handle: (p) => p.handle ?? "",
  status: (p) => p.status ?? "",
  metaTitle: (p) => p.seoTitle ?? "",
  metaDescription: (p) => p.seoDescription ?? "",
  tags: (p) => (Array.isArray(p.tags) ? p.tags.join(", ") : ""),
  collections: (p) => {
    const raw = p.collectionsJson;
    if (!Array.isArray(raw)) return "";
    return raw.map((c) => c?.title).filter(Boolean).join(", ");
  },
  category: (p) => p.categoryName ?? "",
};

const VARIANT_FIELD_RESOLVERS = {
  price: (v) => v.price ?? "",
  compareAtPrice: (v) => v.compareAtPrice ?? "",
  sku: (v) => v.sku ?? "",
  barcode: (v) => v.barcode ?? "",
  taxable: (v) => (typeof v.taxable === "boolean" ? v.taxable : ""),
  variantTitle: (v) => v.title ?? "",
  inventoryQuantity: (v) => v.inventoryQuantity ?? "",
};

/* =========================
   FILTER NORMALIZATION
========================= */

/**
 * IMPORTANT:
 * This worker assumes exportJob.filterQuery stores a Prisma-compatible where object,
 * not a legacy Mongo filter.
 *
 * If your codebase still stores Mongo filters in ExportJob.filterQuery,
 * convert them before queueing the job or add a dedicated translator here.
 */
function parseExportWhere(filterQuery, shop) {
  let parsed = {};

  try {
    const raw = JSON.parse(filterQuery || "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      parsed = raw;
    }
  } catch (error) {
    logger.warn("[Export] Invalid filterQuery JSON; falling back to shop scope", {
      error: error.message,
    });
  }

  return {
    AND: [
      parsed,
      { shop },
    ],
  };
}

async function claimExportJob(exportJobId, shop) {
  return prisma.$transaction(async (tx) => {
    const currentJob = await tx.exportJob.findUnique({
      where: { id: exportJobId },
    });

    if (!currentJob) {
      throw new Error("Export job not found");
    }

    if (currentJob.status === "COMPLETED") {
      return { state: "completed", exportJob: currentJob };
    }

    if (currentJob.status === "FAILED") {
      return { state: "failed", exportJob: currentJob };
    }

    if (currentJob.status === "PROCESSING") {
      return { state: "processing", exportJob: currentJob };
    }

    const activeExport = await tx.exportJob.findFirst({
      where: {
        shop,
        status: "PROCESSING",
        id: {
          not: exportJobId,
        },
      },
      select: { id: true },
    });

    if (activeExport) {
      return { state: "shop_busy", exportJob: currentJob };
    }

    const updated = await tx.exportJob.updateMany({
      where: {
        id: exportJobId,
        status: "PENDING",
      },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
        error: null,
      },
    });

    if (updated.count !== 1) {
      return { state: "not_claimed", exportJob: currentJob };
    }

    const claimedJob = await tx.exportJob.findUnique({
      where: { id: exportJobId },
    });

    return { state: "claimed", exportJob: claimedJob };
  });
}

/* =========================
   WORKER
========================= */

const bulkExportWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { exportJobId, shop, fields } = job.data;

    logger.info("[Export] Started", { exportJobId, shop });
    logMemoryUsage("Before Job Start");

    const claimResult = await claimExportJob(exportJobId, shop);
    const exportJob = claimResult.exportJob;

    if (!exportJob) {
      throw new Error("Export job not found");
    }

    if (claimResult.state === "completed" || claimResult.state === "failed") {
      return { skipped: true, reason: `job_${claimResult.state}` };
    }

    if (claimResult.state === "processing" || claimResult.state === "not_claimed") {
      return { skipped: true, reason: "job_already_claimed" };
    }

    if (claimResult.state === "shop_busy") {
      throw new Error("Another export is already processing for this shop");
    }

    const startTime = Date.now();
    let filePath = null;

    const memoryInterval = setInterval(() => {
      logMemoryUsage("Interval Snapshot");
    }, 30000);

    try {
      await clearKeyCaches(`${shop}:fetchExportHistories:`);

      filePath = path.join(os.tmpdir(), exportJob.filename);
      const writeStream = fs.createWriteStream(filePath);
      const csvStream = format({ headers: true });

      csvStream.pipe(writeStream);

      const where = parseExportWhere(exportJob.filterQuery, shop);

      let totalRows = 0;
      const PAGE_SIZE = 500;
      let lastProductId = null;
      let hasMore = true;

      while (hasMore) {
        const products = await prisma.product.findMany({
          where,
          include: {
            variants: {
              orderBy: { id: "asc" },
            },
          },
          orderBy: {
            id: "asc",
          },
          take: PAGE_SIZE,
          ...(lastProductId
            ? {
                cursor: {
                  shop_id: {
                    shop,
                    id: lastProductId,
                  },
                },
                skip: 1,
              }
            : {}),
        });

        if (!products.length) {
          hasMore = false;
          break;
        }

        for (const product of products) {
          const productId = product.id;
          const variants = product.variants ?? [];

          if (!variants.length) {
            const row = { id: productId };

            for (const field of fields || exportJob.fields) {
              const productResolver = PRODUCT_FIELD_RESOLVERS[field];
              if (productResolver) {
                row[field] = productResolver(product);
              }
            }

            csvStream.write(row);
            totalRows++;
          } else {
            for (let i = 0; i < variants.length; i++) {
              const variant = variants[i];

              const row = {
                id: productId,
                variant_id: variant.id,
              };

              for (const field of fields || exportJob.fields) {
                const productResolver = PRODUCT_FIELD_RESOLVERS[field];
                if (productResolver) {
                  row[field] = i === 0 ? productResolver(product) : "";
                }

                const variantResolver = VARIANT_FIELD_RESOLVERS[field];
                if (variantResolver) {
                  row[field] = variantResolver(variant);
                }
              }

              csvStream.write(row);
              totalRows++;
            }
          }

          if (totalRows > 0 && totalRows % 1000 === 0) {
            logMemoryUsage(`After ${totalRows} rows`);
          }
        }

        lastProductId = products[products.length - 1].id;
        hasMore = products.length === PAGE_SIZE;
      }

      csvStream.end();

      await new Promise((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      logMemoryUsage("After CSV Creation");

      const fileUrl = await uploadCsvToCloudinary(
        filePath,
        exportJob.filename || exportJobId,
      );

      await fs.promises.unlink(filePath);
      filePath = null;

      const durationMs = Date.now() - startTime;

      await prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: "COMPLETED",
          fileUrl,
          totalItems: totalRows,
          durationMs,
          completedAt: new Date(),
        },
      });

      await finalizeScheduledExportRunFromExportJob({
        exportJobId,
        status: "SUCCESS",
      }).catch(() => {});

      await clearKeyCaches(`${shop}:fetchExportHistories:`);

      logger.info("[Export] Completed", {
        exportJobId,
        totalRows,
        durationMs,
      });

      logMemoryUsage("After Job Completed");
    } catch (error) {
      logger.error("[Export] Failed", {
        exportJobId,
        error: error.message,
        stack: error.stack,
      });

      try {
        await prisma.exportJob.update({
          where: { id: exportJobId },
          data: {
            status: "FAILED",
            error: error.message,
            completedAt: new Date(),
          },
        });
      } catch (updateError) {
        logger.error("[Export] Failed to update export job status", {
          exportJobId,
          error: updateError.message,
        });
      }

      await finalizeScheduledExportRunFromExportJob({
        exportJobId,
        status: "FAILED",
        errorMessage: error.message,
      }).catch(() => {});

      await clearKeyCaches(`${shop}:fetchExportHistories:`);

      if (filePath) {
        try {
          await fs.promises.unlink(filePath);
        } catch (unlinkError) {
          logger.warn("[Export] Failed to remove temp file", {
            exportJobId,
            filePath,
            error: unlinkError.message,
          });
        }
      }

      logMemoryUsage("After Job Failed");
      throw error;
    } finally {
      clearInterval(memoryInterval);
    }
  },
  { connection, concurrency: 2 },
);

export default bulkExportWorker;
