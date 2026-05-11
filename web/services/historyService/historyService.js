import { NotFoundError } from "../../utils/errorUtils.js";
import { EDIT_TYPES, FIELD_TRANSLATIONS } from "../../config/constants.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { prisma } from "../../config/database.js";
import { projectEditHistoryStatus } from "../historyStatusProjectionService.js";

const validTypes = ["Manual edit", "Scheduled edit", "Recurring edit", "Automatic rule"];
const HISTORY_PROJECTION_VERSION = 2;

const OPERATION_STATUS_TO_EXECUTION_STATE = {
  PLANNED: "planned",
  SNAPSHOTTING: "snapshooting",
  SNAPSHOTTED: "frozen",
  DISPATCHING: "dispatching",
  AWAITING_SHOPIFY: "awaiting_shopify",
  APPLYING_RESULTS: "finalizing",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const ACTIVE_OPERATION_STATUSES = [
  "PLANNED",
  "SNAPSHOTTING",
  "SNAPSHOTTED",
  "DISPATCHING",
  "AWAITING_SHOPIFY",
  "APPLYING_RESULTS",
  "VERIFYING",
];

function getLocalizedJsonText(value, lang = "en") {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    return String(value);
  }

  return value[lang] ?? value.en ?? Object.values(value)[0] ?? null;
}

function encodeHistoryCursor(operation) {
  if (!operation?.id || !operation?.createdAt) return null;

  return Buffer.from(
    JSON.stringify({
      createdAt: operation.createdAt.toISOString(),
      id: operation.id,
    }),
  ).toString("base64url");
}

function decodeHistoryCursor(cursor) {
  if (!cursor || typeof cursor !== "string") return null;

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed?.id || !parsed?.createdAt) return null;

    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;

    return { id: String(parsed.id), createdAt };
  } catch {
    return null;
  }
}

function mapOperationExecutionState(operation) {
  return OPERATION_STATUS_TO_EXECUTION_STATE[operation?.status] || "planned";
}

function getRuleFieldKey(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return "csv";

  const fields = [
    ...new Set(
      rules
        .map((rule) => rule?.field)
        .filter((field) => typeof field === "string" && field.length > 0),
    ),
  ];

  if (fields.length === 0) return "csv";
  if (fields.length === 1) return fields[0];
  return "multiple_fields";
}

function buildOperationProjection(operation, editHistory, lang) {
  const latestExecution = operation.executions?.[0] || null;
  const latestSubmission = operation.submissions?.[0] || null;
  const snapshotSet = operation.immutableSnapshots?.[0] || null;

  return {
    ...editHistory,
    operationId: operation.id,
    status: String(operation.status || "unknown").toLowerCase(),
    executionState: mapOperationExecutionState(operation),
    executionIdentity: latestExecution?.executionKey || null,
    bulkOperationId: latestSubmission?.bulkOperationId || null,
    targetSnapshotCount: Number(snapshotSet?.productCount || operation.totalItems || 0),
    targetMirrorBatchId: snapshotSet?.mirrorBatchId || null,
    failureStage: operation.errorCode || null,
    processedCount: Number(operation.processedItems || 0),
    totalItems: Number(operation.totalItems || 0),
    completedAt: operation.completedAt || editHistory?.completedAt || null,
    operation: {
      status: operation.status,
      processedItems: operation.processedItems,
      totalItems: operation.totalItems,
      failedItems: operation.failedItems,
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      failedAt: operation.failedAt,
      errorCode: operation.errorCode,
      errorMessage: operation.errorMessage,
      updatedAt: operation.updatedAt,
      snapshotSetId: operation.snapshotSetId || snapshotSet?.id || null,
      executionPlanId: operation.executionPlanId || null,
      intentId: operation.intentId || null,
    },
    title: getLocalizedJsonText(editHistory?.title, lang) || operation.title,
    projectionVersion: HISTORY_PROJECTION_VERSION,
  };
}

