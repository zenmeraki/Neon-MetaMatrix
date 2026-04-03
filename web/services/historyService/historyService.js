import { NotFoundError } from "../../utils/errorUtils.js";
import { EDIT_TYPES, FIELD_TRANSLATIONS } from "../../Config/constants.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { prisma } from "../../config/database.js";
import { projectEditHistoryStatus } from "../historyStatusProjectionService.js";
import {
  enrichEditHistoriesWithTargetingMetadata,
  getEditHistoryTargetingMetadata,
} from "../historyTargetingMetadataService.js";

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
      const where = {
        shop: this.session.shop,
        ...(type === "Favorites"
          ? { isFavourite: true }
          : validTypes.includes(type)
          ? { type }
          : {}),
      };

      const limitNumber = Math.max(1, parseInt(limit, 10));

      let cursorFilter = {};
      if (cursor) {
        const cursorRecord = await prisma.editHistory.findFirst({
          where: {
            id: cursor,
            shop: this.session.shop,
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
              AND: [where, cursorFilter],
            }
          : where;

      const records = await prisma.editHistory.findMany({
        where: queryWhere,
        select: {
          id: true,
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
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limitNumber + 1,
      });

      const hasNextPage = records.length > limitNumber;
      const edges = hasNextPage ? records.slice(0, -1) : records;

      const enrichedEdges = await enrichEditHistoriesWithTargetingMetadata(edges);
      const formattedData = enrichedEdges.map((record) =>
        projectEditHistoryStatus({
          ...record,
          title: getLocalizedJsonText(record.title, lang),
        }),
      );

      const totalCount = await prisma.editHistory.count({
        where,
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
          id,
          shop: this.session.shop,
        },
        select: {
          id: true,
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
          undo: true,
          type: true,
          shop: true,
          rules: true,
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

      const targetingMetadata = await getEditHistoryTargetingMetadata(history.id);
      const returnData = projectEditHistoryStatus({
        ...history,
        ...targetingMetadata,
        title: getLocalizedJsonText(history.title, lang),
        field:
          FIELD_TRANSLATIONS?.[rule?.field]?.[lang] ??
          rule?.field ??
          "unknown_field",
        type:
          EDIT_TYPES?.[history.type]?.[lang] ??
          history.type ??
          "unknown_type",
      });

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
