import {
  createAutomaticProductRule,
  deleteAutomaticProductRule,
  getAutomaticProductRuleById,
  listAutomaticProductRuleRuns,
  listAutomaticProductRules,
  pauseAutomaticProductRule,
  resumeAutomaticProductRule,
  runAutomaticProductRuleNow,
  updateAutomaticProductRule,
} from "../services/automaticProductRuleService.js";
import { logApiError } from "../utils/errorLogUtils.js";

function getSessionOrThrow(res) {
  const session = res.locals.shopify?.session;
  if (!session?.shop) throw new Error("Session expired");
  return session;
}

function getUserFromSession(session) {
  return session?.id || session?.shop || null;
}

function getErrorStatusCode(error) {
  if (error.message === "Session expired") return 403;
  if (error.message === "Automatic product rule not found") return 404;
  return 400;
}

export async function createAutomaticProductRuleController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await createAutomaticProductRule({
      shop: session.shop,
      body: req.body,
      subscription: req.subscription,
      createdBy: getUserFromSession(session),
    });

    return res.status(201).json({ success: true, data, message: "Automatic rule created successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.create" });
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to create automatic rule",
    });
  }
}

export async function listAutomaticProductRulesController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await listAutomaticProductRules({ shop: session.shop });
    return res.status(200).json({ success: true, data, message: "Automatic rules fetched successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.list" });
    return res.status(error.message === "Session expired" ? 403 : 500).json({
      success: false,
      message: error.message || "Failed to fetch automatic rules",
    });
  }
}

export async function getAutomaticProductRuleByIdController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await getAutomaticProductRuleById({
      shop: session.shop,
      automaticProductRuleId: req.params.id,
    });

    return res.status(200).json({ success: true, data, message: "Automatic rule fetched successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.getById" });
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch automatic rule",
    });
  }
}

export async function updateAutomaticProductRuleController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await updateAutomaticProductRule({
      shop: session.shop,
      automaticProductRuleId: req.params.id,
      body: req.body,
      subscription: req.subscription,
      updatedBy: getUserFromSession(session),
    });

    return res.status(200).json({ success: true, data, message: "Automatic rule updated successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.update" });
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to update automatic rule",
    });
  }
}

export async function pauseAutomaticProductRuleController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await pauseAutomaticProductRule({
      shop: session.shop,
      automaticProductRuleId: req.params.id,
    });

    return res.status(200).json({ success: true, data, message: "Automatic rule paused successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.pause" });
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to pause automatic rule",
    });
  }
}

export async function resumeAutomaticProductRuleController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await resumeAutomaticProductRule({
      shop: session.shop,
      automaticProductRuleId: req.params.id,
      subscription: req.subscription,
      updatedBy: getUserFromSession(session),
    });

    return res.status(200).json({ success: true, data, message: "Automatic rule resumed successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.resume" });
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to resume automatic rule",
    });
  }
}

export async function runAutomaticProductRuleNowController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await runAutomaticProductRuleNow({
      shop: session.shop,
      automaticProductRuleId: req.params.id,
      subscription: req.subscription,
    });

    return res.status(202).json({ success: true, data, message: "Automatic rule run queued successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.runNow" });
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to queue automatic rule run",
    });
  }
}

export async function deleteAutomaticProductRuleController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await deleteAutomaticProductRule({
      shop: session.shop,
      automaticProductRuleId: req.params.id,
    });

    return res.status(200).json({ success: true, data, message: "Automatic rule deleted successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.delete" });
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to delete automatic rule",
    });
  }
}

export async function listAutomaticProductRuleRunsController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await listAutomaticProductRuleRuns({
      shop: session.shop,
      automaticProductRuleId: req.params.id,
    });

    return res.status(200).json({ success: true, data, message: "Automatic rule runs fetched successfully" });
  } catch (error) {
    await logApiError({ shop: session?.shop, err: error, req, source: "automaticProductRuleController.listRuns" });
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch automatic rule runs",
    });
  }
}
