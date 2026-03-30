// web/Jobs/Workers/productUpdateWorker.js
import logger from "../../utils/loggerUtils.js";
import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import CacheService from "../../utils/cacheService.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { transformWebhookPayload } from "../../utils/webhookTransformers.js";

import { prisma } from "../../Config/database.js";

const QueueName =
  process.env.NODE_ENV === "production"
    ? "product-update"
    : "product-update-job-dev";

const productUpdateWorker = new Worker(
  QueueName,
  async (job) => {
    try {
      const { shop, id, ...payload } = job.data;

      // Optional throttling based on cache
      // const cache = await CacheService.get(`${shop}:PRODUCT_UPDATE`);
      // if (cache) {
      //   return {
      //     message:
      //       "ignored product update webhook bulk operation running in background",
      //   };
      // }

      // Transform webhook payload to match Prisma Product structure
      const transformedData = transformWebhookPayload(payload, shop);

      await prisma.product.upsert({
        where: {
          // composite PK from @@id([shop, id])
          shop_id: {
            shop,
            id,
          },
        },
        update: {
          ...transformedData,
        },
        create: {
          shop,
          id,
          ...transformedData,
        },
      });

      await clearKeyCaches(`${shop}:ProductFetch:`);
      await clearKeyCaches(`${shop}:productTypes:`);
      await clearKeyCaches(`${shop}:ProductFilterValues:`);

      return { success: true, productId: id };
    } catch (err) {
      throw err; // keep BullMQ retry behavior
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
  productUpdateWorker
    .on("error", (err) => {
      logger.error(
        `${logTime()} ❌ Queue Error in productUpdateWorker: ${err.message}`,
        { stack: err.stack },
      );
    })
    .on("waiting", (jobId) => {
      logger.info(
        `${logTime()} ⏳ productUpdateWorker - Waiting | Job ID: ${jobId}`,
      );
    })
    .on("active", (job) => {
      logger.info(
        `${logTime()} 🚀 productUpdateWorker - Started | Job ID: ${job.id}`,
        { message: "active" },
      );
    })
    .on("completed", (job, result) => {
      logger.info(
        `${logTime()} ✅ productUpdateWorker - Completed | Job ID: ${job.id}`,
        { result },
      );
    })
    .on("failed", (job, err) => {
      logger.error(
        `${logTime()} ❗ productUpdateWorker - Failed | Job ID: ${
          job.id
        } | Error: ${err.message}`,
        { error: err },
      );
    });
}

export default productUpdateWorker;
