import logger from "../../utils/loggerUtils.js";
import { runOperationLeaseScavengerPass } from "../../services/operationLeaseScavengerService.js";
import {
  OPERATION_QUEUE_NAMES,
  addShopScopedJob,
  buildOperationJobId,
  createOperationWorker,
} from "../queues/operationQueueRegistry.js";

const SCAVENGE_INTERVAL_MS = Math.max(
  Number(process.env.LEASE_SCAVENGER_INTERVAL_MS || 5 * 60 * 1000),
  60_000,
);

const operationLeaseScavengerWorker = {
  interval: null,
  worker: createOperationWorker(
    OPERATION_QUEUE_NAMES.OPERATION_REPAIR,
    async () => runOperationLeaseScavengerPass(),
    { concurrency: 1 },
  ),

  start() {
    if (this.interval) return this;

    this.interval = setInterval(() => {
      const runAt = new Date();
      const minuteBucket = runAt.toISOString().slice(0, 16);

      addShopScopedJob(
        OPERATION_QUEUE_NAMES.OPERATION_REPAIR,
        "lease-scavenger",
        { shop: "all", operationId: "operation-lease-scavenger", minuteBucket },
        {
          jobId: buildOperationJobId(OPERATION_QUEUE_NAMES.OPERATION_REPAIR, {
            minuteBucket,
            mode: "lease_scavenger",
          }),
        },
      ).catch((error) => {
        logger.error("Operation lease scavenger enqueue failed", {
          message: error.message,
        });
      });
    }, SCAVENGE_INTERVAL_MS);

    this.interval.unref?.();
    return this;
  },

  stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  },
};

if (String(process.env.DISABLE_LEASE_SCAVENGER_AUTOSTART || "") !== "true") {
  operationLeaseScavengerWorker.start();
}

export { operationLeaseScavengerWorker };
export default operationLeaseScavengerWorker;

