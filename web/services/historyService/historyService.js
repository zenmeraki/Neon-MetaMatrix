import { NotFoundError } from "../../utils/errorUtils.js";
import { EDIT_TYPES, FIELD_TRANSLATIONS } from "../../config/constants.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { prisma } from "../../config/database.js";
import { projectEditHistoryStatus } from "../historyStatusProjectionService.js";

const validTypes = ["Manual edit", "Scheduled edit", "Recurring edit", "Automatic rule"];

function getLocalizedJsonText(value, lang = "en") {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    return String(value);
  }

  return value[lang] ?? value.en ?? Object.values(value)[0] ?? null;
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
        const cursorRecord = await prisma.merchantOperation.findFirst({
          where: {
            shop: this.session.shop,
            OR: [
              { id: cursor },
              { editHistory: { is: { id: cursor } } },
            ],
          },
          select: { id: true, createdAt: true },
        });

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
          updatedAt: true,
          createdAt: true,
          editHistory: {
            select: {
              id: true,
              operationId: true,
              title: true,
              status: true,
              executionState: true,
              executionIdentity: true,
              targetSnapshotCount: true,
              targetMirrorBatchId: true,
              failureStage: true,
              processedCount: true,
              totalItems: true,
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
          const record = operation.editHistory;
        const projected = {
          ...record,
          operationId: operation.id,
          status: String(operation.status || "unknown").toLowerCase(),
          processedCount: Number(operation.processedItems || 0),
          totalItems: Number(operation.totalItems || 0),
          operation: {
            status: operation.status,
            processedItems: operation.processedItems,
            totalItems: operation.totalItems,
            failedItems: operation.failedItems,
            errorCode: operation.errorCode,
            errorMessage: operation.errorMessage,
            updatedAt: operation.updatedAt,
          },
          title: getLocalizedJsonText(record.title, lang),
        };
        return projectEditHistoryStatus(projected);
      });

      const totalCount = await prisma.merchantOperation.count({
        where: operationWhere,
      });

      const returnData = {
        edges: formattedData,
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? edges[edges.length - 1].id : null,
        },
        totalCount,
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

      const history = await prisma.editHistory.findFirst({
        where: {
          OR: [
            { id },
            { operationId: id },
          ],
          shop: this.session.shop,
        },
        select: {
          id: true,
          operationId: true,
          title: true,
          status: true,
          executionState: true,
          executionIdentity: true,
          targetSnapshotCount: true,
          targetMirrorBatchId: true,
          failureStage: true,
          durationMs: true,
          processedCount: true,
          totalItems: true,
          editTime: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          bulkOperationId: true,
          error: true,
          batch: true,
          undo: true,
          type: true,
          shop: true,
          rules: true,
          operation: {
            select: {
              status: true,
              processedItems: true,
              totalItems: true,
              failedItems: true,
              startedAt: true,
              completedAt: true,
              failedAt: true,
              errorCode: true,
              errorMessage: true,
            },
          },
        },
      });

      if (!history) {
        throw new NotFoundError(
          `History record ${id} not found`,
          "History not found",
        );
      }

      const rules = Array.isArray(history.rules) ? history.rules : [];
      const rule = rules[0] ?? { field: "csv" };
      const operationStatus = String(history.operation?.status || "unknown").toLowerCase();
      const undoState = String(
        history?.undo?.status ?? history?.undoStatusSummary?.key ?? "idle",
      ).toLowerCase();
      const undoAllowed = history?.undo == null ? true : history.undo.allowed === true;
      const canUndo =
        operationStatus === "completed" &&
        undoAllowed &&
        ["idle", "failed", "undo_failed"].includes(undoState);
      const undoBlockedReason = canUndo
        ? null
        : !undoAllowed
          ? "UNDO_NOT_ALLOWED"
          : operationStatus !== "completed"
            ? "OPERATION_NOT_COMPLETED"
            : "UNDO_ALREADY_RUNNING_OR_DONE";
      const targetSnapshotId =
        typeof history.batch?.sourceTargetSnapshotId === "string"
          ? history.batch.sourceTargetSnapshotId
          : null;

      const returnData = projectEditHistoryStatus({
        ...history,
        status: history.operation?.status
          ? String(history.operation.status).toLowerCase()
          : "unknown",
        processedCount:
          typeof history.operation?.processedItems === "number"
            ? history.operation.processedItems
            : 0,
        totalItems:
          typeof history.operation?.totalItems === "number"
            ? history.operation.totalItems
            : 0,
        completedAt: history.operation?.completedAt || history.completedAt,
        title: getLocalizedJsonText(history.title, lang),
        field:
          FIELD_TRANSLATIONS?.[rule?.field]?.[lang] ??
          rule?.field ??
          "unknown_field",
        type:
          EDIT_TYPES?.[history.type]?.[lang] ??
          history.type ??
          "unknown_type",
        canUndo,
        undoBlockedReason,
        targetSnapshotId,
        mirrorBatchId: history.targetMirrorBatchId || null,
      });

      const undoExecutionId =
        history?.undo?.executionIdentity || history?.executionIdentity || null;

      let undoSummaryBuckets = null;
      if (undoExecutionId) {
        const undoRequest = await prisma.undoRequest.findFirst({
          where: {
            shop: this.session.shop,
            executionId: undoExecutionId,
          },
          select: {
            id: true,
            status: true,
            safeCount: true,
            conflictCount: true,
            skippedCount: true,
          },
        });

        if (undoRequest?.id) {
          const grouped = await prisma.undoTarget.groupBy({
            by: ["status"],
            where: {
              shop: this.session.shop,
              undoRequestId: undoRequest.id,
            },
            _count: { _all: true },
          });

          const counts = grouped.reduce((acc, item) => {
            acc[item.status] = Number(item?._count?._all || 0);
            return acc;
          }, {});

          undoSummaryBuckets = {
            undoRequestId: undoRequest.id,
            undoRequestStatus: undoRequest.status || null,
            safe: Number(counts.SAFE || 0),
            restored: Number(counts.RESTORED || 0),
            conflict: Number(counts.CONFLICT || 0),
            failed: Number(counts.FAILED || 0),
            skipped: Number(counts.SKIPPED || 0),
            dispatched: Number(counts.DISPATCHED || 0),
            pending: Number(counts.PENDING || 0),
            total:
              Number(counts.SAFE || 0) +
              Number(counts.RESTORED || 0) +
              Number(counts.CONFLICT || 0) +
              Number(counts.FAILED || 0) +
              Number(counts.SKIPPED || 0) +
              Number(counts.DISPATCHED || 0) +
              Number(counts.PENDING || 0),
            safeCount: Number(undoRequest.safeCount || 0),
            conflictCount: Number(undoRequest.conflictCount || 0),
            skippedCount: Number(undoRequest.skippedCount || 0),
          };
        }
      }

      returnData.supportStatus = {
        ...(returnData.supportStatus || {}),
        undoSummaryBuckets,
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

      const cacheKey = `${this.session.shop}:historyChanges:${id}:page${pageNum}:limit${limitNum}`;
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

      const history = await prisma.editHistory.findFirst({
        where: {
          id,
          shop: this.session.shop,
        },
        select: { id: true },
      });

      if (!history) {
        throw new NotFoundError(
          `History record ${id} not found`,
          "History not found",
        );
      }

      const totalCount = await prisma.changeRecord.count({
        where: {
          editHistoryId: id,
          shop: this.session.shop,
        },
      });

      const totalPages = Math.ceil(totalCount / limitNum);

      const changes = await prisma.changeRecord.findMany({
        where: {
          editHistoryId: id,
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
        orderBy: {
          createdAt: "desc",
        },
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
