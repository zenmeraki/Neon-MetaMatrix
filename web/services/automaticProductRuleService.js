import { automaticProductRuleRepository } from "../repositories/automaticProductRuleRepository.js";
import { automaticProductRuleRunRepository } from "../repositories/automaticProductRuleRunRepository.js";
import {
  assertAutomaticProductRuleAccess,
  assertAutomaticProductRuleActiveLimit,
} from "./automaticProductRulePlanService.js";
import {
  buildAutomaticProductRuleScheduleInput,
  computeAutomaticProductRuleNextRunAt,
  parseAutomaticProductRuleDate,
} from "./automaticProductRuleScheduleService.js";
import { createManualAutomaticProductRuleRun } from "./automaticProductRuleExecutionService.js";
import { getUpdatedProducts } from "../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { FIELD_CONFIGS } from "../helpers/productBulkOperationHelpers/constants.js";

function normalizeStatus(rawStatus, fallback = "ACTIVE") {
  if (!rawStatus) return fallback;
  const value = String(rawStatus).trim().toUpperCase();
  if (!["ACTIVE", "PAUSED", "FAILED", "CANCELLED"].includes(value)) {
    throw new Error("Unsupported automatic rule status");
  }
  return value;
}

function normalizeTriggerType(rawValue, fallback = "EVENT") {
  const value = String(rawValue || fallback).trim().toUpperCase();
  if (!["EVENT", "SCHEDULED", "HYBRID"].includes(value)) {
    throw new Error("Unsupported triggerType");
  }
  return value;
}

function normalizeScopeType(rawValue, actions = []) {
  if (rawValue) {
    const value = String(rawValue).trim().toUpperCase();
    if (!["PRODUCT", "VARIANT"].includes(value)) {
      throw new Error("Unsupported scopeType");
    }
    return value;
  }

  return actions.some((action) =>
    [
      "price",
      "barcode",
      "sku",
      "inventory",
      "taxable",
      "compareAtPrice",
      "option1Values",
      "option2Values",
      "option3Values",
      "inventoryPolicy",
      "cost",
      "weight",
      "weightUnit",
    ].includes(action?.field),
  )
    ? "VARIANT"
    : "PRODUCT";
}

function normalizeApplyMode(rawValue) {
  return String(rawValue || "APPLY_TO_MATCHED").trim().toUpperCase();
}

function normalizeOptionalInteger(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return parsed;
}

function normalizePriority(value) {
  if (value === undefined || value === null || value === "") return 100;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error("priority must be an integer");
  }

  return parsed;
}

function buildActionsFromBody(body = {}) {
  if (Array.isArray(body.actions) && body.actions.length > 0) {
    return body.actions.map((action) => ({
      field: action.field,
      value: action.value ?? null,
      editOption: action.editOption ?? action.editedType ?? action.editedBy ?? null,
      searchKey: action.searchKey ?? null,
      replaceText: action.replaceText ?? null,
      supportValue: action.supportValue ?? null,
      locationId: action.locationId ?? null,
    }));
  }

  if (!body.editedField) {
    throw new Error("actions are required");
  }

  return [
    {
      field: body.editedField,
      value: body.value ?? null,
      editOption: body.editedBy ?? body.editType ?? body.editedType ?? null,
      searchKey: body.searchKey ?? null,
      replaceText: body.replaceText ?? null,
      supportValue: body.supportValue ?? null,
      locationId: body.locationId ?? null,
    },
  ];
}

function getActionMutationMode(action) {
  const field = action?.field;
  const config = FIELD_CONFIGS?.[field];
  if (!field || !config) {
    throw new Error(`Unsupported action field: ${field || "unknown"}`);
  }

  if (field === "deleteProducts") return "DELETE";
  if (config.isVariantLevel) return "VARIANT";
  return "PRODUCT";
}

function validateActions(actions = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("actions are required");
  }

  const mutationModes = new Set();
  const validated = actions.map((action) => {
    if (!action?.field) throw new Error("action.field is required");
    if (!action?.editOption) throw new Error("action.editOption is required");
    mutationModes.add(getActionMutationMode(action));
    return action;
  });

  if (mutationModes.has("DELETE") && mutationModes.size > 1) {
    throw new Error("Delete actions cannot be combined with other automatic rule actions");
  }

  if (mutationModes.has("PRODUCT") && mutationModes.has("VARIANT")) {
    throw new Error(
      "Automatic rules cannot mix product-level and variant-level actions in a single rule with the current bulk edit pipeline",
    );
  }

  return validated;
}

