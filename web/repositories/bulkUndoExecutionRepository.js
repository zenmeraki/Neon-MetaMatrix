import crypto from "crypto";
import { prisma } from "../config/database.js";
import { transitionMerchantOperation } from "../services/merchantOperationStateService.js";
import { projectOperationToBulkUndoExecution } from "../services/operationProjectionService.js";
import { stableCanonicalStringify } from "../utils/stableCanonicalStringify.js";
import logger from "../utils/loggerUtils.js";

const UNDO_EXECUTION_STATES = {
  FREEZING: "FREEZING",
  FROZEN: "FROZEN",
  DISPATCHING: "DISPATCHING",
  AWAITING_SHOPIFY: "AWAITING_SHOPIFY",
  APPLYING_RESULTS: "APPLYING_RESULTS",
  VERIFYING: "VERIFYING",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
};
const FREEZE_CHANGE_PAGE_SIZE = 2000;
const SNAPSHOT_INSERT_BATCH_SIZE = 1000;
const UNDO_CHANGE_HASH_SCHEMA_VERSION = "2026-05-07.undo.v1";

function getClient(db) {
  return db || prisma;
}

function hashChangeRow(row) {
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
        beforeValue: row.beforeValue ?? row.oldValue ?? null,
        afterValue: row.afterValue ?? row.newValue ?? null,
        title: row.title,
        scope: row.scope,
        options: row.options ?? null,
        productFieldChanges: row.productFieldChanges ?? null,
        variantFieldChanges: row.variantFieldChanges ?? null,
      }),
    )
    .digest("hex");
}

