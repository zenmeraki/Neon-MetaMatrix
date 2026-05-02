import { prisma } from "../config/database.js";
import logger from "../utils/loggerUtils.js";

const DEFAULT_SLOW_QUERY_MS = 100;

export const databaseMaintenanceService = {
  async analyzeCoreTables() {
    await prisma.$executeRawUnsafe('ANALYZE "Product"');
    await prisma.$executeRawUnsafe('ANALYZE "Variant"');
    await prisma.$executeRawUnsafe('ANALYZE "TargetSnapshotSet"');
    await prisma.$executeRawUnsafe('ANALYZE "StoreOperation"');

    logger.info("Database ANALYZE completed for core operational tables");
    return { analyzed: ["Product", "Variant", "TargetSnapshotSet", "StoreOperation"] };
  },

  async reindexCoreIndexesConcurrently() {
    const indexes = [
      "TargetSnapshotSet_operationId_entityId_idx",
      "StoreOperation_shop_status_idx",
      "StoreOperation_shop_heartbeatAt_idx",
    ];

    for (const indexName of indexes) {
      await prisma.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY "${indexName}"`);
    }

    logger.info("Database REINDEX completed for core operational indexes", {
      indexes,
    });
    return { reindexed: indexes };
  },

  async listSlowQueries({ minMs = DEFAULT_SLOW_QUERY_MS, limit = 25 } = {}) {
    try {
      return await prisma.$queryRawUnsafe(
        `
          SELECT query, calls, mean_exec_time, max_exec_time, total_exec_time
          FROM pg_stat_statements
          WHERE mean_exec_time > $1
          ORDER BY mean_exec_time DESC
          LIMIT $2
        `,
        minMs,
        limit,
      );
    } catch (error) {
      logger.warn("Slow query listing unavailable", {
        message: error.message,
      });
      return [];
    }
  },
};
