//web/routes/productRoutes.js
import express from "express";
import rateLimit from "express-rate-limit";
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
const exportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: "Too many export requests" }),
});
const importLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: "Too many import requests" }),
});
const bulkMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: "Too many requests" }),
});

router.post("/get-all", validateQuery(productQuerySchema), getProductsWithQuery);

router.post(
  "/export",
  // restrictSubscribeUserWork,
  exportLimiter,
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
router.post("/edit-preview", bulkMutationLimiter, subscriptionMiddleware, trackEditPreview);
router.get("/bulk-edit-status/:id", checkEditStatus);
router.post(
  "/update",
  bulkMutationLimiter,
  subscriptionMiddleware,
  handleBulkEditProduct
);

router.put("/undo-edit/:id", bulkMutationLimiter, undoEdit);
router.post(
  "/create-recurring-edit",
  bulkMutationLimiter,
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
  bulkMutationLimiter,
  subscriptionMiddleware,
  requirePaidPlanMiddleware,
  createScheduledEdit
);

router.post(
  "/csv/import",
  importLimiter,
  uploadCsv.single("file"),
  importCsvController,
);


// router.post("/save-filter-combination", addFilterCombination);
// router.get("/get-filter-combinations", getFilterCombinations);
// router.delete("/remove-filter-combinations/:id", deleteFilterCombination);

export default router;
