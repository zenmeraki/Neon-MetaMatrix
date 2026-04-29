// src/hooks/useProducts.js
import { useState, useCallback, useRef } from "react";
import { useDispatch } from "react-redux";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";
import {
  setProducts,
  appendProducts,
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
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [streamingState, setStreamingState] = useState({
    phase: "idle",
    loaded: 0,
    backgroundLoaded: 0,
  });
  const requestIdRef = useRef(0);

  const limit = 20;
  const streamPages = 10;

  const fetchProductPage = useCallback(
    async ({ pageNumber, filterParams, sort, pageLimit = limit }) => {
      const res = await fetchWithAuth(
        `/api/products/get-all?page=${pageNumber}&limit=${pageLimit}`,
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

      return {
        products: json?.data?.products || [],
        pagination: json?.data?.pagination || null,
      };
    },
    [fetchWithAuth]
  );

  const fetchProducts = useCallback(
    async (
      pageNumber = 1,
      filterParams = [],
      sort = { sortKey: "TITLE", sortOrder: "asc" },
      options = {}
    ) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const shouldStream = options.stream !== false && pageNumber === 1;

      try {
        setLoading(true);
        setError(null);
        setStreamingState({
          phase: shouldStream ? "first_page" : "idle",
          loaded: 0,
          backgroundLoaded: 0,
        });

        const { products, pagination } = await fetchProductPage({
          pageNumber,
          filterParams,
          sort,
        });
        if (requestIdRef.current !== requestId) return;

        dispatch(setProducts(products));
        const count = pagination?.total ?? products.length;
        dispatch(setCount(count));
        dispatch(setPagination(pagination));
        dispatch(setPage(pageNumber));
        setLastFetchedAt(new Date().toISOString());
        setStreamingState({
          phase: shouldStream ? "streaming" : "idle",
          loaded: products.length,
          backgroundLoaded: 0,
        });

        if (!shouldStream || !pagination?.hasNextPage) return;

        const totalPages = Math.min(
          Number(pagination.totalPages || streamPages),
          streamPages
        );

        window.setTimeout(async () => {
          let loaded = products.length;

          for (let page = 2; page <= totalPages; page += 1) {
            if (requestIdRef.current !== requestId) return;

            try {
              const nextPage = await fetchProductPage({
                pageNumber: page,
                filterParams,
                sort,
              });
              if (requestIdRef.current !== requestId) return;

              dispatch(appendProducts(nextPage.products));
              loaded += nextPage.products.length;
              setStreamingState({
                phase: page < totalPages ? "streaming" : "background",
                loaded,
                backgroundLoaded: loaded,
              });
            } catch {
              setStreamingState((current) => ({
                ...current,
                phase: "paused",
              }));
              return;
            }
          }
        }, 0);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setError(err.message);
      } finally {
        if (requestIdRef.current === requestId) {
          setHasFetched(true);
          setLoading(false);
        }
      }
    },
    [dispatch, fetchProductPage]
  );

  return {
    loading,
    error,
    hasFetched,
    lastFetchedAt,
    streamingState,
    fetchProducts,
  };
}
