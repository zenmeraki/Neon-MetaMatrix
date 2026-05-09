import express from "express";
import {
  listProductSavedSegments,
  saveProductSavedSegment,
  deleteProductSavedSegment,
} from "../controllers/productSavedSegmentController.js";

const router = express.Router();

router.get("/", listProductSavedSegments);
router.post("/", saveProductSavedSegment);
router.delete("/:id", deleteProductSavedSegment);

export default router;
