import { prisma } from "../../config/database.js";
import logger from "../../utils/loggerUtils.js";
import { alertingService } from "../../services/operationalAlertService.js";
import {
  OPERATION_QUEUE_NAMES,
  addShopScopedJob,
  buildOperationJobId,
  createOperationWorker,
} from "../Queues/operationQueueRegistry.js";

const REPAIR_INTERVAL_MS = 2 * 60 * 1000;
const STALE_OPERATION_MS = 2 * 60 * 1000;

async function repairStaleStoreOperations() {
  const expired = await prisma.storeOperation.findMany({
    where: {
      status: "RUNNING",
      heartbeatAt: {
        lt: new Date(Date.now() - STALE_OPERATION_MS),
      },
    },
    select: {
      id: true,
      shop: true,
    },
  });

  if (!expired.length) {
    return { expiredCount: 0 };
  }

  const expiredIds = expired.map((operation) => operation.id);

  await prisma.storeOperation.updateMany({
    where: {
      id: { in: expiredIds },
      status: "RUNNING",
    },
    data: {
      status: "EXPIRED",
      failedAt: new Date(),
      errorCode: "OPERATION_HEARTBEAT_EXPIRED",
      errorMessage: "Operation heartbeat expired.",
    },
  });

  await Promise.all(
    expired.map((operation) =>
      prisma.storeOperationalState.updateMany({
        where: {
          shop: operation.shop,
          activeWriteOperationId: operation.id,
        },
        data: {
          activeWriteOperationId: null,
        },
      }),
    ),
  );

  logger.warn("Expired stale store operations", {
    expiredCount: expired.length,
    operationIds: expiredIds,
  });

  if (expired.length >= Number(process.env.LEASE_EXPIRY_SPIKE_THRESHOLD || 5)) {
    alertingService.leaseExpirySpike({
      expiredCount: expired.length,
      operationIds: expiredIds,
    });
  }

  return { expiredCount: expired.length };
}

const staleStoreOperationRepairWorker = {
  interval: null,
  worker: createOperationWorker(
    OPERATION_QUEUE_NAMES.OPERATION_REPAIR,
    async () => repairStaleStoreOperations(),
    { concurrency: 1 },
  ),

  start() {
    if (this.interval) return this;

    this.interval = setInterval(() => {
      addShopScopedJob(
        OPERATION_QUEUE_NAMES.OPERATION_REPAIR,
        "repair",
        { shop: "all", operationId: "stale-operation-repair" },
        {
          jobId: buildOperationJobId(OPERATION_QUEUE_NAMES.OPERATION_REPAIR, {
            runAt: new Date(),
          }),
        },
      ).catch((error) => {
        logger.error("Stale store operation repair failed", {
          message: error.message,
        });
      });
    }, REPAIR_INTERVAL_MS);

    this.interval.unref?.();
    return this;
  },

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  },
};

staleStoreOperationRepairWorker.start();

export { repairStaleStoreOperations, staleStoreOperationRepairWorker };
export default staleStoreOperationRepairWorker;
