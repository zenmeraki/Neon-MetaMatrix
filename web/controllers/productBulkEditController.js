import { translatedEditHistoryStatuses } from "../Config/constants.js";
import UndoEditService from "../services/productService/productBulkUndoService.js";
import ProductBulkService from "../services/productService/productBulkEditService.js";
import { errorResponse } from "../utils/responseUtils.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { bulkEditService } from "../services/productService/scheduledEditCreationService.js";
import { recordEditPreviewUsage } from "../services/filterTrackingService.js";

export const undoEdit = async (req, res) => {
  const session = res.locals?.shopify?.session;
  const { id } = req.params;

  try {
    if (!session?.shop) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      return res
        .status(400)
        .json({ message: "Another operation is running in background" });
    }

    const service = new UndoEditService(session);
    const result = await service.undoEdit({
      id,
      shop: session.shop,
    });

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
  const session = res.locals?.shopify?.session;

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
  const session = res.locals?.shopify?.session;

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

    void recordEditPreviewUsage({
      shop: session.shop,
      filterParams,
      field,
      editOption: editType,
      value: editValue,
      en: lang,
      searchKey,
      replaceText,
      supportValue,
    }).catch(() => {});

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
  const session = res.locals?.shopify?.session;

  try {
    if (!session?.shop) {
      return res.status(401).json({
        success: false,
        error: "AUTH_REQUIRED",
        message: "Shopify session missing",
      });
    }

    const result = await bulkEditService.createScheduledEdit({
      session,
      body: req.body,
      subscription: req.subscription,
    });

    return res.status(201).json({
      success: true,
      message: "Scheduled successfully",
      history: result.history,
      reused: result.reused,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/scheduled-edit",
    });

    return res.status(err.httpStatus || 500).json({
      success: false,
      error: err.code || "SCHEDULED_EDIT_CREATE_FAILED",
      message: err.httpStatus ? err.message : "Failed to create scheduled edit",
    });
  }
};
