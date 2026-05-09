// src/hooks/useProducts.js
import { useState, useCallback, useRef, useEffect } from "react";
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
  const requestControllerRef = useRef(null);
  const streamControllerRef = useRef(null);
  const streamTimeoutRef = useRef(null);
  const cursorTrailRef = useRef([null]);

  const limit = 20;
  const streamPages = 10;

  const abortInflight = useCallback(() => {
    if (requestControllerRef.current) {
      requestControllerRef.current.abort();
      requestControllerRef.current = null;
    }
    if (streamControllerRef.current) {
      streamControllerRef.current.abort();
      streamControllerRef.current = null;
    }
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
  }, []);

  const fetchProductPage = useCallback(
    async ({
      cursor = null,
      filterParams,
      sort,
      pageLimit = limit,
      signal,
    }) => {
      const query = new URLSearchParams({
        limit: String(pageLimit),
      });
      if (cursor) {
        query.set("cursor", String(cursor));
      }

      const res = await fetchWithAuth(
        `/api/products/get-all?${query.toString()}`,
        {
          signal,
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
      abortInflight();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const requestController = new AbortController();
      requestControllerRef.current = requestController;
      const shouldStream = options.stream !== false && pageNumber === 1;
      const direction = options.direction || "reset";

      const currentTrail = cursorTrailRef.current;
      let requestedCursor = null;
      let nextTrail = [null];

      if (direction === "next") {
        requestedCursor = options.cursor || null;
        nextTrail = [...currentTrail, requestedCursor];
      } else if (direction === "prev") {
        const index = Math.max(0, pageNumber - 1);
        requestedCursor = currentTrail[index] || null;
        nextTrail = currentTrail.slice(0, index + 1);
      } else if (pageNumber > 1) {
        requestedCursor = currentTrail[pageNumber - 1] || null;
        nextTrail = currentTrail.slice(0, pageNumber);
      }

      try {
        setLoading(true);
        setError(null);
        setStreamingState({
          phase: shouldStream ? "first_page" : "idle",
          loaded: 0,
          backgroundLoaded: 0,
        });

        const { products, pagination } = await fetchProductPage({
          cursor: requestedCursor,
          filterParams,
          sort,
          signal: requestController.signal,
        });
        if (requestIdRef.current !== requestId) return;
        cursorTrailRef.current = nextTrail;

        const nextPagination = {
          ...(pagination || {}),
          page: pageNumber,
          hasPrevPage: pageNumber > 1,
          cursor: requestedCursor,
          prevCursor: pageNumber > 1 ? nextTrail[pageNumber - 2] || null : null,
        };

        dispatch(setProducts(products));
        const count = nextPagination?.total ?? products.length;
        dispatch(setCount(count));
        dispatch(setPagination(nextPagination));
        dispatch(setPage(pageNumber));
        setLastFetchedAt(new Date().toISOString());
        setStreamingState({
          phase: shouldStream ? "streaming" : "idle",
          loaded: products.length,
          backgroundLoaded: 0,
        });

        if (!shouldStream || !nextPagination?.hasNextPage) return;

        const totalPages = Math.min(Number(nextPagination.totalPages || streamPages), streamPages);
        const streamController = new AbortController();
        streamControllerRef.current = streamController;
        const initialCursor = nextPagination.nextCursor || null;

        streamTimeoutRef.current = window.setTimeout(async () => {
          let loaded = products.length;
          let cursor = initialCursor;

          for (let page = 2; page <= totalPages; page += 1) {
            if (requestIdRef.current !== requestId || !cursor) return;

            try {
              const nextPage = await fetchProductPage({
                cursor,
                filterParams,
                sort,
                signal: streamController.signal,
              });
              if (requestIdRef.current !== requestId) return;

              dispatch(appendProducts(nextPage.products));
              loaded += nextPage.products.length;
              cursor = nextPage?.pagination?.nextCursor || null;
              setStreamingState({
                phase: page < totalPages ? "streaming" : "background",
                loaded,
                backgroundLoaded: loaded,
              });
            } catch {
              if (streamController.signal.aborted) return;
              setStreamingState((current) => ({
                ...current,
                phase: "paused",
              }));
              return;
            }
          }
        }, 0);
      } catch (err) {
        if (requestController.signal.aborted) return;
        if (requestIdRef.current !== requestId) return;
        setError(err.message);
      } finally {
        if (requestIdRef.current === requestId) {
          setHasFetched(true);
          setLoading(false);
        }
      }
    },
    [abortInflight, dispatch, fetchProductPage]
  );

  useEffect(
    () => () => {
      abortInflight();
    },
    [abortInflight]
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
