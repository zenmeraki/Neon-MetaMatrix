import crypto from "crypto";
import { Prisma } from "../generated/prisma/index.js";
import { Queue } from "bullmq";
import { connection } from "../Config/redis.js";
import { prisma } from "../config/database.js";
import { automaticProductRuleRepository } from "../repositories/automaticProductRuleRepository.js";
import { automaticProductRuleRunRepository } from "../repositories/automaticProductRuleRunRepository.js";
import {
  assertAutomaticProductRuleAccess,
  getSubscriptionForShop,
} from "./automaticProductRulePlanService.js";
import { computeAutomaticProductRuleNextRunAt } from "./automaticProductRuleScheduleService.js";
import {
  evaluateAutomaticRuleCandidates,
  persistAppliedStateUpdates,
  persistMatchedStateUpdates,
} from "./automaticProductRuleDedupService.js";
import { productFilterService } from "./productService/productFilterService.js";
import { getSession } from "../utils/sessionHandler.js";
import { logWorkerError } from "../utils/errorLogUtils.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import logger from "../utils/loggerUtils.js";
import ProductBulkService from "./productService/productBulkEditService.js";
import { addbulkEditJob } from "../Jobs/Queues/bulkEditJob.js";
import {
  acquireExclusiveShopWork,
  releaseExclusiveShopWork,
} from "./shopWorkLeaseService.js";

export const AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE =
  process.env.AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE || "automatic-product-rule-execution";
export const AUTOMATIC_PRODUCT_RULE_SIGNAL_QUEUE =
  process.env.AUTOMATIC_PRODUCT_RULE_SIGNAL_QUEUE || "automatic-product-rule-signal";

const executionQueue = new Queue(AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE, { connection });
const signalQueue = new Queue(AUTOMATIC_PRODUCT_RULE_SIGNAL_QUEUE, { connection });
const PENDING_RUN_RECOVERY_BATCH_SIZE = 100;

class RetryableAutomaticRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetryableAutomaticRuleError";
    this.retryable = true;
  }
}

function buildSignalExecutionKey(ruleId, triggerSource, triggerReference, productIds = []) {
  const payload = JSON.stringify({
    triggerSource,
    triggerReference: triggerReference || null,
    productIds: [...new Set(productIds.filter(Boolean))].sort(),
  });
  const hash = crypto.createHash("sha256").update(payload).digest("hex");
  return `${ruleId}:signal:${hash}`;
}

function buildScheduledExecutionKey(ruleId, scheduledFor) {
  return `${ruleId}:schedule:${new Date(scheduledFor).toISOString()}`;
}

function buildManualExecutionKey(ruleId) {
  return `${ruleId}:manual:${new Date().toISOString()}:${crypto.randomUUID()}`;
}

function buildTriggerReference({ triggerReference, productIds = [], source }) {
  return JSON.stringify({
    source: source || null,
    reference: triggerReference || null,
    productIds: [...new Set(productIds.filter(Boolean))].sort(),
  });
}

function isTerminalRunStatus(status) {
  return ["SUCCESS", "FAILED", "SKIPPED"].includes(status);
}

function isRunWindowEligible(rule, now = new Date()) {
  if (rule.startAt && new Date(rule.startAt) > now) return false;
  if (rule.endAt && new Date(rule.endAt) < now) return false;
  return true;
}

