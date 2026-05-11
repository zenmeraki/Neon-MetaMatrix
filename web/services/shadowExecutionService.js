import crypto from "crypto";
import logger from "../utils/loggerUtils.js";
import { featureFlags } from "./featureFlagService.js";
import { recordMirrorAnomaly } from "./mirrorAnomalyService.js";

const MAX_SHADOW_CONCURRENCY = Math.max(
  Number(process.env.SHADOW_EXECUTION_CONCURRENCY || 2),
  1,
);
const SHADOW_TIMEOUT_MS = Math.max(
  Number(process.env.SHADOW_EXECUTION_TIMEOUT_MS || 10_000),
  1_000,
);
const SHADOW_SAMPLE_PERCENT = Math.min(
  100,
  Math.max(Number(process.env.SHADOW_EXECUTION_SAMPLE_PERCENT || 5), 0),
);
const MAX_SHADOW_PAYLOAD_BYTES = Math.max(
  Number(process.env.SHADOW_MAX_PAYLOAD_BYTES || 2 * 1024 * 1024),
  64 * 1024,
);

let activeShadowExecutions = 0;

function canonicalize(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = canonicalize(value[key], seen);
        return accumulator;
      }, {});
  }

  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function estimateSize(value) {
  return Buffer.byteLength(stableJson(value), "utf8");
}

function hashValue(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function summarizeForShadowTelemetry(value) {
  return {
    hash: hashValue(value),
    bytes: estimateSize(value),
    itemCount: Array.isArray(value) ? value.length : null,
  };
}

function determineMismatchType(primaryResult, shadowResult) {
  if (Array.isArray(primaryResult) && Array.isArray(shadowResult)) {
    if (primaryResult.length !== shadowResult.length) {
      return "COUNT_MISMATCH";
    }
  }

  const primaryHash = hashValue(primaryResult);
  const shadowHash = hashValue(shadowResult);
  if (primaryHash === shadowHash) {
    return "NON_DETERMINISTIC_ORDER";
  }

  if (
    primaryResult &&
    shadowResult &&
    typeof primaryResult === "object" &&
    typeof shadowResult === "object"
  ) {
    const primaryKeys = Object.keys(primaryResult).sort();
    const shadowKeys = Object.keys(shadowResult).sort();
    if (stableJson(primaryKeys) !== stableJson(shadowKeys)) {
      return "TARGET_SET_DRIFT";
    }
  }

  return "MUTATION_PAYLOAD_DRIFT";
}

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(stableJson(value));
}

function canRunShadow() {
  return activeShadowExecutions < MAX_SHADOW_CONCURRENCY;
}

function shouldShadowExecution(shop, percentage = SHADOW_SAMPLE_PERCENT) {
  const normalized = String(shop || "");
  if (!normalized || percentage <= 0) return false;
  if (percentage >= 100) return true;
  const hashByte = crypto.createHash("sha256").update(normalized).digest()[0];
  return hashByte % 100 < percentage;
}

