import crypto from "crypto";
import { Services } from "./productService/productFilterService.js";
import { getUpdatedProducts } from "../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { FIELD_CONFIGS } from "../helpers/productBulkOperationHelpers/constants.js";
import { createMultiLanguage } from "../utils/googleTranslator.js";
import { scheduledEditQueue } from "../Jobs/Queues/scheduledEditQueue.js";
import { prisma } from "../config/database.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
  buildPlannedUndoState,
} from "./bulkEditExecutionStateService.js";
import {
  createIdempotencyFingerprint,
  stableStringify,
  withAdvisoryLock,
} from "../utils/idempotencyUtils.js";
import { normalizeCanonicalFilterParams } from "./productService/productFilterContract.js";
import { resolveCanonicalProductTarget } from "./productService/productTargetingService.js";
import { persistEditHistoryTargetingMetadata } from "./historyTargetingMetadataService.js";

const productService = new Services();
const PLAN_LIMITS = {
  ADVANCED_MONTHLY: 1000,
  PRO_MONTHLY: Infinity,
};

function createScheduledEditError(statusCode, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.userMessage = message;
  Object.assign(error, extra);
  return error;
}

function normalizeString(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeFilterParams(filterParams) {
  try {
    return normalizeCanonicalFilterParams(filterParams);
  } catch (error) {
    throw createScheduledEditError(400, error.message || "filterParams must be an array");
  }
}

function parseScheduledDate(rawValue, fieldName) {
  const normalized = normalizeString(rawValue);
  if (!normalized) {
    throw createScheduledEditError(400, `${fieldName} is required`);
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw createScheduledEditError(400, `Invalid ${fieldName}`);
  }

  return date;
}

function parseOptionalScheduledDate(rawValue, fieldName) {
  if (!normalizeString(rawValue)) {
    return null;
  }

  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) {
    throw createScheduledEditError(400, `Invalid ${fieldName}`);
  }

  return date;
}

function validateRuleInput({
  editedField,
  editedBy,
  filterParams,
  scheduledAt,
  scheduledUndoAt,
}) {
  if (!editedField || !FIELD_CONFIGS[editedField]) {
    throw createScheduledEditError(400, "Invalid editedField");
  }

  if (!editedBy) {
    throw createScheduledEditError(400, "Invalid editedBy");
  }

  normalizeFilterParams(filterParams);

  if (scheduledAt.getTime() <= Date.now()) {
    throw createScheduledEditError(400, "Scheduled time must be in the future");
  }

  if (scheduledUndoAt && scheduledUndoAt.getTime() <= scheduledAt.getTime()) {
    throw createScheduledEditError(
      400,
      "scheduledUndoAt must be later than scheduledAt",
    );
  }

  if (editedField === "deleteProducts" && scheduledUndoAt) {
    throw createScheduledEditError(
      400,
      "Undo is not allowed for product deletion",
    );
  }
}

async function removeQueuedJob(jobId) {
  if (!jobId) {
    return;
  }

  const job = await scheduledEditQueue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}

async function markScheduledHistoryFailed(historyId, message) {
  await prisma.editHistory.updateMany({
    where: { id: historyId },
    data: {
      status: "failed",
      executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
      error: appendExecutionError(
        null,
        buildExecutionError({
          code: "scheduled_edit_queue_failure",
          stage: "queue_registration",
          message,
          retryable: true,
        }),
      ),
    },
  });
}

function buildRules({
  editedField,
  editedBy,
  value,
  searchKey,
  replaceText,
  supportValue,
  locationId,
}) {
  return [
    {
      field: editedField,
      value,
      editOption: editedBy,
      searchKey: normalizeString(searchKey),
      replaceText: normalizeString(replaceText),
      supportValue: normalizeString(supportValue),
      locationId: locationId ?? null,
    },
  ];
}

function getScheduledLimit(planKey) {
  if (!planKey) {
    return null;
  }

  return PLAN_LIMITS[planKey] ?? 0;
}

