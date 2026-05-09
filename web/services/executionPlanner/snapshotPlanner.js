import { prisma } from "../../config/database.js";
import { stableHash } from "../../utils/idempotencyKey.js";
import { getProductPrismaWhere } from "../productService/productFilterCompiler.js";

function getClient(db) {
  return db || prisma;
}

function buildBeforeValuesFromProduct(product) {
  return {
    id: product.id,
    title: product.title ?? null,
    handle: product.handle ?? null,
    status: product.status ?? null,
    vendor: product.vendor ?? null,
    productType: product.productType ?? null,
    tags: Array.isArray(product.tags) ? product.tags : [],
    option1Name: product.option1Name ?? null,
    option2Name: product.option2Name ?? null,
    option3Name: product.option3Name ?? null,
    optionsJson: product.optionsJson ?? null,
    collectionsJson: product.collectionsJson ?? null,
  };
}

export async function freezeImmutableSnapshotFromIntent({
  shop,
  operationId,
  intentId,
  mirrorBatchId,
  filterAst,
  actionAst,
  filterHash,
  actionHash,
  targetHash,
  canonicalOrderBy,
  plannerVersion,
  compilerVersion,
}, db = prisma) {
  const client = getClient(db);
  const where = getProductPrismaWhere(filterAst || [], shop);
  const products = await client.product.findMany({
    where: {
      ...where,
      shop,
      mirrorBatchId,
    },
    select: {
      id: true,
      title: true,
      handle: true,
      status: true,
      vendor: true,
      productType: true,
      tags: true,
      option1Name: true,
      option2Name: true,
      option3Name: true,
      optionsJson: true,
      collectionsJson: true,
      variants: {
        where: { shop, mirrorBatchId },
        select: { id: true },
      },
    },
    orderBy: [{ id: "asc" }],
  });

  const created = await client.immutableTargetSnapshotSet.upsert({
    where: {
      shop_operationId: { shop, operationId },
    },
    update: {
      intentId,
      mirrorBatchId,
      filterAst,
      actionAst,
      filterHash,
      actionHash,
      targetHash,
      canonicalOrderBy,
      plannerVersion,
      compilerVersion,
      productCount: products.length,
      variantCount: products.reduce(
        (acc, p) => acc + Number(Array.isArray(p.variants) ? p.variants.length : 0),
        0,
      ),
      frozenAt: new Date(),
    },
    create: {
      shop,
      operationId,
      intentId,
      mirrorBatchId,
      filterAst,
      actionAst,
      filterHash,
      actionHash,
      targetHash,
      canonicalOrderBy,
      plannerVersion,
      compilerVersion,
      productCount: products.length,
      variantCount: products.reduce(
        (acc, p) => acc + Number(Array.isArray(p.variants) ? p.variants.length : 0),
        0,
      ),
    },
  });

  await client.immutableTargetSnapshotItem.deleteMany({
    where: { shop, snapshotSetId: created.id },
  });

  const rows = [];
  let ordinal = 1;
  for (const product of products) {
    const beforeValues = buildBeforeValuesFromProduct(product);
    rows.push({
      shop,
      snapshotSetId: created.id,
      productId: product.id,
      variantId: null,
      ordinal: ordinal++,
      beforeValues,
      beforeFingerprint: stableHash(beforeValues),
      beforeHash: stableHash(beforeValues),
      plannedChanges: actionAst || null,
      targetHash,
    });
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      const variantBeforeValues = { id: variant.id, productId: product.id };
      rows.push({
        shop,
        snapshotSetId: created.id,
        productId: product.id,
        variantId: variant.id,
        ordinal: ordinal++,
        beforeValues: variantBeforeValues,
        beforeFingerprint: stableHash(variantBeforeValues),
        beforeHash: stableHash(variantBeforeValues),
        plannedChanges: actionAst || null,
        targetHash,
      });
    }
  }

  if (rows.length) {
    await client.immutableTargetSnapshotItem.createMany({ data: rows });
  }

  return {
    snapshotSetId: created.id,
    productCount: created.productCount,
    variantCount: created.variantCount,
    targetCount: rows.length,
  };
}
