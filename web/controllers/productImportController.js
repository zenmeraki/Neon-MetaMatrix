import { bulkImportService } from "../services/productService/productImportService.js";
import { logApiError } from "../utils/errorLogUtils.js";

const getSession = (res) => res.locals?.shopify?.session ?? null;

export async function createCsvImport(req, res) {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(401).json({
        success: false,
        error: "AUTH_REQUIRED",
        message: "Shopify session missing",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "CSV_FILE_REQUIRED",
        message: "CSV file is required",
      });
    }

    const result = await bulkImportService.startCsvImport({
      shop: session.shop,
      session,
      file: req.file,
      rawColumnMappings: req.body?.columnMappings,
    });

    return res.status(200).json({
      success: true,
      importId: result.importId,
      spreadsheetFileId: result.spreadsheetFileId,
      status: result.status,
    });
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productImportController.createCsvImport",
    }).catch(() => {});

    return res.status(error.httpStatus || 500).json({
      success: false,
      error: error.code || "CSV_IMPORT_FAILED",
      message: error.httpStatus ? error.message : "Failed to queue CSV import",
    });
  }
}

export const importCsvController = createCsvImport;
export const csvBulkProductsEdit = createCsvImport;
