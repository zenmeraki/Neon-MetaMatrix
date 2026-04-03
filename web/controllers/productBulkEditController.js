import { translatedEditHistoryStatuses } from "../Config/constants.js";
import UndoEditService from "../services/productService/productBulkUndoService.js";
import ProductBulkService from "../services/productService/productBulkEditService.js";
import { FIELD_CONFIGS } from "../helpers/productBulkOperationHelpers/constants.js";
import { errorResponse } from "../utils/responseUtils.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import { clearAllCachesForShop } from "../utils/cacheUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { createScheduledBulkEdit } from "../services/scheduledBulkEditService.js";
import { trackBulkEditPreview } from "../services/bulkEditPreviewTrackingService.js";
import { normalizeCanonicalFilterParams } from "../services/productService/productFilterContract.js";

const DEFAULT_LANGUAGE = "en";
const MAX_PAGE = 10000;
const MAX_LIMIT = 100;
const MAX_STRING_LENGTH = 500;

function createHttpError(statusCode, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.userMessage = message;
  Object.assign(error, extra);
  return error;
}

function getSessionOrThrow(res) {
  const session = res.locals.shopify?.session;

  if (!session?.shop) {
    throw createHttpError(403, "Session expired");
  }

  return session;
}

function normalizeLanguage(rawLanguage) {
  if (typeof rawLanguage !== "string") {
    return DEFAULT_LANGUAGE;
  }

  const normalized = rawLanguage.trim().toLowerCase();
  if (!normalized || normalized.length > 10) {
    return DEFAULT_LANGUAGE;
  }

  return normalized;
}

function normalizeString(value, fallback = null, maxLength = MAX_STRING_LENGTH) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function normalizePositiveInteger(value, fallback, { min = 1, max = MAX_LIMIT } = {}) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function ensureActiveOperationAllowed(session) {
  return getCurrentBulkOperationStatus(session).then(({ status }) => {
    if (status === "RUNNING") {
      throw createHttpError(409, "Another operation is running in background");
    }
  });
}

function ensureHistoryId(id) {
  const historyId = normalizeString(id);
  if (!historyId) {
    throw createHttpError(400, "Edit history id is required");
  }

  return historyId;
}

function ensureObjectArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw createHttpError(400, `${fieldName} must be an array`);
  }

  return value;
}

function normalizeFilterParams(filterParams) {
  try {
    return normalizeCanonicalFilterParams(filterParams);
  } catch (error) {
    throw createHttpError(400, error.message || "Invalid filterParams");
  }
}

function normalizeLocationId(body = {}) {
  const locationId = body.locationId ?? body.location ?? null;
  return locationId ? String(locationId).trim() : null;
}

function normalizeBulkEditRequest(req) {
  const body = req.body || {};
  const editedField = normalizeString(body.editedField, null, 120);

  if (!editedField || !FIELD_CONFIGS[editedField]) {
    throw createHttpError(400, "Invalid editedField");
  }

  if (Array.isArray(body.rules) && body.rules.length > 0) {
    return {
      ...body,
      editedField,
      locationId: normalizeLocationId(body),
      filterParams: normalizeFilterParams(body.filterParams),
    };
  }

  const editedType = normalizeString(body.editedType ?? body.editType, null, 150);
  if (!editedType) {
    throw createHttpError(400, "Invalid editedType");
  }

  if (body.filterParams !== undefined) {
    ensureObjectArray(body.filterParams, "filterParams");
  }

  return {
    ...body,
    editedField,
    editedType,
    locationId: normalizeLocationId(body),
    filterParams: normalizeFilterParams(body.filterParams),
  };
}

function mapBulkEditResponse(result, lang, shop) {
  const primaryRule = Array.isArray(result.rules) ? result.rules[0] : null;

  return {
    id: result.id,
    title: result.title,
    status: translatedEditHistoryStatuses[result.status]?.[lang] || result.status,
    processedCount: result.processedCount,
    totalItems: result.totalItems,
    duration: result.durationMs,
    field: primaryRule?.field ?? null,
    shop,
  };
}

function classifyUndoError(error) {
  if (error?.statusCode) {
    return error.statusCode;
  }

  if (error?.message === "Edit history not found") {
    return 404;
  }

  if (
    error?.message === "Undo can only be performed on completed edits" ||
    error?.message === "Undo is already queued or completed" ||
    error?.message === "Undo could not be queued"
  ) {
    return 400;
  }

  return 500;
}

function classifyBulkEditError(error) {
  if (error?.statusCode) {
    return error.statusCode;
  }

  if (
    typeof error?.message === "string" &&
    (
      error.message.includes("plan") ||
      error.message.includes("Location ID is required") ||
      error.message.includes("Edit rules not found")
    )
  ) {
    return 400;
  }

  return 500;
}

