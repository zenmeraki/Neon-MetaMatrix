// web/Jobs/Workers/bulkUndoWorker.js
import { Worker } from "bullmq";
import dayjs from "dayjs";
import { connection } from "../../Config/redis.js";

import UndoEditService from "../../services/productService/productBulkUndoService.js";
import { getSession } from "../../utils/sessionHandler.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";

import { clearKeyCaches } from "../../utils/cacheUtils.js";
import logger from "../../utils/loggerUtils.js";
import { logWorkerError } from "../../utils/errorLogUtils.js";

import { prisma } from "../../Config/database.js";


const bulkUndoWorker = new Worker(
  process.env.UNDO_QUEUE,
  async (job) => {
    const { shop, historyId } = job.data;

    try {
      const session = await getSession(shop);
      const { status } = await getCurrentBulkOperationStatus(session);

      if (status === "RUNNING") {
        return {
          message:
            "Another bulk operation is already running, skipping this job.",
        };
      }

      // 🔹 Load history (was History.findById)
      const history = await prisma.editHistory.findUnique({
        where: { id: historyId },
      });

      if (!history) {
        throw new Error(`EditHistory not found for id ${historyId}`);
      }

      const rules = (history.rules || []);
      const rule = rules[0] || {};

      // 🔹 Mark undo as processing (was history.undo.status = "processing"; history.save())
      const currentUndo = (history.undo || {}) ;

      const updatedHistoryForUndo = await prisma.editHistory.update({
        where: { id: historyId },
        data: {
          undo: {
            ...currentUndo,
            status: "processing",
            startedAt: new Date(),
          },
        },
      });

      await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

      // 🔹 Build paging query for ChangeRecord
      const batch = (updatedHistoryForUndo.batch || {}) ;
      const limit = batch?.size || 75;

      // NOTE:
      // - In Mongo you used _id with $gt to paginate.
      // - In Prisma we use cursor on `id` (string), but keep the value in batch.lastProductId
      //   so other code doesn’t need to change names.
      const cursorId = batch?.lastProductId || null;

      const changeRecordWhere = {
        editHistoryId: historyId,
        shop,
      };

      const products = await prisma.changeRecord.findMany({
        where: changeRecordWhere,
        orderBy: { id: "asc" },
        take: limit,
        ...(cursorId
          ? {
              skip: 1, // skip the cursor row itself
              cursor: { id: cursorId },
            }
          : {}),
      });

      if (!products || products.length === 0) {
        throw new Error("No original products found to undo changes");
      }

      await clearKeyCaches(`${shop}:fetchHistories`);

      const service = new UndoEditService(session);

      // `products` is now an array of Prisma ChangeRecord rows
      const { bulkOperationId, lastProductId, count } =
        await service.undoEditBulkOperation(products, rule.field);

      const newBatch = {
        ...(batch || {}),
        // IMPORTANT:
        // - Here `lastProductId` should be the last ChangeRecord.id
        //   (same semantics as Mongo where it was last ChangeRecord._id)
        lastProductId,
        hasMore: count === limit,
      };

      await prisma.editHistory.update({
        where: { id: historyId },
        data: {
          bulkOperationId,
          batch: newBatch,
        },
      });

      return {
        message: "undo started successfully",
      };
    } catch (err) {
      // 🔻 Set undo.status = "failed" (was History.findByIdAndUpdate)
      try {
        const existing = await prisma.editHistory.findUnique({
          where: { id: historyId },
        });

        if (existing) {
          const currentUndo = (existing.undo || {});

          await prisma.editHistory.update({
            where: { id: historyId },
            data: {
              undo: {
                ...currentUndo,
                status: "failed",
              },
            },
          });
        }
      } catch (innerErr) {
        // best-effort; don’t mask original error
        logger.error("Failed to set undo.status=failed", {
          historyId,
          error: innerErr?.message,
        });
      }

      await clearKeyCaches(`${shop}:fetchHistories`);
      await clearKeyCaches(`${shop}:historyDetails:${historyId}`);

      await logWorkerError({
        shop,
        err,
        source: "BulkUndoWorker",
      });

      throw err; // let Bull mark the job as failed and trigger retries
    }
  },
  { connection, concurrency: 1 },
);

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

if (process.env.NODE_ENV !== "production") {
  bulkUndoWorker
    .on("error", (err) => {
      logger.error("Queue Error in Undo worker", {
        queue: process.env.UNDO_QUEUE,
        time: logTime(),
        error: err.message,
        stack: err.stack,
      });
    })
    .on("waiting", (jobId) => {
      logger.debug("Job waiting to be processed", {
        queue: process.env.UNDO_QUEUE,
        time: logTime(),
        jobId,
      });
    })
    .on("active", (job) => {
      logger.info("Undo job started", {
        queue: process.env.UNDO_QUEUE,
        time: logTime(),
        jobId: job.id,
      });
    })
    .on("completed", (job, result) => {
      logger.info("Undo job completed successfully", {
        queue: process.env.UNDO_QUEUE,
        time: logTime(),
        jobId: job.id,
        result,
      });
    })
    .on("failed", (job, err) => {
      logger.error("Undo job failed", {
        queue: process.env.UNDO_QUEUE,
        time: logTime(),
        jobId: job?.id,
        error: err.message,
        stack: err.stack,
      });
    });
}

export default bulkUndoWorker;