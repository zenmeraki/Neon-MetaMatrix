//web/routes/productRoutes.js
import express from "express";
import { createProductExport } from "../controllers/productExportController.js";
import {
  handleDownloadExportProductsData,
  handleExportProductsData,
} from "../controllers/productExportController.js";
import { refreshProductTypes } from "../controllers/productSyncController.js";
import {
  cancelScheduledEdit,
  executeReplayOperation,
  getOperationSpine,
  handleBulkEditProduct,
  previewReplayOperation,
  trackEditPreview,
  undoEdit,
} from "../controllers/productBulkEditController.js";

import {
  checkEditStatus,
  getProductMirrorDetail,
  getProductFilterValues,
  getProductTypes,
  getProductsWithQuery,
} from "../controllers/productQueryController.js";
import {
  countProductTarget,
  freezeProductTarget,
} from "../controllers/productTargetController.js";
import {
  initCsvImportUploadController,
  uploadCsvImportPartController,
  completeCsvImportUploadController,
  abortCsvImportUploadController,
  validateCsvImportFromS3Controller,
  queueCsvImportFromS3Controller,
} from "../controllers/productImportController.js";
import {
  createRecurringEditController,
  deleteRecurringEditController,
  getRecurringEditByIdController,
  listRecurringEditsController,
  toggleRecurringEditStatusController,
  updateRecurringEditController,
} from "../controllers/recurringEditController.js";
import {
  createScheduledExportController,
  deleteScheduledExportController,
  getScheduledExportByIdController,
  listScheduledExportsController,
  toggleScheduledExportStatusController,
  updateScheduledExportController,
} from "../controllers/scheduledExportController.js";

import {
  subscriptionMiddleware,
  requirePaidPlanMiddleware,
} from "../middleware/subscriptionMiddleware.js";
import productQuerySchema from "../validations/productQuerySchema.js";
import { validateBody, validateQuery } from "../middleware/validateQuery.js";
// import {
//   addFilterCombination,
//   deleteFilterCombination,
//   getFilterCombinations,
// } from "../controllers/filterCombinationController.js";
// import path from "path";
import { createScheduledEdit } from "../controllers/productBulkEditController.js";
import { productExportSchema } from "../validations/productExportQuerySchema.js";

const router = express.Router();

router.post(
  "/get-all",
  validateQuery(productQuerySchema),
  getProductsWithQuery
);
router.post("/targets/freeze", freezeProductTarget);
router.post("/targets/count", countProductTarget);
router.post(
  "/export",
  // restrictSubscribeUserWork,

  createProductExport
);
router.post(
  "/create-scheduled-export",
  subscriptionMiddleware,
  createScheduledExportController
);
router.get("/get-scheduled-exports", listScheduledExportsController);
router.get("/get-scheduled-export/:id", getScheduledExportByIdController);
router.put(
  "/update-scheduled-export/:id",
  subscriptionMiddleware,
  updateScheduledExportController
);
router.put(
  "/update-scheduled-export/:id/toggle",
  subscriptionMiddleware,
  toggleScheduledExportStatusController
);
router.delete("/delete-scheduled-export/:id", deleteScheduledExportController);
router.get(
  "/download-export/:id",
  // restrictSubscribeUserWork,
  handleDownloadExportProductsData
);

router.get("/product-type-all", getProductTypes);
router.get("/filter-values/:field", getProductFilterValues);
router.get("/details/:id", getProductMirrorDetail);
router.get("/product-type-refresh", refreshProductTypes);
router.post("/edit-preview", subscriptionMiddleware, trackEditPreview);
router.get("/operations/:id/spine", subscriptionMiddleware, getOperationSpine);
router.post("/operations/:id/replay/preview", subscriptionMiddleware, previewReplayOperation);
router.post("/operations/:id/replay/execute", subscriptionMiddleware, executeReplayOperation);
router.get("/bulk-edit-status/:id", checkEditStatus);
router.post("/update", subscriptionMiddleware, handleBulkEditProduct);

router.post("/undo-edit/:id", undoEdit);
router.put("/undo-edit/:id", undoEdit);
router.post(
  "/create-recurring-edit",
  subscriptionMiddleware,
  createRecurringEditController
);
router.get("/get-recurring-edits", listRecurringEditsController);
router.get("/get-recurring-edit/:id", getRecurringEditByIdController);
router.put(
  "/update-recurring-edit/:id",
  subscriptionMiddleware,
  updateRecurringEditController
);
router.put(
  "/update-recurring-edit/:id/toggle",
  subscriptionMiddleware,
  toggleRecurringEditStatusController
);
router.delete("/delete-recurring-edit/:id", deleteRecurringEditController);
router.post(
  "/schedule-task",
  subscriptionMiddleware,
  requirePaidPlanMiddleware,
  createScheduledEdit
);
router.delete(
  "/schedule-task/:id",
  subscriptionMiddleware,
  requirePaidPlanMiddleware,
  cancelScheduledEdit,
);

router.post("/csv/import/staged/init", initCsvImportUploadController);
router.put("/csv/import/staged/part/:partNumber", uploadCsvImportPartController);
router.post("/csv/import/staged/complete", completeCsvImportUploadController);
router.post("/csv/import/staged/abort", abortCsvImportUploadController);
router.post("/csv/import/staged/validate", validateCsvImportFromS3Controller);
router.post("/csv/import/staged/queue", queueCsvImportFromS3Controller);

// router.post("/save-filter-combination", addFilterCombination);
// router.get("/get-filter-combinations", getFilterCombinations);
// router.delete("/remove-filter-combinations/:id", deleteFilterCombination);

export default router;