function normalizePreviewPayload(req) {
  const body = req.body || {};
  const field = normalizeString(body.field, null, 120);
  const editType = normalizeString(body.editType, null, 150);

  if (!field || !FIELD_CONFIGS[field]) {
    throw createHttpError(400, "Invalid field");
  }

  if (!editType) {
    throw createHttpError(400, "Invalid editType");
  }

  if (body.filterParams !== undefined) {
    ensureObjectArray(body.filterParams, "filterParams");
  }

  return {
    field,
    editType,
    editValue: body.editValue ?? body.value ?? null,
    filterParams: normalizeFilterParams(body.filterParams),
    searchKey: normalizeString(body.searchKey),
    replaceText: normalizeString(body.replaceText),
    supportValue: body.supportValue ?? null,
    lang: normalizeLanguage(req.query?.lang),
    page: normalizePositiveInteger(body.page, 1, { min: 1, max: MAX_PAGE }),
    limit: normalizePositiveInteger(body.limit, 20, { min: 1, max: MAX_LIMIT }),
    locationId: normalizeLocationId(body),
  };
}

export const undoEdit = async (req, res) => {
  let session;

  try {
    session = getSessionOrThrow(res);
    const historyId = ensureHistoryId(req.params?.id);

    await ensureActiveOperationAllowed(session);

    const service = new UndoEditService(session);
    const result = await service.undoEdit(historyId);

    return res.status(200).json(result.data);
  } catch (err) {
    const statusCode = classifyUndoError(err);

    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/undo-edit/:id",
    });

    const message =
      statusCode >= 500
        ? "Failed to undo edit"
        : err.userMessage || err.message || "Failed to undo edit";

    return res.status(statusCode).json(
      statusCode >= 500
        ? errorResponse(message)
        : { message },
    );
  }
};

export const handleBulkEditProduct = async (req, res) => {
  let session;

  try {
    session = getSessionOrThrow(res);
    const lang = normalizeLanguage(req.query?.lang);
    const normalizedBody = normalizeBulkEditRequest(req);

    await ensureActiveOperationAllowed(session);

    const service = new ProductBulkService(session);
    const result = await service.bulkEditProducts({
      ...req,
      body: normalizedBody,
      query: {
        ...req.query,
        lang,
      },
      subscription: req.subscription,
    });

    if (!result) {
      throw createHttpError(500, "Bulk edit failed");
    }

    await clearAllCachesForShop(session.shop);

    return res.status(200).json(
      mapBulkEditResponse(result, lang, session.shop),
    );
  } catch (err) {
    const statusCode = classifyBulkEditError(err);

    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/bulk-edit",
    });

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode >= 500
          ? "An unexpected error occurred. Please try again later."
          : err.userMessage || err.message || "An unexpected error occurred. Please try again later.",
    });
  }
};

export const trackEditPreview = async (req, res) => {
  let session;

  try {
    session = getSessionOrThrow(res);
    const payload = normalizePreviewPayload(req);

    trackBulkEditPreview({
      shop: session.shop,
      field: payload.field,
      editType: payload.editType,
      value: payload.editValue,
      lang: payload.lang,
      searchKey: payload.searchKey,
      replaceText: payload.replaceText,
      supportValue: payload.supportValue,
      filterParams: payload.filterParams,
    });

    const service = new ProductBulkService(session);
    const result = await service.trackEditProducts({
      field: payload.field,
      editType: payload.editType,
      editValue: payload.editValue,
      filterParams: payload.filterParams,
      searchKey: payload.searchKey,
      replaceText: payload.replaceText,
      supportValue: payload.supportValue,
      lang: payload.lang,
      page: payload.page,
      limit: payload.limit,
      locationId: payload.locationId,
      subscription: req.subscription,
    });

    return res.status(200).json(result);
  } catch (err) {
    const statusCode = err?.statusCode || 500;

    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/edit-preview",
    });

    return res.status(statusCode).json(
      errorResponse(
        statusCode >= 500
          ? "Failed to track edit preview"
          : err.userMessage || err.message || "Failed to track edit preview",
      ),
    );
  }
};

export const createScheduledEdit = async (req, res) => {
  let session;

  try {
    session = getSessionOrThrow(res);

    const history = await createScheduledBulkEdit({
      session,
      subscription: req.subscription,
      payload: req.body,
    });

    return res.status(201).json({
      message: "Scheduled successfully",
      history,
    });
  } catch (err) {
    const statusCode = err?.statusCode || 500;

    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/scheduled-edit",
    });

    if (statusCode >= 500) {
      return res.status(500).json({
        error: "Failed to create scheduled edit",
      });
    }

    if (err?.code) {
      return res.status(statusCode).json({
        success: false,
        message: err.userMessage || err.message,
        code: err.code,
      });
    }

    return res.status(statusCode).json({
      error: err.userMessage || err.message,
    });
  }
};
