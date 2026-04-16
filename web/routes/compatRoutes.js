import express from "express";
import { getAllExportHistories } from "../controllers/historyController.js";
import {
  deleteRecurringEdit,
  listRecurringEdits,
  toggleRecurringEditStatus,
} from "../services/recurringEditService.js";
import { subscriptionMiddleware } from "../middleware/subscriptionMiddleware.js";
import { logApiError } from "../utils/errorLogUtils.js";
import logger from "../utils/loggerUtils.js";

const router = express.Router();

const getSession = (res) => res.locals?.shopify?.session || null;

router.post("/log-error", async (req, res) => {
  const session = getSession(res);

  logger.error("Frontend error reported", {
    shop: session?.shop || null,
    message: req.body?.message || null,
    stack: req.body?.stack || null,
    componentInlineStack: req.body?.componentInlineStack || null,
    context: req.body?.context || null,
    retryCount: req.body?.retryCount ?? null,
    timestamp: req.body?.timestamp || null,
    userAgent: req.body?.userAgent || req.get("user-agent") || null,
  });

  return res.status(202).json({
    success: true,
    message: "Frontend error logged",
  });
});

router.get("/exportHistory", getAllExportHistories);

router.get("/recurring-edits", async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(403).json({
        success: false,
        message: "Session expired",
      });
    }

    const data = await listRecurringEdits({ shop: session.shop });

    return res.status(200).json({
      success: true,
      data,
      edits: data,
      message: "Recurring edits fetched successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "compatRoutes.listRecurringEdits",
    });

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch recurring edits",
    });
  }
});

router.patch("/recurring-edits/:id", subscriptionMiddleware, async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(403).json({
        success: false,
        message: "Session expired",
      });
    }

    const requestedStatus =
      typeof req.body?.active === "boolean"
        ? req.body.active
          ? "ACTIVE"
          : "PAUSED"
        : req.body?.status;

    const data = await toggleRecurringEditStatus({
      shop: session.shop,
      recurringEditId: req.params.id,
      status: requestedStatus,
      subscription: req.subscription,
    });

    return res.status(200).json({
      success: true,
      data,
      edit: data,
      message: "Recurring edit status updated successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "compatRoutes.toggleRecurringEdit",
    });

    const statusCode = error.message === "Recurring edit not found" ? 404 : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to update recurring edit status",
    });
  }
});

router.delete("/recurring-edits/:id", async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(403).json({
        success: false,
        message: "Session expired",
      });
    }

    const data = await deleteRecurringEdit({
      shop: session.shop,
      recurringEditId: req.params.id,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Recurring edit deleted successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "compatRoutes.deleteRecurringEdit",
    });

    const statusCode = error.message === "Recurring edit not found" ? 404 : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to delete recurring edit",
    });
  }
});

export default router;
