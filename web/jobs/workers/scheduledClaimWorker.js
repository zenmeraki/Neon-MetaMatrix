import { scheduledDispatchQueue } from "../queues/scheduledDispatchQueue.js";
import { createWorker } from "./createWorker.js";
import { scheduledEditService } from "../../services/scheduledEditService.js";

export const scheduledClaimWorker = createWorker(
  "scheduled.claim",
  async () => {
    const claimedRuns = await scheduledEditService.claimDueRuns({
      limit: 50,
    });

    for (const run of claimedRuns) {
      await scheduledDispatchQueue.add(
        "scheduled.dispatch",
        {
          shop: run.shop,
          scheduledRunId: run.id,
        },
        {
          jobId: `scheduled:dispatch:${run.shop}:${run.id}`,
          priority: 4,
        },
      );
    }
  },
  {
    concurrency: 1,
  },
);
