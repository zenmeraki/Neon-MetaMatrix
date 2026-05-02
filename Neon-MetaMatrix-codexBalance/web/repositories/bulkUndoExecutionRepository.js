import crypto from "crypto";
import { prisma } from "../config/database.js";
import { Prisma } from "../generated/prisma/index.js";

const UNDO_EXECUTION_STATES = {
  FREEZING: "FREEZING",
  FROZEN: "FROZEN",
  DISPATCHING: "DISPATCHING",
  AWAITING_SHOPIFY: "AWAITING_SHOPIFY",
  FINALIZING: "FINALIZING",
  FAILED: "FAILED",
  PARTIAL: "PARTIAL",
  COMPLETED: "COMPLETED",
};

const ACTIVE_STATES = [
  UNDO_EXECUTION_STATES.FREEZING,
  UNDO_EXECUTION_STATES.FROZEN,
  UNDO_EXECUTION_STATES.DISPATCHING,
  UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
];

const ACTIVE_SHOPIFY_MUTATION_STATES = [
  UNDO_EXECUTION_STATES.DISPATCHING,
  UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
  UNDO_EXECUTION_STATES.FINALIZING,
];

const FREEZE_CHANGE_PAGE_SIZE = 1000;
const SNAPSHOT_INSERT_BATCH_SIZE = 500;
const MAX_FREEZE_TARGETS = 250_000;
const MAX_SNAPSHOT_BATCH_SIZE = 2000;
const DEFAULT_LEASE_MS = 15 * 60 * 1000;

function getClient(db) {
  return db || prisma;
}

function assertRequired(value, name) {
  if (!value) throw new Error(`${name} is required`);
}

function assertDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
}

function normalizeLimit(limit, max = MAX_SNAPSHOT_BATCH_SIZE) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 75;
  return Math.min(parsed, max);
}

function leaseUntil(now, leaseMs = DEFAULT_LEASE_MS) {
  assertDate(now, "now");
  return new Date(now.getTime() + leaseMs);
}

