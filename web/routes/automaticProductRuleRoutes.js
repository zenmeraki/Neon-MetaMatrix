import express from "express";
import {
  createAutomaticProductRuleController,
  deleteAutomaticProductRuleController,
  getAutomaticProductRuleBuilderOptionsController,
  getAutomaticProductRuleByIdController,
  listAutomaticProductRuleRunsController,
  listAutomaticProductRulesController,
  previewAutomaticProductRuleAstController,
  pauseAutomaticProductRuleController,
  resumeAutomaticProductRuleController,
  runAutomaticProductRuleNowController,
  updateAutomaticProductRuleController,
  validateAutomaticProductRuleAstController,
} from "../controllers/automaticProductRuleController.js";
import { subscriptionMiddleware } from "../middleware/subscriptionMiddleware.js";

const router = express.Router();

router.get("/", listAutomaticProductRulesController);
router.get("/builder/options", getAutomaticProductRuleBuilderOptionsController);
router.post("/builder/validate", subscriptionMiddleware, validateAutomaticProductRuleAstController);
router.post("/builder/preview", subscriptionMiddleware, previewAutomaticProductRuleAstController);
router.get("/:id", getAutomaticProductRuleByIdController);
router.get("/:id/runs", listAutomaticProductRuleRunsController);
router.post("/", subscriptionMiddleware, createAutomaticProductRuleController);
router.put("/:id", subscriptionMiddleware, updateAutomaticProductRuleController);
router.post("/:id/pause", subscriptionMiddleware, pauseAutomaticProductRuleController);
router.post("/:id/resume", subscriptionMiddleware, resumeAutomaticProductRuleController);
router.post("/:id/run-now", subscriptionMiddleware, runAutomaticProductRuleNowController);
router.delete("/:id", deleteAutomaticProductRuleController);

export default router;
