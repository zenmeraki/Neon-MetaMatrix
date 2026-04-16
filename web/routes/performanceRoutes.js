import express from "express";
import {
  frontendWebVitalTotal,
  frontendWebVitalValue,
} from "../utils/metricsUtils.js";
import logger from "../utils/loggerUtils.js";

const router = express.Router();

const ALLOWED_METRICS = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);
const ALLOWED_RATINGS = new Set(["good", "needs-improvement", "poor"]);

function normalizeMetricPayload(body = {}) {
  const name = String(body.name || "").toUpperCase();
  const value = Number(body.value);
  const rating = ALLOWED_RATINGS.has(body.rating) ? body.rating : "unknown";
  const navigationType = String(body.navigationType || "unknown").slice(0, 40);

  if (!ALLOWED_METRICS.has(name)) {
    throw new Error("Unsupported Web Vital metric");
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Invalid Web Vital value");
  }

  return {
    id: String(body.id || "").slice(0, 120),
    name,
    value,
    rating,
    navigationType,
    page: String(body.page || "").slice(0, 300),
    visibilityState: String(body.visibilityState || "").slice(0, 40),
    effectiveConnectionType: String(body.effectiveConnectionType || "").slice(0, 40),
  };
}

router.post("/web-vitals", (req, res) => {
  const shop = res.locals.shopify?.session?.shop || "unknown";
  const metrics = Array.isArray(req.body?.metrics) ? req.body.metrics : [req.body];
  const normalizedMetrics = metrics.slice(0, 20).map(normalizeMetricPayload);

  for (const metric of normalizedMetrics) {
    const labels = {
      shop,
      metric: metric.name,
      rating: metric.rating,
      navigationType: metric.navigationType,
    };

    frontendWebVitalTotal.inc(labels);
    frontendWebVitalValue.observe(labels, metric.value);
  }

  logger.info("Frontend Web Vitals received", {
    requestId: res.getHeader("x-request-id"),
    shop,
    count: normalizedMetrics.length,
    metrics: normalizedMetrics,
  });

  res.status(204).end();
});

export default router;
