import {
  createScheduledExport,
  deleteScheduledExport,
  getScheduledExportById,
  listScheduledExports,
  toggleScheduledExportStatus,
  updateScheduledExport,
} from "../services/scheduledExportService.js";
import { logApiError } from "../utils/errorLogUtils.js";

function getSessionOrThrow(res) {
  const session = res.locals.shopify?.session;
  if (!session?.shop) {
    throw new Error("Session expired");
  }

  return session;
}

export async function createScheduledExportController(req, res) {
  let session;

  
  try {
    session = getSessionOrThrow(res);
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
    const data = await toggleScheduledExportStatus({
      shop: session.shop,
      scheduledExportId: req.params.id,
      status: req.body?.status,
      subscription: req.subscription,
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
    const data = await deleteScheduledExport({
      shop: session.shop,
      scheduledExportId: req.params.id,
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
