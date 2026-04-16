import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

const ENDPOINT = "/api/performance/web-vitals";
const DEFAULT_SAMPLE_RATE = 1;
const FLUSH_DELAY_MS = 1_000;
const queue = [];
let flushTimer = null;

function readSampleRate() {
  const configured = Number(import.meta.env.VITE_WEB_VITALS_SAMPLE_RATE);

  if (!Number.isFinite(configured)) {
    return DEFAULT_SAMPLE_RATE;
  }

  return Math.min(1, Math.max(0, configured));
}

function getConnectionType() {
  return (
    navigator.connection?.effectiveType ||
    navigator.mozConnection?.effectiveType ||
    navigator.webkitConnection?.effectiveType ||
    "unknown"
  );
}

function buildPayload(metric) {
  return {
    id: metric.id,
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    navigationType: metric.navigationType || "unknown",
    page: window.location.pathname,
    visibilityState: document.visibilityState,
    effectiveConnectionType: getConnectionType(),
  };
}

function scheduleIdle(callback) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: FLUSH_DELAY_MS });
    return;
  }

  window.setTimeout(callback, FLUSH_DELAY_MS);
}

function flushMetrics() {
  flushTimer = null;

  if (queue.length === 0) {
    return;
  }

  const metrics = queue.splice(0, queue.length);
  const body = JSON.stringify({ metrics });

  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      ENDPOINT,
      new Blob([body], { type: "application/json" }),
    );

    if (sent) {
      return;
    }
  }

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

function sendMetric(metric) {
  queue.push(buildPayload(metric));

  if (flushTimer) {
    return;
  }

  flushTimer = window.setTimeout(() => scheduleIdle(flushMetrics), 250);
}

export function reportWebVitals(callback = sendMetric) {
  if (typeof window === "undefined" || Math.random() > readSampleRate()) {
    return;
  }

  try {
    onCLS(callback);
    onFCP(callback);
    onINP(callback);
    onLCP(callback);
    onTTFB(callback);

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushMetrics();
      }
    });
  } catch (err) {
    console.error("Web Vitals collection failed", err);
  }
}
