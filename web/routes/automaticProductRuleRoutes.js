import express from "express";
import {
  createAutomaticProductRuleController,
  deleteAutomaticProductRuleController,
  getAutomaticProductRuleByIdController,
  listAutomaticProductRuleRunsController,
  listAutomaticProductRulesController,
  pauseAutomaticProductRuleController,
  resumeAutomaticProductRuleController,
  runAutomaticProductRuleNowController,
  updateAutomaticProductRuleController,
} from "../controllers/automaticProductRuleController.js";
import { subscriptionMiddleware } from "../middleware/subscriptionMiddleware.js";

const router = express.Router();

router.get("/", listAutomaticProductRulesController);
router.get("/:id", getAutomaticProductRuleByIdController);
router.get("/:id/runs", listAutomaticProductRuleRunsController);
router.post("/", subscriptionMiddleware, createAutomaticProductRuleController);
router.put("/:id", subscriptionMiddleware, updateAutomaticProductRuleController);
router.post("/:id/pause", subscriptionMiddleware, pauseAutomaticProductRuleController);
router.post("/:id/resume", subscriptionMiddleware, resumeAutomaticProductRuleController);
router.post("/:id/run-now", subscriptionMiddleware, runAutomaticProductRuleNowController);
router.delete("/:id", deleteAutomaticProductRuleController);

export default router;
