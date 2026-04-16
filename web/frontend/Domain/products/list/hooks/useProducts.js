import { useState, useCallback } from "react";
import { useProductStore } from "../../../../store/productStore";

function normalizeProductsResponse(json) {
  const products = json?.data?.products || [];
  const pagination = json?.data?.pagination || null;
  const count = json?.data?.pagination?.total ?? products.length;

  return {
    products,
    pagination,
    count,
  };
}

function createMirrorNotReadyError(result) {
  const error = new Error(
    result?.message || "Product mirror is not ready yet."
  );

  error.code = result?.error || "MIRROR_NOT_READY";
  error.isMirrorNotReady = true;
  error.details = result?.details || null;

  return error;
}

export default function useProducts() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [mirrorNotReady, setMirrorNotReady] = useState(false);

  const limit = 20;

  const clearProductsResult = useCallback((pageNumber = 1) => {
    useProductStore.getState().setProductsResult({
      products: [],
      pagination: null,
      count: 0,
      page: pageNumber,
    });
  }, []);

  const fetchProducts = useCallback(
    async (pageNumber = 1, filterParams = []) => {
      try {
        setLoading(true);
        setError(null);
        setErrorCode(null);
        setMirrorNotReady(false);

        const res = await fetch(
          `/api/products/get-all?page=${pageNumber}&limit=${limit}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ filterParams }),
          }
        );

        let json = null;

        try {
          json = await res.json();
        } catch {
          json = null;
        }

        if (!res.ok) {
          const apiErrorCode = json?.error || null;

          if (
            res.status === 409 &&
            apiErrorCode === "MIRROR_NOT_READY"
          ) {
            clearProductsResult(pageNumber);
            setMirrorNotReady(true);
            setError(null);
            setErrorCode(apiErrorCode);
            return {
              ok: false,
              mirrorNotReady: true,
              errorCode: apiErrorCode,
              details: json?.details || null,
            };
          }

          if (
            res.status === 500 &&
            apiErrorCode === "PRODUCT_LIST_FAILED"
          ) {
            clearProductsResult(pageNumber);
            setError("Failed to fetch products");
            setErrorCode(apiErrorCode);
            return {
              ok: false,
              mirrorNotReady: false,
              errorCode: apiErrorCode,
              details: json?.details || null,
            };
          }

          throw createMirrorNotReadyError(json);
        }

        const normalized = normalizeProductsResponse(json);

        useProductStore.getState().setProductsResult({
          products: normalized.products,
          pagination: normalized.pagination,
          count: normalized.count,
          page: pageNumber,
        });

        return {
          ok: true,
          mirrorNotReady: false,
          errorCode: null,
        };
      } catch (err) {
        if (err?.isMirrorNotReady) {
          clearProductsResult(pageNumber);
          setMirrorNotReady(true);
          setError(null);
          setErrorCode(err.code || "MIRROR_NOT_READY");

          return {
            ok: false,
            mirrorNotReady: true,
            errorCode: err.code || "MIRROR_NOT_READY",
            details: err.details || null,
          };
        }

        clearProductsResult(pageNumber);
        setMirrorNotReady(false);
        setError(err?.message || "Failed to fetch products");
        setErrorCode(err?.code || "PRODUCT_LIST_FAILED");

        return {
          ok: false,
          mirrorNotReady: false,
          errorCode: err?.code || "PRODUCT_LIST_FAILED",
          details: err?.details || null,
        };
      } finally {
        setHasFetched(true);
        setLoading(false);
      }
    },
    [clearProductsResult]
  );

  return {
    loading,
    error,
    errorCode,
    hasFetched,
    mirrorNotReady,
    fetchProducts,
  };
}