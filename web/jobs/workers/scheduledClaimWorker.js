import { scheduledDispatchQueue } from "../queues/scheduledDispatchQueue.js";
import { createWorker } from "./createWorker.js";
import { scheduledEditService } from "../../services/scheduledEditService.js";
import logger from "../../utils/loggerUtils.js";

export const scheduledClaimWorker = createWorker(
  "scheduled.claim",
  async (job) => {
    const claimedRuns = await scheduledEditService.claimDueRuns({
      limit: 50,
      claimJobId: job?.id || null,
    });

    let enqueued = 0;

    for (const run of claimedRuns) {
      if (!run?.shop || !run?.id) {
        logger.warn("Scheduled claim worker skipped malformed claimed run", {
          worker: "scheduledClaimWorker",
          jobId: job?.id,
          run,
        });
        continue;
      }

      const dispatchJobId = `scheduled:dispatch:${run.shop}:${run.id}`;

      await scheduledDispatchQueue.add(
        "scheduled.dispatch",
        {
          shop: run.shop,
          scheduledRunId: run.id,
        },
        {
          jobId: dispatchJobId,
          priority: 4,
        },
      );

      enqueued += 1;
    }

    logger.info("Scheduled claim worker completed", {
      worker: "scheduledClaimWorker",
      jobId: job?.id,
      claimed: claimedRuns.length,
      enqueued,
    });

    return {
      claimed: claimedRuns.length,
      enqueued,
    };
  },
  {
    concurrency: 1,
  },
);
