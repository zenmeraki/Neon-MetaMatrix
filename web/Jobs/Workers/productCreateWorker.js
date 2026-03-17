// web/Jobs/Workers/productCreateWorker.js
import logger from "../../utils/loggerUtils.js";
import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import CacheService from "../../utils/cacheService.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { transformWebhookPayload } from "../../utils/webhookTransformers.js";

import { prisma } from "../../config/database.js";


const QueueName =
  process.env.NODE_ENV === "production"
    ? "product-create"
    : "product-create-job-dev";

const productCreateWorker = new Worker(
  QueueName,
  async (job) => {
    try {
      const { shop, id, ...payload } = job.data;

      const cache = await CacheService.get(`${shop}:PRODUCT_CREATE`);
      if (cache) {
        return {
          message:
            "ignored product create webhook – bulk operation running in background",
        };
      }

      // 🔄 Transform webhook payload into Product + Variants DTO for Prisma
      // You should shape this to match your Prisma models (Product, Variant)
      const { product, variants } = transformWebhookPayload(payload, shop);

      // ─────────────────────────────────────────────────────────────
      // Prisma upsert: Product + full variant replacement
      // ─────────────────────────────────────────────────────────────

      await prisma.$transaction(async (tx) => {
        // 1️⃣ Upsert product
        await tx.product.upsert({
          where: {
            // composite @@id([shop, id]) → unique input is { shop_id: { shop, id } }
            shop_id: { shop, id },
          },
          update: {
            // `product` object should only contain Product fields
            ...product,
          },
          create: {
            shop,
            id,
            ...product,
          },
        });

        // 2️⃣ Replace variants for this product (simple strategy)
        if (Array.isArray(variants)) {
          // wipe old variants for {shop, productId}
          await tx.variant.deleteMany({
            where: {
              shop,
              productId: id,
            },
          });

          if (variants.length > 0) {
            const variantData = variants.map((v) => ({
              // Prisma Variant fields
              shop,
              id: v.id,
              productId: id,
              title: v.title ?? null,
              sku: v.sku ?? null,
              barcode: v.barcode ?? null,
              price:
                typeof v.price === "number"
                  ? v.price
                  : v.price != null
                  ? Number(v.price)
                  : null,
              compareAtPrice:
                typeof v.compareAtPrice === "number"
                  ? v.compareAtPrice
                  : v.compareAtPrice != null
                  ? Number(v.compareAtPrice)
                  : null,
              inventoryQuantity:
                v.inventoryQuantity != null
                  ? Number(v.inventoryQuantity)
                  : null,
              inventoryPolicy: v.inventoryPolicy ?? null,
              taxable:
                typeof v.taxable === "boolean"
                  ? v.taxable
                  : v.taxable != null
                  ? v.taxable === "true" || v.taxable === "TRUE"
                  : null,
              taxCode: v.taxCode ?? null,
              position:
                v.position != null ? Number(v.position) : null,
              selectedOptionsJson: v.selectedOptionsJson ?? null,
            }));

            // bulk insert new variant
            await tx.variant.createMany({
              data: variantData,
            });
          }
        }
      });

      // 🔁 Clear caches
      await clearKeyCaches(`${shop}:ProductFetch:`);
      await clearKeyCaches(`${shop}:productTypes:`);

      return { success: true, productId: id };
    } catch (err) {
      // Let BullMQ handle retries
      throw err;
    }
  },
  {
    connection,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  },
);

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

if (process.env.NODE_ENV !== "production") {
  productCreateWorker
    .on("error", (err) => {
      logger.error(
        `${logTime()} ❌ Queue Error in productCreateWorker: ${err.message}`,
        {
          stack: err.stack,
        },
      );
    })
    .on("waiting", (jobId) => {
      logger.info(
        `${logTime()} ⏳ productCreateWorker - Job waiting | Job ID: ${jobId}`,
      );
    })
    .on("active", (job) => {
      logger.info(
        `${logTime()} 🚀 productCreateWorker - Job started | Job ID: ${job.id}`,
      );
    })
    .on("completed", (job, result) => {
      logger.info(
        `${logTime()} ✅ productCreateWorker - Job completed | Job ID: ${job.id}`,
        { result },
      );
    })
    .on("failed", (job, err) => {
      logger.error(
        `${logTime()} ❗ productCreateWorker - Job failed | Job ID: ${
          job.id
        } | Error: ${err.message}`,
        { error: err },
      );
    });
}

export default productCreateWorker;