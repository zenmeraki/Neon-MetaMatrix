import {
  createScheduledExport,
  deleteScheduledExport,
  getScheduledExportById,
  listScheduledExports,
  toggleScheduledExportStatus,
  updateScheduledExport,
} from "../services/scheduledExportService.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { getSessionOrThrow } from "../utils/sessionShop.js";
import { scheduledExportRepository } from "../repositories/scheduledExportRepository.js";
import { recordAuditEvent } from "../services/auditLogService.js";

export async function createScheduledExportController(req, res, next) {
  let session;

  try {
    session = getSessionOrThrow(res);

    if (!req.subscription) {
      const error = new Error("Subscription context missing for scheduled export");
      error.statusCode = 500;
      throw error;
    }

    const data = await createScheduledExport({
      shop: session.shop,
      body: req.body,
      subscription: req.subscription,
    });

    return res.status(201).json({
      success: true,
      data,
      message: "Scheduled export created successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "scheduledExportController.create",
    });

    if (typeof next === "function" && error.statusCode >= 500) {
      return next(error);
    }

    const isSessionError = error.message === "Session expired";

    return res.status(error.statusCode || (isSessionError ? 403 : 400)).json({
      success: false,
      code: error.code || "SCHEDULED_EXPORT_FAILED",
      message: error.code || error.message || "SCHEDULED_EXPORT_FAILED",
    });
  }
}

export async function listScheduledExportsController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await listScheduledExports({
      shop: session.shop,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Scheduled exports fetched successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "scheduledExportController.list",
    });

    const statusCode = error.message === "Session expired" ? 403 : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to fetch scheduled exports",
    });
  }
}

export async function getScheduledExportByIdController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await getScheduledExportById({
      shop: session.shop,
      scheduledExportId: req.params.id,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Scheduled export fetched successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "scheduledExportController.getById",
    });

    const statusCode =
      error.message === "Session expired"
        ? 403
        : error.message === "Scheduled export not found"
          ? 404
          : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to fetch scheduled export",
    });
  }
}

export async function updateScheduledExportController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const owned = await scheduledExportRepository.findByIdForShop(
      req.params.id,
      session.shop,
    );
    if (!owned) {
      return res.status(404).json({ success: false, message: "Scheduled export not found" });
    }
    const data = await updateScheduledExport({
      shop: session.shop,
      scheduledExportId: req.params.id,
      body: req.body,
      subscription: req.subscription,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Scheduled export updated successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "scheduledExportController.update",
    });

    const statusCode =
      error.message === "Session expired"
        ? 403
        : error.message === "Scheduled export not found"
          ? 404
          : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to update scheduled export",
    });
  }
}

export async function toggleScheduledExportStatusController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const owned = await scheduledExportRepository.findByIdForShop(
      req.params.id,
      session.shop,
    );
    if (!owned) {
      return res.status(404).json({ success: false, message: "Scheduled export not found" });
    }
    const data = await toggleScheduledExportStatus({
      shop: session.shop,
      scheduledExportId: req.params.id,
      status: req.body?.status,
      subscription: req.subscription,
    });
    await recordAuditEvent({
      shop: session.shop,
      action: "TOGGLE_SCHEDULED_EXPORT_STATUS",
      entityType: "scheduledExport",
      entityId: req.params.id,
      actor: session.id || session.shop,
      metadata: { status: req.body?.status || null },
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Scheduled export status updated successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "scheduledExportController.toggleStatus",
    });

    const statusCode =
      error.message === "Session expired"
        ? 403
        : error.message === "Scheduled export not found"
          ? 404
          : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to update scheduled export status",
    });
  }
}

export async function deleteScheduledExportController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const owned = await scheduledExportRepository.findByIdForShop(
      req.params.id,
      session.shop,
    );
    if (!owned) {
      return res.status(404).json({ success: false, message: "Scheduled export not found" });
    }
    const data = await deleteScheduledExport({
      shop: session.shop,
      scheduledExportId: req.params.id,
    });
    await recordAuditEvent({
      shop: session.shop,
      action: "DELETE_SCHEDULED_EXPORT",
      entityType: "scheduledExport",
      entityId: req.params.id,
      actor: session.id || session.shop,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Scheduled export deleted successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "scheduledExportController.delete",
    });

    const statusCode =
      error.message === "Session expired"
        ? 403
        : error.message === "Scheduled export not found"
          ? 404
          : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to delete scheduled export",
    });
  }
}
