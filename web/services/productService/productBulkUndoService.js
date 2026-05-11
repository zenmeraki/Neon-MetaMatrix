import crypto from "crypto";
import { uploadToShopifyStagedTarget } from "../../modules/bulkEdits/productBulkEditUtils.js";
import { addBulkUndoJob } from "../../jobs/queues/bulkUndoJob.js";
import {
  bulkOperationMutation,
  getProductSetMutation,
  PRODUCT_SET_MODE,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import shopify from "../../shopify.js";
import { clearKeyCachesBatch } from "../../utils/cacheUtils.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { prisma } from "../../config/database.js";
import { bulkUndoExecutionRepository } from "../../repositories/bulkUndoExecutionRepository.js";
import {
  BULK_UNDO_STATES,
  normalizeUndoState,
} from "../bulkEditExecutionStateService.js";
import { bulkEditHistoryRepository } from "../../repositories/bulkEditHistoryRepository.js";
import { stableCanonicalStringify } from "../../utils/stableCanonicalStringify.js";
import {
  assertShadowExternalCallsAllowed,
  assertShadowWriteAllowed,
} from "../shadowReadOnlyGuardService.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
]);

const OPTION_VALUE_FIELDS = new Set([
  "option1Values",
  "option2Values",
  "option3Values",
]);

const BLOCKED_UNDO_STATES = [
  BULK_UNDO_STATES.QUEUED,
  BULK_UNDO_STATES.DISPATCHING,
  BULK_UNDO_STATES.AWAITING_SHOPIFY,
  BULK_UNDO_STATES.FINALIZING,
  BULK_UNDO_STATES.COMPLETED,
];
const UNDO_CHANGE_HASH_SCHEMA_VERSION = "2026-05-07.undo.v1";

function getUndoCacheKeys(shop, historyId) {
  return [
    `${shop}:fetchHistories`,
    `${shop}:historyDetails:${historyId}`,
  ];
}

function normalizeBooleanUndoValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", ""].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hashUndoChangeRow(row) {
  const beforeValue =
    row.beforeValue !== undefined && row.beforeValue !== null
      ? row.beforeValue
      : row.oldValue ?? null;
  const afterValue =
    row.afterValue !== undefined && row.afterValue !== null
      ? row.afterValue
      : row.newValue ?? null;
  return crypto
    .createHash("sha256")
    .update(
      stableCanonicalStringify({
        schemaVersion: UNDO_CHANGE_HASH_SCHEMA_VERSION,
        productId: row.productId,
        variantId: row.variantId ?? null,
        entityType: row.entityType ?? null,
        entityId: row.entityId ?? null,
        field: row.field ?? null,
        beforeValue,
        afterValue,
        title: row.title,
        scope: row.scope,
        options: row.options ?? null,
        productFieldChanges: row.productFieldChanges ?? null,
        variantFieldChanges: row.variantFieldChanges ?? null,
      }),
    )
    .digest("hex");
}

function hashUndoChangeSet(changeHashes) {
  const canonicalHashes = [...changeHashes].sort();
  return crypto
    .createHash("sha256")
    .update(
      stableCanonicalStringify({
        schemaVersion: UNDO_CHANGE_HASH_SCHEMA_VERSION,
        hashes: canonicalHashes,
      }),
    )
    .digest("hex");
}

function buildDeterministicUndoExecutionIdentity({ shop, historyId, mirrorBatchId }) {
  const lineageHash = crypto
    .createHash("sha256")
    .update(
      stableCanonicalStringify({
        schemaVersion: "2026-05-07.undo.execution.v1",
        shop,
        historyId,
        mirrorBatchId: mirrorBatchId || null,
      }),
    )
    .digest("hex");

  return `undo_exec_${lineageHash.slice(0, 24)}`;
}

function hasBeforeValue(value) {
  return value !== undefined && value !== null;
}

