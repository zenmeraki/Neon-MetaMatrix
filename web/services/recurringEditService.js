import { prisma } from "../config/database.js";
import { Services } from "./productService/productFilterService.js";
import { getUpdatedProducts } from "../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { recurringEditRepository } from "../repositories/recurringEditRepository.js";
import { recurringEditRunRepository } from "../repositories/recurringEditRunRepository.js";
import {
  assertProRecurringEditAccess,
  assertRecurringEditActiveLimit,
} from "./recurringEditPlanService.js";
import {
  buildRecurringScheduleInput,
  computeRecurringEditNextRunAt,
} from "./recurringEditScheduleService.js";
import logger from "../utils/loggerUtils.js";

const productQueryService = new Services();
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function normalizeStatus(rawStatus, fallback = "ACTIVE") {
  if (!rawStatus) return fallback;

  const value = String(rawStatus).trim().toUpperCase();
  switch (value) {
    case "ACTIVE":
    case "PAUSED":
    case "COMPLETED":
    case "FAILED":
    case "CANCELLED":
      return value;
    case "INACTIVE":
      return "PAUSED";
    default:
      throw new Error("Unsupported recurring edit status");
  }
}

function buildRulesFromBody(body = {}) {
  if (Array.isArray(body.rules) && body.rules.length > 0) {
    return body.rules;
  }

  if (!body.editedField) {
    throw new Error("rules are required");
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

function validateRules(rules = []) {
  if (!Array.isArray(rules) || rules.length !== 1) {
    throw new Error(
      "Recurring edits require exactly one rule in the current bulk edit pipeline",
    );
  }

  const [rule] = rules;
  if (!rule?.field) throw new Error("Recurring edit rule.field is required");
  if (!rule?.editOption) {
    throw new Error("Recurring edit rule.editOption is required");
  }

  return rule;
}

function buildDefaultTitle(rule) {
  return getUpdatedProducts({
    field: rule.field,
    editType: rule.editOption,
    value: rule.value,
    supportValue: rule.supportValue,
    searchKey: rule.searchKey,
    replaceText: rule.replaceText,
    returnTitleOnly: true,
  });
}

function mapStatusForClient(status) {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "PAUSED":
      return "Inactive";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

function mapFrequencyForClient(edit) {
  if (edit.scheduleType === "EVERY_X_MINUTES") {
    if (edit.intervalMinutes === 60) return "Hourly";
    if (edit.intervalMinutes === 120) return "Every 2 Hours";
    return "Every X Minutes";
  }

  return edit.scheduleType.toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

function indexRunCounts(statusCounts = []) {
  return statusCounts.reduce((accumulator, row) => {
    const current = accumulator[row.recurringEditId] || {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    };

    current.total += row._count._all;
    if (row.status === "SUCCESS") current.success += row._count._all;
    if (row.status === "FAILED") current.failed += row._count._all;
    if (row.status === "SKIPPED") current.skipped += row._count._all;

    accumulator[row.recurringEditId] = current;
    return accumulator;
  }, {});
}

function indexLatestRuns(runs = []) {
  const latestByRecurringEdit = {};

  for (const run of runs) {
    if (!latestByRecurringEdit[run.recurringEditId]) {
      latestByRecurringEdit[run.recurringEditId] = run;
    }
  }

  return latestByRecurringEdit;
}

function serializeRecurringEdit(edit, countsById = {}, latestRunsById = {}) {
  const counts = countsById[edit.id] || {
    total: edit.runCount || 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };
  const latestRun = latestRunsById[edit.id] || null;

  return {
    _id: edit.id,
    id: edit.id,
    shop: edit.shop,
    title: edit.title,
    status: mapStatusForClient(edit.status),
    statusKey: edit.status,
    frequency: mapFrequencyForClient(edit),
    scheduleType: edit.scheduleType,
    timezone: edit.timezone,
    scheduleConfig: edit.scheduleConfig,
    cronExpression: edit.cronExpression,
    intervalMinutes: edit.intervalMinutes,
    timeToRun: edit.scheduleConfig?.time ?? null,
    dayOfMonthToRun: edit.scheduleConfig?.dayOfMonth ?? null,
    daysOfWeekToRun: Array.isArray(edit.scheduleConfig?.weekdays)
      ? edit.scheduleConfig.weekdays.map(
          (weekday) => WEEKDAY_NAMES[weekday] ?? String(weekday),
        )
      : [],
    totalRuns: counts.total,
    successfulRuns: counts.success,
    totalRunsSucceed: counts.success,
    totalRunsSkipped: counts.skipped,
    totalFails: counts.failed,
    runCount: edit.runCount,
    nextRun: edit.nextRunAt,
    nextRunAt: edit.nextRunAt,
    lastRunAt: edit.lastRunAt,
    lastSuccessAt: edit.lastSuccessAt,
    lastFailureAt: edit.lastFailureAt,
    lastFailureReason: edit.lastFailureReason,
    lastRunStatus: latestRun?.status ?? null,
    lastRunMessage: latestRun?.errorMessage ?? edit.lastFailureReason ?? null,
    rules: edit.rules,
    steps: edit.rules,
    filterParams: edit.filterParams,
    queryFilter: JSON.stringify(edit.filterParams),
    startAt: edit.startAt,
    endAt: edit.endAt,
    createdAt: edit.createdAt,
    updatedAt: edit.updatedAt,
  };
}

async function getRecurringEditHydrated(id, shop) {
  const edit = await recurringEditRepository.findByIdForShop(id, shop);
  if (!edit) {
    throw new Error("Recurring edit not found");
  }

  const [statusCounts, latestRuns] = await Promise.all([
    recurringEditRunRepository.groupStatusCounts([edit.id]),
    recurringEditRunRepository.findLatestRuns([edit.id]),
  ]);

  const countsById = indexRunCounts(statusCounts);
  const latestRunsById = indexLatestRuns(latestRuns);
  const serialized = serializeRecurringEdit(edit, countsById, latestRunsById);

  const where = productQueryService.getProductPrismaWhere(edit.filterParams, shop);
  const latestHistory = latestRunsById[edit.id]?.editHistoryId
    ? await prisma.editHistory.findUnique({
        where: { id: latestRunsById[edit.id].editHistoryId },
        select: {
          processedCount: true,
          totalItems: true,
          durationMs: true,
        },
      })
    : null;

  return {
    ...serialized,
    totalItems: latestHistory?.totalItems ?? (await prisma.product.count({ where })),
    processedCount: latestHistory?.processedCount ?? 0,
    durationMs: latestHistory?.durationMs ?? 0,
  };
}

export async function createRecurringEdit({ shop, body, subscription }) {
  await assertProRecurringEditAccess(subscription);

  const filterParams = Array.isArray(body.filterParams) ? body.filterParams : [];
  const rules = buildRulesFromBody(body);
  const rule = validateRules(rules);
  const status = normalizeStatus(body.status, "ACTIVE");

  if (status === "ACTIVE") {
    await assertRecurringEditActiveLimit({ shop });
  }

  const scheduleInput = buildRecurringScheduleInput(body);
  const title = String(body.title || "").trim() || buildDefaultTitle(rule);
  const nextRunAt = status === "ACTIVE"
    ? computeRecurringEditNextRunAt({ ...scheduleInput, status }, scheduleInput.startAt || new Date())
    : null;

  const created = await recurringEditRepository.create({
    shop,
    title,
    status,
    scheduleType: scheduleInput.scheduleType,
    timezone: scheduleInput.timezone,
    scheduleConfig: scheduleInput.scheduleConfig,
    cronExpression: scheduleInput.cronExpression,
    intervalMinutes: scheduleInput.intervalMinutes,
    startAt: scheduleInput.startAt,
    endAt: scheduleInput.endAt,
    filterParams,
    rules,
    nextRunAt,
  });

  logger.info("Recurring edit created", {
    shop,
    recurringEditId: created.id,
    scheduleType: created.scheduleType,
    nextRunAt: created.nextRunAt,
  });

  return getRecurringEditHydrated(created.id, shop);
}

export async function listRecurringEdits({ shop }) {
  const edits = await recurringEditRepository.listByShop(shop);
  const ids = edits.map((edit) => edit.id);
  const [statusCounts, latestRuns] = await Promise.all([
    recurringEditRunRepository.groupStatusCounts(ids),
    recurringEditRunRepository.findLatestRuns(ids),
  ]);

  const countsById = indexRunCounts(statusCounts);
  const latestRunsById = indexLatestRuns(latestRuns);

  return edits.map((edit) => serializeRecurringEdit(edit, countsById, latestRunsById));
}

export async function getRecurringEditById({ shop, recurringEditId }) {
  return getRecurringEditHydrated(recurringEditId, shop);
}

export async function updateRecurringEdit({
  shop,
  recurringEditId,
  body,
  subscription,
}) {
  const existing = await recurringEditRepository.findByIdForShop(recurringEditId, shop);
  if (!existing) {
    throw new Error("Recurring edit not found");
  }

  const mergedBody = {
    ...body,
    scheduleType: body.scheduleType ?? body.frequency ?? existing.scheduleType,
    timezone: body.timezone ?? existing.timezone,
    startAt: body.startAt ?? existing.startAt,
    endAt: body.endAt ?? existing.endAt,
    scheduleConfig: body.scheduleConfig ?? existing.scheduleConfig,
    intervalMinutes: body.intervalMinutes ?? existing.intervalMinutes,
    cronExpression: body.cronExpression ?? existing.cronExpression,
  };

  const nextStatus = normalizeStatus(body.status, existing.status);
  if (nextStatus === "ACTIVE") {
    await assertProRecurringEditAccess(subscription);
    if (existing.status !== "ACTIVE") {
      await assertRecurringEditActiveLimit({
        shop,
        excludeRecurringEditId: existing.id,
      });
    }
  }

  const scheduleInput = buildRecurringScheduleInput(mergedBody, existing);
  const rules = body.rules ? buildRulesFromBody(body) : existing.rules;
  const rule = validateRules(rules);
  const filterParams = Array.isArray(body.filterParams) ? body.filterParams : existing.filterParams;
  const title = body.title !== undefined
    ? String(body.title || "").trim() || buildDefaultTitle(rule)
    : existing.title;
  const nextRunAt = nextStatus === "ACTIVE"
    ? computeRecurringEditNextRunAt({ ...existing, ...scheduleInput, status: nextStatus }, new Date())
    : null;

  await recurringEditRepository.updateById(existing.id, {
    title,
    status: nextStatus,
    scheduleType: scheduleInput.scheduleType,
    timezone: scheduleInput.timezone,
    scheduleConfig: scheduleInput.scheduleConfig,
    cronExpression: scheduleInput.cronExpression,
    intervalMinutes: scheduleInput.intervalMinutes,
    startAt: scheduleInput.startAt,
    endAt: scheduleInput.endAt,
    filterParams,
    rules,
    nextRunAt,
    isDeleted: false,
  });

  return getRecurringEditHydrated(existing.id, shop);
}

export async function toggleRecurringEditStatus({
  shop,
  recurringEditId,
  status,
  subscription,
}) {
  const existing = await recurringEditRepository.findByIdForShop(recurringEditId, shop);
  if (!existing) {
    throw new Error("Recurring edit not found");
  }

  const requestedStatus = normalizeStatus(
    status,
    existing.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
  );

  if (requestedStatus === "ACTIVE") {
    await assertProRecurringEditAccess(subscription);
    await assertRecurringEditActiveLimit({
      shop,
      excludeRecurringEditId: existing.id,
    });
  }

  const nextRunAt = requestedStatus === "ACTIVE"
    ? computeRecurringEditNextRunAt(existing, new Date())
    : null;

  await recurringEditRepository.updateById(existing.id, {
    status: requestedStatus,
    nextRunAt,
  });

  return getRecurringEditHydrated(existing.id, shop);
}

export async function deleteRecurringEdit({ shop, recurringEditId }) {
  const existing = await recurringEditRepository.findByIdForShop(recurringEditId, shop);
  if (!existing) {
    throw new Error("Recurring edit not found");
  }

  await recurringEditRepository.updateById(existing.id, {
    status: "CANCELLED",
    isDeleted: true,
    nextRunAt: null,
    endAt: existing.endAt || new Date(),
  });

  return {
    id: existing.id,
    deleted: true,
  };
}
