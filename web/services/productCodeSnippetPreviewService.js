import { prisma } from "../Config/database.js";
import { evaluateProductSnippet } from "../utils/productSnippetEvaluator.js";
import { buildBulkRulePreviewFromSnippetOutput } from "./productCodeSnippetExecutionService.js";
import { getActiveBatchIds } from "./sync/catalogSnapshotService.js";

function buildProductSummary(product) {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    featuredImageUrl: product.featuredImageUrl || null,
    variantCount: Array.isArray(product.variants) ? product.variants.length : 0,
  };
}

export async function previewProductCodeSnippet({
  shop,
  snippet,
  productId,
}) {
  const activeBatch = await getActiveBatchIds({
    shop,
    path: "snippet_preview",
  });

  const product = await prisma.product.findFirst({
    where: {
      shop,
      id: productId,
      catalogBatchId: activeBatch.catalogBatchId,
    },
    include: {
      variants: true,
    },
  });

  if (!product) {
    throw new Error("Selected product was not found for this shop");
  }

  const evaluation = evaluateProductSnippet({
    ast: snippet.normalizedAst,
    product,
  });

  return {
    product: buildProductSummary(product),
    matched: evaluation.matched,
    branchUsed: evaluation.branchUsed,
    normalizedOutput: evaluation.normalizedOutput,
    rulePreview: buildBulkRulePreviewFromSnippetOutput(evaluation.normalizedOutput),
    hasOutput: Object.keys(evaluation.normalizedOutput).length > 0,
  };
}