function defaultTitleFromActions(actions = []) {
  return actions
    .map((action) =>
      getUpdatedProducts({
        field: action.field,
        editType: action.editOption,
        value: action.value,
        supportValue: action.supportValue,
        searchKey: action.searchKey,
        replaceText: action.replaceText,
        returnTitleOnly: true,
      }),
    )
    .filter(Boolean)
    .join(" + ") || "Automatic product rule";
}

function mapStatusForClient(status) {
  return {
    ACTIVE: "Active",
    PAUSED: "Paused",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
  }[status] || status;
}

function indexRunCounts(statusCounts = []) {
  return statusCounts.reduce((accumulator, row) => {
    const current = accumulator[row.automaticProductRuleId] || {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    };

    current.total += row._count._all;
    if (row.status === "SUCCESS") current.success += row._count._all;
    if (row.status === "FAILED") current.failed += row._count._all;
    if (row.status === "SKIPPED") current.skipped += row._count._all;
    accumulator[row.automaticProductRuleId] = current;
    return accumulator;
  }, {});
}

function indexLatestRuns(runs = []) {
  const latestByRuleId = {};
  for (const run of runs) {
    if (!latestByRuleId[run.automaticProductRuleId]) {
      latestByRuleId[run.automaticProductRuleId] = run;
    }
  }
  return latestByRuleId;
}

