const DEFAULT_ERROR_RATE_THRESHOLD = 0.3;

export function shouldTripOperationCircuit({
  processedCount = 0,
  failureCount = 0,
  minProcessed = 10,
  threshold = DEFAULT_ERROR_RATE_THRESHOLD,
}) {
  const processed = Number(processedCount || 0);
  const failures = Number(failureCount || 0);

  if (processed < minProcessed) {
    return false;
  }

  return failures / Math.max(processed, 1) > threshold;
}

export function assertOperationCircuitClosed(stats = {}) {
  if (!shouldTripOperationCircuit(stats)) {
    return;
  }

  const error = new Error("Operation stopped because Shopify failure rate exceeded safety threshold.");
  error.code = "OPERATION_CIRCUIT_OPEN";
  throw error;
}
