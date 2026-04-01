import express from "express";
import rateLimit from "express-rate-limit";
import {
  syncProductData,
  getSyncStatus,
  trackProductSync,
  getSyncSocketAuth,
} from "../controllers/syncController.js";

const router = express.Router();
const syncMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: "Too many requests" }),
});
const syncReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: "Too many requests" }),
});

router.get("/products", syncMutationLimiter, syncProductData);
router.get("/sync-status", syncReadLimiter, getSyncStatus);
router.get("/product-track", syncReadLimiter, trackProductSync);
router.get("/socket-auth", syncReadLimiter, getSyncSocketAuth);

export default router;