function hashProductChangeSet(changeHashes) {
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

function assertRequired(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hasBeforeValueOnChangeRow(row) {
  return (
    row?.beforeValueJson !== undefined && row?.beforeValueJson !== null
  ) || (
    row?.beforeValue !== undefined && row?.beforeValue !== null
  ) || (
    row?.oldValue !== undefined && row?.oldValue !== null
  );
}

function buildUndoEntityKey(change) {
  return `${change.productId}:${change.variantId || "product"}:${change.field || "*"}`;
}

function toFrozenMutationRow(change) {
  return {
    id: change.id,
    productId: change.productId,
    variantId: change.variantId ?? null,
    entityType: change.entityType ?? null,
    entityId: change.entityId ?? null,
    field: change.field ?? null,
    beforeValue: change.beforeValue ?? change.oldValue ?? null,
    afterValue: change.afterValue ?? change.newValue ?? null,
    title: change.title ?? null,
    scope: change.scope ?? null,
    options: change.options ?? null,
    productFieldChanges: change.productFieldChanges ?? null,
    variantFieldChanges: change.variantFieldChanges ?? null,
  };
}

export const bulkUndoExecutionRepository = {
  async createExecution(
    { shop, historyId, executionIdentity, source, mirrorBatchId },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(historyId, "historyId");
    assertRequired(executionIdentity, "executionIdentity");
    assertRequired(mirrorBatchId, "mirrorBatchId");

    const history = await getClient(db).editHistory.findFirst({
      where: { id: historyId, shop },
      select: { operationId: true },
    });

    const undoOperationId = `op_undo_${executionIdentity}`;
    if (history?.operationId) {
      await getClient(db).merchantOperation.upsert({
        where: {
          shop_idempotencyKey: {
            shop,
            idempotencyKey: `undo:${historyId}:${executionIdentity}`,
          },
        },
        update: {
          status: "SNAPSHOTTING",
          parentId: history.operationId,
        },
        create: {
          id: undoOperationId,
          shop,
          type: "BULK_UNDO",
          status: "SNAPSHOTTING",
          source: source || "undo",
          parentId: history.operationId,
          idempotencyKey: `undo:${historyId}:${executionIdentity}`,
          startedAt: new Date(),
        },
      });

      await getClient(db).operationExecution.create({
        data: {
          merchantOperationId: undoOperationId,
          shop,
          executionKey: executionIdentity,
          status: "SNAPSHOTTING",
          attempt: 1,
        },
      }).catch((error) => {
        logger.error("Failed to create undo operation execution", {
          shop,
          historyId,
          executionIdentity,
          undoOperationId,
          message: error?.message || "unknown_error",
        });
        throw error;
      });
    }

    return getClient(db).bulkUndoExecution.create({
      data: {
        shop,
        historyId,
        operationId: history?.operationId ? undoOperationId : null,
        executionIdentity,
        mirrorBatchId,
        source,
        state: UNDO_EXECUTION_STATES.FREEZING,
      },
    });
  },

  async freezeTargets({ shop, historyId, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(historyId, "historyId");
    assertRequired(executionIdentity, "executionIdentity");

    const client = getClient(db);
    const run = async (tx) => {
      const history = await tx.editHistory.findFirst({
        where: { id: historyId, shop },
        select: { operationId: true },
      });

      const snapshotSets = history?.operationId
        ? await tx.immutableTargetSnapshotSet.findMany({
            where: { shop, operationId: history.operationId },
            select: { id: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          })
        : [];

      const immutableTargetScope = new Set();
      for (const snapshotSet of snapshotSets) {
        let lastOrdinal = 0;
        while (true) {
          const frozenRows = await tx.immutableTargetSnapshotItem.findMany({
            where: {
              shop,
              snapshotSetId: snapshotSet.id,
              ordinal: { gt: lastOrdinal },
            },
            select: {
              productId: true,
              variantId: true,
              ordinal: true,
            },
            orderBy: [{ ordinal: "asc" }],
            take: FREEZE_CHANGE_PAGE_SIZE,
          });
          if (!frozenRows.length) break;

          for (const row of frozenRows) {
            immutableTargetScope.add(`${row.productId}:${row.variantId || "product"}`);
          }

          lastOrdinal = frozenRows[frozenRows.length - 1].ordinal;
          if (frozenRows.length < FREEZE_CHANGE_PAGE_SIZE) break;
        }
      }

      const snapshotByEntityKey = new Map();
      let lastId = null;

      while (true) {
        const changes = await tx.changeRecord.findMany({
          where: {
            shop,
            editHistoryId: historyId,
            ...(lastId ? { id: { gt: lastId } } : {}),
          },
          orderBy: [{ id: "asc" }],
          take: FREEZE_CHANGE_PAGE_SIZE,
        });

        if (!changes.length) {
          break;
        }

        const invalidBeforeValueRow = changes.find(
          (change) =>
            typeof change?.field === "string" &&
            change.field.trim() &&
            !hasBeforeValueOnChangeRow(change),
        );
        if (invalidBeforeValueRow) {
          throw codedError(
            "UNDO_BEFORE_VALUE_REQUIRED",
            `Missing before-value for changeRecord ${invalidBeforeValueRow.id}`,
          );
        }

        for (const change of changes) {
          if (
            immutableTargetScope.size &&
            !immutableTargetScope.has(`${change.productId}:${change.variantId || "product"}`)
          ) {
            continue;
          }

          const entityKey = buildUndoEntityKey(change);
          const existing = snapshotByEntityKey.get(entityKey) || {
            productId: change.productId,
            variantId: change.variantId ?? null,
            field: change.field ?? null,
            changeHashes: [],
            changeRecordIds: [],
            frozenMutations: [],
          };
          const frozenMutation = toFrozenMutationRow(change);
          existing.changeHashes.push(hashChangeRow(frozenMutation));
          existing.changeRecordIds.push(change.id);
          existing.frozenMutations.push(frozenMutation);
          snapshotByEntityKey.set(entityKey, existing);
        }

        lastId = changes[changes.length - 1].id;

        if (changes.length < FREEZE_CHANGE_PAGE_SIZE) {
          break;
        }
      }

      if (!snapshotByEntityKey.size) return 0;

      const entityKeys = [...snapshotByEntityKey.keys()].sort();

      for (let index = 0; index < entityKeys.length; index += SNAPSHOT_INSERT_BATCH_SIZE) {
        const batch = entityKeys.slice(index, index + SNAPSHOT_INSERT_BATCH_SIZE);

        await tx.bulkUndoTargetSnapshot.createMany({
          data: batch.map((entityKey, batchIndex) => {
            const entity = snapshotByEntityKey.get(entityKey);
            return {
              shop,
              historyId,
              executionIdentity,
              productId: entity?.productId,
              variantId: entity?.variantId ?? null,
              field: entity?.field ?? null,
              entityKey,
              ordinal: index + batchIndex + 1,
              changeHash: hashProductChangeSet(entity?.changeHashes || []),
              changeRecordIds: entity?.changeRecordIds || [],
              frozenMutations: entity?.frozenMutations || [],
            };
          }),
          skipDuplicates: true,
        });
      }

      return entityKeys.length;
    };

    if (typeof client.$transaction === "function") {
      return client.$transaction(run);
    }

    return run(client);
  },

  async markFrozen({ shop, executionIdentity, frozenCount }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    if (Number(frozenCount) <= 0) {
      throw codedError("UNDO_FROZEN_COUNT_REQUIRED");
    }

    const updated = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.FREEZING,
      },
      data: {
        frozenCount,
        state: UNDO_EXECUTION_STATES.FROZEN,
      },
    });
    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: { shop, executionIdentity },
      select: { operationId: true },
    });
    if (updated.count && execution?.operationId) {
      await transitionMerchantOperation({
        shop,
        operationId: execution.operationId,
        status: "SNAPSHOTTED",
        totalItems: frozenCount,
        processedItems: 0,
      }, db);
      await projectOperationToBulkUndoExecution(
        {
          shop,
          executionIdentity,
          operationId: execution.operationId,
        },
        db,
      );
    }
    return updated;
  },

  async getNextSnapshotBatch(
    { shop, executionIdentity, cursorOrdinal = 0, limit = 75 },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    const safeCursor = Number(cursorOrdinal) || 0;
    const safeLimit = Math.max(1, Number(limit) || 75);

    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: { shop, executionIdentity },
      select: {
        state: true,
        frozenCount: true,
      },
    });
    if (!execution) {
      throw codedError("UNDO_EXECUTION_NOT_FOUND");
    }
    if (
      ![
        UNDO_EXECUTION_STATES.DISPATCHING,
        UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
        UNDO_EXECUTION_STATES.APPLYING_RESULTS,
        UNDO_EXECUTION_STATES.VERIFYING,
      ].includes(execution.state)
    ) {
      throw codedError("UNDO_INVALID_STATE_FOR_SNAPSHOT_READ");
    }
    if (safeCursor < 0 || safeCursor > Number(execution.frozenCount || 0)) {
      throw codedError("UNDO_SNAPSHOT_CURSOR_OUT_OF_BOUNDS");
    }

    return getClient(db).bulkUndoTargetSnapshot.findMany({
      where: {
        shop,
        executionIdentity,
        ordinal: {
          gt: safeCursor,
        },
      },
      orderBy: [{ ordinal: "asc" }, { id: "asc" }],
      take: safeLimit,
    });
  },

  async markApplyingResults({ shop, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    const updated = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
      },
      data: {
        state: UNDO_EXECUTION_STATES.APPLYING_RESULTS,
      },
    });
    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: { shop, executionIdentity },
      select: { operationId: true },
    });
    if (updated.count && execution?.operationId) {
      await transitionMerchantOperation({
        shop,
        operationId: execution.operationId,
        status: "APPLYING_RESULTS",
      }, db);
      await projectOperationToBulkUndoExecution(
        {
          shop,
          executionIdentity,
          operationId: execution.operationId,
        },
        db,
      );
    }
    return updated;
  },

  async markVerifying(
    { shop, executionIdentity, resultChecksum = null, resultsAppliedAt = new Date() },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    const updated = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.APPLYING_RESULTS,
      },
      data: {
        state: UNDO_EXECUTION_STATES.VERIFYING,
        resultChecksum,
        resultsAppliedAt,
      },
    });
    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: { shop, executionIdentity },
      select: { operationId: true },
    });
    if (updated.count && execution?.operationId) {
      await transitionMerchantOperation({
        shop,
        operationId: execution.operationId,
        status: "VERIFYING",
      }, db);
      await projectOperationToBulkUndoExecution(
        {
          shop,
          executionIdentity,
          operationId: execution.operationId,
        },
        db,
      );
    }
    return updated;
  },

  async findExecution({ shop, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoExecution.findFirst({
      where: {
        shop,
        executionIdentity,
      },
    });
  },

  async markDispatching({ shop, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    const updated = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: {
          in: [UNDO_EXECUTION_STATES.FROZEN, UNDO_EXECUTION_STATES.DISPATCHING],
        },
        frozenCount: {
          gt: 0,
        },
      },
      data: {
        state: UNDO_EXECUTION_STATES.DISPATCHING,
      },
    });
    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: { shop, executionIdentity },
      select: { operationId: true },
    });
    if (updated.count && execution?.operationId) {
      await transitionMerchantOperation({
        shop,
        operationId: execution.operationId,
        status: "DISPATCHING",
      }, db);
      await projectOperationToBulkUndoExecution(
        {
          shop,
          executionIdentity,
          operationId: execution.operationId,
        },
        db,
      );
    }
    return updated;
  },

  async markAwaitingShopify(
    {
      shop,
      executionIdentity,
      bulkOperationId,
      lastSnapshotOrdinal,
      count,
    },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    assertRequired(bulkOperationId, "bulkOperationId");
    const nextOrdinal = Number(lastSnapshotOrdinal) || 0;
    const incrementBy = Number(count) || 0;
    if (nextOrdinal <= 0) {
      throw codedError("UNDO_SNAPSHOT_ORDINAL_REQUIRED");
    }
    if (incrementBy <= 0) {
      throw codedError("UNDO_BATCH_COUNT_REQUIRED");
    }

    const client = getClient(db);
    const run = async (tx) => {
      const execution = await tx.bulkUndoExecution.findFirst({
        where: {
          shop,
          executionIdentity,
        },
      });

      if (!execution) {
        throw codedError("UNDO_EXECUTION_NOT_FOUND");
      }

      if (execution.state !== UNDO_EXECUTION_STATES.DISPATCHING) {
        throw codedError("UNDO_INVALID_STATE_TRANSITION");
      }

      if (execution.lastSnapshotOrdinal > nextOrdinal) {
        throw codedError("UNDO_SNAPSHOT_CURSOR_REGRESSION");
      }

      const nextProcessedCount = Number(execution.processedCount || 0) + incrementBy;
      if (
        Number(execution.frozenCount || 0) > 0 &&
        nextProcessedCount > Number(execution.frozenCount)
      ) {
        throw codedError("UNDO_PROCESSED_COUNT_EXCEEDS_FROZEN");
      }

      const updated = await tx.bulkUndoExecution.updateMany({
        where: {
          shop,
          executionIdentity,
          state: UNDO_EXECUTION_STATES.DISPATCHING,
          lastSnapshotOrdinal: {
            lte: nextOrdinal,
          },
        },
        data: {
          state: UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
          bulkOperationId,
          lastSnapshotOrdinal: nextOrdinal,
          processedCount: nextProcessedCount,
        },
      });
      if (updated.count && execution.operationId) {
        await transitionMerchantOperation({
          shop,
          operationId: execution.operationId,
          status: "AWAITING_SHOPIFY",
          processedItems: nextProcessedCount,
          totalItems: Number(execution.frozenCount || 0),
        }, tx);
        await projectOperationToBulkUndoExecution(
          {
            shop,
            executionIdentity,
            operationId: execution.operationId,
          },
          tx,
        );
      }
      return updated;
    };

    if (typeof client.$transaction === "function") {
      return client.$transaction(run);
    }

    return run(client);
  },

  async markCompleted({ shop, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    const updated = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.VERIFYING,
      },
      data: {
        state: UNDO_EXECUTION_STATES.COMPLETED,
      },
    });
    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: { shop, executionIdentity },
      select: { operationId: true },
    });
    if (updated.count && execution?.operationId) {
      await transitionMerchantOperation({
        shop,
        operationId: execution.operationId,
        status: "COMPLETED",
        completedAt: new Date(),
      }, db);
      await projectOperationToBulkUndoExecution(
        {
          shop,
          executionIdentity,
          operationId: execution.operationId,
        },
        db,
      );
    }
    return updated;
  },

  async markFailed({ shop, executionIdentity, errorMessage }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    const updated = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: {
          in: [
            UNDO_EXECUTION_STATES.FREEZING,
            UNDO_EXECUTION_STATES.FROZEN,
            UNDO_EXECUTION_STATES.DISPATCHING,
            UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
            UNDO_EXECUTION_STATES.APPLYING_RESULTS,
            UNDO_EXECUTION_STATES.VERIFYING,
          ],
        },
      },
      data: {
        state: UNDO_EXECUTION_STATES.FAILED,
        errorMessage,
      },
    });
    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: { shop, executionIdentity },
      select: { operationId: true },
    });
    if (updated.count && execution?.operationId) {
      await transitionMerchantOperation({
        shop,
        operationId: execution.operationId,
        status: "FAILED",
        failedAt: new Date(),
        errorMessage: errorMessage || "UNDO_FAILED",
      }, db);
      await projectOperationToBulkUndoExecution(
        {
          shop,
          executionIdentity,
          operationId: execution.operationId,
        },
        db,
      );
    }
    return updated;
  },
};

export { UNDO_EXECUTION_STATES };
