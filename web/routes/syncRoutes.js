import express from "express";
import {
  syncProductData,
  getSyncStatus,
  trackProductSync,
} from "../controllers/syncController.js";

const router = express.Router();

router.get("/products", syncProductData);
router.get("/sync-status", getSyncStatus);
router.get("/product-track", trackProductSync);

export default router;
