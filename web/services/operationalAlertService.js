import { prisma } from "../config/database.js";
import logger from "../utils/loggerUtils.js";

const DEFAULT_FAILURE_RATE_THRESHOLD = 0.1;
const DEFAULT_WINDOW_MINUTES = 15;

function alertLog(level, message, details) {
  const payload = {
    alert: message,
    ...details,
  };

  if (level === "error") {
    logger.error(message, payload);
  } else {
    logger.warn(message, payload);
  }
}

export const alertingService = {
  async evaluateOperationFailureRate({
    shop,
    operationType,
    windowMinutes = DEFAULT_WINDOW_MINUTES,
    threshold = DEFAULT_FAILURE_RATE_THRESHOLD,
  } = {}) {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const where = {
      createdAt: { gte: since },
      ...(shop && shop !== "unknown" ? { shop } : {}),
      ...(operationType ? { type: operationType } : {}),
    };

    const merchantWhere = {
      createdAt: where.createdAt,
      ...(where.shop ? { shop: where.shop } : {}),
      ...(where.type ? { type: where.type } : {}),
    };

    const [total, failed] = await Promise.all([
      prisma.merchantOperation.count({ where: merchantWhere }),
      prisma.merchantOperation.count({
        where: {
          ...merchantWhere,
          status: "FAILED",
        },
      }),
    ]);

    const failureRate = total ? failed / total : 0;
    if (total >= 5 && failureRate > threshold) {
      alertLog("error", "operation failure rate threshold exceeded", {
        shop,
        operationType,
        total,
        failed,
        failureRate,
        threshold,
      });
    }

    return { total, failed, failureRate };
  },

  syncFailure({ shop, syncRunId, error }) {
    alertLog("error", "sync failure", {
      shop,
      syncRunId,
      message: error?.message || String(error || ""),
    });
  },

  queueStuck({ queueName, counts }) {
    alertLog("error", "queue stuck", {
      queueName,
      counts,
    });
  },

  leaseExpirySpike({ expiredCount, operationIds }) {
    alertLog("error", "lease expiry spike", {
      expiredCount,
      operationIds,
    });
  },
};
