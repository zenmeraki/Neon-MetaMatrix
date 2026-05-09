import {
  automationQueue,
  buildAutomationJobId,
} from "../../jobs/queues/automationQueue.js";

export async function enqueueAutomationAfterSync({ shop, mirrorBatchId }) {
  await automationQueue.add(
    "trigger-automation",
    {
      shop,
      triggerType: "ON_SYNC_COMPLETED",
      mirrorBatchId,
      triggerReason: "MIRROR_SYNC_COMPLETED",
    },
    {
      jobId: buildAutomationJobId({
        shop,
        triggerType: "ON_SYNC_COMPLETED",
        mirrorBatchId,
      }),
    },
  );
}
