import { recordMirrorAnomaly } from "../services/mirrorAnomalyService.js";

export function getJobAttempt(job) {
  return Number(job?.attemptsMade || 0) + 1;
}

export function isRetryExhausted(job) {
  const attempts = Number(job?.opts?.attempts || 1);
  return getJobAttempt(job) >= attempts;
}

export async function recordRetryExhausted({
  job,
  shop,
  worker,
  queue,
  entityType = null,
  entityId = null,
  executionId = null,
  message,
  details = null,
}) {
  if (!shop || !message) {
    return;
  }

  await recordMirrorAnomaly({
    shop,
    severity: "high",
    type: "worker_retry_exhausted",
    entityType,
    entityId,
    message,
    details: {
      worker,
      queue,
      jobId: job?.id || null,
      attempt: getJobAttempt(job),
      maxAttempts: Number(job?.opts?.attempts || 1),
      executionId,
      ...(details || {}),
    },
  }).catch(() => {});
}
