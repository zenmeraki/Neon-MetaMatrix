import {
  archiveProductCodeSnippet,
  createProductCodeSnippet,
  getProductCodeSnippetById,
  listProductCodeSnippets,
  previewSavedProductCodeSnippet,
  searchProductsForSnippetPreview,
  updateProductCodeSnippet,
  validateProductCodeSnippet,
} from "../services/productCodeSnippetService.js";
import { errorResponse, successResponse } from "../utils/responseUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";

function getSessionOrThrow(res) {
  const session = res.locals.shopify?.session;
  if (!session?.shop) {
    throw new Error("Session expired");
  }
  return session;
}

function getUserFromSession(session) {
  return session?.id || session?.shop || null;
}

function getStatusCode(error) {
  if (error.message === "Session expired") return 403;
  if (error.message === "Product code snippet not found") return 404;
  if (error.message?.includes("not found")) return 404;
  return 400;
}

export async function createProductCodeSnippetController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await createProductCodeSnippet({
      shop: session.shop,
      body: req.body,
      createdBy: getUserFromSession(session),
    });

    return res.status(201).json(successResponse("Snippet created successfully", data));
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productCodeSnippetController.create",
    });
    return res.status(getStatusCode(error)).json(errorResponse(error.message));
  }
}

export async function listProductCodeSnippetsController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await listProductCodeSnippets({
      shop: session.shop,
      query: req.query,
    });

    return res.status(200).json(successResponse("Snippets fetched successfully", data));
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productCodeSnippetController.list",
    });
    return res.status(getStatusCode(error)).json(errorResponse(error.message));
  }
}

export async function getProductCodeSnippetByIdController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await getProductCodeSnippetById({
      shop: session.shop,
      productCodeSnippetId: req.params.id,
    });

    return res.status(200).json(successResponse("Snippet fetched successfully", data));
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productCodeSnippetController.getById",
    });
    return res.status(getStatusCode(error)).json(errorResponse(error.message));
  }
}

export async function updateProductCodeSnippetController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await updateProductCodeSnippet({
      shop: session.shop,
      productCodeSnippetId: req.params.id,
      body: req.body,
      updatedBy: getUserFromSession(session),
    });

    return res.status(200).json(successResponse("Snippet updated successfully", data));
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productCodeSnippetController.update",
    });
    return res.status(getStatusCode(error)).json(errorResponse(error.message));
  }
}

export async function deleteProductCodeSnippetController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await archiveProductCodeSnippet({
      shop: session.shop,
      productCodeSnippetId: req.params.id,
      updatedBy: getUserFromSession(session),
    });

    return res.status(200).json(successResponse("Snippet archived successfully", data));
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productCodeSnippetController.delete",
    });
    return res.status(getStatusCode(error)).json(errorResponse(error.message));
  }
}

export async function validateProductCodeSnippetController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await validateProductCodeSnippet({
      shop: session.shop,
      productCodeSnippetId: req.params.id,
    });

    if (data.validationStatus === "VALID") {
      return res
        .status(200)
        .json(successResponse("Snippet validation completed", data));
    }

    return res
      .status(422)
      .json(errorResponse("Snippet validation failed", data));
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productCodeSnippetController.validate",
    });
    return res.status(getStatusCode(error)).json(errorResponse(error.message));
  }
}

export async function previewProductCodeSnippetController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await previewSavedProductCodeSnippet({
      shop: session.shop,
      productCodeSnippetId: req.params.id,
      productId: req.body.productId,
    });

    return res.status(200).json(successResponse("Snippet preview completed", data));
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productCodeSnippetController.preview",
    });
    return res.status(getStatusCode(error)).json(errorResponse(error.message));
  }
}

export async function searchSnippetPreviewProductsController(req, res) {
  let session;

  try {
    session = getSessionOrThrow(res);
    const data = await searchProductsForSnippetPreview({
      shop: session.shop,
      search: req.query.search,
      limit: req.query.limit,
    });

    return res.status(200).json(successResponse("Products fetched successfully", data));
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "productCodeSnippetController.searchProducts",
    });
    return res.status(getStatusCode(error)).json(errorResponse(error.message));
  }
}
