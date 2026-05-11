import { prisma } from "../config/database.js";
import logger from "../utils/loggerUtils.js";

const DEFAULT_SLOW_QUERY_MS = 100;

export const databaseMaintenanceService = {
  async analyzeCoreTables() {
    await prisma.$executeRawUnsafe('ANALYZE "Product"');
    await prisma.$executeRawUnsafe('ANALYZE "Variant"');
    await prisma.$executeRawUnsafe('ANALYZE "TargetSnapshotSet"');
    await prisma.$executeRawUnsafe('ANALYZE "MerchantOperation"');
    await prisma.$executeRawUnsafe('ANALYZE "OperationExecution"');
    await prisma.$executeRawUnsafe('ANALYZE "OperationSubmission"');

    logger.info("Database ANALYZE completed for core operational tables");
    return {
      analyzed: [
        "Product",
        "Variant",
        "TargetSnapshotSet",
        "MerchantOperation",
        "OperationExecution",
        "OperationSubmission",
      ],
    };
  },

  async reindexCoreIndexesConcurrently() {
    const indexes = [
      "TargetSnapshotSet_operationId_entityId_idx",
      "MerchantOperation_shop_type_status_createdAt_idx",
      "OperationExecution_shop_status_idx",
      "OperationSubmission_shop_status_idx",
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

  async findScheduledExportIntegrityIssues({ olderThanMinutes = 30 } = {}) {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

    const [
      stuckProcessingWithoutExportJob,
      queuedExportJobsWithoutQueueSignal,
      completedExportJobRunMismatch,
      dueScheduledExportsWithoutPendingRun,
    ] = await Promise.all([
      prisma.$queryRawUnsafe(
        `
          SELECT id, shop, "scheduledExportId", "startedAt", status
          FROM "ScheduledExportRun"
          WHERE status = 'PROCESSING'
            AND "exportJobId" IS NULL
            AND "startedAt" < $1
          ORDER BY "startedAt" ASC
          LIMIT 200
        `,
        cutoff,
      ),
      prisma.$queryRawUnsafe(
        `
          SELECT ej.id, ej.shop, ej."scheduledExportRunId", ej."executionState", ej."updatedAt"
          FROM "ExportJob" ej
          LEFT JOIN "ScheduledExportRun" ser
            ON ser.id = ej."scheduledExportRunId"
          WHERE ej."executionState" = 'queued'
            AND ej."scheduledExportRunId" IS NOT NULL
            AND (ser.id IS NULL OR ser.status NOT IN ('PROCESSING','SUCCESS'))
          ORDER BY ej."updatedAt" ASC
          LIMIT 200
        `,
      ),
      prisma.$queryRawUnsafe(
        `
          SELECT ej.id, ej.shop, ej."scheduledExportRunId", ej.status, ser.status AS run_status
          FROM "ExportJob" ej
          JOIN "ScheduledExportRun" ser
            ON ser.id = ej."scheduledExportRunId"
          WHERE ej.status = 'COMPLETED'
            AND ser.status <> 'SUCCESS'
          ORDER BY ej."updatedAt" DESC
          LIMIT 200
        `,
      ),
      prisma.$queryRawUnsafe(
        `
          SELECT se.id, se.shop, se."nextRunAt", se.status
          FROM "ScheduledExport" se
          WHERE se."isDeleted" = false
            AND se.status = 'ACTIVE'
            AND se."nextRunAt" <= now()
            AND NOT EXISTS (
              SELECT 1
              FROM "ScheduledExportRun" ser
              WHERE ser."scheduledExportId" = se.id
                AND ser.shop = se.shop
                AND ser.status = 'PENDING'
            )
          ORDER BY se."nextRunAt" ASC
          LIMIT 200
        `,
      ),
    ]);

    const result = {
      stuckProcessingWithoutExportJob,
      queuedExportJobsWithoutQueueSignal,
      completedExportJobRunMismatch,
      dueScheduledExportsWithoutPendingRun,
    };

    logger.warn("Scheduled export integrity check completed", {
      counts: {
        stuckProcessingWithoutExportJob: stuckProcessingWithoutExportJob.length,
        queuedExportJobsWithoutQueueSignal:
          queuedExportJobsWithoutQueueSignal.length,
        completedExportJobRunMismatch: completedExportJobRunMismatch.length,
        dueScheduledExportsWithoutPendingRun:
          dueScheduledExportsWithoutPendingRun.length,
      },
    });

    return result;
  },
};
