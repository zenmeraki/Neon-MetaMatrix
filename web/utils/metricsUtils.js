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

export const frontendWebVitalTotal = new client.Counter({
  name: "frontend_web_vital_total",
  help: "Total frontend Web Vitals reports received",
  labelNames: ["shop", "metric", "rating", "navigationType"],
});

export const frontendWebVitalValue = new client.Histogram({
  name: "frontend_web_vital_value",
  help: "Frontend Web Vitals values. CLS is unitless; other metrics are milliseconds.",
  labelNames: ["shop", "metric", "rating", "navigationType"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 4, 10, 100, 300, 800, 1800, 2500, 4000, 8000],
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
  frontendWebVitalTotal,
  frontendWebVitalValue,
  metricsEndpoint,
};