function summarizeUndoOperation(operation) {
  if (!operation) return null;

  const partitions = operation.executionPartitions || [];
  const counts = partitions.reduce((acc, partition) => {
    const key = String(partition.status || "UNKNOWN").toUpperCase();
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    undoOperationId: operation.id,
    undoOperationStatus: operation.status || null,
    safe: 0,
    restored: Number(operation.processedItems || 0),
    conflict: Number(counts.CONFLICT || counts.CONFLICTED || 0),
    failed: Number(operation.failedItems || counts.FAILED || 0),
    skipped: Number(counts.SKIPPED || 0),
    dispatched: Number(counts.DISPATCHING || counts.AWAITING_SHOPIFY || 0),
    pending: Number(counts.PLANNED || counts.SNAPSHOTTING || counts.SNAPSHOTTED || 0),
    total: Number(operation.totalItems || partitions.length || 0),
    partitionCounts: counts,
  };
}

function buildUndoStateFromOperation(operation) {
  if (!operation) {
    return {
      allowed: true,
      status: "idle",
      state: "planned",
      processedCount: 0,
      error: null,
    };
  }

  return {
    allowed: false,
    status: String(operation.status || "unknown").toLowerCase(),
    state: mapOperationExecutionState(operation),
    executionIdentity: operation.executions?.[0]?.executionKey || null,
    processedCount: Number(operation.processedItems || 0),
    durationMs:
      operation.startedAt && operation.completedAt
        ? Math.max(0, operation.completedAt.getTime() - operation.startedAt.getTime())
        : 0,
    queuedAt: operation.createdAt || null,
    startedAt: operation.startedAt || null,
    completedAt: operation.completedAt || null,
    bulkOperationId: operation.submissions?.[0]?.bulkOperationId || null,
    error: operation.errorMessage
      ? { code: operation.errorCode || "UNDO_OPERATION_FAILED", message: operation.errorMessage }
      : null,
  };
}

export class EditHistoryService {
  constructor(session, activePlan) {
    this.session = session;
    this.plan = activePlan?.name || "Basic";
  }

  getDateLimit() {
    const planDurations = {
      "Basic (Monthly)": 60,
      "Basic (Yearly)": 60,
      "Advanced (Monthly)": 90,
      "Advanced (Yearly)": 90,
      "Pro (Monthly)": 180,
      "Pro (Yearly)": 180,
    };

    const days = planDurations[this.plan] || 0;
    const date = new Date();
    date.setDate(date.getDate() - days);

    return { dateLimit: date, planLimit: days };
  }

  async getEditHistories({ type, search, cursor, limit = 10, lang }) {
    try {
      const editHistoryWhere =
        type === "Favorites"
          ? { isFavourite: true }
          : validTypes.includes(type)
            ? { type }
            : {};

      const operationWhere = {
        shop: this.session.shop,
        type: { in: ["BULK_EDIT", "SCHEDULED_EDIT"] },
        editHistory: { is: editHistoryWhere },
      };

      const limitNumber = Math.max(1, parseInt(limit, 10));

      let cursorFilter = {};
      if (cursor) {
        const decodedCursor = decodeHistoryCursor(cursor);
        let cursorRecord = decodedCursor;

        if (!cursorRecord) {
          cursorRecord = await prisma.merchantOperation.findFirst({
            where: {
              shop: this.session.shop,
              OR: [
                { id: cursor },
                { editHistory: { is: { id: cursor } } },
              ],
            },
            select: { id: true, createdAt: true },
          });
        }

        if (cursorRecord) {
          cursorFilter = {
            OR: [
              { createdAt: { lt: cursorRecord.createdAt } },
              {
                AND: [
                  { createdAt: cursorRecord.createdAt },
                  { id: { lt: cursorRecord.id } },
                ],
              },
            ],
          };
        }
      }

      const queryWhere =
        Object.keys(cursorFilter).length > 0
          ? {
              AND: [operationWhere, cursorFilter],
            }
          : operationWhere;

      const operations = await prisma.merchantOperation.findMany({
        where: queryWhere,
        select: {
          id: true,
          status: true,
          processedItems: true,
          totalItems: true,
          failedItems: true,
          errorCode: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
          failedAt: true,
          snapshotSetId: true,
          executionPlanId: true,
          intentId: true,
          updatedAt: true,
          createdAt: true,
          executions: {
            select: {
              executionKey: true,
              status: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
          submissions: {
            select: {
              bulkOperationId: true,
              status: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
          immutableSnapshots: {
            select: {
              id: true,
              mirrorBatchId: true,
              productCount: true,
              variantCount: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
          editHistory: {
            select: {
              id: true,
              operationId: true,
              title: true,
              editTime: true,
              shop: true,
              undo: true,
              error: true,
              batch: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limitNumber + 1,
      });

      const hasNextPage = operations.length > limitNumber;
      const edges = hasNextPage ? operations.slice(0, -1) : operations;

      const formattedData = edges
        .filter((operation) => Boolean(operation.editHistory))
        .map((operation) => {
          const projected = buildOperationProjection(
            operation,
            operation.editHistory,
            lang,
          );
          return projectEditHistoryStatus(projected);
        });

      const windowedTotal = hasNextPage ? limitNumber + 1 : formattedData.length;

      const returnData = {
        edges: formattedData,
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? encodeHistoryCursor(edges[edges.length - 1]) : null,
        },
        totalCount: windowedTotal,
        totalCountStrategy: "windowed_lower_bound",
      };

      return {
        ...returnData,
        ref: "Fetched edit histories successfully from database.",
      };
    } catch (error) {
      throw new Error("Error fetching history records: " + error.message);
    }
  }

  async getHistoryDetails(id, lang) {
    try {
      if (!id || id === "undefined" || id === "null") {
        throw new NotFoundError(
          `Invalid history ID format: ${id}`,
          "Invalid ID",
        );
      }

      const operation = await prisma.merchantOperation.findFirst({
        where: {
          shop: this.session.shop,
          type: { in: ["BULK_EDIT", "SCHEDULED_EDIT"] },
          OR: [
            { id },
            { editHistory: { is: { id } } },
            { editHistory: { is: { operationId: id } } },
          ],
        },
        select: {
          id: true,
          status: true,
          title: true,
          source: true,
          parentId: true,
          replayOfOperationId: true,
          snapshotSetId: true,
          executionPlanId: true,
          intentId: true,
          totalItems: true,
          processedItems: true,
          failedItems: true,
          startedAt: true,
          completedAt: true,
          failedAt: true,
          errorCode: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          executions: {
            select: {
              id: true,
              executionKey: true,
              status: true,
              attempt: true,
              poisoned: true,
              leaseOwner: true,
              leaseExpiresAt: true,
              heartbeatAt: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
          submissions: {
            select: {
              id: true,
              status: true,
              bulkOperationId: true,
              resultChecksum: true,
              resultsAppliedAt: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
          executionPartitions: {
            select: {
              id: true,
              ordinal: true,
              status: true,
              resultChecksum: true,
              completedAt: true,
              updatedAt: true,
            },
            orderBy: [{ ordinal: "asc" }, { id: "asc" }],
          },
          immutableSnapshots: {
            select: {
              id: true,
              intentId: true,
              mirrorBatchId: true,
              productCount: true,
              variantCount: true,
              targetHash: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
          children: {
            where: { type: "BULK_UNDO" },
            select: {
              id: true,
              status: true,
              totalItems: true,
              processedItems: true,
              failedItems: true,
              startedAt: true,
              completedAt: true,
              errorCode: true,
              errorMessage: true,
              createdAt: true,
              updatedAt: true,
              executions: {
                select: {
                  executionKey: true,
                  createdAt: true,
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
              },
              submissions: {
                select: {
                  bulkOperationId: true,
                  createdAt: true,
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
              },
              executionPartitions: {
                select: {
                  status: true,
                  ordinal: true,
                },
                orderBy: [{ ordinal: "asc" }, { id: "asc" }],
              },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
          editHistory: {
            select: {
              id: true,
              operationId: true,
              title: true,
              durationMs: true,
              editTime: true,
              createdAt: true,
              updatedAt: true,
              completedAt: true,
              error: true,
              batch: true,
              type: true,
              shop: true,
              rules: true,
              undo: true,
            },
          },
        },
      });

      if (!operation?.editHistory) {
        throw new NotFoundError(
          `History record ${id} not found`,
          "History not found",
        );
      }

      const history = operation.editHistory;
      const snapshotSet = operation.immutableSnapshots?.[0] || null;
      const undoOperation = operation.children?.[0] || null;
      const verificationSummary = await prisma.verificationResult.groupBy({
        by: ["verified"],
        where: {
          shop: this.session.shop,
          operationId: operation.id,
        },
        _count: { _all: true },
      });
      const verificationCounts = verificationSummary.reduce((acc, item) => {
        if (item.verified) acc.passed += Number(item?._count?._all || 0);
        else acc.failed += Number(item?._count?._all || 0);
        return acc;
      }, { passed: 0, failed: 0 });
      const runningReplay = await prisma.merchantOperation.findFirst({
        where: {
          shop: this.session.shop,
          replayOfOperationId: operation.id,
          status: { in: ACTIVE_OPERATION_STATUSES },
        },
        select: { id: true },
      });
      const rules = Array.isArray(history.rules) ? history.rules : [];
      const ruleField = getRuleFieldKey(rules);
      const operationCompleted = operation.status === "COMPLETED";
      const verificationPassed = verificationCounts.failed === 0;
      const immutableSnapshotExists = Boolean(snapshotSet?.id || operation.snapshotSetId);
      const noReplayRunning = !runningReplay;
      const noUndoRunning =
        !undoOperation || !ACTIVE_OPERATION_STATUSES.includes(undoOperation.status);
      const driftWithinThreshold = verificationPassed;
      const snapshotBatchStillAvailable = immutableSnapshotExists;
      const canUndo =
        operationCompleted &&
        verificationPassed &&
        immutableSnapshotExists &&
        noReplayRunning &&
        noUndoRunning &&
        driftWithinThreshold &&
        snapshotBatchStillAvailable;
      const undoBlockedReason = canUndo
        ? null
        : !operationCompleted
          ? "OPERATION_NOT_COMPLETED"
          : !verificationPassed
            ? "VERIFICATION_FAILED"
            : !immutableSnapshotExists
              ? "IMMUTABLE_SNAPSHOT_MISSING"
              : !noReplayRunning
                ? "REPLAY_ALREADY_RUNNING"
                : !noUndoRunning
                  ? "UNDO_ALREADY_RUNNING_OR_DONE"
                  : !snapshotBatchStillAvailable
                    ? "SNAPSHOT_BATCH_UNAVAILABLE"
                    : "DRIFT_THRESHOLD_EXCEEDED";

      const projected = buildOperationProjection(operation, {
        ...history,
        undo: buildUndoStateFromOperation(undoOperation),
        field:
          FIELD_TRANSLATIONS?.[ruleField]?.[lang] ??
          ruleField ??
          "unknown_field",
        type:
          EDIT_TYPES?.[history.type]?.[lang] ??
          history.type ??
          "unknown_type",
        canUndo,
        undoBlockedReason,
        targetSnapshotId: operation.snapshotSetId || snapshotSet?.id || null,
        mirrorBatchId: snapshotSet?.mirrorBatchId || null,
      }, lang);

      const returnData = projectEditHistoryStatus(projected);
      const undoSummaryBuckets = summarizeUndoOperation(undoOperation);

      returnData.supportStatus = {
        ...(returnData.supportStatus || {}),
        undoSummaryBuckets,
        operationLineage: {
          operationId: operation.id,
          parentId: operation.parentId || null,
          replayOfOperationId: operation.replayOfOperationId || null,
          undoOperationId: undoOperation?.id || null,
        },
        deterministicExecution: {
          snapshotSetId: operation.snapshotSetId || snapshotSet?.id || null,
          executionPlanId: operation.executionPlanId || null,
          intentId: operation.intentId || snapshotSet?.intentId || null,
          partitionCount: operation.executionPartitions.length,
          verification: verificationCounts,
        },
        undoSafety: {
          operationCompleted,
          verificationPassed,
          immutableSnapshotExists,
          noReplayRunning,
          noUndoRunning,
          driftWithinThreshold,
          snapshotBatchStillAvailable,
        },
      };

      return returnData;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new Error("Error fetching history details: " + error.message);
    }
  }

  async getHistoryEditChanges(id, page = 1, limit = 10) {
    try {
      if (!id || id === "undefined" || id === "null") {
        throw new NotFoundError(
          `Invalid history ID format: ${id}`,
          "Invalid ID",
        );
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const operation = await prisma.merchantOperation.findFirst({
        where: {
          shop: this.session.shop,
          OR: [
            { id },
            { editHistory: { is: { id } } },
            { editHistory: { is: { operationId: id } } },
          ],
        },
        select: {
          id: true,
          updatedAt: true,
          editHistory: {
            select: {
              id: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!operation?.editHistory) {
        throw new NotFoundError(
          `History record ${id} not found`,
          "History not found",
        );
      }

      const historyId = operation.editHistory.id;
      const cacheVersion = [
        HISTORY_PROJECTION_VERSION,
        operation.updatedAt?.getTime?.() || 0,
        operation.editHistory.updatedAt?.getTime?.() || 0,
      ].join(":");
      const cacheKey = `${this.session.shop}:historyChanges:${historyId}:v${cacheVersion}:page${pageNum}:limit${limitNum}`;
      const cacheData = await getCache(cacheKey);

      if (cacheData) {
        return {
          changes: cacheData.changes,
          currentPage: cacheData.currentPage,
          totalPages: cacheData.totalPages,
          totalCount: cacheData.totalCount,
          message: "Fetched history changes successfully from cache.",
        };
      }

      const totalCount = await prisma.changeRecord.count({
        where: {
          editHistoryId: historyId,
          shop: this.session.shop,
        },
      });

      const totalPages = Math.ceil(totalCount / limitNum);

      const changes = await prisma.changeRecord.findMany({
        where: {
          editHistoryId: historyId,
          shop: this.session.shop,
        },
        select: {
          id: true,
          title: true,
          productFieldChanges: true,
          variantFieldChanges: true,
          status: true,
          image: true,
          productId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limitNum,
      });

      const result = {
        changes,
        currentPage: pageNum,
        totalPages,
        totalCount,
        message: "Fetched history changes successfully.",
      };

      await setCache(cacheKey, result, 300);
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new Error("Error fetching history changes: " + error.message);
    }
  }
}
