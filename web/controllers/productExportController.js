//web/controllers/productExportController.js

import { errorResponse } from "../utils/responseUtils.js";
import { ProductExportService } from "../services/productService/productExportService.js";
import { logApiError } from "../utils/errorLogUtils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard cap on the byte-size of a stored CSV that we are willing to stream
 * synchronously to the browser. Records larger than this almost certainly
 * indicate a runaway export and would OOM the Node process on
 * res.send(). Callers that need larger files should download directly from
 * object storage instead.
 */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getSession = (res) => res.locals?.shopify?.session ?? null;

/**
 * Log the error fire-and-forget so a logging failure can never suppress the
 * original error or delay the HTTP response.
 */
const logError = (opts) => logApiError(opts).catch(() => {});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * POST /export
 *
 * Canonical export-job creation endpoint. The service owns target resolution,
 * snapshot freezing, durable state transitions, cache invalidation, and queue
 * dispatch.
 */
export const createProductExport = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { fields, fileName, filterParams } = req.body;
    const service = new ProductExportService(session);
    const result = await service.startExport({ fields, fileName, filterParams });

    return res.status(200).json(result);
  } catch (error) {
    logError({
      shop: session?.shop,
      err: error,
      req,
      source: "productExportController.createProductExport",
    });

    return res.status(error.httpStatus || 500).json({
      success: false,
      message: "Failed to create export job",
    });
  }
};

/**
 * GET /download-export/:id
 *
 * Streams the completed CSV to the browser.
 *
 * Security: `getExportHistoryDetails` always scopes the DB lookup by
 * `session.shop`, so a user cannot enumerate another shop's exports by
 * guessing IDs (IDOR prevented at the service layer).
 *
 * Size guard: we refuse to buffer and send records larger than
 * MAX_DOWNLOAD_BYTES to protect the Node process from OOM conditions.
 */
export const handleDownloadExportProductsData = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const service = new ProductExportService(session);

    const result = await service.getExportHistoryDetails(req.params.id);

    if (!result) {
      return res.status(404).json({ message: "Export history not found" });
    }

    const csvData = result.exportedData ?? "";

    const byteLength = Buffer.byteLength(csvData, "utf8");
    if (byteLength > MAX_DOWNLOAD_BYTES) {
      return res.status(413).json({
        message: "Export file is too large to download directly. Please contact support.",
      });
    }

    res.header("Content-Type", "text/csv");
    res.attachment(result.filename);
    return res.send(csvData);
  } catch (err) {
    logError({
      shop: session?.shop,
      err,
      req,
      source: "productExportController.handleDownloadExportProductsData",
    });

    return res.status(500).json(errorResponse("Failed to download export file"));
  }
};
