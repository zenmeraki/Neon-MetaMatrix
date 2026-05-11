import { assertShadowExternalCallsAllowed } from "../../services/shadowReadOnlyGuardService.js";

const DEFAULT_QUEUE_WAITING_LIMIT = 5_000;

export async function assertQueueBackpressure(
  queue,
  limit = DEFAULT_QUEUE_WAITING_LIMIT,
) {
  const waiting = await queue.getWaitingCount();

  if (waiting > limit) {
    const error = new Error("QUEUE_OVERLOADED");
    error.code = "QUEUE_OVERLOADED";
    error.waiting = waiting;
    error.limit = limit;
    throw error;
  }
}

export function applyQueueBackpressure(queue, limit = DEFAULT_QUEUE_WAITING_LIMIT) {
  const add = queue.add.bind(queue);

  queue.add = async (...args) => {
    const jobData = args?.[1] && typeof args[1] === "object" ? args[1] : null;
    const executionContext =
      jobData?.executionContext && typeof jobData.executionContext === "object"
        ? jobData.executionContext
        : null;
    assertShadowExternalCallsAllowed(
      executionContext,
      `queue_add.${queue?.name || "unknown"}`,
    );
    await assertQueueBackpressure(queue, limit);
    return add(...args);
  };

  return queue;
}
