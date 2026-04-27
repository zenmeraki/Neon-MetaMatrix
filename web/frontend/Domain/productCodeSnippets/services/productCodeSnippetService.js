export async function readJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "Request failed");
  }
  return payload;
}

export async function listProductCodeSnippets(fetchFn, params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) searchParams.set("search", params.search);
  if (params.status) searchParams.set("status", params.status);

  const response = await fetchFn(`/api/product-code-snippets?${searchParams.toString()}`);
  const payload = await readJsonResponse(response);
  return payload.data || [];
}

export async function getProductCodeSnippet(fetchFn, id) {
  const response = await fetchFn(`/api/product-code-snippets/${id}`);
  const payload = await readJsonResponse(response);
  return payload.data;
}

export async function createProductCodeSnippet(fetchFn, body) {
  const response = await fetchFn("/api/product-code-snippets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJsonResponse(response);
  return payload.data;
}

export async function updateProductCodeSnippet(fetchFn, id, body) {
  const response = await fetchFn(`/api/product-code-snippets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJsonResponse(response);
  return payload.data;
}

export async function archiveProductCodeSnippet(fetchFn, id) {
  const response = await fetchFn(`/api/product-code-snippets/${id}`, {
    method: "DELETE",
  });
  const payload = await readJsonResponse(response);
  return payload.data;
}

export async function validateProductCodeSnippet(fetchFn, id) {
  const response = await fetchFn(`/api/product-code-snippets/${id}/validate`, {
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok && response.status !== 422) {
    throw new Error(payload?.message || "Validation failed");
  }
  return payload.data;
}

export async function previewProductCodeSnippet(fetchFn, id, productId) {
  const response = await fetchFn(`/api/product-code-snippets/${id}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId }),
  });
  const payload = await readJsonResponse(response);
  return payload.data;
}

export async function searchPreviewProducts(fetchFn, search = "") {
  const searchParams = new URLSearchParams();
  if (search) searchParams.set("search", search);
  searchParams.set("limit", "20");

  const response = await fetchFn(
    `/api/product-code-snippets/preview-products?${searchParams.toString()}`,
  );
  const payload = await readJsonResponse(response);
  return payload.data || [];
}