function assertUndoBeforeValue(field, beforeValue, changeId = null) {
  if (!field || !hasBeforeValue(beforeValue)) {
    const error = codedError("UNDO_BEFORE_VALUE_REQUIRED");
    error.changeId = changeId || null;
    throw error;
  }
}

function buildUndoEntityKey(change) {
  return `${change.productId}:${change.variantId || "product"}:${change.field || "*"}`;
}

function normalizeMoneyUndoValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw codedError("INVALID_UNDO_NUMERIC_VALUE");
  }
  return num.toFixed(2);
}

const PRECOMPUTED_UNDO_UNSUPPORTED_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "option1Values",
  "option2Values",
  "option3Values",
]);

function canUsePrecomputedUndoPlan(planJson) {
  const mutations = Array.isArray(planJson?.mutations) ? planJson.mutations : [];
  if (!mutations.length) return false;
  return !mutations.some((mutation) =>
    PRECOMPUTED_UNDO_UNSUPPORTED_FIELDS.has(String(mutation?.field || "").trim()),
  );
}

function buildUndoProductsFromPrecomputedPlan({ planJson, cursorOrdinal = 0, limit = 75, shop }) {
  const mutations = Array.isArray(planJson?.mutations) ? planJson.mutations : [];
  const groups = [];
  const byKey = new Map();

  for (const mutation of mutations) {
    const productId = mutation?.productId || null;
    if (!productId) continue;

    const variantId = mutation?.variantId || null;
    const field = mutation?.field || null;
    const restoreValue =
      mutation?.restoreValueJson && typeof mutation.restoreValueJson === "object"
        ? mutation.restoreValueJson.field
        : mutation?.restoreValueJson ?? null;
    const expectedCurrentValue =
      mutation?.expectedCurrentValueJson && typeof mutation.expectedCurrentValueJson === "object"
        ? mutation.expectedCurrentValueJson.field
        : mutation?.expectedCurrentValueJson ?? null;

    const key = productId;
    let product = byKey.get(key);
    if (!product) {
      product = {
        shop,
        productId,
        productFieldChanges: [],
        variantFieldChanges: [],
        options: [],
        _variantById: new Map(),
      };
      byKey.set(key, product);
      groups.push(product);
    }

    const normalizedFieldChange = {
      field,
      oldValue: restoreValue,
      revertValue: restoreValue,
      newValue: expectedCurrentValue,
    };

    if (variantId) {
      const existingVariant = product._variantById.get(variantId) || {
        variantId,
        variantTitle: null,
        selectedOptions: [],
        changes: [],
      };
      existingVariant.changes.push(normalizedFieldChange);
      product._variantById.set(variantId, existingVariant);
    } else {
      product.productFieldChanges.push(normalizedFieldChange);
    }
  }

  for (const product of groups) {
    const variantEntries = Array.from(product._variantById.values());
    if (variantEntries.length) {
      product.variantFieldChanges.push(...variantEntries);
    }
    delete product._variantById;
  }

  const safeCursor = Math.max(Number(cursorOrdinal) || 0, 0);
  const safeLimit = Math.max(Number(limit) || 75, 1);
  const slice = groups.slice(safeCursor, safeCursor + safeLimit);
  const nextOrdinal = safeCursor + slice.length;

  return {
    products: slice,
    hasMore: nextOrdinal < groups.length,
    lastSnapshotOrdinal: nextOrdinal,
    count: slice.length,
  };
}

class UndoEditService {
  constructor(session) {
    this.client = new shopify.api.clients.Graphql({ session });
    this.session = session;
  }

