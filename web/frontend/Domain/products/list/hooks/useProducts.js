// src/hooks/useProducts.js
import { useState, useCallback } from "react";
import { useDispatch } from "react-redux";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";
import {
  setProducts,
  setCount,
  setPagination,
  setPage,
} from "../../../../store/slices/productSlice";

export default function useProducts() {
  const dispatch = useDispatch();
  const fetchWithAuth = useAuthenticatedFetch();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasFetched, setHasFetched] = useState(false);

  const limit = 20;

  const fetchProducts = useCallback(
    async (
      pageNumber = 1,
      filterParams = [],
      sort = { sortKey: "TITLE", sortOrder: "asc" }
    ) => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetchWithAuth(
          `/api/products/get-all?page=${pageNumber}&limit=${limit}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filterParams,
              sortKey: sort.sortKey,
              sortOrder: sort.sortOrder,
            }),
          }
        );
        const json = await res.json();

        if (!res.ok) {
          throw new Error(
            json?.message || json?.error || "Failed to fetch products"
          );
        }

        const products = json?.data?.products || [];
        const pagination = json?.data?.pagination || null;
        const count = json?.data?.pagination?.total ?? products.length;

        dispatch(setProducts(products));
        dispatch(setCount(count));
        dispatch(setPagination(pagination));
        dispatch(setPage(pageNumber));
      } catch (err) {
        setError(err.message);
      } finally {
        setHasFetched(true);
        setLoading(false);
      }
    },
    [dispatch, fetchWithAuth]
  );

  return {
    loading,
    error,
    hasFetched,
    fetchProducts,
  };
}
