import { prisma } from "../config/database.js";
import { productCodeSnippetRepository } from "../repositories/productCodeSnippetRepository.js";
import { validateProductSnippetDefinition } from "./productCodeSnippetValidationService.js";
import { previewProductCodeSnippet } from "./productCodeSnippetPreviewService.js";

function normalizeStatus(value, fallback = "DRAFT") {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!["ACTIVE", "DRAFT", "ARCHIVED"].includes(normalized)) {
    throw new Error("Unsupported snippet status");
  }
  return normalized;
}

function serializeSnippet(snippet) {
  return {
    id: snippet.id,
    title: snippet.title,
    status: snippet.status,
    language: snippet.language,
    code: snippet.code,
    normalizedAst: snippet.normalizedAst,
    lastValidationStatus: snippet.lastValidationStatus,
    lastValidationError: snippet.lastValidationError,
    lastPreviewedAt: snippet.lastPreviewedAt,
    createdBy: snippet.createdBy,
    updatedBy: snippet.updatedBy,
    createdAt: snippet.createdAt,
    updatedAt: snippet.updatedAt,
  };
}

async function getSnippetOrThrow(shop, id) {
  const snippet = await productCodeSnippetRepository.findByIdForShop(id, shop);
  if (!snippet) {
    throw new Error("Product code snippet not found");
  }
  return snippet;
}

export async function createProductCodeSnippet({
  shop,
  body,
  createdBy = null,
}) {
  const status = normalizeStatus(body.status, "DRAFT");
  if (status === "ARCHIVED") {
    throw new Error("New snippets cannot be created as archived");
  }

  const validation = validateProductSnippetDefinition({
    title: body.title,
    code: body.code,
  });

  const created = await productCodeSnippetRepository.create({
    shop,
    title: String(body.title).trim(),
    status,
    language: "SNIPPET_DSL",
    code: String(body.code || ""),
    normalizedAst: validation.ast,
    lastValidationStatus: validation.validationStatus,
    lastValidationError: null,
    createdBy,
    updatedBy: createdBy,
  });

  return serializeSnippet(created);
}

export async function listProductCodeSnippets({
  shop,
  query = {},
}) {
  const snippets = await productCodeSnippetRepository.listByShop({
    shop,
    search: String(query.search || "").trim(),
    status: query.status ? normalizeStatus(query.status) : null,
  });

  return snippets.map(serializeSnippet);
}

export async function getProductCodeSnippetById({
  shop,
  productCodeSnippetId,
}) {
  return serializeSnippet(await getSnippetOrThrow(shop, productCodeSnippetId));
}

export async function updateProductCodeSnippet({
  shop,
  productCodeSnippetId,
  body,
  updatedBy = null,
}) {
  const existing = await getSnippetOrThrow(shop, productCodeSnippetId);
  if (existing.status === "ARCHIVED") {
    throw new Error("Archived snippets cannot be updated");
  }

  const status = normalizeStatus(body.status, existing.status);
  if (status === "ARCHIVED") {
    throw new Error("Use delete to archive a snippet");
  }

  const validation = validateProductSnippetDefinition({
    title: body.title ?? existing.title,
    code: body.code ?? existing.code,
  });

  const updated = await productCodeSnippetRepository.updateById(existing.id, {
    title: body.title !== undefined ? String(body.title).trim() : existing.title,
    status,
    code: body.code !== undefined ? String(body.code) : existing.code,
    normalizedAst: validation.ast,
    lastValidationStatus: validation.validationStatus,
    lastValidationError: null,
    updatedBy,
  });

  return serializeSnippet(updated);
}

export async function archiveProductCodeSnippet({
  shop,
  productCodeSnippetId,
  updatedBy = null,
}) {
  const existing = await getSnippetOrThrow(shop, productCodeSnippetId);

  const archived = await productCodeSnippetRepository.updateById(existing.id, {
    status: "ARCHIVED",
    updatedBy,
  });

  return serializeSnippet(archived);
}

export async function validateProductCodeSnippet({
  shop,
  productCodeSnippetId,
}) {
  const snippet = await getSnippetOrThrow(shop, productCodeSnippetId);

  try {
    const validation = validateProductSnippetDefinition({
      title: snippet.title,
      code: snippet.code,
    });

    const updated = await productCodeSnippetRepository.updateById(snippet.id, {
      normalizedAst: validation.ast,
      lastValidationStatus: "VALID",
      lastValidationError: null,
    });

    return {
      snippet: serializeSnippet(updated),
      validationStatus: "VALID",
      normalizedAst: validation.ast,
    };
  } catch (error) {
    const updated = await productCodeSnippetRepository.updateById(snippet.id, {
      lastValidationStatus: "INVALID",
      lastValidationError: error.message,
    });

    return {
      snippet: serializeSnippet(updated),
      validationStatus: "INVALID",
      error: error.message,
    };
  }
}

export async function previewSavedProductCodeSnippet({
  shop,
  productCodeSnippetId,
  productId,
}) {
  const snippet = await getSnippetOrThrow(shop, productCodeSnippetId);

  if (snippet.status === "ARCHIVED") {
    throw new Error("Archived snippets cannot be previewed");
  }

  if (!productId) {
    throw new Error("A product selection is required to preview a snippet");
  }

  let normalizedAst = snippet.normalizedAst;
  if (!normalizedAst) {
    const validation = validateProductSnippetDefinition({
      title: snippet.title,
      code: snippet.code,
    });
    normalizedAst = validation.ast;

    await productCodeSnippetRepository.updateById(snippet.id, {
      normalizedAst,
      lastValidationStatus: "VALID",
      lastValidationError: null,
    });
  }

  const preview = await previewProductCodeSnippet({
    shop,
    snippet: {
      ...snippet,
      normalizedAst,
    },
    productId,
  });

  await productCodeSnippetRepository.updateById(snippet.id, {
    lastPreviewedAt: new Date(),
  });

  return preview;
}

export async function searchProductsForSnippetPreview({
  shop,
  search = "",
  limit = 20,
}) {
  const products = await prisma.product.findMany({
    where: {
      shop,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { handle: { contains: search, mode: "insensitive" } },
              { vendor: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      handle: true,
      status: true,
      vendor: true,
      featuredImageUrl: true,
      variantCount: true,
    },
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
    take: Math.min(Math.max(Number(limit) || 20, 1), 25),
  });

  return products;
}
