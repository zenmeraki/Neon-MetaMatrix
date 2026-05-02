import express from "express";
import {
  createProductCodeSnippetController,
  deleteProductCodeSnippetController,
  getProductCodeSnippetByIdController,
  listProductCodeSnippetsController,
  previewProductCodeSnippetController,
  searchSnippetPreviewProductsController,
  updateProductCodeSnippetController,
  validateProductCodeSnippetController,
} from "../controllers/productCodeSnippetController.js";

const router = express.Router();

router.get("/", listProductCodeSnippetsController);
router.get("/preview-products", searchSnippetPreviewProductsController);
router.get("/:id", getProductCodeSnippetByIdController);
router.post("/", createProductCodeSnippetController);
router.put("/:id", updateProductCodeSnippetController);
router.delete("/:id", deleteProductCodeSnippetController);
router.post("/:id/validate", validateProductCodeSnippetController);
router.post("/:id/preview", previewProductCodeSnippetController);

export default router;