  async undoEdit({
    id: historyId,
    shop,
    idempotencyKey = null,
    executionContext = null,
  }) {
    if (!historyId || !shop) {
      throw new Error("Undo requires id and shop");
    }

    if (shop !== this.session.shop) {
      throw new Error("Cross-shop undo blocked");
    }

    if (idempotencyKey != null) {
      const normalizedKey = String(idempotencyKey).trim();
      const expectedPrefix = `undo:${shop}:`;
      if (!normalizedKey.startsWith(expectedPrefix)) {
        throw new Error("Undo idempotency key shop scope mismatch");
      }
      const executionPart = normalizedKey.slice(expectedPrefix.length).trim();
      if (!executionPart || !/^[a-zA-Z0-9:_-]{8,200}$/.test(executionPart)) {
        throw new Error("Undo idempotency key execution identifier is invalid");
      }
    }

    assertShadowWriteAllowed(executionContext, "undo_edit.prisma_transaction");
    const { executionIdentity } = await prisma.$transaction(async (tx) => {
      const editedHistory = await tx.editHistory.findFirst({
        where: {
          id: historyId,
          shop: this.session.shop,
        },
        select: {
          id: true,
          status: true,
          undo: true,
          undoState: true,
          undoExecutionIdentity: true,
          targetMirrorBatchId: true,
          isRecurring: true,
          recurringRunId: true,
          recurringEditId: true,
        },
      });

      if (!editedHistory) {
        throw new Error("Edit history not found");
      }

      if (!editedHistory.undo) {
        throw new Error("Undo metadata missing - cannot safely undo");
      }
      if (!editedHistory.targetMirrorBatchId) {
        throw codedError("UNDO_MIRROR_BATCH_REQUIRED");
      }

      const undoData = normalizeUndoState(editedHistory.undo);

      let recurringExecutionMetadata = null;
      if (editedHistory.isRecurring) {
        if (!editedHistory.recurringRunId || !editedHistory.recurringEditId) {
          throw codedError("RECURRING_RUN_METADATA_REQUIRED");
        }

        const run = await tx.recurringRuleRun.findUnique({
          where: { id: editedHistory.recurringRunId },
          select: {
            id: true,
            shop: true,
            recurringEditId: true,
            editHistoryId: true,
            targetSnapshotId: true,
            mirrorBatchId: true,
            plannerFingerprint: true,
            executionId: true,
            frozenAt: true,
          },
        });

        if (
          !run ||
          run.shop !== this.session.shop ||
          run.recurringEditId !== editedHistory.recurringEditId ||
          run.editHistoryId !== editedHistory.id
        ) {
          throw codedError("RECURRING_RUN_OWNERSHIP_MISMATCH");
        }

        if (!run.targetSnapshotId || !run.executionId) {
          throw codedError("RECURRING_RUN_LINEAGE_INCOMPLETE");
        }

        recurringExecutionMetadata = {
          runId: run.id,
          recurringEditId: run.recurringEditId,
          targetSnapshotId: run.targetSnapshotId,
          mirrorBatchId: run.mirrorBatchId || null,
          plannerFingerprint: run.plannerFingerprint || null,
          executionId: run.executionId,
          frozenAt: run.frozenAt || null,
        };
      }

      if (undoData.allowed !== true) {
        throw new Error("Undo not allowed for this edit");
      }

      if (editedHistory.status !== "completed") {
        throw new Error("Undo only allowed on completed edits");
      }

      const currentState =
        editedHistory.undoState ?? undoData.state ?? BULK_UNDO_STATES.PLANNED;

      if (BLOCKED_UNDO_STATES.includes(currentState)) {
        throw new Error("Undo already in progress or completed");
      }

      const executionIdentity = buildDeterministicUndoExecutionIdentity({
        shop: this.session.shop,
        historyId,
        mirrorBatchId: editedHistory.targetMirrorBatchId,
      });

      const nextUndo = {
        ...undoData,
        state: BULK_UNDO_STATES.QUEUED,
        status: "pending",
        queuedAt: new Date(),
        startedAt: null,
        completedAt: null,
        processedCount: 0,
        durationMs: 0,
        bulkOperationId: null,
        executionIdentity,
        error: null,
        recurringExecution: recurringExecutionMetadata,
      };

      const updated = await bulkEditHistoryRepository.applyProjectionUpdate({
        where: {
          id: historyId,
          shop: this.session.shop,
          status: "completed",
          OR: [
            { undoState: null },
            {
              undoState: {
                in: [BULK_UNDO_STATES.PLANNED, BULK_UNDO_STATES.FAILED],
              },
            },
          ],
        },
        data: {
          undoState: BULK_UNDO_STATES.QUEUED,
          undoExecutionIdentity: executionIdentity,
          undoQueuedAt: new Date(),
          undo: nextUndo,
        },
      }, tx);

      if (updated.count !== 1) {
        throw new Error("Undo could not be queued");
      }

      await bulkUndoExecutionRepository.createExecution(
        {
          shop: this.session.shop,
          historyId,
          executionIdentity,
          source: "manual_undo",
          mirrorBatchId: editedHistory.targetMirrorBatchId,
        },
        tx,
      );

      const frozenCount = await bulkUndoExecutionRepository.freezeTargets(
        {
          shop: this.session.shop,
          historyId,
          executionIdentity,
        },
        tx,
      );

      if (frozenCount <= 0) {
        throw new Error("Undo cannot be queued because no reversible targets exist");
      }

      await bulkUndoExecutionRepository.markFrozen(
        {
          shop: this.session.shop,
          executionIdentity,
          frozenCount,
        },
        tx,
      );

      return {
        executionIdentity,
      };
    });

    try {
      const undoRequest = await prisma.undoRequest.findFirst({
        where: {
          shop: this.session.shop,
          executionId: executionIdentity,
        },
        select: { id: true },
      });

      const undoPlan = undoRequest
        ? await prisma.undoExecutionPlan.findFirst({
            where: {
              shop: this.session.shop,
              undoRequestId: undoRequest.id,
            },
            select: { id: true },
          })
        : null;

      if (!undoPlan?.id) {
        throw new Error("UNDO_EXECUTION_PLAN_NOT_FOUND");
      }

      assertShadowExternalCallsAllowed(executionContext, "undo_edit.enqueue_bulk_undo_job");
      await addBulkUndoJob(
        {
          shop: this.session.shop,
          undoRequestId: undoRequest.id,
          undoExecutionPlanId: undoPlan.id,
          executionContext,
        },
      );
    } catch (err) {
      await bulkUndoExecutionRepository.markFailed({
        shop: this.session.shop,
        executionIdentity,
        errorMessage: `Undo enqueue failed: ${err.message}`,
      });

      await clearKeyCachesBatch(getUndoCacheKeys(this.session.shop, historyId));

      throw err;
    }

    await clearKeyCachesBatch(getUndoCacheKeys(this.session.shop, historyId));

    return {
      data: { id: historyId },
      message: "Undo processing started",
    };
  }

