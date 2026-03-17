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

// 🔹 Prisma
import { prisma } from "../../config/database.js";


const QUEUE_NAME = process.env.EXPORT_QUEUE;

/* =========================
   FIELD RESOLVERS (PRISMA)
========================= */

// Product here is Prisma Product with:
// - tags: string[]
// - seoTitle / seoDescription
// - collectionsJson: Json?  => expected [{ title, ... }, ...]
// - categoryName: string?
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
    if (!raw) return "";
    // collectionsJson should be an array of { title, ... }
    const arr = Array.isArray(raw) ? raw : [];
    return arr.map((c) => c?.title).filter(Boolean).join(", ");
  },
  category: (p) => p.categoryName ?? "",
};

// Variant is Prisma Variant (included via relation)
const VARIANT_FIELD_RESOLVERS = {
  price: (v) => v.price ?? "",
  compareAtPrice: (v) => v.compareAtPrice ?? "",
  sku: (v) => v.sku ?? "",
  barcode: (v) => v.barcode ?? "",
  taxable: (v) => (typeof v.taxable === "boolean" ? v.taxable : ""),
  inventoryQuantity: (v) => v.inventoryQuantity ?? "",
};

/* =========================
   WORKER
========================= */

const bulkExportWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { exportJobId, shop, fields } = job.data;

    logger.info("[Export] Started", { exportJobId, shop });

    // Mongo: ExportJob.findById(exportJobId)
    const exportJob = await prisma.exportJob.findUnique({
      where: { id: exportJobId },
    });

    if (!exportJob) {
      throw new Error("Export job not found");
    }

    const startTime = Date.now();

    try {
      // Mongo: exportJob.status = "PROCESSING"; exportJob.save()
      await prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: "PROCESSING",
          startedAt: new Date(),
        },
      });

      await clearKeyCaches(`${shop}:fetchExportHistories:`);

      const filePath = path.join(os.tmpdir(), exportJob.filename);
      const writeStream = fs.createWriteStream(filePath);
      const csvStream = format({ headers: true });

      csvStream.pipe(writeStream);

      // ⚠️ IMPORTANT:
      // exportJob.filterQuery must contain a Prisma-compatible `where` object (stringified).
      // If it still contains legacy Mongo filter, convert it before using.
      let where = {};
      try {
        const parsed = JSON.parse(exportJob.filterQuery || "{}");
        if (parsed && typeof parsed === "object") {
          where = parsed;
        }
      } catch {
        where = {};
      }

      // Always scope by shop for multi-tenant safety
      where = { ...(where || {}), shop };

      let totalRows = 0;

      // ──────────────────────────────────────────────────────────
      // Prisma batched pagination (no native cursor streaming)
      // ──────────────────────────────────────────────────────────
      const PAGE_SIZE = 500;
      let lastProductId = null;
      let hasMore = true;

      while (hasMore) {
        const products = await prisma.product.findMany({
          where,
          include: {
            variants: true,
          },
          orderBy: {
            id: "asc",
          },
          take: PAGE_SIZE,
          ...(lastProductId
            ? {
                cursor: {
                  // composite PK: @@id([shop, id])
                  shop,
                  id: lastProductId,
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

          // ✅ If no variants, export only product data
          if (!variants.length) {
            const row = { productId };

            for (const field of fields) {
              const resolver = PRODUCT_FIELD_RESOLVERS[field];
              if (resolver) {
                row[field] = resolver(product);
              }
            }

            csvStream.write(row);
            totalRows++;
            continue;
          }

          // ✅ If variants exist
          for (let i = 0; i < variants.length; i++) {
            const variant = variants[i];

            const row = {
              productId: i === 0 ? productId : "",
              variantId: variant.id,
            };

            for (const field of fields) {
              // Product fields → only first row
              const productResolver = PRODUCT_FIELD_RESOLVERS[field];
              if (productResolver) {
                row[field] = i === 0 ? productResolver(product) : "";
              }

              // Variant fields → every row
              const variantResolver = VARIANT_FIELD_RESOLVERS[field];
              if (variantResolver) {
                row[field] = variantResolver(variant);
              }
            }

            csvStream.write(row);
            totalRows++;
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

      const fileUrl = await uploadCsvToCloudinary(
        filePath,
        exportJobId,
        exportJob.filename,
      );

      await fs.promises.unlink(filePath);

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

      await clearKeyCaches(`${shop}:fetchExportHistories:`);

      logger.info("[Export] Completed", {
        exportJobId,
        totalRows,
        durationMs,
      });
    } catch (error) {
      logger.error("[Export] Failed", {
        exportJobId,
        error: error.message,
      });

      try {
        await prisma.exportJob.update({
          where: { id: exportJobId },
          data: {
            status: "FAILED",
            error: error.message,
          },
        });
      } catch (updateErr) {
        logger.error("[Export] Failed to update job status", {
          exportJobId,
          error: updateErr.message,
        });
      }

      await clearKeyCaches(`${shop}:fetchExportHistories:`);
      throw error;
    }
  },
  { connection, concurrency: 2 },
);

export default bulkExportWorker;