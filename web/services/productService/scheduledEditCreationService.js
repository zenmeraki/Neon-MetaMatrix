import crypto from "crypto";
import { prisma } from "../../Config/database.js";
import { scheduledEditQueue } from "../../Jobs/Queues/scheduledEditQueue.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { createMultiLanguage } from "../../utils/googleTranslator.js";
import { logBatchEvent } from "../../utils/batchObservability.js";
import {
  buildRulesHash,
  sha256Hex,
} from "../../utils/deterministicHashUtils.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  buildPlannedUndoState,
} from "../bulkEditExecutionStateService.js";
import { getActiveCatalogSnapshot } from "../sync/catalogSnapshotService.js";
import { freezeTargetSnapshot, resolveCanonicalProductTarget } from "./productTargetingService.js";
import * as editHistoryRepository from "../../repositories/editHistoryRepository.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "mixed",
]);

const VARIANT_LEVEL_FIELDS = new Set([
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
  "requiresShipping",
  "weight",
  "weightUnit",
]);

function buildHttpError(message, httpStatus = 400, code = "SCHEDULED_EDIT_VALIDATION_ERROR") {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.code = code;
  return error;
}

function isVariantLevelField(field) {
  if (FIELD_CONFIGS?.[field]?.isVariantLevel) return true;
  return VARIANT_LEVEL_FIELDS.has(field);
}

function determineTargetLevel(fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  return normalizedFields.some((field) => isVariantLevelField(field) || VARIANT_LEVEL_FIELDS.has(field))
    ? "VARIANT"
    : "PRODUCT";
}

function parseRequiredDate(value, fieldName) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw buildHttpError(`Invalid ${fieldName}`, 400, `INVALID_${fieldName.toUpperCase()}`);
  }
  return parsed;
}

function buildRule({
  editedField,
  editedBy,
  value,
  searchKey,
  replaceText,
  supportValue,
  locationId,
}) {
  return {
    field: editedField,
    value,
    editOption: editedBy,
    searchKey,
    replaceText,
    supportValue,
    locationId: locationId ?? null,
  };
}

function buildScheduledEditIdempotencyKey({
  shop,
  filterParams,
  editedField,
  editedBy,
  value,
  scheduledAt,
  searchKey,
  replaceText,
  supportValue,
  locationId,
}) {
  return sha256Hex({
    shop,
    filterParams,
    editedField,
    editedBy,
    value,
    scheduledAt: scheduledAt.toISOString(),
    searchKey: searchKey ?? null,
    replaceText: replaceText ?? null,
    supportValue: supportValue ?? null,
    locationId: locationId ?? null,
  });
}

export class ScheduledEditCreationService {
  constructor(session) {
    this.session = session;
  }