async function tryAdvisoryLock(client, lockKey, transactional = true) {
  if (transactional) {
    const rows = await client.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
    `;
    return Boolean(rows?.[0]?.locked);
  }

  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

async function unlockAdvisoryLock(client, lockKey) {
  await client.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${lockKey}))
  `;
}

async function enqueueExecutionRun(runId, shop, opts = {}) {
  return executionQueue.add(
    "automatic-product-rule-execution",
    { runId, shop },
    {
      jobId: runId,
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 8,
      backoff: {
        type: "exponential",
        delay: 30_000,
      },
      ...opts,
    },
  );
}

async function resolveExistingHistoryForRun(runId) {
  return prisma.editHistory.findFirst({
    where: {
      automaticProductRuleRunId: runId,
    },
      select: {
        id: true,
        status: true,
        completedAt: true,
        executionIdentity: true,
      },
    });
  }

async function reserveScheduledRun(ruleId, shop, now) {
  return prisma.$transaction(async (tx) => {
    const locked = await tryAdvisoryLock(tx, `automatic-product-rule:${ruleId}`, true);
    if (!locked) return null;

    const rule = await automaticProductRuleRepository.findById(ruleId, shop, tx);
    if (
      !rule ||
      rule.isDeleted ||
      rule.status !== "ACTIVE" ||
      !rule.nextRunAt ||
      rule.nextRunAt > now
    ) {
      return null;
    }

    const scheduledFor = rule.nextRunAt;
    const executionKey = buildScheduledExecutionKey(rule.id, scheduledFor);
    const existingRun = await automaticProductRuleRunRepository.findByExecutionKey(
      executionKey,
      rule.shop,
      tx,
    );

    if (existingRun) {
      return {
        runId: existingRun.id,
        executionKey,
        shop: rule.shop,
        reused: true,
      };
    }

    const nextRunAt = computeAutomaticProductRuleNextRunAt(
      rule,
      new Date(scheduledFor.getTime() + 1000),
    );

    const run = await automaticProductRuleRunRepository.create({
      automaticProductRuleId: rule.id,
      shop: rule.shop,
      triggerSource: "SCHEDULE",
      triggerReference: buildTriggerReference({
        triggerReference: scheduledFor.toISOString(),
        source: "SCHEDULE",
      }),
      scheduledFor,
      status: "PENDING",
      executionKey,
    }, tx);

    await automaticProductRuleRepository.updateById(rule.id, rule.shop, { nextRunAt }, tx);

    return {
      runId: run.id,
      executionKey,
      shop: rule.shop,
      reused: false,
    };
  }, {
    maxWait: 10_000,
    timeout: 20_000,
  });
}

async function markRunSkipped(run, reason, data = {}) {
  const transition = await automaticProductRuleRunRepository.markPendingSkipped(run.id, run.shop, {
    completedAt: new Date(),
    errorMessage: reason,
    ...data,
  });

  if (!transition.count) {
    return null;
  }

  await automaticProductRuleRepository.updateById(run.automaticProductRuleId, run.shop, {
    runCount: { increment: 1 },
    lastRunAt: new Date(),
  });

  return reason;
}

async function markRunFailed({ run, rule, errorMessage, data = {} }) {
  const transition = await automaticProductRuleRunRepository.markProcessingFinished(
    run.id,
    run.shop,
    "FAILED",
    {
      completedAt: new Date(),
      errorMessage,
      ...data,
    },
  );

  if (!transition.count) {
    return null;
  }

  await automaticProductRuleRepository.updateById(rule.id, rule.shop, {
    runCount: { increment: 1 },
    lastRunAt: new Date(),
    lastFailureAt: new Date(),
    lastFailureReason: errorMessage,
  });

  return errorMessage;
}

async function recoverPendingRuns(shop, limit = PENDING_RUN_RECOVERY_BATCH_SIZE) {
  const pendingRuns = await automaticProductRuleRunRepository.listPendingRunsWithoutHistory(shop, limit);
  let enqueued = 0;

  for (const run of pendingRuns) {
    try {
      await enqueueExecutionRun(run.id, run.shop);
      enqueued += 1;
    } catch (error) {
      await logWorkerError({
        shop: run.shop,
        err: error,
        source: "AutomaticProductRuleExecutionService.recoverPendingRuns",
      });
    }
  }

  return enqueued;
}

export async function enqueueAutomaticProductRuleExecutionJob({ runId, shop }) {
  return enqueueExecutionRun(runId, shop);
}

export async function enqueueAutomaticProductRuleSignalJob({
  shop,
  productIds = [],
  triggerReference,
  triggerSource = "WEBHOOK",
}) {
  const signalFingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        shop,
        triggerSource,
        triggerReference: triggerReference || null,
        productIds: [...new Set(productIds.filter(Boolean))].sort(),
      }),
    )
    .digest("hex");

  return signalQueue.add(
    "automatic-product-rule-signal",
    { shop, productIds, triggerReference, triggerSource },
    {
      jobId: `${shop}:${signalFingerprint}`,
      removeOnComplete: 200,
      removeOnFail: 200,
      attempts: 8,
      backoff: {
        type: "exponential",
        delay: 10_000,
      },
    },
  );
}

