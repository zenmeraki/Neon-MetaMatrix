// web/Jobs/Cron/scheduledEdit.js
import cron from "node-cron";
import UndoEditService from "../../services/productService/productBulkUndoService.js";
import { addbulkEditJob } from "../../Jobs/Queues/bulkEditJob.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { getSession } from "../../utils/sessionHandler.js";

// ✅ Prisma
import { prisma } from "../../config/database.js";


/**
 * Run scheduled edit / undo for a given historyId.
 *
 * @param {string} historyId - EditHistory.id (Prisma)
 * @param {boolean} isUndo   - false → run edit; true → run undo
 */
export const updateProducts = async (historyId, isUndo) => {
  let history = null;
  let session = null;

  try {
    // 🔹 Load history via Prisma
    history = await prisma.editHistory.findUnique({
      where: { id: historyId },
    });

    if (!history) {
      return { success: false, message: "history not found" };
    }

    // 🔹 Resolve Shopify session for this shop
    session = await getSession(history.shop);
    if (!session) {
      return { success: false, message: "session not found" };
    }

    if (isUndo === false) {
      // ─────────────────────────────────────────────────────────
      //  Scheduled EDIT
      // ─────────────────────────────────────────────────────────
      try {
        await addbulkEditJob({
          session,
          historyId: history.id, // Prisma PK
        });
      } catch (error) {
        const existingErrors = Array.isArray(history.error)
          ? history.error
          : [];

        await prisma.editHistory.update({
          where: { id: history.id },
          data: {
            status: "failed",
            error: [
              ...existingErrors,
              {
                code: "failed scheduled edit",
                message: error.message,
              },
            ],
          },
        });

        return {
          success: false,
          message: "failed scheduled edit",
        };
      }
    } else {
      // ─────────────────────────────────────────────────────────
      //  Scheduled UNDO
      // ─────────────────────────────────────────────────────────
      try {
        const service = new UndoEditService(session);
        await service.undoEdit(history.id);
      } catch (error) {
        const existingErrors = Array.isArray(history.error)
          ? history.error
          : [];

        const undoObj =
          history.undo && typeof history.undo === "object"
            ? history.undo
            : {};

        await prisma.editHistory.update({
          where: { id: history.id },
          data: {
            undo: {
              ...undoObj,
              status: "failed",
            },
            error: [
              ...existingErrors,
              {
                code: "failed scheduled undo edit",
                message: error.message,
              },
            ],
          },
        });

        return {
          success: false,
          message: "failed scheduled undo edit",
        };
      }
    }

    // If we got here, the job was enqueued / undo started successfully
    return { success: true, message: "scheduled task triggered" };
  } catch (err) {
    // 🔹 Only clear caches if we actually have both session + history
    if (session && history) {
      await clearKeyCaches(`${session.shop}:fetchHistories`);
      await clearKeyCaches(`${session.shop}:historyDetails:${history.id}`);
    }
    throw new Error(err.message);
  }
};

// If you are actually using node-cron here, you can still schedule like:
// cron.schedule("*/5 * * * *", async () => {
//   // ... look up due histories and call updateProducts(historyId, false/true)
// });