function stableJson(value) {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value;
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readPreviousValue(change) {
  return (
    change?.revertValue ??
    change?.oldValue ??
    change?.beforeValue ??
    change?.previousValue ??
    null
  );
}

function readCurrentValue(change) {
  return (
    change?.newValue ??
    change?.afterValue ??
    change?.currentValue ??
    change?.value ??
    null
  );
}

function buildTargetHash(payload) {
  return crypto
    .createHash("sha256")
    .update(
      stableStringify({
        changeRecordId: payload.changeRecordId,
        productId: payload.productId,
        variantId: payload.variantId ?? null,
        scope: payload.scope,
        field: payload.field,
        previousValue: payload.previousValue,
        currentValue: payload.currentValue ?? null,
      }),
    )
    .digest("hex");
}

function buildUndoSnapshotRows({
  shop,
  historyId,
  executionIdentity,
  change,
}) {
  const rows = [];

  const productFieldChanges = Array.isArray(change.productFieldChanges)
    ? change.productFieldChanges
    : [];

  const variantFieldChanges = Array.isArray(change.variantFieldChanges)
    ? change.variantFieldChanges
    : [];

  for (const productChange of productFieldChanges) {
    if (!productChange?.field) continue;

    const previousValue = stableJson(readPreviousValue(productChange));

    const row = {
      shop,
      historyId,
      executionIdentity,
      changeRecordId: change.id,
      productId: change.productId,
      variantId: null,
      scope: "PRODUCT",
      field: productChange.field,
      previousValue,
      currentValue: stableJson(readCurrentValue(productChange)),
      status: "FROZEN",
    };

    rows.push({
      ...row,
      targetHash: buildTargetHash(row),
    });
  }

  for (const variantChange of variantFieldChanges) {
    const variantId = variantChange.variantId;

    if (!variantId) continue;

    const nestedChanges = Array.isArray(variantChange.changes)
      ? variantChange.changes
      : [variantChange];

    for (const nestedChange of nestedChanges) {
      if (!nestedChange?.field) continue;

      const row = {
        shop,
        historyId,
        executionIdentity,
        changeRecordId: change.id,
        productId: change.productId,
        variantId,
        scope: "VARIANT",
        field: nestedChange.field,
        previousValue: stableJson(readPreviousValue(nestedChange)),
        currentValue: stableJson(readCurrentValue(nestedChange)),
        status: "FROZEN",
      };

      rows.push({
        ...row,
        targetHash: buildTargetHash(row),
      });
    }
  }

  return rows;
}

function appendError(existing, entry) {
  if (!existing) return [entry];
  if (Array.isArray(existing)) return [...existing, entry];
  return [existing, entry];
}

async function assertHistoryOwnedByShop(client, { shop, historyId }) {
  const history = await client.editHistory.findFirst({
    where: { id: historyId, shop },
    select: {
      id: true,
      shop: true,
      status: true,
      undoState: true,
      targetMirrorBatchId: true,
    },
  });

  if (!history) throw new Error("Edit history not found for shop");
  return history;
}

async function assertNoOtherActiveExecution(client, { shop, historyId, executionIdentity }) {
  const active = await client.bulkUndoExecution.findFirst({
    where: {
      shop,
      historyId,
      state: { in: ACTIVE_STATES },
      executionIdentity: { not: executionIdentity },
    },
    select: { id: true, executionIdentity: true, state: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (active) {
    throw new Error("Another undo execution is already active for this history");
  }
}

async function verifySnapshotIntegrity(client, { shop, executionIdentity, expectedCount }) {
  const [count, maxRow] = await Promise.all([
    client.bulkUndoTargetSnapshot.count({
      where: { shop, executionIdentity },
    }),
    client.bulkUndoTargetSnapshot.findFirst({
      where: { shop, executionIdentity },
      orderBy: { ordinal: "desc" },
      select: { ordinal: true },
    }),
  ]);

  if (count !== expectedCount || (expectedCount > 0 && maxRow?.ordinal !== expectedCount)) {
    throw new Error("Undo target snapshot integrity check failed");
  }

  return { count, maxOrdinal: maxRow?.ordinal || 0 };
}

export const bulkUndoExecutionRepository = {
  async createExecution(
    { shop, historyId, executionIdentity, source, now = new Date() },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(historyId, "historyId");
    assertRequired(executionIdentity, "executionIdentity");
    assertDate(now, "now");

    const client = getClient(db);
    await assertHistoryOwnedByShop(client, { shop, historyId });
    await assertNoOtherActiveExecution(client, { shop, historyId, executionIdentity });

    return client.bulkUndoExecution.upsert({
      where: { executionIdentity },
      create: {
        shop,
        historyId,
        executionIdentity,
        source,
        state: UNDO_EXECUTION_STATES.FREEZING,
        leaseUntil: leaseUntil(now),
        heartbeatAt: now,
        attemptCount: 1,
      },
      update: {},
    });
  },

  async freezeTargets(
    { shop, historyId, executionIdentity, now = new Date(), worker = "bulkUndoFreeze" },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(historyId, "historyId");
    assertRequired(executionIdentity, "executionIdentity");
    assertDate(now, "now");

    const client = getClient(db);
    const claimed = await client.bulkUndoExecution.updateMany({
      where: {
        shop,
        historyId,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.FREEZING,
        OR: [
          { leaseUntil: null },
          { leaseUntil: { lt: now } },
          { leaseOwner: worker },
        ],
      },
      data: {
        leaseOwner: worker,
        leaseUntil: leaseUntil(now),
        heartbeatAt: now,
      },
    });

    if (claimed.count !== 1) {
      throw new Error("Undo target freeze could not be claimed");
    }

    const run = async (tx) => {
      await assertHistoryOwnedByShop(tx, { shop, historyId });
      await tx.bulkUndoTargetSnapshot.deleteMany({ where: { shop, executionIdentity } });

      let ordinal = 0;
      let frozenCount = 0;
      let lastId = null;
      const maxChangeId = await tx.changeRecord.findFirst({
        where: { shop, editHistoryId: historyId },
        orderBy: { id: "desc" },
        select: { id: true },
      });

      while (true) {
        const changes = await tx.changeRecord.findMany({
          where: {
            shop,
            editHistoryId: historyId,
            ...(lastId ? { id: { gt: lastId } } : {}),
            ...(maxChangeId?.id ? { id: { lte: maxChangeId.id } } : {}),
          },
          orderBy: [{ id: "asc" }],
          take: FREEZE_CHANGE_PAGE_SIZE,
        });

        if (!changes.length) break;

        const snapshotRows = [];
        for (const change of changes) {
          const rows = buildUndoSnapshotRows({
            shop,
            historyId,
            executionIdentity,
            change,
          });

          for (const row of rows) {
            ordinal += 1;
            snapshotRows.push({
              ...row,
              ordinal,
            });
          }
        }

        if (frozenCount + snapshotRows.length > MAX_FREEZE_TARGETS) {
          throw new Error(`Undo target freeze exceeded ${MAX_FREEZE_TARGETS} snapshot rows`);
        }

        for (let index = 0; index < snapshotRows.length; index += SNAPSHOT_INSERT_BATCH_SIZE) {
          const data = snapshotRows.slice(index, index + SNAPSHOT_INSERT_BATCH_SIZE);
          if (!data.length) continue;

          const inserted = await tx.bulkUndoTargetSnapshot.createMany({
            data,
            skipDuplicates: true,
          });
          frozenCount += inserted.count;
        }

        lastId = changes[changes.length - 1].id;
        await tx.bulkUndoExecution.updateMany({
          where: { shop, executionIdentity, state: UNDO_EXECUTION_STATES.FREEZING },
          data: {
            freezeCursorId: lastId,
            frozenCount,
            heartbeatAt: now,
          },
        });

        if (changes.length < FREEZE_CHANGE_PAGE_SIZE) break;
      }

      await verifySnapshotIntegrity(tx, { shop, executionIdentity, expectedCount: frozenCount });

      return frozenCount;
    };

    if (typeof client.$transaction === "function") {
      return client.$transaction(run);
    }

    return run(client);
  },

  async markFrozen({ shop, executionIdentity, frozenCount, now = new Date() }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    assertDate(now, "now");

    const integrity = await verifySnapshotIntegrity(getClient(db), {
      shop,
      executionIdentity,
      expectedCount: frozenCount,
    });

    const transition = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.FREEZING,
        frozenCount: integrity.count,
      },
      data: {
        frozenCount,
        frozenAt: now,
        heartbeatAt: now,
        leaseOwner: null,
        leaseUntil: null,
        state: UNDO_EXECUTION_STATES.FROZEN,
      },
    });

    if (transition.count !== 1) throw new Error("Undo execution could not be marked frozen");
    return transition;
  },

  async getNextSnapshotBatch(
    { shop, executionIdentity, cursorOrdinal = 0, limit = 75 },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    const take = normalizeLimit(limit);
    const cursor = Number(cursorOrdinal) || 0;

    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: {
        shop,
        executionIdentity,
        state: { in: [UNDO_EXECUTION_STATES.DISPATCHING, UNDO_EXECUTION_STATES.AWAITING_SHOPIFY] },
      },
      select: { frozenCount: true },
    });
    if (!execution) throw new Error("Undo execution is not dispatchable");

    return getClient(db).bulkUndoTargetSnapshot.findMany({
      where: {
        shop,
        executionIdentity,
        status: "FROZEN",
        ordinal: { gt: cursor, lte: execution.frozenCount },
      },
      orderBy: [{ ordinal: "asc" }],
      take,
    });
  },

  async createDispatchProducts({ shop, executionIdentity, products = [] }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    if (!Array.isArray(products) || !products.length) {
      return { count: 0 };
    }

    const data = products.map((product, index) => {
      if (!product?.productId) {
        throw new Error("dispatch productId is required");
      }

      const targetIds = Array.isArray(product.targetIds)
        ? product.targetIds.filter(Boolean)
        : [];

      if (!targetIds.length) {
        throw new Error("dispatch targetIds are required");
      }

      return {
        shop,
        executionIdentity,
        productId: product.productId,
        ordinal: Number(product.ordinal) || index + 1,
        targetIds,
        payloadHash: product.payloadHash,
        status: "DISPATCHED",
      };
    });

    const targetIds = data.flatMap((product) => product.targetIds);
    const client = getClient(db);

    return client.$transaction(async (tx) => {
      const inserted = await tx.bulkUndoDispatchProduct.createMany({
        data,
        skipDuplicates: true,
      });

      await tx.bulkUndoTargetSnapshot.updateMany({
        where: {
          shop,
          executionIdentity,
          id: { in: targetIds },
          status: "FROZEN",
        },
        data: {
          status: "DISPATCHED",
        },
      });

      return inserted;
    });
  },

  async markDispatchProductResult(
    { shop, executionIdentity, productId, status, errorCode = null, errorMessage = null },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    assertRequired(productId, "productId");
    assertRequired(status, "status");

    const client = getClient(db);
    const dispatchProduct = await client.bulkUndoDispatchProduct.findUnique({
      where: {
        shop_executionIdentity_productId: {
          shop,
          executionIdentity,
          productId,
        },
      },
      select: { targetIds: true },
    });

    if (!dispatchProduct) {
      return { dispatch: { count: 0 }, targets: { count: 0 } };
    }

    const targetStatus = status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED";

    const [dispatch, targets] = await client.$transaction([
      client.bulkUndoDispatchProduct.updateMany({
        where: {
          shop,
          executionIdentity,
          productId,
        },
        data: {
          status,
          errorCode,
          errorMessage,
        },
      }),
      client.bulkUndoTargetSnapshot.updateMany({
        where: {
          shop,
          executionIdentity,
          id: { in: dispatchProduct.targetIds },
        },
        data: {
          status: targetStatus,
          errorCode,
          errorMessage,
        },
      }),
    ]);

    return { dispatch, targets };
  },

  async listDispatchProducts({ shop, executionIdentity, status = null, limit = 250 }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoDispatchProduct.findMany({
      where: {
        shop,
        executionIdentity,
        ...(status ? { status } : {}),
      },
      orderBy: [{ ordinal: "asc" }, { id: "asc" }],
      take: normalizeLimit(limit, 1000),
    });
  },

  async findExecution({ shop, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoExecution.findFirst({
      where: { shop, executionIdentity },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  },

  async findByBulkOperationId({ shop, bulkOperationId }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(bulkOperationId, "bulkOperationId");

    return getClient(db).bulkUndoExecution.findFirst({
      where: { shop, bulkOperationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  },

  async markDispatching(
    { shop, executionIdentity, now = new Date(), worker = "bulkUndoWorker", leaseMs },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    assertDate(now, "now");

    const client = getClient(db);
    const activeUndoMutation = await client.bulkUndoExecution.findFirst({
      where: {
        shop,
        executionIdentity: { not: executionIdentity },
        state: { in: ACTIVE_SHOPIFY_MUTATION_STATES },
      },
      select: {
        id: true,
        executionIdentity: true,
        state: true,
        bulkOperationId: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    if (activeUndoMutation) {
      throw new Error("Another undo Shopify bulk mutation is already active for this shop");
    }

    const transition = await client.bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.FROZEN,
        frozenCount: { gt: 0 },
      },
      data: {
        state: UNDO_EXECUTION_STATES.DISPATCHING,
        leaseOwner: worker,
        leaseUntil: leaseUntil(now, leaseMs),
        heartbeatAt: now,
        dispatchStartedAt: now,
        dispatchCompletedAt: null,
        jsonlFileBytes: null,
        dispatchProductCount: 0,
        attemptCount: { increment: 1 },
      },
    });

    if (transition.count !== 1) throw new Error("Undo execution is not dispatchable");
    return transition;
  },

  async heartbeat({ shop, executionIdentity, worker, now = new Date(), leaseMs }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    assertRequired(worker, "worker");
    assertDate(now, "now");

    return getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        leaseOwner: worker,
        state: { in: ACTIVE_STATES },
      },
      data: {
        heartbeatAt: now,
        leaseUntil: leaseUntil(now, leaseMs),
      },
    });
  },

  async markAwaitingShopify(
    {
      shop,
      executionIdentity,
      bulkOperationId,
      lastSnapshotOrdinal,
      count,
      jsonlFileBytes = null,
      dispatchProductCount = null,
      now = new Date(),
    },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    assertRequired(bulkOperationId, "bulkOperationId");
    assertDate(now, "now");

    const client = getClient(db);
    const execution = await client.bulkUndoExecution.findFirst({
      where: { shop, executionIdentity, state: UNDO_EXECUTION_STATES.DISPATCHING },
      select: { frozenCount: true, processedCount: true },
    });
    if (!execution) throw new Error("Undo execution is not awaiting-shopify eligible");

    const increment = Number(count) || 0;
    const nextProcessedCount = execution.processedCount + increment;
    if (nextProcessedCount > execution.frozenCount) {
      throw new Error("Undo processed count cannot exceed frozen count");
    }

    const duplicateBulkOperation = await client.bulkUndoExecution.findFirst({
      where: {
        shop,
        bulkOperationId,
        executionIdentity: { not: executionIdentity },
      },
      select: { id: true },
    });
    if (duplicateBulkOperation) {
      throw new Error("bulkOperationId is already attached to another undo execution");
    }

    const transition = await client.bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.DISPATCHING,
      },
      data: {
        state: UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
        bulkOperationId,
        lastSnapshotOrdinal,
        dispatchCompletedAt: now,
        ...(jsonlFileBytes !== null ? { jsonlFileBytes } : {}),
        ...(dispatchProductCount !== null ? { dispatchProductCount } : {}),
        processedCount: { increment },
      },
    });

    if (transition.count !== 1) throw new Error("Undo execution could not move to awaiting Shopify");
    return transition;
  },

  async markBatchSucceeded({ shop, executionIdentity, hasMore, now = new Date() }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    assertDate(now, "now");

    const nextState = hasMore ? UNDO_EXECUTION_STATES.FROZEN : UNDO_EXECUTION_STATES.AWAITING_SHOPIFY;
    const transition = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
      },
      data: {
        state: nextState,
        ...(hasMore ? { bulkOperationId: null } : {}),
        heartbeatAt: now,
        leaseOwner: null,
        leaseUntil: null,
      },
    });

    if (transition.count !== 1) throw new Error("Undo execution batch could not be finalized");
    return transition;
  },

  async markCompleted({ shop, executionIdentity, now = new Date() }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    assertDate(now, "now");

    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: {
        shop,
        executionIdentity,
        state: {
          in: [
            UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
            UNDO_EXECUTION_STATES.DISPATCHING,
          ],
        },
      },
      select: { frozenCount: true, processedCount: true },
    });
    if (!execution) throw new Error("Undo execution is not completable");
    if (execution.processedCount !== execution.frozenCount) {
      throw new Error("Undo execution cannot complete before all frozen targets are processed");
    }

    const transition = await getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: {
          in: [
            UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
            UNDO_EXECUTION_STATES.DISPATCHING,
          ],
        },
        processedCount: execution.frozenCount,
      },
      data: {
        state: UNDO_EXECUTION_STATES.COMPLETED,
        completedAt: now,
        heartbeatAt: now,
        leaseOwner: null,
        leaseUntil: null,
      },
    });

    if (transition.count !== 1) throw new Error("Undo execution could not be completed");
    return transition;
  },

  async markFailed({ shop, executionIdentity, errorMessage, now = new Date() }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");
    assertDate(now, "now");

    const execution = await getClient(db).bulkUndoExecution.findFirst({
      where: {
        shop,
        executionIdentity,
        state: { in: [...ACTIVE_STATES, UNDO_EXECUTION_STATES.FAILED] },
      },
      select: { errorHistory: true, state: true },
    });
    if (!execution || execution.state === UNDO_EXECUTION_STATES.COMPLETED) {
      return { count: 0 };
    }

    return getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: { in: [...ACTIVE_STATES, UNDO_EXECUTION_STATES.FAILED] },
      },
      data: {
        state: UNDO_EXECUTION_STATES.FAILED,
        errorMessage: errorMessage || "Undo execution failed",
        errorHistory: appendError(execution.errorHistory, {
          message: errorMessage || "Undo execution failed",
          occurredAt: now.toISOString(),
        }),
        completedAt: now,
        heartbeatAt: now,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
  },

  async listStaleExecutions({ shop, now = new Date(), limit = 100 }, db = prisma) {
    assertRequired(shop, "shop");
    assertDate(now, "now");

    return getClient(db).bulkUndoExecution.findMany({
      where: {
        shop,
        state: { in: ACTIVE_STATES },
        leaseUntil: { lt: now },
      },
      orderBy: [{ leaseUntil: "asc" }, { id: "asc" }],
      take: normalizeLimit(limit),
    });
  },

  async validateSnapshotIntegrity({ shop, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    const execution = await this.findExecution({ shop, executionIdentity }, db);
    if (!execution) throw new Error("Undo execution not found");
    return verifySnapshotIntegrity(getClient(db), {
      shop,
      executionIdentity,
      expectedCount: execution.frozenCount,
    });
  },

  async cleanupOrphanedSnapshots({ shop, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).$executeRaw`
      DELETE FROM "BulkUndoTargetSnapshot" snapshot
      WHERE snapshot."shop" = ${shop}
        AND snapshot."executionIdentity" = ${executionIdentity}
        AND NOT EXISTS (
          SELECT 1
          FROM "BulkUndoExecution" execution
          WHERE execution."shop" = snapshot."shop"
            AND execution."executionIdentity" = snapshot."executionIdentity"
        )
    `;
  },
};

export { UNDO_EXECUTION_STATES };
