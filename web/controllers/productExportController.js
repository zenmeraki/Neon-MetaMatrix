import { errorResponse } from "../utils/responseUtils.js";
import { ProductExportService } from "../services/productService/productExportService.js";
import { logApiError } from "../utils/errorLogUtils.js";
import {
  resolveCanonicalProductTarget,
} from "../services/productService/productTargetingService.js";
import { createManualExportJob } from "../services/productExportJobService.js";
import { normalizeCanonicalFilterParams } from "../services/productService/productFilterContract.js";

function normalizeExportFilterParams(filterParams) {
  try {
    return normalizeCanonicalFilterParams(filterParams);
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
}

export const handleExportProductsData = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const fields = req.body?.fields ?? req.body?.columns;
    const fileName = req.body?.fileName ?? req.body?.filename;
    const filterParams = normalizeExportFilterParams(req.body?.filterParams);
    const target = await resolveCanonicalProductTarget({
      shop: session.shop,
      filterParams,
      queryParams: { page: 1, limit: 20 },
      sampleLimit: 0,
      includeSample: false,
    });

    const filename = fileName?.endsWith(".csv") ? fileName : `${fileName}.csv`;
    const result = await createManualExportJob({
      shop: session.shop,
      filename,
      fields,
      filterParams,
      target,
      source: "manual_export_legacy_endpoint",
      createHistory: true,
    });

    return res.status(200).json({
      message: "Exporting started - queued in background",
      data: result.exportHistory || { exportJobId: result.exportJob.id, reused: result.reused },
    });
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/export-products",
    });

    return res
      .status(statusCode)
      .json(errorResponse(
        statusCode >= 500
          ? "Failed to start export process"
          : err.message || "Failed to start export process",
      ));
  }
};

export const createProductExport = async (req, res) => {
  try {
    const fields = req.body?.fields ?? req.body?.columns;
    const fileName = req.body?.fileName ?? req.body?.filename;
    const filterParams = normalizeExportFilterParams(req.body?.filterParams);
    const session = res.locals.shopify?.session;

    if (!session?.shop) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ message: "No fields selected" });
    }

    if (!fileName?.trim()) {
      return res.status(400).json({ message: "File name required" });
    }

    const shop = session.shop;
    const target = await resolveCanonicalProductTarget({
      shop,
      filterParams,
      queryParams: { page: 1, limit: 20 },
      sampleLimit: 0,
      includeSample: false,
    });

    const filename = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
    const result = await createManualExportJob({
      shop,
      filename,
      fields,
      filterParams,
      target,
      source: "manual_export",
      createHistory: false,
    });

    return res.status(200).json({
      exportJobId: result.exportJob.id,
      status: result.exportJob.status,
      reused: result.reused,
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    await logApiError({
      shop: res.locals.shopify?.session?.shop,
      err: error,
      req,
      source: "POST /api/product-exports",
    });
    return res.status(statusCode).json({
      message:
        statusCode >= 500
          ? "Failed to create export job"
          : error.message || "Failed to create export job",
    });
  }
};

export const handleDownloadExportProductsData = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const service = new ProductExportService(session);
    const result = await service.getExportHistoryDetails(req.params.id);

    if (!result) {
      return res.status(404).json({
        message: "Export history not found",
      });
    }

    res.header("Content-Type", "text/csv");
    res.attachment(result.filename);
    return res.send(result.exportedData);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/export-products/:id/download",
    });

    return res
      .status(500)
      .json(errorResponse("Failed to download export file"));
  }
};