export async function createScheduledBulkEdit({
  session,
  subscription = {},
  payload = {},
}) {
  const editedField = normalizeString(payload.editedField);
  const editedBy = normalizeString(payload.editedBy);
  const value = payload.value ?? null;
  const searchKey = payload.searchKey ?? null;
  const replaceText = payload.replaceText ?? null;
  const supportValue = payload.supportValue ?? null;
  const filterParams = normalizeFilterParams(payload.filterParams);
  const locationId = payload.locationId ?? payload.location ?? null;
  const scheduledAt = parseScheduledDate(payload.scheduledAt, "scheduledAt");
  const scheduledUndoAt = parseOptionalScheduledDate(
    payload.scheduledUndoAt,
    "scheduledUndoAt",
  );

  validateRuleInput({
    editedField,
    editedBy,
    filterParams,
    scheduledAt,
    scheduledUndoAt,
  });

  const target = await resolveCanonicalProductTarget({
    shop: session.shop,
    filterParams,
    queryParams: { page: 1, limit: 1 },
    sampleLimit: 0,
    includeSample: false,
  });
  const where = target.where;
  const count = target.count;

  const planKey = subscription?.planKey;
  if (!planKey) {
    throw createScheduledEditError(403, "Subscription not found");
  }

  const scheduledLimit = getScheduledLimit(planKey);
  if (scheduledLimit !== Infinity && count > scheduledLimit) {
    throw createScheduledEditError(
      403,
      `Your plan allows scheduling edits for only ${scheduledLimit} products at a time. You selected ${count}. Please refine your filters or upgrade to Pro.`,
      { code: "PRODUCT_LIMIT_EXCEEDED" },
    );
  }

  const rules = buildRules({
    editedField,
    editedBy,
    value,
    searchKey,
    replaceText,
    supportValue,
    locationId,
  });
  const serializedWhere = JSON.stringify(where);
  const updatedTitle = getUpdatedProducts({
    field: editedField,
    editType: editedBy,
    value,
    returnTitleOnly: true,
    supportValue,
    searchKey,
    replaceText,
  });
  const multiLanguageTitle = await createMultiLanguage(updatedTitle);
  const undoAllowed = editedField !== "deleteProducts";
  const delay = scheduledAt.getTime() - Date.now();
  const fingerprint = createIdempotencyFingerprint("scheduled_edit", {
    shop: session.shop,
    scheduledAt,
    scheduledUndoAt,
    queryFilter: serializedWhere,
    rules,
  });

  const { result } = await withAdvisoryLock(
    `scheduled-edit:${session.shop}:${fingerprint}`,
    async () => {
      const recentCandidates = await prisma.editHistory.findMany({
        where: {
          shop: session.shop,
          type: "Scheduled edit",
          status: "pending",
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      const existing = recentCandidates.find((candidate) => (
        candidate.queryFilter === serializedWhere &&
        String(candidate.scheduledAt || "") === scheduledAt.toISOString() &&
        String(candidate.scheduledUndoAt || "") ===
          String(scheduledUndoAt?.toISOString?.() || "") &&
        stableStringify(candidate.rules ?? []) === stableStringify(rules)
      ));

      if (existing) {
        return existing;
      }

      const history = await prisma.editHistory.create({
        data: {
          shop: session.shop,
          title: multiLanguageTitle,
          status: "pending",
          executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
          executionIdentity: crypto.randomUUID(),
          processedCount: 0,
          totalItems: count,
          scheduledAt,
          scheduledUndoAt,
          type: "Scheduled edit",
          queryFilter: serializedWhere,
          rules,
          startedAt: new Date(),
          undo: buildPlannedUndoState({
            allowed: undoAllowed,
          }),
        },
      });

      await persistEditHistoryTargetingMetadata({
        historyId: history.id,
        filterParams,
      });

      const scheduledJobId = `scheduled-edit:${session.shop}:${history.id}`;
      const undoJobId = `scheduled-undo:${session.shop}:${history.id}`;

      try {
        await scheduledEditQueue.add(
          "scheduled-task",
          { historyId: history.id, shop: session.shop },
          { delay, jobId: scheduledJobId },
        );

        if (
          scheduledUndoAt &&
          scheduledUndoAt.getTime() > Date.now() &&
          undoAllowed
        ) {
          const undoDelay = scheduledUndoAt.getTime() - Date.now();
          if (undoDelay > 0) {
            await scheduledEditQueue.add(
              "undo-task",
              { historyId: history.id, shop: session.shop },
              { delay: undoDelay, jobId: undoJobId },
            );
          }
        }
      } catch (error) {
        await removeQueuedJob(scheduledJobId).catch(() => {});
        await removeQueuedJob(undoJobId).catch(() => {});
        await markScheduledHistoryFailed(history.id, error.message);
        throw error;
      }

      return history;
    },
  );

  return result;
}
