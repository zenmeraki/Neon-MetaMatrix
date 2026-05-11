import express from "express";
import {
  activateAutomationRuleController,
  createAutomationRuleController,
  listAutomationRulesController,
  listAutomationRunsController,
  pauseAutomationRuleController,
  promoteAutomationRunController,
  previewAutomationRunController,
} from "../controllers/automationController.js";

const router = express.Router();

router.get("/", listAutomationRulesController);
router.post("/", createAutomationRuleController);
router.post("/:id/activate", activateAutomationRuleController);
router.post("/:id/pause", pauseAutomationRuleController);
router.get("/:id/runs", listAutomationRunsController);
router.post("/:id/runs/:runId/promote", promoteAutomationRunController);
router.post("/:id/preview-run", previewAutomationRunController);

export default router;
