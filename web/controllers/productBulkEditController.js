import { translatedEditHistoryStatuses } from "../Config/constants.js";
import UndoEditService from "../services/productService/productBulkUndoService.js";
import ProductBulkService from "../services/productService/productBulkEditService.js";
import { Services } from "../services/productService/productFilterService.js";
import { errorResponse } from "../utils/responseUtils.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import { getUpdatedProducts } from "../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import {
  createMultiLanguage,
} from "../utils/googleTranslator.js";
import { scheduledEditQueue } from "../Jobs/Queues/scheduledEditQueue.js";
import { clearAllCachesForShop } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";
import crypto from "crypto";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
} from "../services/bulkEditExecutionStateService.js";
import { resolveCanonicalProductTarget } from "../services/productService/productTargetingService.js";

const productService = new Services();

export const undoEdit = async (req, res) => {
  const session = res.locals.shopify?.session;
  const { id } = req.params;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      return res
        .status(400)
        .json({ message: "Another operation is running in background" });
    }

    const service = new UndoEditService(session);
    const result = await service.undoEdit(id);

    return res.status(200).json(result.data);
  } catch (err) {
    console.error(err.message);
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/undo-edit/:id",
    });

    return res.status(500).json(errorResponse("Failed to undo edit"));
  }
};

export const handleBulkEditProduct = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      return res
        .status(400)
        .json({ message: "Another operation is running in background" });
    }

    const lang = req.query.lang || "en";
    const service = new ProductBulkService(session);
    const result = await service.bulkEditProducts({
      ...req,
      subscription: req.subscription,
    });

    if (!result) {
      return res.status(500).json({
        message: "Bulk edit failed â€” no result returned.",
      });
    }

    await clearAllCachesForShop(session.shop);

    return res.status(200).json({
      id: result.id,
      title: result.title,
      status:
        translatedEditHistoryStatuses[result.status]?.[lang] || result.status,
      processedCount: result.processedCount,
      totalItems: result.totalItems,
      duration: result.durationMs,
      field: result.field,
      shop: session.shop,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/bulk-edit",
    });

    return res.status(400).json({
      success: false,
      message:
        err.message || "An unexpected error occurred. Please try again later.",
    });
  }
};

export const trackEditPreview = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const {
      field,
      editType,
      editValue,
      searchKey,
      replaceText,
      filterParams,
      supportValue,
      page,
      limit,
    } = req.body;

    const lang = req.query.lang || "en";

    if (process.env.NODE_ENV === "production") {
      await prisma.filterTrack.create({
        data: {
          shop: session.shop,
          previewFilterParams: filterParams,
          type: "preview",
          field,
          editOption: editType,
          value: editValue,
          en: lang,
          searchKey,
          replaceText,
          supportValue,
        },
      });
    }

    const service = new ProductBulkService(session);

    const result = await service.trackEditProducts({
      field,
      editType,
      editValue,
      filterParams,
      searchKey,
      replaceText,
      supportValue,
      lang,
      page,
      limit,
      subscription: req.subscription,
    });

    return res.status(200).json(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/edit-preview",
    });

    return res.status(500).json(errorResponse("Failed to track edit preview"));
  }
};

export const createScheduledEdit = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json({ error: "Session expired" });
    }

    const {
      editedField,
      editedBy,
      filterParams,
      value,
      scheduledAt: rawScheduledAt,
      scheduledUndoAt: rawScheduledUndoAt,
      searchKey,
      replaceText,
      supportValue,
    } = req.body;

    if (!filterParams || !editedField) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const scheduledAt = new Date(rawScheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ error: "Invalid scheduledAt" });
    }

    let scheduledUndoAt = null;
    if (rawScheduledUndoAt) {
      const d = new Date(rawScheduledUndoAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid scheduledUndoAt" });
      }
      scheduledUndoAt = d;
    }

    if (editedField === "deleteProducts" && scheduledUndoAt) {
      return res.status(400).json({
        error: "Undo is not allowed for product deletion",
      });
    }

    const target = await resolveCanonicalProductTarget({
      shop: session.shop,
      filterParams,
      queryParams: {
        page: 1,
        limit: 20,
      },
      sampleLimit: 20,
    });

    const where = target.where;
    const count = target.count;

    const planKey = req.subscription?.planKey;
    if (!planKey) {
      return res.status(403).json({
        error: "Subscription not found",
      });
    }

    let scheduledLimit = 0;
    if (planKey === "ADVANCED_MONTHLY") {
      scheduledLimit = 1000;
    } else if (planKey === "PRO_MONTHLY") {
      scheduledLimit = Infinity;
    }

    if (scheduledLimit !== Infinity && count > scheduledLimit) {
      return res.status(403).json({
        success: false,
        message: `Your plan allows scheduling edits for only ${scheduledLimit} products at a time. You selected ${count}. Please refine your filters or upgrade to Pro.`,
        code: "PRODUCT_LIMIT_EXCEEDED",
      });
    }

    const updatedTitle = getUpdatedProducts({
      field: editedField,
      editType: editedBy,
      value,
      returnTitleOnly: true,
      supportValue,
      searchKey,
      replaceText,
    });

    const multiLanguageTitle = await createMultiLanguage(updatedTitle);

    const undoAllowed = editedField !== "deleteProducts";

    const delay = scheduledAt.getTime() - Date.now();
    if (delay <= 0) {
      return res.status(400).json({
        error: "Scheduled time must be in the future",
      });
    }

    const history = await prisma.editHistory.create({
      data: {
        shop: session.shop,
        title: multiLanguageTitle,
        status: "pending",
        executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
        executionIdentity: crypto.randomUUID(),
        processedCount: 0,
        totalItems: count,
        scheduledAt,
        scheduledUndoAt,
        type: "Scheduled edit",
        queryFilter: JSON.stringify(where),
        targetMirrorBatchId: target.mirrorBatchId,
        rules: [
          {
            field: editedField,
            value,
            editOption: editedBy,
            searchKey,
            replaceText,
            supportValue,
          },
        ],
        startedAt: new Date(),
        undo: buildPlannedUndoState({
          allowed: undoAllowed,
        }),
      },
    });

    await scheduledEditQueue.add(
      "scheduled-task",
      { historyId: history.id, shop: session.shop },
      { delay, jobId: `scheduled-edit:${session.shop}:${history.id}` },
    );

    if (scheduledUndoAt && scheduledUndoAt.getTime() > Date.now() && undoAllowed) {
      const undoDelay = scheduledUndoAt.getTime() - Date.now();
      if (undoDelay > 0) {
        await scheduledEditQueue.add(
          "undo-task",
          { historyId: history.id, shop: session.shop },
          { delay: undoDelay, jobId: `scheduled-undo:${session.shop}:${history.id}` },
        );
      }
    }

    return res.status(201).json({
      message: "Scheduled successfully",
      history,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/scheduled-edit",
    });

    return res.status(500).json({
      error: "Failed to create scheduled edit",
    });
  }
};
