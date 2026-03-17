// web/Jobs/Workers/bulkImportEditWorker.js
import { Worker } from "bullmq";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
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

// 🔹 Prisma
import { prisma } from "../../config/database.js";


const QUEUE_NAME = process.env.IMPORT_EDIT_QUEUE || "importEdit";

/* =========================
   UTILS
========================= */

const downloadFile = async (url) => {
  const filePath = path.join(os.tmpdir(), `${Date.now()}.csv`);
  const writer = fs.createWriteStream(filePath);

  const response = await axios.get(url, { responseType: "stream" });
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(filePath));
    writer.on("error", reject);
  });
};

const normalizeBoolean = (v) => v === true || v === "TRUE" || v === "true";

const normalizeNumber = (v) =>
  v !== undefined && v !== "" ? Number(v) : undefined;

/* =========================
   WORKER
========================= */

const bulkImportEditWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { historyId, fileUrl, columnMappings, session } = job.data;

    logger.info("🔵 Job received", { jobId: job.id, historyId });

    try {
      logger.info("🟡 Fetching history record...");
      const history = await prisma.editHistory.findUnique({
        where: { id: historyId },
      });

      if (!history) {
        throw new Error("History record not found");
      }

      // 🔄 set status = processing
      await prisma.editHistory.update({
        where: { id: historyId },
        data: { status: "processing" },
      });
      logger.info("🟢 History status updated to processing");

      await clearKeyCaches(`${history.shop}:fetchHistories`);
      logger.info("🧹 Cache cleared");

      logger.info("⬇️ Downloading CSV file...", { fileUrl });
      const localFile = await downloadFile(fileUrl);
      logger.info("✅ File downloaded", { localFile });

      const productMap = new Map();
      let totalRows = 0;
      const formattedProducts = [];

      /* =========================
         CSV PARSE
      ========================= */

      logger.info("📄 Starting CSV parsing...");

      await new Promise((resolve, reject) => {
        fs.createReadStream(localFile)
          .pipe(csv())
          .on("data", (row) => {
            totalRows++;

            logger.debug("Row parsed", { rowNumber: totalRows });

            const mapped = {};
            for (const [csvCol, field] of Object.entries(columnMappings)) {
              if (field && row[csvCol] !== undefined) {
                mapped[field] = row[csvCol];
              }
            }

            if (!mapped.id) {
              logger.warn("⚠️ Skipping row - no product id", { row });
              return;
            }

            const productId = mapped.id;

            if (!productMap.has(productId)) {
              logger.debug("➕ Creating new product entry", { productId });

              productMap.set(productId, {
                productSet: {
                  id: productId,
                  ...(mapped.title && { title: mapped.title }),
                  ...(mapped.vendor && { vendor: mapped.vendor }),
                  ...(mapped.status && { status: mapped.status }),
                  ...(mapped.description && {
                    descriptionHtml: mapped.description,
                  }),
                  ...(mapped.productType && {
                    productType: mapped.productType,
                  }),
                  ...(mapped.handle && { handle: mapped.handle }),
                  ...(mapped.tags && { tags: mapped.tags }),
                  options: [],
                  variants: [],
                },
              });

              const p = productMap.get(productId).productSet;

              if (mapped.option1Name)
                p.options.push({ name: mapped.option1Name });
              if (mapped.option2Name)
                p.options.push({ name: mapped.option2Name });
              if (mapped.option3Name)
                p.options.push({ name: mapped.option3Name });
            }

            if (mapped.variant_id) {
              logger.debug("➕ Adding variant", {
                productId,
                variantId: mapped.variant_id,
              });

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
          })
          .on("end", () => {
            logger.info("✅ CSV parsing completed", {
              totalRows,
              totalProducts: productMap.size,
            });
            resolve();
          })
          .on("error", (err) => {
            logger.error("❌ CSV parsing error", { error: err.message });
            reject(err);
          });
      });

      /* =========================
         CHANGE RECORD CREATION
      ========================== */

      logger.info("🔍 Starting change detection...");

      for (const { productSet } of productMap.values()) {
        logger.debug("Checking product", { productId: productSet.id });

        // Mongo: Products.findOne({ shop: history.shop, id: productSet.id }).lean()
        const existingProduct = await prisma.product.findFirst({
          where: {
            shop: history.shop,
            id: productSet.id,
          },
          include: {
            variants: true,
          },
        });

        if (!existingProduct) {
          logger.warn("⚠️ Product not found in DB", {
            productId: productSet.id,
          });
          continue;
        }

        const productFieldChanges = diffProductFields(
          existingProduct,
          productSet,
        );
        const variantFieldChanges = diffVariants(
          existingProduct.variants,
          productSet.variants,
        );

        if (!productFieldChanges.length && !variantFieldChanges.length) {
          logger.debug("No changes detected", {
            productId: productSet.id,
          });
          continue;
        }

        logger.info("✏️ Changes detected", {
          productId: productSet.id,
          productChanges: productFieldChanges.length,
          variantChanges: variantFieldChanges.length,
        });

        const mutationPayload = buildProductSetMutation({
          productSet,
          existingProduct,
        });

        formattedProducts.push(JSON.stringify(mutationPayload));

        // Mongo: ChangeRecord.create({...})
        await prisma.changeRecord.create({
          data: {
            editHistoryId: historyId,
            productId: productSet.id,
            shop: history.shop,
            title: existingProduct.title,
            image: existingProduct.featuredImageUrl ?? null,
            scope: "mixed",
            batchId: job.id.toString(),
            productFieldChanges,
            variantFieldChanges,
            status: "pending",
          },
        });
      }

      logger.info("📦 Total mutation payloads prepared", {
        count: formattedProducts.length,
      });

      /* =========================
         SHOPIFY BULK OPERATION
      ========================== */

      const service = new ProductBulkService(session);

      logger.info("🚀 Sending bulk operation to Shopify...");

      const result = await service._bulkOperationHelper({
        formattedProducts: formattedProducts.join("\n"),
        field: "mixed",
      });

      logger.debug("Shopify response", { result });

      if (!result?.bulkOperation?.id) {
        throw new Error("Missing bulkOperationId in Shopify response");
      }

      await prisma.editHistory.update({
        where: { id: historyId },
        data: {
          totalRows,
          bulkOperationId: result.bulkOperation.id,
          totalItems: formattedProducts.length,
        },
      });
      logger.info("✅ History updated with bulk operation ID");

      await clearKeyCaches(`${history.shop}:fetchHistories`);
      logger.info("🧹 Cache cleared again");

      fs.unlinkSync(localFile);
      logger.info("🗑️ Temporary file deleted");
    } catch (error) {
      logger.error("🔥 Worker failed", {
        jobId: job.id,
        error: error.message,
        stack: error.stack,
      });

      try {
        const history = await prisma.editHistory.findUnique({
          where: { id: historyId },
          select: {
            shop: true,
            error: true,
          },
        });

        if (history) {
          const existingErrors = Array.isArray(history.error)
            ? history.error
            : [];

          await prisma.editHistory.update({
            where: { id: historyId },
            data: {
              status: "failed",
              error: [...existingErrors, { message: error.message }],
            },
          });

          await clearKeyCaches(`${history.shop}:fetchHistories`);
        }
      } catch (innerErr) {
        logger.error("🔥 Failed to update history after worker error", {
          jobId: job.id,
          error: innerErr.message,
        });
      }
    }
  },
  { connection, concurrency: 1 },
);

/* =========================
   LOGS
========================= */

if (process.env.NODE_ENV !== "production") {
  bulkImportEditWorker
    .on("active", (job) => logger.info("🚀 Import started", { jobId: job.id }))
    .on("completed", (job) =>
      logger.info("✅ Import completed", { jobId: job.id }),
    )
    .on("failed", (job, err) =>
      logger.error("❌ Import failed", {
        jobId: job?.id,
        error: err.message,
      }),
    );
}

export default bulkImportEditWorker;