  async createScheduledEdit({ body = {}, subscription = {} }) {
    const shop = this.session?.shop;
    if (!shop) {
      throw buildHttpError("Session expired", 401, "AUTH_REQUIRED");
    }

    const {
      editedField,
      editedBy,
      filterParams,
      value,
      scheduledAt: rawScheduledAt,
      scheduledUndoAt: rawScheduledUndoAt,
      searchKey,
      replaceText,
      supportValue,
      locationId,
    } = body;

    if (!filterParams || !editedField) {
      throw buildHttpError("Missing required fields", 400, "SCHEDULED_EDIT_REQUIRED_FIELDS");
    }

    const scheduledAt = parseRequiredDate(rawScheduledAt, "scheduledAt");
    const delay = scheduledAt.getTime() - Date.now();
    if (delay <= 0) {
      throw buildHttpError(
        "Scheduled time must be in the future",
        400,
        "SCHEDULED_EDIT_PAST_TIME",
      );
    }

    const scheduledUndoAt = rawScheduledUndoAt
      ? parseRequiredDate(rawScheduledUndoAt, "scheduledUndoAt")
      : null;

    if (scheduledUndoAt && scheduledUndoAt.getTime() <= scheduledAt.getTime()) {
      throw buildHttpError(
        "Undo time must be later than the scheduled edit time",
        400,
        "SCHEDULED_UNDO_BEFORE_EDIT",
      );
    }

    if (editedField === "deleteProducts" && scheduledUndoAt) {
      throw buildHttpError(
        "Undo is not allowed for product deletion",
        400,
        "SCHEDULED_DELETE_UNDO_NOT_ALLOWED",
      );
    }

    const activeSnapshot = await getActiveCatalogSnapshot({ shop });
    if (!activeSnapshot?.catalogBatchId || activeSnapshot.isConsistent !== true) {
      const error = buildHttpError(
        "Active catalog snapshot is not consistent",
        409,
        "ACTIVE_CATALOG_SNAPSHOT_INCONSISTENT",
      );
      error.details = {
        snapshotId: activeSnapshot?.snapshotId || null,
        catalogBatchId: activeSnapshot?.catalogBatchId || null,
        reason: activeSnapshot?.reason || "active_catalog_snapshot_missing",
      };
      throw error;
    }

    const resolvedTarget = await resolveCanonicalProductTarget({
      shop,
      filterParams,
      queryParams: {
        page: 1,
        limit: 20,
      },
      sampleLimit: 20,
      path: "scheduler",
      snapshot: activeSnapshot,
    });

    const count = resolvedTarget.count;
    if (!subscription?.planKey) {
      throw buildHttpError("Subscription not found", 403, "SUBSCRIPTION_NOT_FOUND");
    }

    const scheduledLimit = subscription.isUnlimited
      ? Infinity
      : Number(subscription.limit ?? 0);
    if (scheduledLimit !== Infinity && count > scheduledLimit) {
      throw buildHttpError(
        `Your plan allows scheduling edits for only ${scheduledLimit} products at a time. You selected ${count}. Please refine your filters or upgrade to Pro.`,
        403,
        "PRODUCT_LIMIT_EXCEEDED",
      );
    }

    const updatedTitle = getUpdatedProducts({
      field: editedField,
      editType: editedBy,
      value,
      returnTitleOnly: true,
      supportValue,
      searchKey,
      replaceText,
    });
    const title = await createMultiLanguage(updatedTitle);
    const rule = buildRule({
      editedField,
      editedBy,
      value,
      searchKey,
      replaceText,
      supportValue,
      locationId,
    });
    const rules = [rule];
    const rulesHash = buildRulesHash(rules);
    const executionIdentity = crypto.randomUUID();
    const idempotencyKey = buildScheduledEditIdempotencyKey({
      shop,
      filterParams,
      editedField,
      editedBy,
      value,
      scheduledAt,
      searchKey,
      replaceText,
      supportValue,
      locationId,
    });
    const undoAllowed = editedField !== "deleteProducts";

    const { history, frozenSnapshot, reused } = await prisma.$transaction(async (tx) => {
      const existing = await editHistoryRepository.findActiveScheduledEditByIdempotencyKey({
        shop,
        idempotencyKey,
        client: tx,
      });

      if (existing?.targetSnapshotSetId) {
        return {
          history: existing,
          frozenSnapshot: {
            targetSnapshotSetId: existing.targetSnapshotSetId,
            count: existing.targetSnapshotCount,
          },
          reused: true,
        };
      }

      if (existing) {
        throw buildHttpError(
          "Scheduled edit already exists but is missing its target snapshot",
          409,
          "SCHEDULED_EDIT_INCOMPLETE_REPLAY",
        );
      }

      const history = await editHistoryRepository.createScheduledEditHistory({
        data: {
          shop,
          title,
          status: "pending",
          executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
          executionIdentity,
          idempotencyKey,
          processedCount: 0,
          totalItems: count,
          targetSnapshotCount: 0,
          targetCatalogBatchId: resolvedTarget.catalogBatchId,
          targetMirrorBatchId: resolvedTarget.mirrorBatchId,
          scheduledAt,
          scheduledUndoAt,
          type: "Scheduled edit",
          queryFilter: JSON.stringify(resolvedTarget.where),
          rules,
          filterVersion: resolvedTarget.filterVersion,
          canonicalFilterKey: resolvedTarget.canonicalFilterKey,
          rulesHash,
          ruleEngineVersion: "product-set-v1",
          durationMs: 0,
          batch: {
            frozen: true,
            batchField: resolvedTarget.batchField,
            catalogSnapshotCutoverFlag: resolvedTarget.cutoverFlag,
            catalogSnapshotCutoverEnabled: resolvedTarget.cutoverEnabled,
            hasMore: count > 0,
            lastProductId: null,
            targetCursorKey: null,
            size: 75,
            previewCount: count,
            currentBatchTargetCount: 0,
            queuedAt: new Date().toISOString(),
          },
          undo: buildPlannedUndoState({
            allowed: undoAllowed,
          }),
        },
        client: tx,
      });

      const frozenSnapshot = await freezeTargetSnapshot({
        ownerType: "EDIT_HISTORY",
        ownerId: history.id,
        shop,
        where: resolvedTarget.where,
        catalogBatchId: resolvedTarget.catalogBatchId,
        mirrorBatchId: resolvedTarget.mirrorBatchId,
        batchField: resolvedTarget.batchField,
        targetLevel: determineTargetLevel([editedField]),
        filterVersion: resolvedTarget.filterVersion || 1,
        canonicalFilterKey: resolvedTarget.canonicalFilterKey,
        compiledWhereHash: resolvedTarget.compiledWhereHash || sha256Hex(resolvedTarget.where),
        rulesHash,
        ruleEngineVersion: "product-set-v1",
        path: "scheduler",
        client: tx,
      });

      const updatedHistory = await editHistoryRepository.attachScheduledEditTargetSnapshot({
        id: history.id,
        shop,
        targetSnapshotCount: frozenSnapshot.count,
        targetSnapshotSetId: frozenSnapshot.targetSnapshotSetId,
        batch: {
          ...(history.batch || {}),
          hasMore: frozenSnapshot.count > 0,
          previewCount: count,
        },
        client: tx,
      });

      return {
        history: updatedHistory,
        frozenSnapshot,
        reused: false,
      };
    });

    logBatchEvent("catalog_batch_edit_execution", {
      shop,
      oldMirrorBatchId:
        resolvedTarget.mirrorBatchId &&
        resolvedTarget.mirrorBatchId !== resolvedTarget.catalogBatchId
          ? resolvedTarget.mirrorBatchId
          : null,
      resolvedCatalogBatchId: resolvedTarget.catalogBatchId,
      path: "scheduler",
      extra: {
        historyId: history.id,
        targetSnapshotSetId: frozenSnapshot.targetSnapshotSetId,
        targetCount: frozenSnapshot.count,
        reused,
      },
    });

    try {
      await scheduledEditQueue.add(
        "scheduled-task",
        { historyId: history.id, shop },
        { delay, jobId: `scheduled-edit:${shop}:${history.id}` },
      );
    } catch (error) {
      await editHistoryRepository.markScheduledEditQueueDispatchFailed({
        id: history.id,
        shop,
        error: error.message,
      }).catch(() => {});
      throw error;
    }

    return {
      success: true,
      history,
      reused,
      scheduledUndoDeferredUntilEditCompletes: Boolean(scheduledUndoAt && undoAllowed),
    };
  }
}

export const bulkEditService = {
  createScheduledEdit({ session, ...input }) {
    return new ScheduledEditCreationService(session).createScheduledEdit(input);
  },
};
