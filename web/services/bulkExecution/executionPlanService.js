import crypto from "crypto";
import { prisma } from "../../config/database.js";
import { createExecutionPlanRecord } from "./executionPlanRepository.js";

function applyOperation(beforeValueJson, operation) {
  const current = beforeValueJson?.field ?? null;

  switch (operation.action) {
    case "set":
      return operation.value;
    case "append":
      return `${current ?? ""}${operation.value ?? ""}`;
    case "prepend":
      return `${operation.value ?? ""}${current ?? ""}`;
    case "clear":
      return null;
    case "increaseBy":
      return Number(current) + Number(operation.value);
    case "decreaseBy":
      return Number(current) - Number(operation.value);
    case "multiplyBy":
      return Number(current) * Number(operation.value);
    default:
      throw new Error(`UNSUPPORTED_EXECUTION_ACTION:${operation.action}`);
  }
}

function hashPlan(planJson) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(planJson))
    .digest("hex");
}

export async function buildExecutionPlan({ intent, intentHash, snapshotSetId }) {
  const targets = await prisma.targetSnapshot.findMany({
    where: {
      shop: intent.shop,
      snapshotSetId,
    },
    orderBy: [{ productId: "asc" }, { variantId: "asc" }],
  });

  if (!targets.length) {
    throw new Error("NO_TARGETS_TO_EXECUTE");
  }

  const operation = intent?.operation || {};
  const action =
    operation.action ||
    ({
      SET: "set",
      APPEND: "append",
      PREPEND: "prepend",
      CLEAR: "clear",
      INCREASE: "increaseBy",
      DECREASE: "decreaseBy",
      MULTIPLY: "multiplyBy",
    }[String(operation.editType || "").toUpperCase()] || "set");
  const normalizedOperation = {
    ...operation,
    action,
  };

  const mutations = targets.map((target) => ({
    productId: target.productId,
    variantId: target.variantId,
    field: normalizedOperation.field,
    action: normalizedOperation.action,
    beforeValueJson: target.beforeValueJson,
    afterValueJson: {
      field: applyOperation(target.beforeValueJson, normalizedOperation),
    },
    targetFingerprint: target.fingerprint,
  }));

  const mirrorBatchId = intent?.scope?.mirrorBatchId || intent?.target?.mirrorBatchId;
  const planJson = {
    schemaVersion: "2026-05-07.executionPlan.v1",
    intentHash,
    snapshotSetId,
    mirrorBatchId,
    operation: normalizedOperation,
    mutationCount: mutations.length,
    mutations,
  };

  const planHash = hashPlan(planJson);

  const record = await createExecutionPlanRecord({
    shop: intent.shop,
    intentHash,
    snapshotSetId,
    mirrorBatchId,
    mutationCount: mutations.length,
    planHash,
    planJson,
  });

  return {
    executionPlanId: record.id,
    planHash,
    mutationCount: mutations.length,
  };
}

export async function claimExecutionPlanForDispatch({ executionPlanId, shop }) {
  const plan = await prisma.executionPlan.findFirst({
    where: {
      id: executionPlanId,
      shop,
      status: {
        in: ["CREATED", "DISPATCHING", "AWAITING_SHOPIFY"],
      },
    },
  });

  if (!plan) {
    throw new Error("EXECUTION_PLAN_NOT_FOUND_OR_ALREADY_USED");
  }

  const snapshotSet = await prisma.targetSnapshotSet.findFirst({
    where: {
      id: plan.snapshotSetId,
      shop,
      status: "FROZEN",
    },
  });

  if (!snapshotSet) {
    throw new Error("TARGET_SNAPSHOT_NOT_FROZEN");
  }

  if (plan.status === "CREATED") {
    const claim = await prisma.executionPlan.updateMany({
      where: {
        id: executionPlanId,
        shop,
        status: "CREATED",
      },
      data: {
        status: "DISPATCHING",
      },
    });

    if (!claim.count) {
      throw new Error("EXECUTION_PLAN_ALREADY_CLAIMED");
    }
  }

  return { plan, snapshotSet };
}
