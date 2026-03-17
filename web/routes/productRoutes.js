//web/routes/productRoutes.js
import express from "express";
import {
  createProductExport,
  getProductsWithQuery,
} from "../controllers/productController.js";
import {
  handleDownloadExportProductsData,
  handleExportProductsData,
  importCsvController
} from "../controllers/productController.js";
import {
  clearProductTypes,
  getProductTypes,
} from "../controllers/productController.js";
import {
  checkEditStatus,
  handleBulkEditProduct,
  trackEditPreview,
  undoEdit,
} from "../controllers/productController.js";

import { csvBulkProductsEdit } from "../controllers/productController.js";

import { subscriptionMiddleware, requirePaidPlanMiddleware } from "../middleware/subscriptionMiddleware.js";
import productQuerySchema from "../validations/productQuerySchema.js";
import { validateBody, validateQuery } from "../middleware/validateQuery.js";
// import { recurringEditSchema } from "../validations/recurringEditValidator.js";
// import {
//   createRecurringEdit,
//   deleteRecurringEdit,
//   toggleRecurringEditStatus,
//   updateRecurringEdit,
// } from "../controllers/productController.js";
// import {
//   addFilterCombination,
//   deleteFilterCombination,
//   getFilterCombinations,
// } from "../controllers/filterCombinationController.js";
// import path from "path";
import { createScheduledEdit } from "../controllers/productController.js";
import { productExportSchema } from "../validations/productExportQuerySchema.js";
import { uploadCsv } from "../middleware/uploadCsv.js";
// import { getRecurringEditById, getRecurringEdits } from "../controllers/historyController.js";

const router = express.Router();

router.post("/get-all", validateQuery(productQuerySchema), getProductsWithQuery);

router.post(
  "/export",
  // restrictSubscribeUserWork,
  
  createProductExport
);
router.get(
  "/download-export/:id",
  // restrictSubscribeUserWork,
  handleDownloadExportProductsData
);


router.get("/product-type-all", getProductTypes);
router.get("/product-type-refresh", clearProductTypes);
router.post("/edit-preview", subscriptionMiddleware, trackEditPreview);
router.get("/bulk-edit-status/:id", checkEditStatus);
router.post(
  "/update",
  subscriptionMiddleware,
  handleBulkEditProduct
);

router.put("/undo-edit/:id", undoEdit);
// router.post(
//   "/create-recurring-edit",
//   validateBody(recurringEditSchema),
//   createRecurringEdit
// );
// router.get("/get-recurring-edits", getRecurringEdits);
// router.get("/get-recurring-edit/:id", getRecurringEditById);
// router.put("/update-recurring-edit/:id", updateRecurringEdit);
// router.delete("/delete-recurring-edit/:id", deleteRecurringEdit);
// router.put("/update-recurring-edit-status/:id", toggleRecurringEditStatus);
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
