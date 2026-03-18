// web/Jobs/Workers/bulkEditWorker.js
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import ProductBulkService from "../../services/productService/productBulkEditService.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";

// 🔹 Prisma
import { prisma } from "../../config/database.js";

const QUEUE_NAME = process.env.EDIT_QUEUE;

async function processBulkEdit(job) {
  const { historyId, session } = job.data;

  try {
    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      return { skipped: true };
    }

    // Mongo:
    // const history = await History.findByIdAndUpdate(
    //   historyId,
    //   { status: "processing" },
    //   { new: true }
    // ).select("rules");
    //
    // Prisma: update + select rules & batch (we’ll need batch later)
    const history = await prisma.editHistory.update({
      where: { id: historyId },
      data: { status: "processing" },
      select: {
        rules: true,
        batch: true,
      },
    });

    await clearKeyCaches(`${session.shop}:fetchHistories`);
    await clearKeyCaches(`${session.shop}:historyDetails:${historyId}`);

    const service = new ProductBulkService(session);

    const {
      formattedProducts,
      changes,
      hasMore,
      lastProductId,
      batchId,
    } = await service._preparingBulkOperation({ historyId });

    
    const result = await service._bulkOperationHelper({
      formattedProducts,
      field: history.rules?.[0]?.field || "",
    });

    console.log("📦 bulkOperation result:", result);

    if (!result?.bulkOperation?.id) {
      console.error("❌ Missing bulkOperationId in Shopify response", {
        result,
      });
      throw new Error("Missing bulkOperationId in Shopify response");
    }

    // Mongo:
    // await ChangeRecord.insertMany(changes);
    //
    // Prisma:
    await prisma.changeRecord.createMany({
      data: changes,
      // skipDuplicates: true, // optional if your data might collide on unique constraints
    });

    await clearKeyCaches(`${session.shop}:historyChanges:${historyId}`);

    // Mongo:
    // await History.findByIdAndUpdate(
    //   historyId,
    //   {
    //     bulkOperationId: result.bulkOperation.id,
    //     "batch.lastProductId": lastProductId,
    //     "batch.hasMore": hasMore,
    //     processingBatchId: batchId,
    //   },
    //   { new: true }
    // );
    //
    // Prisma: batch is a JSON field, so we must merge into existing batch
    const existingBatch = (history.batch ?? {})
    const updatedBatch = {
      ...existingBatch,
      lastProductId,
      hasMore,
    };

    await prisma.editHistory.update({
      where: { id: historyId },
      data: {
        bulkOperationId: result.bulkOperation.id,
        batch: updatedBatch,
        processingBatchId: batchId,
      },
    });

    return { result };
  } catch (err) {
    console.error("🔥 Bulk edit job failed", {
      shop: session.shop,
      historyId,
      message: err.message,
      stack: err.stack,
    });

    // Mongo:
    // await History.findByIdAndUpdate(historyId, {
    //   $set: {
    //     status: "failed",
    //     error: {
    //       message: err.message,
    //       details: err.stack || null,
    //     },
    //   },
    // });
    //
    // Prisma:
    try {
      await prisma.editHistory.update({
        where: { id: historyId },
        data: {
          status: "failed",
          error: {
            message: err.message,
            details: err.stack || null,
          }  // JSON field
        },
      });
    } catch (updateErr) {
      // if history row is missing, we just log – don’t mask original error
      console.error(
        "⚠️ Failed to mark editHistory as failed:",
        updateErr.message,
      );
    }

    await clearKeyCaches(`${session.shop}:fetchHistories`);
    await clearKeyCaches(`${session.shop}:historyDetails:${historyId}`);

    await logWorkerError({
      shop: session?.shop,
      err,
      source: "BulkEditWorker",
    });

    throw err; // Bull will retry
  }
}

const bulkEditWorker = new Worker(QUEUE_NAME, processBulkEdit, {
  connection,
  concurrency: 1,
});

// ---- Event Listeners ----
// if (process.env.NODE_ENV != "production") {
//   bulkEditWorker
//     .on("error", (err) =>
//       logger.error("Queue Error", { queue: QUEUE_NAME, error: err.message })
//     )
//     .on("waiting", (jobId) =>
//       logger.debug("Job waiting", { queue: QUEUE_NAME, jobId })
//     )
//     .on("active", (job) =>
//       logger.debug("Job started", { queue: QUEUE_NAME, jobId: job.id })
//     )
//     .on("completed", (job, result) =>
//       logger.info("Job completed", { queue: QUEUE_NAME, jobId: job.id })
//     )
//     .on("failed", (job, err) =>
//       logger.error("Job failed", {
//         queue: QUEUE_NAME,
//         jobId: job.id,
//         error: err.message,
//       })
//     );
// }

export default bulkEditWorker;