function serializeRule(rule, countsById = {}, latestRunsById = {}) {
  const counts = countsById[rule.id] || {
    total: rule.runCount || 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };
  const latestRun = latestRunsById[rule.id] || null;

  return {
    id: rule.id,
    _id: rule.id,
    shop: rule.shop,
    title: rule.title,
    status: mapStatusForClient(rule.status),
    statusKey: rule.status,
    triggerType: rule.triggerType,
    scheduleType: rule.scheduleType,
    timezone: rule.timezone,
    scheduleConfig: rule.scheduleConfig,
    cronExpression: rule.cronExpression,
    intervalMinutes: rule.intervalMinutes,
    scopeType: rule.scopeType,
    conditions: rule.conditions,
    actions: rule.actions,
    applyMode: rule.applyMode,
    priority: rule.priority,
    cooldownMinutes: rule.cooldownMinutes,
    maxAffectedPerRun: rule.maxAffectedPerRun,
    runCount: rule.runCount,
    totalRuns: counts.total,
    successfulRuns: counts.success,
    totalFails: counts.failed,
    totalRunsSkipped: counts.skipped,
    nextRunAt: rule.nextRunAt,
    lastRunAt: rule.lastRunAt,
    lastSuccessAt: rule.lastSuccessAt,
    lastFailureAt: rule.lastFailureAt,
    lastFailureReason: rule.lastFailureReason,
    lastRunStatus: latestRun?.status ?? null,
    lastRunMessage: latestRun?.errorMessage ?? rule.lastFailureReason ?? null,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

async function getHydratedRule(id, shop) {
  const rule = await automaticProductRuleRepository.findByIdForShop(id, shop);
  if (!rule) {
    throw new Error("Automatic product rule not found");
  }

  const [statusCounts, latestRuns] = await Promise.all([
    automaticProductRuleRunRepository.groupStatusCounts([rule.id]),
    automaticProductRuleRunRepository.findLatestRuns([rule.id]),
  ]);

  return serializeRule(rule, indexRunCounts(statusCounts), indexLatestRuns(latestRuns));
}

function buildEventOnlyScheduleInput(body, existing = null) {
  return {
    scheduleType: null,
    timezone: null,
    scheduleConfig: null,
    cronExpression: null,
    intervalMinutes: null,
    startAt: parseAutomaticProductRuleDate(body.startAt ?? existing?.startAt, "startAt"),
    endAt: parseAutomaticProductRuleDate(body.endAt ?? existing?.endAt, "endAt"),
  };
}

function assertRuleLifecycleDates(startAt, endAt) {
  if (startAt && endAt && startAt >= endAt) {
    throw new Error("endAt must be greater than startAt");
  }
}

function assertSchedulableIfNeeded(triggerType, status, scheduleInput) {
  if (triggerType === "EVENT" || status !== "ACTIVE") {
    return;
  }

  const nextRunAt = computeAutomaticProductRuleNextRunAt(
    { ...scheduleInput, triggerType, status, endAt: scheduleInput.endAt },
    scheduleInput.startAt || new Date(),
  );

  if (!nextRunAt) {
    throw new Error("The current automatic rule schedule does not have a future execution time");
  }
}

export async function createAutomaticProductRule({ shop, body, subscription, createdBy = null }) {
  await assertAutomaticProductRuleAccess(subscription);

  const triggerType = normalizeTriggerType(body.triggerType);
  const actions = validateActions(buildActionsFromBody(body));
  const scopeType = normalizeScopeType(body.scopeType, actions);
  const status = normalizeStatus(body.status, "ACTIVE");
  const conditions = Array.isArray(body.conditions)
    ? body.conditions
    : Array.isArray(body.filterParams)
      ? body.filterParams
      : [];

  if (status === "ACTIVE") {
    await assertAutomaticProductRuleActiveLimit({
      shop,
      repository: automaticProductRuleRepository,
    });
  }

  const scheduleInput = triggerType === "EVENT"
    ? buildEventOnlyScheduleInput(body)
    : buildAutomaticProductRuleScheduleInput(body);

  if (triggerType !== "EVENT" && !scheduleInput.scheduleType) {
    throw new Error("scheduleType is required for scheduled automatic rules");
  }

  assertRuleLifecycleDates(scheduleInput.startAt, scheduleInput.endAt);
  assertSchedulableIfNeeded(triggerType, status, scheduleInput);

  const nextRunAt = status === "ACTIVE" && triggerType !== "EVENT"
    ? computeAutomaticProductRuleNextRunAt(
        { ...scheduleInput, status, endAt: scheduleInput.endAt },
        scheduleInput.startAt || new Date(),
      )
    : null;

  const created = await automaticProductRuleRepository.create({
    shop,
    title: String(body.title || "").trim() || defaultTitleFromActions(actions),
    status,
    triggerType,
    scheduleType: scheduleInput.scheduleType,
    timezone: scheduleInput.timezone,
    scheduleConfig: scheduleInput.scheduleConfig,
    cronExpression: scheduleInput.cronExpression,
    intervalMinutes: scheduleInput.intervalMinutes,
    startAt: scheduleInput.startAt,
    endAt: scheduleInput.endAt,
    scopeType,
    conditions,
    actions,
    applyMode: normalizeApplyMode(body.applyMode),
    priority: normalizePriority(body.priority),
    cooldownMinutes: normalizeOptionalInteger(body.cooldownMinutes, "cooldownMinutes"),
    maxAffectedPerRun: normalizeOptionalInteger(body.maxAffectedPerRun, "maxAffectedPerRun"),
    nextRunAt,
    createdBy,
    updatedBy: createdBy,
  });

  return getHydratedRule(created.id, shop);
}

export async function listAutomaticProductRules({ shop }) {
  const rules = await automaticProductRuleRepository.listByShop(shop);
  const ids = rules.map((rule) => rule.id);
  const [statusCounts, latestRuns] = await Promise.all([
    automaticProductRuleRunRepository.groupStatusCounts(ids),
    automaticProductRuleRunRepository.findLatestRuns(ids),
  ]);

  return rules.map((rule) =>
    serializeRule(rule, indexRunCounts(statusCounts), indexLatestRuns(latestRuns)),
  );
}

export async function getAutomaticProductRuleById({ shop, automaticProductRuleId }) {
  return getHydratedRule(automaticProductRuleId, shop);
}

export async function updateAutomaticProductRule({
  shop,
  automaticProductRuleId,
  body,
  subscription,
  updatedBy = null,
}) {
  const existing = await automaticProductRuleRepository.findByIdForShop(automaticProductRuleId, shop);
  if (!existing) throw new Error("Automatic product rule not found");

  const triggerType = normalizeTriggerType(body.triggerType ?? existing.triggerType);
  const actions = body.actions || body.editedField
    ? validateActions(buildActionsFromBody(body))
    : existing.actions;
  const scopeType = normalizeScopeType(body.scopeType ?? existing.scopeType, actions);
  const status = normalizeStatus(body.status, existing.status);
  const conditions = Array.isArray(body.conditions)
    ? body.conditions
    : Array.isArray(body.filterParams)
      ? body.filterParams
      : existing.conditions;

  if (status === "ACTIVE") {
    await assertAutomaticProductRuleAccess(subscription);
    if (existing.status !== "ACTIVE") {
      await assertAutomaticProductRuleActiveLimit({
        shop,
        repository: automaticProductRuleRepository,
        excludeAutomaticProductRuleId: existing.id,
      });
    }
  }

  const scheduleInput = triggerType === "EVENT"
    ? buildEventOnlyScheduleInput(body, existing)
    : buildAutomaticProductRuleScheduleInput(body, existing);

  assertRuleLifecycleDates(scheduleInput.startAt, scheduleInput.endAt);
  assertSchedulableIfNeeded(triggerType, status, scheduleInput);

  const nextRunAt = status === "ACTIVE" && triggerType !== "EVENT"
    ? computeAutomaticProductRuleNextRunAt({ ...existing, ...scheduleInput, status, triggerType }, new Date())
    : null;

  await automaticProductRuleRepository.updateById(existing.id, {
    title: body.title !== undefined
      ? String(body.title || "").trim() || defaultTitleFromActions(actions)
      : existing.title,
    status,
    triggerType,
    scheduleType: scheduleInput.scheduleType,
    timezone: scheduleInput.timezone,
    scheduleConfig: scheduleInput.scheduleConfig,
    cronExpression: scheduleInput.cronExpression,
    intervalMinutes: scheduleInput.intervalMinutes,
    startAt: scheduleInput.startAt,
    endAt: scheduleInput.endAt,
    scopeType,
    conditions,
    actions,
    applyMode: body.applyMode !== undefined ? normalizeApplyMode(body.applyMode) : existing.applyMode,
    priority: body.priority !== undefined ? normalizePriority(body.priority) : existing.priority,
    cooldownMinutes: body.cooldownMinutes !== undefined
      ? normalizeOptionalInteger(body.cooldownMinutes, "cooldownMinutes")
      : existing.cooldownMinutes,
    maxAffectedPerRun: body.maxAffectedPerRun !== undefined
      ? normalizeOptionalInteger(body.maxAffectedPerRun, "maxAffectedPerRun")
      : existing.maxAffectedPerRun,
    nextRunAt,
    updatedBy,
    isDeleted: false,
  });

  return getHydratedRule(existing.id, shop);
}

export async function pauseAutomaticProductRule({ shop, automaticProductRuleId }) {
  const existing = await automaticProductRuleRepository.findByIdForShop(automaticProductRuleId, shop);
  if (!existing) throw new Error("Automatic product rule not found");

  await automaticProductRuleRepository.updateById(existing.id, {
    status: "PAUSED",
    nextRunAt: null,
  });

  return getHydratedRule(existing.id, shop);
}

export async function resumeAutomaticProductRule({
  shop,
  automaticProductRuleId,
  subscription,
  updatedBy = null,
}) {
  const existing = await automaticProductRuleRepository.findByIdForShop(automaticProductRuleId, shop);
  if (!existing) throw new Error("Automatic product rule not found");
  if (existing.isDeleted || existing.status === "CANCELLED") {
    throw new Error("Cancelled automatic product rules cannot be resumed");
  }

  await assertAutomaticProductRuleAccess(subscription);
  await assertAutomaticProductRuleActiveLimit({
    shop,
    repository: automaticProductRuleRepository,
    excludeAutomaticProductRuleId: existing.id,
  });

  const nextRunAt = existing.triggerType === "EVENT"
    ? null
    : computeAutomaticProductRuleNextRunAt(existing, new Date());

  await automaticProductRuleRepository.updateById(existing.id, {
    status: "ACTIVE",
    nextRunAt,
    updatedBy,
  });

  return getHydratedRule(existing.id, shop);
}

export async function runAutomaticProductRuleNow({
  shop,
  automaticProductRuleId,
  subscription,
}) {
  const rule = await automaticProductRuleRepository.findByIdForShop(automaticProductRuleId, shop);
  if (!rule) throw new Error("Automatic product rule not found");

  await assertAutomaticProductRuleAccess(subscription);
  if (rule.status !== "ACTIVE") {
    throw new Error("Automatic product rule must be active to run now");
  }

  return createManualAutomaticProductRuleRun({ rule });
}

export async function deleteAutomaticProductRule({ shop, automaticProductRuleId }) {
  const existing = await automaticProductRuleRepository.findByIdForShop(automaticProductRuleId, shop);
  if (!existing) throw new Error("Automatic product rule not found");

  await automaticProductRuleRepository.updateById(existing.id, {
    status: "CANCELLED",
    isDeleted: true,
    nextRunAt: null,
    endAt: existing.endAt || new Date(),
  });

  return { id: existing.id, deleted: true };
}

export async function listAutomaticProductRuleRuns({ shop, automaticProductRuleId }) {
  const rule = await automaticProductRuleRepository.findByIdForShop(automaticProductRuleId, shop);
  if (!rule) throw new Error("Automatic product rule not found");

  return automaticProductRuleRunRepository.listByRule(automaticProductRuleId, shop);
}