  async prepareUndoBatch({ historyId, executionId, limit = 75, undoPlanJson = null }) {
    const execution = await bulkUndoExecutionRepository.findExecution({
      shop: this.session.shop,
      executionIdentity: executionId,
    });

    if (!execution) {
      throw codedError("UNDO_EXECUTION_NOT_FOUND");
    }

    if (execution.historyId !== historyId) {
      throw codedError("UNDO_EXECUTION_HISTORY_MISMATCH");
    }

    if (execution.executionIdentity !== executionId) {
      throw codedError("UNDO_EXECUTION_IDENTITY_MISMATCH");
    }
    if (!execution.mirrorBatchId) {
      throw codedError("UNDO_MIRROR_BATCH_REQUIRED");
    }

    const locked = await bulkUndoExecutionRepository.markDispatching({
      shop: this.session.shop,
      executionIdentity: executionId,
    });

    if (locked.count !== 1) {
      throw new Error("Undo execution is not dispatchable");
    }

    const historyMeta = await prisma.editHistory.findFirst({
      where: {
        id: historyId,
        shop: this.session.shop,
      },
      select: {
        targetMirrorBatchId: true,
      },
    });

    if (!historyMeta?.targetMirrorBatchId) {
      throw codedError("UNDO_MIRROR_BATCH_REQUIRED");
    }
    if (historyMeta.targetMirrorBatchId !== execution.mirrorBatchId) {
      throw codedError("UNDO_MIRROR_BATCH_MISMATCH");
    }

    if (canUsePrecomputedUndoPlan(undoPlanJson)) {
      return buildUndoProductsFromPrecomputedPlan({
        planJson: undoPlanJson,
        cursorOrdinal: execution.lastSnapshotOrdinal,
        limit,
        shop: this.session.shop,
      });
    }

    const snapshotRows = await bulkUndoExecutionRepository.getNextSnapshotBatch({
      shop: this.session.shop,
      executionIdentity: executionId,
      cursorOrdinal: execution.lastSnapshotOrdinal,
      limit,
    });

    if (!snapshotRows.length) {
      return {
        products: [],
        hasMore: false,
        lastSnapshotOrdinal: execution.lastSnapshotOrdinal || 0,
        count: 0,
      };
    }

    const productIds = [];
    const seenProductIds = new Set();
    const requiredChangeRecordIds = [];
    const frozenMutations = [];
    for (const snapshotRow of snapshotRows) {
      const rowFrozenMutations = Array.isArray(snapshotRow.frozenMutations)
        ? snapshotRow.frozenMutations
        : [];
      if (rowFrozenMutations.length > 0) {
        frozenMutations.push(...rowFrozenMutations);
        continue;
      }
      const ids = Array.isArray(snapshotRow.changeRecordIds)
        ? snapshotRow.changeRecordIds.filter((id) => typeof id === "string" && id)
        : [];
      if (!ids.length) {
        throw codedError("UNDO_SNAPSHOT_MUTATIONS_REQUIRED");
      }
      requiredChangeRecordIds.push(...ids);
    }
    const uniqueRequiredChangeRecordIds = [...new Set(requiredChangeRecordIds)];
    let changes = [];
    if (frozenMutations.length > 0) {
      changes = frozenMutations
        .filter((row) => row && typeof row === "object")
        .map((row) => ({
          id: row.id || null,
          shop: this.session.shop,
          productId: row.productId || null,
          variantId: row.variantId ?? null,
          entityType: row.entityType ?? null,
          entityId: row.entityId ?? null,
          field: row.field ?? null,
          beforeValue: row.beforeValue ?? null,
          afterValue: row.afterValue ?? null,
          oldValue: row.beforeValue ?? null,
          newValue: row.afterValue ?? null,
          title: row.title ?? null,
          scope: row.scope ?? null,
          options: row.options ?? null,
          productFieldChanges: row.productFieldChanges ?? null,
          variantFieldChanges: row.variantFieldChanges ?? null,
        }))
        .filter((row) => row.productId);
    } else {
      changes = await prisma.changeRecord.findMany({
        where: {
          shop: this.session.shop,
          editHistoryId: historyId,
          id: { in: uniqueRequiredChangeRecordIds },
        },
        orderBy: [
          { productId: "asc" },
          { variantId: "asc" },
          { field: "asc" },
          { id: "asc" },
        ],
      });
    }

    const grouped = new Map();
    const hashRowsByEntityKey = new Map();
    if (!frozenMutations.length) {
      const seenChangeIds = new Set(changes.map((change) => change.id));
      for (const expectedId of uniqueRequiredChangeRecordIds) {
        if (!seenChangeIds.has(expectedId)) {
          throw codedError("UNDO_CHANGE_RECORD_MISSING");
        }
      }
    }

    for (const change of changes) {
      const entityKey = buildUndoEntityKey(change);
      const product = grouped.get(change.productId) || {
        shop: change.shop,
        productId: change.productId,
        productFieldChanges: [],
        variantFieldChanges: [],
        options: Array.isArray(change.options) ? change.options : [],
        _variantById: new Map(),
      };

      const hasNormalizedField = typeof change.field === "string" && change.field.trim();
      const beforeValue =
        change.beforeValue !== undefined && change.beforeValue !== null
          ? change.beforeValue
          : change.oldValue ?? null;
      const afterValue =
        change.afterValue !== undefined && change.afterValue !== null
          ? change.afterValue
          : change.newValue ?? null;

      if (hasNormalizedField) {
        assertUndoBeforeValue(change.field, beforeValue, change.id);
        const normalizedFieldChange = {
          field: change.field,
          oldValue: beforeValue,
          revertValue: beforeValue,
          newValue: afterValue,
        };

        if (
          change.entityType === "VARIANT" ||
          (typeof change.variantId === "string" && change.variantId)
        ) {
          const variantId = change.variantId || change.entityId || null;
          if (variantId) {
            const existingVariant = product._variantById.get(variantId) || {
              variantId,
              variantTitle: null,
              selectedOptions: [],
              changes: [],
            };
            existingVariant.changes.push(normalizedFieldChange);
            product._variantById.set(variantId, existingVariant);
          }
        } else {
          product.productFieldChanges.push(normalizedFieldChange);
        }
      }

      if (!hasNormalizedField) {
        const productFieldChanges = Array.isArray(change.productFieldChanges)
          ? change.productFieldChanges
          : [];
        const variantFieldChanges = Array.isArray(change.variantFieldChanges)
          ? change.variantFieldChanges
          : [];

        for (const productFieldChange of productFieldChanges) {
          const field = productFieldChange?.field;
          const before =
            productFieldChange?.oldValue !== undefined &&
            productFieldChange?.oldValue !== null
              ? productFieldChange.oldValue
              : productFieldChange?.revertValue ?? null;
          assertUndoBeforeValue(field, before, change.id);
        }

        for (const variantFieldChange of variantFieldChanges) {
          const variantChanges = Array.isArray(variantFieldChange?.changes)
            ? variantFieldChange.changes
            : [];
          for (const variantChange of variantChanges) {
            const field = variantChange?.field;
            const before =
              variantChange?.oldValue !== undefined &&
              variantChange?.oldValue !== null
                ? variantChange.oldValue
                : variantChange?.revertValue ?? null;
            assertUndoBeforeValue(field, before, change.id);
          }
        }

        product.productFieldChanges.push(...productFieldChanges);
        product.variantFieldChanges.push(...variantFieldChanges);
      }

      if (!product.options.length && Array.isArray(change.options)) {
        product.options = change.options;
      }

      grouped.set(change.productId, product);

      const existingHashes = hashRowsByEntityKey.get(entityKey) || [];
      existingHashes.push(hashUndoChangeRow(change));
      hashRowsByEntityKey.set(entityKey, existingHashes);
    }

    for (const product of grouped.values()) {
      const variantEntries = Array.from(product._variantById.values());
      if (variantEntries.length) {
        product.variantFieldChanges.push(...variantEntries);
      }
      delete product._variantById;
    }

    for (const snapshotRow of snapshotRows) {
      const expectedHash = snapshotRow.changeHash || null;
      const actualHash = hashUndoChangeSet(
        hashRowsByEntityKey.get(snapshotRow.entityKey) || [],
      );
      if (!expectedHash || !actualHash || expectedHash !== actualHash) {
        throw codedError("UNDO_CHANGE_HASH_MISMATCH");
      }
      if (!seenProductIds.has(snapshotRow.productId)) {
        seenProductIds.add(snapshotRow.productId);
        productIds.push(snapshotRow.productId);
      }
    }

    return {
      products: productIds.map((productId) => grouped.get(productId)).filter(Boolean),
      hasMore: snapshotRows.length === limit,
      lastSnapshotOrdinal: snapshotRows.at(-1)?.ordinal ?? execution.lastSnapshotOrdinal ?? 0,
      count: snapshotRows.length,
    };
  }

