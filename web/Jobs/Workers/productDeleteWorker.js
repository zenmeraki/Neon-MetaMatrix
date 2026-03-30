// web/Jobs/Workers/productDeleteWorker.js
import logger from "../../utils/loggerUtils.js";
import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";

import { prisma } from "../../Config/database.js";

const QueueName =
  process.env.NODE_ENV === "production"
    ? "product-delete"
    : "product-delete-job-dev";

const productDeleteWorker = new Worker(
  QueueName,
  async (job) => {
    try {
      const { id, shop } = job.data;

      // Shopify sends numeric id; your DB stores full GID
      const productGid = `gid://shopify/Product/${id}`;

      // 🔄 Mongoose: await Products.deleteOne({ id: productGid, shop })
      await prisma.product.deleteMany({
        where: {
          id: productGid,
          shop,
        },
      });

      await clearKeyCaches(`${shop}:ProductFetch`);
      await clearKeyCaches(`${shop}:productTypes:`);

      return { success: true, message: "Product deleted successfully" };
    } catch (err) {
      // Let BullMQ retry handling work as before
      throw err;
    }
  },
  {
    connection,
    concurrency: 5, // Process 5 jobs at once
    limiter: {
      max: 10, // Max 10 jobs per second
      duration: 1000,
    },
  },
);

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

if (process.env.NODE_ENV !== "production") {
  productDeleteWorker
    .on("error", (err) => {
      logger.error(
        `${logTime()} ❌ Queue Error in productDeleteWorker: ${err.message}`,
        {
          stack: err.stack,
        },
      );
    })
    .on("waiting", (jobId) => {
      logger.info(
        `${logTime()} ⏳ productDeleteWorker - Waiting | Job ID: ${jobId}`,
      );
    })
    .on("active", (job) => {
      logger.info(
        `${logTime()} 🚀 productDeleteWorker - Started | Job ID: ${job.id}`,
        {
          data: job.data,
        },
      );
    })
    .on("completed", (job, result) => {
      logger.info(
        `${logTime()} ✅ productDeleteWorker - Completed | Job ID: ${job.id}`,
        {
          result,
        },
      );
    })
    .on("failed", (job, err) => {
      logger.error(
        `${logTime()} ❗ productDeleteWorker - Failed | Job ID: ${job.id} | Error: ${err.message}`,
        {
          error: err,
        },
      );
    });
}

export default productDeleteWorker;