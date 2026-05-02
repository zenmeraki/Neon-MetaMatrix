import crypto from "crypto";
import { prisma } from "../config/database.js";

const UNDO_EXECUTION_STATES = {
  FREEZING: "FREEZING",
  FROZEN: "FROZEN",
  DISPATCHING: "DISPATCHING",
  AWAITING_SHOPIFY: "AWAITING_SHOPIFY",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
};
const FREEZE_CHANGE_PAGE_SIZE = 2000;
const SNAPSHOT_INSERT_BATCH_SIZE = 1000;

function getClient(db) {
  return db || prisma;
}

function hashChangeRow(row) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        productId: row.productId,
        title: row.title,
        scope: row.scope,
        options: row.options ?? null,
        productFieldChanges: row.productFieldChanges ?? null,
        variantFieldChanges: row.variantFieldChanges ?? null,
      }),
    )
    .digest("hex");
}

function assertRequired(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

export const bulkUndoExecutionRepository = {
  async createExecution(
    { shop, historyId, executionIdentity, source },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(historyId, "historyId");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoExecution.create({
      data: {
        shop,
        historyId,
        executionIdentity,
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
      const hashByProductId = new Map();
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

        for (const change of changes) {
          const currentHash = hashByProductId.get(change.productId) || "";

          hashByProductId.set(
            change.productId,
            crypto
              .createHash("sha256")
              .update(currentHash + hashChangeRow(change))
              .digest("hex"),
          );
        }

        lastId = changes[changes.length - 1].id;

        if (changes.length < FREEZE_CHANGE_PAGE_SIZE) {
          break;
        }
      }

      if (!hashByProductId.size) return 0;

      const productIds = [...hashByProductId.keys()].sort();

      for (let index = 0; index < productIds.length; index += SNAPSHOT_INSERT_BATCH_SIZE) {
        const batch = productIds.slice(index, index + SNAPSHOT_INSERT_BATCH_SIZE);

        await tx.bulkUndoTargetSnapshot.createMany({
          data: batch.map((productId, batchIndex) => ({
            shop,
            historyId,
            executionIdentity,
            productId,
            ordinal: index + batchIndex + 1,
            changeHash: hashByProductId.get(productId),
          })),
          skipDuplicates: true,
        });
      }

      return productIds.length;
    };

    if (typeof client.$transaction === "function") {
      return client.$transaction(run);
    }

    return run(client);
  },

  async markFrozen({ shop, executionIdentity, frozenCount }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoExecution.updateMany({
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
  },

  async getNextSnapshotBatch(
    { shop, executionIdentity, cursorOrdinal = 0, limit = 75 },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoTargetSnapshot.findMany({
      where: {
        shop,
        executionIdentity,
        ordinal: {
          gt: Number(cursorOrdinal) || 0,
        },
      },
      orderBy: [{ ordinal: "asc" }],
      take: limit,
    });
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

    return getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.FROZEN,
        frozenCount: {
          gt: 0,
        },
      },
      data: {
        state: UNDO_EXECUTION_STATES.DISPATCHING,
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
    },
    db = prisma,
  ) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.DISPATCHING,
      },
      data: {
        state: UNDO_EXECUTION_STATES.AWAITING_SHOPIFY,
        bulkOperationId,
        lastSnapshotOrdinal,
        processedCount: {
          increment: Number(count) || 0,
        },
      },
    });
  },

  async markCompleted({ shop, executionIdentity }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: UNDO_EXECUTION_STATES.DISPATCHING,
      },
      data: {
        state: UNDO_EXECUTION_STATES.COMPLETED,
      },
    });
  },

  async markFailed({ shop, executionIdentity, errorMessage }, db = prisma) {
    assertRequired(shop, "shop");
    assertRequired(executionIdentity, "executionIdentity");

    return getClient(db).bulkUndoExecution.updateMany({
      where: {
        shop,
        executionIdentity,
        state: {
          not: UNDO_EXECUTION_STATES.COMPLETED,
        },
      },
      data: {
        state: UNDO_EXECUTION_STATES.FAILED,
        errorMessage,
      },
    });
  },
};

export { UNDO_EXECUTION_STATES };
