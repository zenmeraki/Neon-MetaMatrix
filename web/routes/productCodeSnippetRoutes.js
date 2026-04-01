import express from "express";
import rateLimit from "express-rate-limit";
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
const snippetMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: "Too many requests" }),
});

router.get("/", listProductCodeSnippetsController);
router.get("/preview-products", searchSnippetPreviewProductsController);
router.get("/:id", getProductCodeSnippetByIdController);
router.post("/", snippetMutationLimiter, createProductCodeSnippetController);
router.put("/:id", snippetMutationLimiter, updateProductCodeSnippetController);
router.delete("/:id", snippetMutationLimiter, deleteProductCodeSnippetController);
router.post("/:id/validate", snippetMutationLimiter, validateProductCodeSnippetController);
router.post("/:id/preview", snippetMutationLimiter, previewProductCodeSnippetController);

export default router;
