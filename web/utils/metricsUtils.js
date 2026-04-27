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
  metricsEndpoint,
};
