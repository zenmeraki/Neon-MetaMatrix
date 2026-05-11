import { prisma } from "../config/database.js";
import { evaluateProductSnippet } from "../modules/productCodeSnippets/productSnippetEvaluator.js";
import { buildBulkRulePreviewFromSnippetOutput } from "./productCodeSnippetExecutionService.js";

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
  const store = await prisma.store.findUnique({
    where: { shopUrl: shop },
    select: { activeMirrorBatchId: true },
  });

  const product = await prisma.product.findFirst({
    where: {
      shop,
      id: productId,
      ...(store?.activeMirrorBatchId ? { mirrorBatchId: store.activeMirrorBatchId } : {}),
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
