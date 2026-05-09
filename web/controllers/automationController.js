import { prisma } from "../config/database.js";
import { getSessionOrThrow } from "../utils/sessionShop.js";
import {
  activateAutomationRule,
  createAutomationRule,
} from "../services/automation/automationRuleService.js";
import { runAutomationRule } from "../services/automation/automationRunService.js";

export const listAutomationRulesController = async (req, res) => {
  try {
    const session = getSessionOrThrow(res);
    const rules = await prisma.automationRule.findMany({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return res.status(200).json({ success: true, data: rules });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({
      success: false,
      message: error?.message || "Failed to list automation rules",
    });
  }
};

export const createAutomationRuleController = async (req, res) => {
  try {
    const session = getSessionOrThrow(res);
    const {
      name,
      triggerType,
      triggerConfig,
      ruleAstJson,
      actionsJson,
      dryRunFirst = true,
      cooldownSeconds = 300,
      maxRunsPerDay = 24,
    } = req.body || {};

    const created = await createAutomationRule({
      shop: session.shop,
      name,
      triggerType,
      triggerConfig,
      ruleAstJson,
      actionsJson,
      dryRunFirst,
      cooldownSeconds,
      maxRunsPerDay,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    return res.status(error?.statusCode || 400).json({
      success: false,
      message: error?.message || "Failed to create automation rule",
    });
  }
};

export const activateAutomationRuleController = async (req, res) => {
  try {
    const session = getSessionOrThrow(res);
    const result = await activateAutomationRule({
      shop: session.shop,
      automationRuleId: req.params.id,
    });
    if (result.count !== 1) {
      return res.status(404).json({
        success: false,
        message: "AUTOMATION_RULE_NOT_FOUND_OR_NOT_ACTIVATABLE",
      });
    }
    return res.status(200).json({ success: true, data: { updated: result.count } });
  } catch (error) {
    return res.status(error?.statusCode || 400).json({
      success: false,
      message: error?.message || "Failed to activate automation rule",
    });
  }
};

export const pauseAutomationRuleController = async (req, res) => {
  try {
    const session = getSessionOrThrow(res);
    const result = await prisma.automationRule.updateMany({
      where: {
        id: req.params.id,
        shop: session.shop,
        status: { in: ["ACTIVE"] },
      },
      data: { status: "PAUSED" },
    });
    if (result.count !== 1) {
      return res.status(404).json({
        success: false,
        message: "AUTOMATION_RULE_NOT_FOUND_OR_NOT_PAUSABLE",
      });
    }
    return res.status(200).json({ success: true, data: { updated: result.count } });
  } catch (error) {
    return res.status(error?.statusCode || 400).json({
      success: false,
      message: error?.message || "Failed to pause automation rule",
    });
  }
};

export const listAutomationRunsController = async (req, res) => {
  try {
    const session = getSessionOrThrow(res);
    const runs = await prisma.automationRun.findMany({
      where: {
        shop: session.shop,
        automationRuleId: req.params.id,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.status(200).json({ success: true, data: runs });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({
      success: false,
      message: error?.message || "Failed to list automation runs",
    });
  }
};

export const promoteAutomationRunController = async (req, res) => {
  try {
    const session = getSessionOrThrow(res);
    const { id, runId } = req.params;
    const approved = req.body?.approved === true;
    const maxApprovedTargets = Number(req.body?.maxApprovedTargets);

    if (!approved) {
      return res.status(400).json({
        success: false,
        message: "APPROVAL_REQUIRED",
      });
    }

    if (!Number.isFinite(maxApprovedTargets) || maxApprovedTargets <= 0) {
      return res.status(400).json({
        success: false,
        message: "MAX_APPROVED_TARGETS_REQUIRED",
      });
    }

    const run = await prisma.automationRun.findFirst({
      where: {
        id: runId,
        automationRuleId: id,
        shop: session.shop,
      },
    });

    if (!run) {
      return res.status(404).json({
        success: false,
        message: "AUTOMATION_RUN_NOT_FOUND",
      });
    }

    if (run.status !== "PREVIEW_READY") {
      return res.status(409).json({
        success: false,
        message: "AUTOMATION_RUN_NOT_PROMOTABLE",
      });
    }

    const targetCount = Number(run.targetCount || 0);
    if (targetCount > maxApprovedTargets) {
      return res.status(409).json({
        success: false,
        message: "AUTOMATION_PROMOTION_TARGET_CAP_EXCEEDED",
      });
    }

    const updated = await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "READY_TO_EXECUTE",
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
      },
    });
  } catch (error) {
    return res.status(error?.statusCode || 400).json({
      success: false,
      message: error?.message || "Failed to promote automation run",
    });
  }
};

export const previewAutomationRunController = async (req, res) => {
  try {
    const session = getSessionOrThrow(res);
    const rule = await prisma.automationRule.findFirstOrThrow({
      where: { id: req.params.id, shop: session.shop },
      select: { id: true },
    });
    const store = await prisma.store.findUnique({
      where: { shopUrl: session.shop },
      select: { activeMirrorBatchId: true },
    });
    const mirrorBatchId = req.body?.mirrorBatchId || store?.activeMirrorBatchId;
    if (!mirrorBatchId) {
      return res.status(400).json({
        success: false,
        message: "MIRROR_BATCH_ID_REQUIRED",
      });
    }

    const result = await runAutomationRule({
      shop: session.shop,
      automationRuleId: rule.id,
      mirrorBatchId,
      triggerReason: "MANUAL_PREVIEW",
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error?.statusCode || 400).json({
      success: false,
      message: error?.message || "Failed to create automation preview run",
    });
  }
};
