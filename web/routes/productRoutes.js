//web/routes/productRoutes.js
import express from "express";
import {
  createProductExport,
} from "../controllers/productExportController.js";
import {
  handleDownloadExportProductsData,
  handleExportProductsData,
} from "../controllers/productExportController.js";
import {
  clearProductTypes,
} from "../controllers/productSyncController.js";
import {
  handleBulkEditProduct,
  trackEditPreview,
  undoEdit,
} from "../controllers/productBulkEditController.js";

import {
  checkEditStatus,
  getProductFilterValues,
  getProductTypes,
  getProductsWithQuery,
} from "../controllers/productQueryController.js";
import {
  csvBulkProductsEdit,
  importCsvController,
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

import { subscriptionMiddleware, requirePaidPlanMiddleware } from "../middleware/subscriptionMiddleware.js";
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
import { uploadCsv } from "../middleware/uploadCsv.js";

const router = express.Router();

router.post("/get-all", validateQuery(productQuerySchema), getProductsWithQuery);
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
router.get("/product-type-refresh", clearProductTypes);
router.post("/edit-preview", subscriptionMiddleware, trackEditPreview);
router.get("/bulk-edit-status/:id", checkEditStatus);
router.post(
  "/update",
  subscriptionMiddleware,
  handleBulkEditProduct
);

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


router.post(
  "/csv/import",
  uploadCsv.single("file"),
  importCsvController,
);


// router.post("/save-filter-combination", addFilterCombination);
// router.get("/get-filter-combinations", getFilterCombinations);
// router.delete("/remove-filter-combinations/:id", deleteFilterCombination);

export default router;