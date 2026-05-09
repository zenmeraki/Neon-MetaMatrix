import crypto from "crypto";
import { prisma } from "../../config/database.js";
import { createTargetSnapshotSet } from "./targetSnapshotRepository.js";
import { compileProductFilterAstToSql } from "../productService/productFilterCompiler.js";

function fingerprintTarget(target) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        productId: target.productId,
        variantId: target.variantId ?? null,
        beforeValueJson: target.beforeValueJson ?? null,
      }),
    )
    .digest("hex");
}

export async function freezeTargetSnapshotSet({ intent, intentHash }) {
  const mirrorBatchId = intent?.target?.mirrorBatchId || intent?.scope?.mirrorBatchId;
  const resource = intent?.scope?.resource || "PRODUCT";
  const ast =
    intent?.targeting?.ast ||
    intent?.target?.runtimeRule?.ast ||
    intent?.target?.runtimeRule ||
    null;

  if (!intent?.shop) throw new Error("INTENT_SHOP_REQUIRED");
  if (!mirrorBatchId) throw new Error("INTENT_MIRROR_BATCH_REQUIRED");
  if (!ast) throw new Error("INTENT_TARGET_AST_REQUIRED");

  const snapshotSet = await createTargetSnapshotSet({
    shop: intent.shop,
    intentHash,
    mirrorBatchId,
    resource,
  });

  const compiled = compileProductFilterAstToSql({
    shop: intent.shop,
    mirrorBatchId,
    ast,
    resource,
    operationField: intent?.operation?.field,
  });

  const rows = await prisma.$queryRawUnsafe(compiled.sql, ...compiled.params);

  const targets = rows.map((row, index) => {
    const target = {
      ownerType: "SNAPSHOT_SET",
      ownerId: snapshotSet.id,
      shop: intent.shop,
      productId: row.product_id,
      variantId: row.variant_id ?? null,
      snapshotSetId: snapshotSet.id,
      ordinal: index + 1,
      mirrorBatchId,
      beforeValueJson: row.before_value_json ?? null,
    };

    return {
      ...target,
      fingerprint: fingerprintTarget(target),
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.targetSnapshot.createMany({
      data: targets,
      skipDuplicates: true,
    });

    await tx.targetSnapshotSet.update({
      where: { id: snapshotSet.id },
      data: {
        targetCount: targets.length,
        status: "FROZEN",
      },
    });
  });

  return {
    snapshotSetId: snapshotSet.id,
    targetCount: targets.length,
  };
}