  async undoEditBulkOperation(products, field = "", executionContext = null) {
    assertShadowExternalCallsAllowed(executionContext, "undo_edit_bulk_operation.shopify");
    const operationName = `bulkEditUndoProducts_${Date.now()}`;
    const formattedProducts = [];

    let lastProductId = null;
    let count = 0;

    const mode = this.getMutationMode(field);
    const seen = new Set();

    for (const product of products) {
      if (!product?.shop || product.shop !== this.session.shop) {
        throw new Error("Cross-tenant product detected in undo payload");
      }

      if (!product?.productId) {
        throw new Error("Missing productId in undo payload");
      }
      if (seen.has(product.productId)) {
        continue;
      }
      seen.add(product.productId);

      const payload = { id: product.productId };

      const productFieldChanges = product.productFieldChanges || [];
      const variantFieldChanges = product.variantFieldChanges || [];
      const productOptions = product.options || [];

      const revertedOptionNames = new Map();

      for (const fieldChange of productFieldChanges) {
        if (OPTION_NAME_FIELDS.has(fieldChange.field)) {
          const index = Number(
            fieldChange.field.match(/^option([123])Name$/)?.[1],
          );
          if (index) {
            revertedOptionNames.set(
              index - 1,
              fieldChange.revertValue ?? fieldChange.oldValue,
            );
          }
          continue;
        }

        Object.assign(
          payload,
          this.getProductFieldPayload(
            fieldChange.field,
            fieldChange.revertValue,
            fieldChange.oldValue,
          ),
        );
      }

      if (revertedOptionNames.size > 0 || variantFieldChanges.length > 0) {
        if (!Array.isArray(productOptions) || productOptions.length === 0) {
          throw codedError("UNDO_OPTION_SNAPSHOT_REQUIRED");
        }
        payload.productOptions = productOptions.map((option, index) => ({
          name: revertedOptionNames.get(index) ?? option.name,
          values: option.values?.map((v) => ({ name: v })) || [],
        }));
      }

      if (variantFieldChanges.length > 0) {
        payload.variants = variantFieldChanges.map((variant) => {
          if (!variant?.variantId) {
            throw codedError("UNDO_VARIANT_ID_REQUIRED");
          }

          return {
            id: variant.variantId,
            ...this.getVariantOptionValues(variant, productOptions),
            ...this.getVariantFieldPayloadFromChanges(variant),
          };
        });
      }

      if (Object.keys(payload).length === 1) {
        throw codedError("UNDO_EMPTY_PRODUCT_PAYLOAD");
      }

      formattedProducts.push(JSON.stringify({ productSet: payload }));
      lastProductId = product.productId;
      count++;
    }

    if (!formattedProducts.length && products.length > 0) {
      throw codedError("EMPTY_UNDO_MUTATION_JSONL");
    }

    if (!formattedProducts.length) {
      throw codedError("EMPTY_BULK_UNDO_MUTATION_JSONL_PAYLOAD");
    }

    const stagedRes = await this.client.query({
      data: {
        query: stagesUploadMutation,
        variables: {
          input: [
            {
              filename: operationName,
              mimeType: "text/jsonl",
              resource: "BULK_MUTATION_VARIABLES",
              httpMethod: "POST",
            },
          ],
        },
      },
    });

    const stagedErrors =
      stagedRes?.body?.data?.stagedUploadsCreate?.userErrors || [];
    if (stagedErrors.length) {
      throw new Error(
        `Shopify staged upload returned errors: ${JSON.stringify(stagedErrors)}`,
      );
    }

    const target =
      stagedRes?.body?.data?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!target) {
      throw new Error("Failed to get staged upload target");
    }