export async function reserveAutomaticProductRuleRunFromSignal({
  shop,
  productIds = [],
  triggerReference,
  triggerSource = "WEBHOOK",
}) {
  const now = new Date();
  const rules = await automaticProductRuleRepository.listRunnableEventRulesByShop(shop, now);
  let createdRuns = 0;
  let reusedRuns = 0;

  for (const rule of rules) {
    const executionKey = buildSignalExecutionKey(rule.id, triggerSource, triggerReference, productIds);

    try {
      const existingRun = await automaticProductRuleRunRepository.findByExecutionKey(
        executionKey,
        shop,
      );
      if (existingRun) {
        if (existingRun.status === "PENDING") {
          await enqueueExecutionRun(existingRun.id, shop);
        }
        reusedRuns += 1;
        continue;
      }

      const run = await automaticProductRuleRunRepository.create({
        automaticProductRuleId: rule.id,
        shop,
        triggerSource,
        triggerReference: buildTriggerReference({
          triggerReference,
          productIds,
          source: triggerSource,
        }),
        status: "PENDING",
        executionKey,
      });

      await enqueueExecutionRun(run.id, shop);
      createdRuns += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existingRun = await automaticProductRuleRunRepository.findByExecutionKey(
          executionKey,
          shop,
        );
        if (existingRun?.status === "PENDING") {
          await enqueueExecutionRun(existingRun.id, shop).catch(() => {});
        }
        reusedRuns += 1;
        continue;
      }

      await logWorkerError({
        shop,
        err: error,
        source: "AutomaticProductRuleExecutionService.reserveAutomaticProductRuleRunFromSignal",
      });
    }
  }

  return {
    createdRuns,
    reusedRuns,
  };
}

export async function scheduleDueAutomaticProductRuleRuns({ limit = 100 } = {}) {
  const schedulerLockKey = "automatic-product-rule-scheduler";
  const hasSchedulerLock = await tryAdvisoryLock(prisma, schedulerLockKey, false);

  if (!hasSchedulerLock) {
    return {
      scheduled: 0,
      recovered: 0,
      skipped: 0,
      reason: "scheduler_locked",
    };
  }

  try {
    const now = new Date();
    const dueShops = await automaticProductRuleRepository.findDueShops(now, limit);
    const perShopLimit = Math.max(1, Math.ceil(limit / Math.max(dueShops.length, 1)));
    const dueIds = [];
    let recovered = 0;
    for (const shop of dueShops) {
      recovered += await recoverPendingRuns(shop);
      const shopDueIds = await automaticProductRuleRepository.findDueRuleIds({
        shop,
        now,
        limit: perShopLimit,
      });
      dueIds.push(...shopDueIds);
      if (dueIds.length >= limit) break;
    }
    let scheduled = 0;
    let skipped = 0;

    for (const { id, shop } of dueIds.slice(0, limit)) {
      try {
        const reservation = await reserveScheduledRun(id, shop, now);
        if (!reservation?.runId) {
          skipped += 1;
          continue;
        }

        await enqueueExecutionRun(reservation.runId, reservation.shop);
        scheduled += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          skipped += 1;
          continue;
        }

        await logWorkerError({
          shop: "unknown",
          err: error,
          source: "AutomaticProductRuleExecutionService.scheduleDueAutomaticProductRuleRuns",
        });
        skipped += 1;
      }
    }

    return {
      scheduled,
      recovered,
      skipped,
      scanned: dueIds.length,
    };
  } finally {
    await unlockAdvisoryLock(prisma, schedulerLockKey);
  }
}

export async function createManualAutomaticProductRuleRun({ rule }) {
  const run = await automaticProductRuleRunRepository.create({
    automaticProductRuleId: rule.id,
    shop: rule.shop,
    triggerSource: "MANUAL",
    triggerReference: buildTriggerReference({
      triggerReference: "manual",
      source: "MANUAL",
    }),
    status: "PENDING",
    executionKey: buildManualExecutionKey(rule.id),
  });

  await enqueueExecutionRun(run.id, rule.shop);
  return run;
}