async function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label}_TIMEOUT`);
      error.code = `${label}_TIMEOUT`;
      reject(error);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runShadowExecution({
  name,
  shop,
  executionId = null,
  phase = "default",
  engineVersion = "unknown",
  primaryVersion = "unknown",
  shadowVersion = "unknown",
  comparisonType = "json_equivalence",
  input,
  primary,
  shadow,
  shadowContextFactory = null,
  leaseKey = null,
  assertLeaseOwner = null,
  abortSignal = null,
  compare = (left, right) => stableJson(left) === stableJson(right),
}) {
  if (input?.__shadowExecution === true) {
    return primary(input);
  }

  const shadowEnabled =
    typeof featureFlags?.isEnabled === "function"
      ? featureFlags.isEnabled("shadowBulkEngine", { shop, name, executionId })
      : featureFlags.shadowBulkEngine;

  const inputBytes = estimateSize(input);
  if (inputBytes > MAX_SHADOW_PAYLOAD_BYTES) {
    logger.warn("Shadow execution skipped due to payload size", {
      name,
      shop,
      executionId,
      phase,
      engineVersion,
      comparisonType,
      inputBytes,
      maxPayloadBytes: MAX_SHADOW_PAYLOAD_BYTES,
    });
    return primary(input);
  }

  const originalInput = cloneValue(input);
  const primaryResult = await primary(input);
  const primaryBytes = estimateSize(primaryResult);
  if (primaryBytes > MAX_SHADOW_PAYLOAD_BYTES) {
    logger.warn("Shadow execution skipped due to payload size", {
      name,
      shop,
      executionId,
      phase,
      engineVersion,
      comparisonType,
      primaryBytes,
      maxPayloadBytes: MAX_SHADOW_PAYLOAD_BYTES,
    });
    return primaryResult;
  }
  const frozenPrimaryResult = Object.freeze(cloneValue(primaryResult));
  const inputHash = hashValue(originalInput);

  if (abortSignal?.aborted) {
    return primaryResult;
  }

  if (shadowEnabled && typeof shadow === "function") {
    if (!shouldShadowExecution(shop, SHADOW_SAMPLE_PERCENT)) {
      logger.info("Shadow execution skipped due to sampling", {
        name,
        shop,
        executionId,
        phase,
        engineVersion,
        primaryVersion,
        shadowVersion,
        comparisonType,
        inputHash,
        samplePercent: SHADOW_SAMPLE_PERCENT,
      });
      return primaryResult;
    }

    if (!canRunShadow()) {
      logger.warn("Shadow execution skipped due to concurrency limit", {
        name,
        shop,
        executionId,
        phase,
        engineVersion,
        primaryVersion,
        shadowVersion,
        comparisonType,
        inputHash,
        activeShadowExecutions,
        maxConcurrency: MAX_SHADOW_CONCURRENCY,
      });
      await recordMirrorAnomaly({
        shop,
        severity: "medium",
        type: "shadow_execution_skipped_concurrency",
        entityType: "shadowExecution",
        entityId: executionId || name || null,
        message: `Shadow execution skipped for ${name || "unknown"} due to concurrency limit`,
        details: {
          executionId,
          phase,
          engineVersion,
          primaryVersion,
          shadowVersion,
          comparisonType,
          inputHash,
          activeShadowExecutions,
          maxConcurrency: MAX_SHADOW_CONCURRENCY,
        },
      }).catch(() => {});
      return primaryResult;
    }

    setImmediate(async () => {
      activeShadowExecutions += 1;
      const shadowStartedAt = Date.now();
      try {
        if (abortSignal?.aborted) {
          const abortError = new Error("SHADOW_ABORTED");
          abortError.code = "SHADOW_ABORTED";
          throw abortError;
        }

        // Shadow execution receives a serialized DTO copy to avoid reusing
        // mutable runtime context from request/transaction scoped objects.
        const dtoInput = JSON.parse(stableJson(originalInput));
        const shadowInput = {
          ...dtoInput,
          shadowMode: true,
          dryRun: true,
          allowWrites: false,
          allowExternalCalls: false,
          cachePolicy: "BYPASS_WRITE",
          cacheNamespace: "shadow",
          __shadowExecution: true,
        };
        if (leaseKey && typeof assertLeaseOwner === "function") {
          await assertLeaseOwner(leaseKey);
        }
        const shadowContext =
          typeof shadowContextFactory === "function"
            ? shadowContextFactory({ shop, name, executionId, phase, engineVersion })
            : null;

        const shadowResult = await withTimeout(
          shadow(shadowInput, shadowContext),
          SHADOW_TIMEOUT_MS,
          "SHADOW_EXECUTION",
        );
        if (abortSignal?.aborted) {
          const abortError = new Error("SHADOW_ABORTED");
          abortError.code = "SHADOW_ABORTED";
          throw abortError;
        }

        let matched = false;
        try {
          matched = compare(frozenPrimaryResult, shadowResult);
        } catch (compareError) {
          logger.error("Shadow comparison failed", {
            name,
            shop,
            executionId,
            phase,
            engineVersion,
            primaryVersion,
            shadowVersion,
            comparisonType,
            inputHash,
            message: compareError?.message,
          });
          await recordMirrorAnomaly({
            shop,
            severity: "medium",
            type: "shadow_comparison_failed",
            entityType: "shadowExecution",
            entityId: executionId || name || null,
            message: `Shadow comparison failed for ${name || "unknown"}`,
            details: {
              executionId,
              phase,
              engineVersion,
              primaryVersion,
              shadowVersion,
              comparisonType,
              inputHash,
              message: compareError?.message || null,
              stack: compareError?.stack || null,
            },
          }).catch(() => {});
          return;
        }

        const primaryHash = hashValue(frozenPrimaryResult);
        const shadowHash = hashValue(shadowResult);
        const mismatchType = matched
          ? null
          : determineMismatchType(frozenPrimaryResult, shadowResult);
        const inputTelemetry = summarizeForShadowTelemetry(originalInput);
        const primaryTelemetry = summarizeForShadowTelemetry(frozenPrimaryResult);
        const shadowTelemetry = summarizeForShadowTelemetry(shadowResult);

        if (matched) {
          logger.info("Shadow execution compared", {
            name,
            shop,
            executionId,
            phase,
            engineVersion,
            primaryVersion,
            shadowVersion,
            comparisonType,
            matched: true,
            inputHash,
            primaryHash,
            shadowHash,
            input: inputTelemetry,
            primary: primaryTelemetry,
            shadow: shadowTelemetry,
            mismatchType,
          });
        } else {
          logger.warn("Shadow execution mismatch", {
            name,
            shop,
            executionId,
            phase,
            engineVersion,
            primaryVersion,
            shadowVersion,
            comparisonType,
            matched: false,
            inputHash,
            primaryHash,
            shadowHash,
            input: inputTelemetry,
            primary: primaryTelemetry,
            shadow: shadowTelemetry,
            mismatchType,
          });
          await recordMirrorAnomaly({
            shop,
            severity: "medium",
            type: "shadow_execution_mismatch",
            entityType: "shadowExecution",
            entityId: executionId || name || null,
            message: `Shadow execution mismatch for ${name || "unknown"}`,
            details: {
              executionId,
              phase,
              engineVersion,
              primaryVersion,
              shadowVersion,
              comparisonType,
              inputHash,
              primaryHash,
              shadowHash,
              input: inputTelemetry,
              primary: primaryTelemetry,
              shadow: shadowTelemetry,
              mismatchType,
            },
          }).catch(() => {});
        }
      } catch (error) {
        logger.error("Shadow execution failed", {
          name,
          shop,
          executionId,
          phase,
          engineVersion,
          primaryVersion,
          shadowVersion,
          comparisonType,
          message: error.message,
          inputHash,
        });
        await recordMirrorAnomaly({
          shop,
          severity: "medium",
          type: "shadow_execution_failed",
          entityType: "shadowExecution",
          entityId: executionId || name || null,
          message: `Shadow execution failed for ${name || "unknown"}`,
          details: {
            executionId,
            phase,
            engineVersion,
            primaryVersion,
            shadowVersion,
            comparisonType,
            inputHash,
            message: error?.message || null,
            stack: error?.stack || null,
            code: error?.code || null,
          },
        }).catch(() => {});
      } finally {
        activeShadowExecutions = Math.max(0, activeShadowExecutions - 1);
        logger.info("Shadow execution duration", {
          name,
          shop,
          executionId,
          phase,
          engineVersion,
          primaryVersion,
          shadowVersion,
          comparisonType,
          durationMs: Date.now() - shadowStartedAt,
        });
      }
    });
  }

  return primaryResult;
}
