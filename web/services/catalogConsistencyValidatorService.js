import { prisma } from "../config/database.js";
import { storeOperationalStateRepository } from "../repositories/storeOperationalStateRepository.js";
import { CURRENT_MIRROR_SCHEMA_VERSION } from "./catalogMirrorSchema.js";

export async function validateCatalogConsistency({ shop, mirrorBatchId }) {
  if (!shop || !mirrorBatchId) {
    return {
      status: "INCONSISTENT",
      errors: ["Missing shop or mirror batch id"],
    };
  }

  const [
    operationalState,
    productCount,
    productsMissingRequiredFields,
    variantsMissingRequiredFields,
    orphanVariantCount,
  ] = await Promise.all([
    prisma.storeOperationalState.findUnique({
      where: { shop },
      select: {
        activeProductBatchId: true,
        activeVariantBatchId: true,
        activeCollectionBatchId: true,
      },
    }),
    prisma.product.count({
      where: { shop, mirrorBatchId },
    }),
    prisma.product.count({
      where: {
        shop,
        mirrorBatchId,
        OR: [{ id: "" }, { title: "" }],
      },
    }),
    prisma.variant.count({
      where: {
        shop,
        mirrorBatchId,
        OR: [{ id: "" }, { productId: "" }],
      },
    }),
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "Variant" v
      LEFT JOIN "Product" p
        ON p."shop" = v."shop"
       AND p."id" = v."productId"
       AND p."mirrorBatchId" = v."mirrorBatchId"
      WHERE v."shop" = ${shop}
        AND v."mirrorBatchId" = ${mirrorBatchId}
        AND p."id" IS NULL
    `,
  ]);

  const errors = [];
  const productReady =
    operationalState?.activeProductBatchId === mirrorBatchId && productCount > 0;
  const variantsReady =
    operationalState?.activeVariantBatchId === mirrorBatchId &&
    variantsMissingRequiredFields === 0 &&
    Number(orphanVariantCount?.[0]?.count || 0) === 0;
  const collectionsReady = Boolean(operationalState?.activeCollectionBatchId);
  const metafieldsReady = true;

  if (!productReady) errors.push("Product domain not ready");
  if (!variantsReady) errors.push("Variant domain not ready");
  if (!metafieldsReady) errors.push("Metafield domain not ready");
  if (productsMissingRequiredFields > 0) errors.push("Products missing required fields");
  if (variantsMissingRequiredFields > 0) errors.push("Variants missing required fields");
  if (Number(orphanVariantCount?.[0]?.count || 0) > 0) {
    errors.push("Variants without matching products");
  }

  const status = errors.length ? "INCONSISTENT" : "READY";
  await storeOperationalStateRepository.setCatalogStatus(shop, status, {
    mirrorBatchId,
    mirrorSchemaVersion: CURRENT_MIRROR_SCHEMA_VERSION,
  });

  return {
    status,
    productCount,
    productsMissingRequiredFields,
    variantsMissingRequiredFields,
    orphanVariantCount: Number(orphanVariantCount?.[0]?.count || 0),
    domainReadiness: {
      product: productReady ? "READY" : "NOT_READY",
      variant: variantsReady ? "READY" : "NOT_READY",
      collection: collectionsReady ? "READY" : "NOT_READY",
      metafield: metafieldsReady ? "READY" : "NOT_READY",
    },
    errors,
  };
}