async function failHistoryAndRun({ rule, run, historyId, error }) {
  if (historyId) {
    await prisma.editHistory.updateMany({
      where: {
        id: historyId,
        status: { in: ["pending", "processing"] },
      },
      data: {
        status: "failed",
        completedAt: new Date(),
        error: {
          message: error.message,
          details: error.stack || null,
        },
      },
    }).catch(() => {});
  }

  await markRunFailed({
    run,
    rule,
    errorMessage: error.message || "Automatic rule execution failed",
  });
}

export async function executeAutomaticProductRuleRun(runId, shopFromJob = null) {
  if (!shopFromJob) {
    throw new Error("shop is required to execute an automatic product rule run");
  }

  let run = await automaticProductRuleRunRepository.findByIdWithRule(runId, shopFromJob);
  let executionLockKey = null;
  if (!run) {
    return { skipped: true, reason: "run_not_found" };
  }

  if (isTerminalRunStatus(run.status)) {
    return { skipped: true, reason: "run_already_completed" };
  }

  const initialRule = run.automaticProductRule;
  if (shopFromJob && initialRule?.shop && initialRule.shop !== shopFromJob) {
    throw new Error("Cross-shop automatic rule execution blocked");
  }
  if (!initialRule) {
    return { skipped: true, reason: "rule_not_found" };
  }

  const subscription = await getSubscriptionForShop(initialRule.shop);
  if (
    initialRule.isDeleted ||
    initialRule.status !== "ACTIVE" ||
    !isRunWindowEligible(initialRule)
  ) {
    await markRunSkipped(run, "Automatic rule is not active for execution");
    return { skipped: true, reason: "rule_inactive" };
  }

  try {
    await assertAutomaticProductRuleAccess(subscription);
  } catch (error) {
    await markRunSkipped(run, error.message);
    return { skipped: true, reason: "plan_ineligible" };
  }

  executionLockKey = `automatic-rule-shop:${initialRule.shop}`;
  const hasShopLock = await tryAdvisoryLock(prisma, executionLockKey, false);
  if (!hasShopLock) {
    throw new RetryableAutomaticRuleError("Automatic rule execution is already running for this shop");
  }

  let exclusiveShopLockKey = null;

  try {
    run = await automaticProductRuleRunRepository.findByIdWithRule(runId, shopFromJob);
    if (!run || isTerminalRunStatus(run.status)) {
      return { skipped: true, reason: "run_not_actionable" };
    }

    const rule = run.automaticProductRule;
    if (
      !rule ||
      rule.isDeleted ||
      rule.status !== "ACTIVE" ||
      !isRunWindowEligible(rule)
    ) {
      await markRunSkipped(run, "Automatic rule is not active for execution");
      return { skipped: true, reason: "rule_inactive_after_lock" };
    }

    const exclusiveLock = await acquireExclusiveShopWork({
      shop: rule.shop,
      activity: "automatic_rule_execution",
      worker: "automaticProductRuleExecutionService",
      queue: AUTOMATIC_PRODUCT_RULE_EXECUTION_QUEUE,
      jobId: run.id,
      entityType: "automaticProductRuleRun",
      entityId: run.id,
      executionId: run.id,
    });

    if (!exclusiveLock.acquired) {
      throw new RetryableAutomaticRuleError("Another heavy job is already running for this shop");
    }

    exclusiveShopLockKey = exclusiveLock.lockKey;

    const latestSubscription = await getSubscriptionForShop(rule.shop);
    try {
      await assertAutomaticProductRuleAccess(latestSubscription);
    } catch (error) {
      await markRunSkipped(run, error.message);
      return { skipped: true, reason: "plan_ineligible_after_lock" };
    }

    const session = await getSession(rule.shop);
    const { status: bulkStatus } = await getCurrentBulkOperationStatus(session);
    if (bulkStatus === "RUNNING") {
      throw new RetryableAutomaticRuleError("A Shopify bulk operation is already running for this shop");
    }

    if (run.editHistoryId) {
      const history = await prisma.editHistory.findUnique({
        where: { id: run.editHistoryId },
        select: { id: true, status: true, completedAt: true },
      });

      if (history?.status === "completed") {
        await finalizeAutomaticProductRuleRunFromHistory({
          historyId: history.id,
          status: "SUCCESS",
        });
        return { skipped: true, reason: "history_already_completed" };
      }

      if (history?.status === "failed") {
        await finalizeAutomaticProductRuleRunFromHistory({
          historyId: history.id,
          status: "FAILED",
          errorMessage: "Edit history already failed",
        });
        return { skipped: true, reason: "history_already_failed" };
      }

      await addbulkEditJob({
        historyId: run.editHistoryId,
        shop: rule.shop,
        source: "automatic_rule_resume",
        executionId: history.executionIdentity || history.id,
      });
      return {
        queued: true,
        runId: run.id,
        editHistoryId: run.editHistoryId,
      };
    }

    const existingHistory = await resolveExistingHistoryForRun(run.id);
    if (existingHistory) {
      await automaticProductRuleRunRepository.updateByIdForStatuses(
        run.id,
        rule.shop,
        ["PENDING", "PROCESSING"],
        {
          editHistoryId: existingHistory.id,
          status: "PROCESSING",
          startedAt: run.startedAt || new Date(),
        },
      );

      if (existingHistory.status === "completed") {
        await finalizeAutomaticProductRuleRunFromHistory({
          historyId: existingHistory.id,
          status: "SUCCESS",
        });
        return { skipped: true, reason: "history_recovered_completed" };
      }

      if (existingHistory.status === "failed") {
        await finalizeAutomaticProductRuleRunFromHistory({
          historyId: existingHistory.id,
          status: "FAILED",
          errorMessage: "Recovered failed edit history",
        });
        return { skipped: true, reason: "history_recovered_failed" };
      }

      await addbulkEditJob({
        historyId: existingHistory.id,
        shop: rule.shop,
        source: "automatic_rule_recovery",
        executionId: existingHistory.executionIdentity || existingHistory.id,
      });
      return {
        queued: true,
        runId: run.id,
        editHistoryId: existingHistory.id,
        recovered: true,
      };
    }

    const where = productFilterService.getProductPrismaWhere(
      Array.isArray(rule.conditions) ? rule.conditions : [],
      rule.shop,
    );

    const {
      matchedCount,
      candidateProducts,
      matchedStateUpdates,
      appliedStateUpdates,
    } = await evaluateAutomaticRuleCandidates({
      rule,
      run,
      where,
    });

    await persistMatchedStateUpdates(rule, matchedStateUpdates, run);

    if (!candidateProducts.length) {
      await markRunSkipped(run, "No eligible products remained after dedupe checks", {
        matchedCount,
        affectedCount: 0,
      });

      return {
        skipped: true,
        reason: "no_candidates",
        matchedCount,
      };
    }

    const movedToProcessing = await automaticProductRuleRunRepository.updatePendingToProcessing(
      run.id,
      rule.shop,
      { now: new Date(), worker: "automaticProductRuleExecutionService" },
    );
    if (!movedToProcessing.count) {
      return { skipped: true, reason: "run_already_claimed" };
    }
    run = {
      ...run,
      status: "PROCESSING",
      startedAt: run.startedAt || new Date(),
    };

    const productIds = candidateProducts.map((product) => product.id);
    const bulkService = new ProductBulkService(session);
    let editHistoryId = null;
    let editHistoryExecutionIdentity = null;

    try {
      const baseHistory = await bulkService._bulkOperationEdit(
        {
          filterParams: rule.conditions,
          productIds,
          queryWhere: {
            shop: rule.shop,
            id: {
              in: productIds,
            },
          },
          rules: rule.actions,
          title: rule.title,
        },
        {
          planKey: "PRO_MONTHLY",
          planName: "Pro Monthly",
          isUnlimited: true,
          limit: Number.MAX_SAFE_INTEGER,
          status: "ACTIVE",
        },
      );

      const editHistory = await prisma.editHistory.create({
        data: {
          ...baseHistory,
          type: "Automatic rule",
          automaticProductRuleId: rule.id,
          automaticProductRuleRunId: run.id,
          triggerType: "AUTOMATIC_RULE",
          batch: {
            automaticRuleStateUpdates: appliedStateUpdates,
            automaticRuleMatchedCount: matchedCount,
            automaticRuleAffectedProductIds: productIds,
          },
        },
      });

      editHistoryId = editHistory.id;
      editHistoryExecutionIdentity = editHistory.executionIdentity;
      const frozenCount = await bulkService.freezeEditHistoryTargets(editHistory.id);
      await prisma.editHistory.update({
        where: { id: editHistory.id },
        data: {
          totalItems: frozenCount,
          targetSnapshotCount: frozenCount,
          executionState: "queued",
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const recoveredHistory = await resolveExistingHistoryForRun(run.id);
        if (recoveredHistory) {
          editHistoryId = recoveredHistory.id;
          editHistoryExecutionIdentity = recoveredHistory.executionIdentity;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    try {
      await automaticProductRuleRunRepository.updateById(run.id, rule.shop, {
        editHistoryId,
        matchedCount,
        affectedCount: productIds.length,
      });

      await addbulkEditJob({
        historyId: editHistoryId,
        shop: rule.shop,
        source: "automatic_rule",
        executionId: editHistoryExecutionIdentity || editHistoryId,
      });
    } catch (error) {
      await failHistoryAndRun({
        rule,
        run,
        historyId: editHistoryId,
        error,
      });
      throw error;
    }

    logger.info("Automatic rule execution queued", {
      shop: rule.shop,
      automaticProductRuleId: rule.id,
      runId: run.id,
      editHistoryId,
      matchedCount,
      affectedCount: productIds.length,
      triggerSource: run.triggerSource,
    });

    return {
      success: true,
      runId: run.id,
      editHistoryId,
      matchedCount,
      affectedCount: productIds.length,
    };
  } catch (error) {
    if (error instanceof RetryableAutomaticRuleError) {
      logger.warn("Automatic rule execution deferred", {
        runId,
        reason: error.message,
      });
      throw error;
    }

    if (run?.automaticProductRule && run.status === "PROCESSING" && !run.editHistoryId) {
      await markRunFailed({
        run,
        rule: run.automaticProductRule,
        errorMessage: error.message || "Automatic rule execution failed",
      }).catch(() => {});
    }

    await logWorkerError({
      shop: run?.shop || initialRule.shop,
      err: error,
      source: "AutomaticProductRuleExecutionService.executeAutomaticProductRuleRun",
    });

    throw error;
  } finally {
    await releaseExclusiveShopWork(exclusiveShopLockKey);
    if (executionLockKey) {
      await unlockAdvisoryLock(prisma, executionLockKey).catch(() => {});
    }
  }
}

export async function finalizeAutomaticProductRuleRunFromHistory({
  historyId,
  status,
  errorMessage = null,
}) {
  const history = await prisma.editHistory.findUnique({
    where: { id: historyId },
    select: {
      automaticProductRuleId: true,
      automaticProductRuleRunId: true,
      shop: true,
      batch: true,
      status: true,
      completedAt: true,
    },
  });

  if (!history?.automaticProductRuleId || !history?.automaticProductRuleRunId) {
    return null;
  }

  const run = await automaticProductRuleRunRepository.findById(
    history.automaticProductRuleRunId,
    history.shop,
  );
  if (!run) {
    return null;
  }

  if (isTerminalRunStatus(run.status)) {
    return run.status;
  }

  const completedAt = history.completedAt || new Date();
  const normalizedStatus =
    status === "SUCCESS" || history.status === "completed"
      ? "SUCCESS"
      : "FAILED";

  const transition = await automaticProductRuleRunRepository.markProcessingFinished(
    history.automaticProductRuleRunId,
    run.shop,
    normalizedStatus,
    {
      completedAt,
      errorMessage: normalizedStatus === "FAILED"
        ? errorMessage || "Automatic rule run failed"
        : null,
    },
  );

  if (!transition.count) {
    return run.status;
  }

  await automaticProductRuleRepository.updateById(history.automaticProductRuleId, run.shop, {
    runCount: { increment: 1 },
    lastRunAt: completedAt,
    ...(normalizedStatus === "SUCCESS"
      ? {
          lastSuccessAt: completedAt,
          lastFailureReason: null,
        }
      : {
          lastFailureAt: completedAt,
          lastFailureReason: errorMessage || "Automatic rule run failed",
        }),
  });

  if (normalizedStatus === "SUCCESS") {
    const appliedStateUpdates = Array.isArray(history.batch?.automaticRuleStateUpdates)
      ? history.batch.automaticRuleStateUpdates
      : [];

    await persistAppliedStateUpdates(
      {
        id: history.automaticProductRuleId,
        shop: run.shop,
      },
      appliedStateUpdates,
      run,
    );
  }

  return normalizedStatus;
}
