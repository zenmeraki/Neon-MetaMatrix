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
    await assertQueueBackpressure(queue, limit);
    return add(...args);
  };

  return queue;
}
