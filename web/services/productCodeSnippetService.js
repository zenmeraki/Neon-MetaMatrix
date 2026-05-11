import { prisma } from "../config/database.js";
import { productCodeSnippetRepository } from "../repositories/productCodeSnippetRepository.js";
import { validateProductSnippetDefinition } from "./productCodeSnippetValidationService.js";
import { previewProductCodeSnippet } from "./productCodeSnippetPreviewService.js";
import { migrateProductSnippetSnapshot } from "./productCodeSnippetMigrationService.js";

function normalizeStatus(value, fallback = "DRAFT") {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!["ACTIVE", "DRAFT", "ARCHIVED"].includes(normalized)) {
    throw new Error("Unsupported snippet status");
  }
  return normalized;
}

function serializeSnippet(snippet) {
  const astPayload = extractCanonicalAst(snippet.normalizedAst);
  const validationMeta = extractValidationMeta(snippet.normalizedAst);
  return {
    id: snippet.id,
    title: snippet.title,
    status: snippet.status,
    language: snippet.language,
    code: snippet.code,
    normalizedAst: astPayload,
    validationMeta,
    lastValidationStatus: snippet.lastValidationStatus,
    lastValidationError: snippet.lastValidationError,
    lastPreviewedAt: snippet.lastPreviewedAt,
    createdBy: snippet.createdBy,
    updatedBy: snippet.updatedBy,
    createdAt: snippet.createdAt,
    updatedAt: snippet.updatedAt,
  };
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function buildValidationSnapshot(validation) {
  return {
    __meta: {
      fingerprint: validation.fingerprint || null,
      schemaVersion: validation.schemaVersion || null,
      validatorVersion: validation.validatorVersion || null,
      safetyClass: validation.safetyClass || null,
      validatedAt: new Date().toISOString(),
    },
    ast: validation.ast,
  };
}

function extractCanonicalAst(normalizedAst) {
  if (
    normalizedAst &&
    typeof normalizedAst === "object" &&
    !Array.isArray(normalizedAst) &&
    normalizedAst.ast
  ) {
    return normalizedAst.ast;
  }
  return normalizedAst;
}

function extractValidationMeta(normalizedAst) {
  if (
    normalizedAst &&
    typeof normalizedAst === "object" &&
    !Array.isArray(normalizedAst) &&
    normalizedAst.__meta &&
    typeof normalizedAst.__meta === "object"
  ) {
    return normalizedAst.__meta;
  }
  return null;
}

function sanitizeValidationError(error) {
  return error?.code || "SNIPPET_VALIDATION_FAILED";
}

async function getSnippetOrThrow(shop, id) {
  const snippet = await productCodeSnippetRepository.findByIdForShop(id, shop);
  if (!snippet) {
    throw new Error("Product code snippet not found");
  }

  if (snippet.normalizedAst) {
    const migrated = migrateProductSnippetSnapshot(snippet.normalizedAst);
    if (migrated.migrated) {
      const updated = await productCodeSnippetRepository.updateById(snippet.id, {
        normalizedAst: migrated.normalizedAst,
      });
      return updated;
    }
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

  const created = await prisma.$transaction(async (tx) => productCodeSnippetRepository.create({
    shop,
    title: String(body.title).trim(),
    status,
    language: "SNIPPET_DSL",
    code: String(body.code || ""),
    normalizedAst: buildValidationSnapshot(validation),
    lastValidationStatus: validation.validationStatus,
    lastValidationError: null,
    createdBy,
    updatedBy: createdBy,
  }, tx));

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
  expectedUpdatedAt = null,
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

  const updateResult = await productCodeSnippetRepository.updateByIdForShopWithUpdatedAt({
    id: existing.id,
    shop,
    expectedUpdatedAt: expectedUpdatedAt || body.expectedUpdatedAt || existing.updatedAt,
    data: {
      title: body.title !== undefined ? String(body.title).trim() : existing.title,
      status,
      code: body.code !== undefined ? String(body.code) : existing.code,
      normalizedAst: buildValidationSnapshot(validation),
      lastValidationStatus: validation.validationStatus,
      lastValidationError: null,
      updatedBy,
    },
  });
  if (updateResult.count !== 1) {
    throw codedError("SNIPPET_CONFLICT");
  }
  const updated = await getSnippetOrThrow(shop, existing.id);

  return serializeSnippet(updated);
}

export async function archiveProductCodeSnippet({
  shop,
  productCodeSnippetId,
  updatedBy = null,
  expectedUpdatedAt = null,
}) {
  const existing = await getSnippetOrThrow(shop, productCodeSnippetId);

  const archiveResult = await productCodeSnippetRepository.updateByIdForShopWithUpdatedAt({
    id: existing.id,
    shop,
    expectedUpdatedAt: expectedUpdatedAt || existing.updatedAt,
    data: {
      status: "ARCHIVED",
      updatedBy,
    },
  });
  if (archiveResult.count !== 1) {
    throw codedError("SNIPPET_CONFLICT");
  }
  const archived = await getSnippetOrThrow(shop, existing.id);

  return serializeSnippet(archived);
}

export async function validateProductCodeSnippet({
  shop,
  productCodeSnippetId,
  expectedUpdatedAt = null,
}) {
  const snippet = await getSnippetOrThrow(shop, productCodeSnippetId);

  try {
    const validation = validateProductSnippetDefinition({
      title: snippet.title,
      code: snippet.code,
    });

    const updateResult = await productCodeSnippetRepository.updateByIdForShopWithUpdatedAt({
      id: snippet.id,
      shop,
      expectedUpdatedAt: expectedUpdatedAt || snippet.updatedAt,
      data: {
      normalizedAst: buildValidationSnapshot(validation),
      lastValidationStatus: "VALID",
      lastValidationError: null,
      },
    });
    if (updateResult.count !== 1) {
      throw codedError("SNIPPET_CONFLICT");
    }
    const updated = await getSnippetOrThrow(shop, snippet.id);

    return {
      snippet: serializeSnippet(updated),
      validationStatus: "VALID",
      normalizedAst: extractCanonicalAst(updated.normalizedAst),
    };
  } catch (error) {
    const updated = await productCodeSnippetRepository.updateById(snippet.id, {
      lastValidationStatus: "INVALID",
      lastValidationError: sanitizeValidationError(error),
    });

    return {
      snippet: serializeSnippet(updated),
      validationStatus: "INVALID",
      error: sanitizeValidationError(error),
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
    normalizedAst = buildValidationSnapshot(validation);
  }

  const preview = await previewProductCodeSnippet({
    shop,
    snippet: {
      ...snippet,
      normalizedAst: extractCanonicalAst(normalizedAst),
    },
    productId,
  });

  const previewAt = new Date();
  if (
    !snippet.lastPreviewedAt ||
    previewAt.getTime() - new Date(snippet.lastPreviewedAt).getTime() > 60_000
  ) {
    await productCodeSnippetRepository.updateById(snippet.id, {
      lastPreviewedAt: previewAt,
    });
  }

  return preview;
}

export async function searchProductsForSnippetPreview({
  shop,
  search = "",
  limit = 20,
}) {
  const normalizedSearch = String(search || "").trim().slice(0, 80);
  if (normalizedSearch && normalizedSearch.length < 2) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      shop,
      ...(normalizedSearch
        ? {
            OR: [
              { title: { contains: normalizedSearch, mode: "insensitive" } },
              { handle: { contains: normalizedSearch, mode: "insensitive" } },
              { vendor: { contains: normalizedSearch, mode: "insensitive" } },
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
