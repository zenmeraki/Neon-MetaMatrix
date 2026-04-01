// dashboardFetcher.js — ULTRA FINAL OPTIMIZED
import { authenticatedFetch } from "@shopify/app-bridge/utilities";

/* ------------------------------------------------------------
   Combine multiple AbortSignals → returns a new controller
------------------------------------------------------------- */
function combineSignals(...signals) {
  const controller = new AbortController();
  const abort = () => controller.abort();

  for (let i = 0; i < signals.length; i++) {
    const sig = signals[i];
    if (!sig) continue;

    if (sig.aborted) {
      controller.abort();
      return controller;
    }

    sig.addEventListener("abort", abort);
  }

  return controller;
}

/* ------------------------------------------------------------
   Timeout helper (returns controller + clear fn)
------------------------------------------------------------- */
function requestTimeout(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

/* ------------------------------------------------------------
   Error classifier (fast, minimal allocations)
------------------------------------------------------------- */
function classifyError(err, response) {
  if (!response) {
    return {
      type: "NETWORK",
      status: null,
      message: err.message,
    };
  }

  const status = response.status;

  if (status === 429) return { type: "RATE_LIMIT", status, message: err.message };
  if (status === 401) return { type: "AUTH", status, message: err.message };
  if (status >= 500) return { type: "SERVER", status, message: err.message };
  if (status >= 400) return { type: "CLIENT", status, message: err.message };

  return { type: "UNKNOWN", status, message: err.message };
}

/* ------------------------------------------------------------
   Retry with exponential backoff + jitter
------------------------------------------------------------- */
async function retryWithBackoff(fn, opts) {
  const retries = opts?.retries ?? 4;
  const base = opts?.baseDelay ?? 300;
  const max = opts?.maxDelay ?? 2500;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const { type, status } = error;

      const retryable =
        type === "RATE_LIMIT" ||
        type === "NETWORK" ||
        (type === "SERVER" && status >= 500);

      if (!retryable || attempt === retries) throw error;

      const retryAfter = error?.response?.headers?.get("Retry-After");

      // Respect server retry header
      if (retryAfter) {
        await new Promise((resolve) =>
          setTimeout(resolve, parseInt(retryAfter, 10) * 1000)
        );
      } else {
        const delay = Math.min(max, base * (1 << attempt));
        const jitter = delay * (0.4 * Math.random());
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      }
    }
  }
}

/* ------------------------------------------------------------
   Authenticated fetch wrapper (App Bridge safe)
------------------------------------------------------------- */
export function createDashboardFetcher(app) {
  const authFetch = authenticatedFetch(app);

  return async function dashboardFetch(url, options = {}) {
    const method = options.method || "GET";
    const externalSignal = options.signal;

    // Abort if request takes too long
    const timeout = requestTimeout(5000);
    const combinedController = combineSignals(externalSignal, timeout.signal);

    try {
      return await retryWithBackoff(async () => {
        const res = await authFetch(url, {
          method,
          signal: combinedController.signal,
        });

        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.response = res;

          throw {
            ...classifyError(err, res),
            response: res,
          };
        }

        return res;
      });
    } finally {
      timeout.clear();
    }
  };
}
