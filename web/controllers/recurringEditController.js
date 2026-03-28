import {
  createRecurringEdit,
  deleteRecurringEdit,
  getRecurringEditById,
  listRecurringEdits,
  toggleRecurringEditStatus,
  updateRecurringEdit,
} from "../services/recurringEditService.js";
import { logApiError } from "../utils/errorLogUtils.js";

function getSessionOrThrow(res) {
  const session = res.locals.shopify?.session;
  if (!session?.shop) {
    throw new Error("Session expired");
  }

  return session;
}

export async function createRecurringEditController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await createRecurringEdit({
      shop: session.shop,
      body: req.body,
      subscription: req.subscription,
    });

    return res.status(201).json({
      success: true,
      data,
      message: "Recurring edit created successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "recurringEditController.create",
    });

    const statusCode = error.message === "Session expired" ? 403 : 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to create recurring edit",
    });
  }
}

export async function listRecurringEditsController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await listRecurringEdits({
      shop: session.shop,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Recurring edits fetched successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "recurringEditController.list",
    });

    const statusCode = error.message === "Session expired" ? 403 : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to fetch recurring edits",
    });
  }
}

export async function getRecurringEditByIdController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await getRecurringEditById({
      shop: session.shop,
      recurringEditId: req.params.id,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Recurring edit fetched successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "recurringEditController.getById",
    });

    const statusCode =
      error.message === "Session expired"
        ? 403
        : error.message === "Recurring edit not found"
          ? 404
          : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to fetch recurring edit",
    });
  }
}

export async function updateRecurringEditController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await updateRecurringEdit({
      shop: session.shop,
      recurringEditId: req.params.id,
      body: req.body,
      subscription: req.subscription,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Recurring edit updated successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "recurringEditController.update",
    });

    const statusCode =
      error.message === "Session expired"
        ? 403
        : error.message === "Recurring edit not found"
          ? 404
          : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to update recurring edit",
    });
  }
}

export async function toggleRecurringEditStatusController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await toggleRecurringEditStatus({
      shop: session.shop,
      recurringEditId: req.params.id,
      status: req.body?.status,
      subscription: req.subscription,
    });

    return res.status(200).json({
      success: true,
      data,
      message: "Recurring edit status updated successfully",
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "recurringEditController.toggleStatus",
    });

    const statusCode =
      error.message === "Session expired"
        ? 403
        : error.message === "Recurring edit not found"
          ? 404
          : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to update recurring edit status",
    });
  }
}

export async function deleteRecurringEditController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
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
      source: "recurringEditController.delete",
    });

    const statusCode =
      error.message === "Session expired"
        ? 403
        : error.message === "Recurring edit not found"
          ? 404
          : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to delete recurring edit",
    });
  }
}
