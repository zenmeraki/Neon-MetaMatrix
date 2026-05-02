import client from "prom-client";

// Collect Node.js process and system metrics automatically
client.collectDefaultMetrics();

// Define metrics for product operations
export const productFetchDuration = new client.Histogram({
  name: "product_fetch_duration_seconds",
  help: "Time taken to fetch products from Shopify API or DB",
  labelNames: ["shop"],
  buckets: [0.1, 0.3, 0.5, 1, 2, 5],
});

export const productFetchTotal = new client.Counter({
  name: "product_fetch_total",
  help: "Total number of product fetch operations",
  labelNames: ["shop", "status"], // success or failed
});

export const productFetchErrorsTotal = new client.Counter({
  name: "product_fetch_errors_total",
  help: "Total number of failed product fetch operations",
  labelNames: ["shop", "errorType"],
});

export const operationsStartedTotal = new client.Counter({
  name: "operations_started_total",
  help: "Total number of store operations started",
  labelNames: ["shop", "operationType"],
});

export const operationsFailedTotal = new client.Counter({
  name: "operations_failed_total",
  help: "Total number of store operations failed",
  labelNames: ["shop", "operationType", "reason"],
});

export const operationExecutionDuration = new client.Histogram({
  name: "operation_execution_duration_seconds",
  help: "Store operation execution duration",
  labelNames: ["shop", "operationType", "status"],
  buckets: [1, 5, 15, 30, 60, 120, 300, 900, 1800, 3600],
});

export const shopifyErrorsTotal = new client.Counter({
  name: "shopify_errors_total",
  help: "Total number of Shopify API or webhook errors",
  labelNames: ["shop", "source", "errorType"],
});

export const retryCountTotal = new client.Counter({
  name: "retry_count_total",
  help: "Total number of job retries",
  labelNames: ["shop", "queueName"],
});

export const queueDepthGauge = new client.Gauge({
  name: "queue_depth",
  help: "Current queue depth by queue and state",
  labelNames: ["queueName", "state"],
});

export function recordOperationStarted({ shop = "unknown", operationType = "unknown" } = {}) {
  operationsStartedTotal.inc({ shop, operationType });
}

export function recordOperationFailed({
  shop = "unknown",
  operationType = "unknown",
  reason = "UNKNOWN",
} = {}) {
  operationsFailedTotal.inc({ shop, operationType, reason });
}

export function recordOperationDuration({
  shop = "unknown",
  operationType = "unknown",
  status = "unknown",
  startedAt,
} = {}) {
  const started = startedAt ? new Date(startedAt).getTime() : Date.now();
  const seconds = Math.max(0, (Date.now() - started) / 1000);
  operationExecutionDuration.observe({ shop, operationType, status }, seconds);
}

export function recordShopifyError({
  shop = "unknown",
  source = "unknown",
  errorType = "UNKNOWN",
} = {}) {
  shopifyErrorsTotal.inc({ shop, source, errorType });
}

export function recordRetry({ shop = "unknown", queueName = "unknown" } = {}) {
  retryCountTotal.inc({ shop, queueName });
}

export async function observeQueueDepth(queueName, queue) {
  const counts = await queue.getJobCounts(
    "waiting",
    "delayed",
    "active",
    "failed",
  );

  for (const [state, count] of Object.entries(counts)) {
    queueDepthGauge.set({ queueName, state }, count);
  }

  return counts;
}

/**
 * Middleware/handler for exposing Prometheus metrics
 */
export const metricsEndpoint = async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  const metrics = await client.register.metrics();
  res.end(metrics);
};

export default {
  productFetchDuration,
  productFetchTotal,
  productFetchErrorsTotal,
  operationsStartedTotal,
  operationsFailedTotal,
  operationExecutionDuration,
  shopifyErrorsTotal,
  retryCountTotal,
  queueDepthGauge,
  recordOperationStarted,
  recordOperationFailed,
  recordOperationDuration,
  recordShopifyError,
  recordRetry,
  observeQueueDepth,
  metricsEndpoint,
};