    const keyUrl = await uploadToShopifyStagedTarget(
      target,
      { lines: formattedProducts },
    );

    const bulkRes = await this.client.query({
      data: {
        query: bulkOperationMutation,
        variables: {
          mutation: getProductSetMutation(mode),
          stagedUploadPath: keyUrl,
        },
      },
    });

    const bulkErrors =
      bulkRes?.body?.data?.bulkOperationRunMutation?.userErrors || [];
    if (bulkErrors.length) {
      throw new Error(
        `Shopify bulk undo returned errors: ${JSON.stringify(bulkErrors)}`,
      );
    }

    return {
      bulkOperationId:
        bulkRes.body?.data?.bulkOperationRunMutation?.bulkOperation?.id ??
        null,
      lastProductId,
      count,
    };
  }

  getProductFieldPayload(field, revertValue, oldValue) {
    const value = revertValue ?? oldValue;

    const fieldMap = {
      title: { title: value ?? "" },
      vendor: { vendor: value ?? "" },
      productType: { productType: value ?? "" },
      description: { descriptionHtml: value ?? "" },
      descriptionHtml: { descriptionHtml: value ?? "" },
      metaTitle: { seo: { title: value ?? "" } },
      metaDescription: { seo: { description: value ?? "" } },
      handle: { handle: value ?? "" },
      status: { status: value },
      tags: { tags: Array.isArray(value) ? value : [] },
    };

    if (!Object.hasOwn(fieldMap, field)) {
      const error = new Error(`UNSUPPORTED_UNDO_PRODUCT_FIELD:${field}`);
      error.code = "UNSUPPORTED_UNDO_PRODUCT_FIELD";
      throw error;
    }

    return fieldMap[field];
  }

  getVariantFieldPayloadFromChanges(variant) {
    const payload = {};

    for (const change of variant.changes || []) {
      Object.assign(
        payload,
        this.getVariantFieldPayload(
          change.field,
          change.revertValue,
          change.oldValue,
        ),
      );
    }

    return payload;
  }

  getVariantOptionValues(variant, productOptions = []) {
    if (Array.isArray(variant?.selectedOptions) && variant.selectedOptions.length > 0) {
      return {
        optionValues: variant.selectedOptions.map((option) => ({
          optionName: option.name,
          name: option.value,
        })),
      };
    }

    const optionValues = productOptions
      .map((option, index) => {
        const value = variant?.[`option${index + 1}Value`] ?? variant?.[`option${index + 1}`];
        if (!option?.name || !value) return null;

        return {
          optionName: option.name,
          name: value,
        };
      })
      .filter(Boolean);

    return optionValues.length ? { optionValues } : {};
  }

  getVariantFieldPayload(field, revertValue, oldValue) {
    const value = revertValue ?? oldValue;

    const fieldMap = {
      price: { price: normalizeMoneyUndoValue(value) },
      compareAtPrice: { compareAtPrice: normalizeMoneyUndoValue(value) },
      sku: { sku: value ?? "" },
      barcode: { barcode: value ?? "" },
      taxable: { taxable: normalizeBooleanUndoValue(value) },
      inventoryPolicy: { inventoryPolicy: value },
      requiresShipping: { requiresShipping: normalizeBooleanUndoValue(value) },
      weight: { weight: value },
      weightUnit: { weightUnit: value },
      cost: { inventoryItem: { cost: value } },
    };

    if (!Object.hasOwn(fieldMap, field)) {
      const error = new Error(`UNSUPPORTED_UNDO_VARIANT_FIELD:${field}`);
      error.code = "UNSUPPORTED_UNDO_VARIANT_FIELD";
      throw error;
    }

    return fieldMap[field];
  }

  getMutationMode(field = "") {
    if (!field || field === "mixed") return PRODUCT_SET_MODE.BOTH;
    if (OPTION_NAME_FIELDS.has(field)) return PRODUCT_SET_MODE.BOTH;
    if (OPTION_VALUE_FIELDS.has(field)) return PRODUCT_SET_MODE.BOTH;
    if (FIELD_CONFIGS[field]?.isVariantLevel)
      return PRODUCT_SET_MODE.VARIANT_ONLY;

    return PRODUCT_SET_MODE.PRODUCT_ONLY;
  }
}

export default UndoEditService;
