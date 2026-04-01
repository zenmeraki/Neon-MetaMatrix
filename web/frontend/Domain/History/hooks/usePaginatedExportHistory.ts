// web/frontend/Domain/History/hooks/usePaginatedExportHistory.ts
import { useState, useEffect, useRef, useCallback } from "react";
import { ExportHistoryItem, ExportResponseSchema } from "../schema/exportHistorySchema";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import { backoff } from "../../../utils/exponentialBackoff";

interface PaginatedExportHistoryResult {
  histories: ExportHistoryItem[];
  loading: boolean;
  error?: Error;
  hasNextPage: boolean;
  loadNextPage: () => void;
  startPolling: () => void;
  stopPolling: () => void;
}

/**
 * Query parameters for pagination. We assume the API supports `cursor` or `page`.
 * For cursor‐based pagination:
 *   GET /api/exportHistory?cursor=xyz&limit=20
 *
 * Or for page‐based:
 *   GET /api/exportHistory?page=2&limit=20
 */
interface QueryParams {
  cursor?: string;
  page?: number;
  limit?: number;
}

/**
 * Hook: usePaginatedExportHistory
 *
 * - Fetches export history pages
 * - Supports polling
 * - Retries failed calls with exponential backoff
 * - Cleans up on unmount
 * - Exposes loadNextPage
 */
export function usePaginatedExportHistory(
  initialLimit: number = 20,
  pollIntervalMs: number = 30_000 // 30 seconds
): PaginatedExportHistoryResult {
  const fetchWithAuth = useAuthenticatedFetch();

  // State
  const [histories, setHistories] = useState<ExportHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState<boolean>(false);

  // Polling control
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const abortControllerRef = useRef<AbortController>(new AbortController());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      abortControllerRef.current.abort();
    };
  }, []);

  // Low‐level API call (with retry/backoff)
  const fetchPage = useCallback(
    async (params: QueryParams) => {
      const maxRetries = 3;
      const baseDelayMs = 1000; // 1 second

      // Create new abort controller for this request
      abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      // Wrapper that attempts fetch, applies exponential backoff on failure
      return backoff(async () => {
        const query = new URLSearchParams();
        if (params.cursor) query.set("cursor", params.cursor);
        if (params.page !== undefined) query.set("page", String(params.page));
        query.set("limit", String(params.limit ?? initialLimit));

        const response = await fetchWithAuth(`/api/exportHistory?${query.toString()}`, {
          signal: abortControllerRef.current.signal,
        });
        
        // Check if response is null or undefined
        if (!response) {
          throw new Error("Network request failed - no response received");
        }
        
        if (!response.ok) {
          throw new Error(`API returned status ${response.status}`);
        }
        
        const json = await response.json();
        const parsed = ExportHistoryResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error("Malformed response: " + JSON.stringify(parsed.error.errors));
        }
        return parsed.data; // array of ExportHistoryItem
      }, { retries: maxRetries, factor: 2, baseDelay: baseDelayMs });
    },
    [fetchWithAuth, initialLimit]
  );

  // Load one page, merge into state
  const loadPage = useCallback(
    async (nextCursor?: string) => {
      setLoading(true);
      setError(undefined);

      try {
        const pageData = await fetchPage({ cursor: nextCursor, limit: initialLimit });
        if (!isMountedRef.current) return;

        // Merge new page of data
        setHistories((prev) => [...prev, ...pageData]);

        // Decide new cursor and hasNextPage
        // Assuming the API returns `pageData` always length <= limit,
        // and if it's full-length, there may be a next page:
        if (pageData.length === initialLimit) {
          // In a real cursor-based API, you'd read a `nextCursor` field. Here
          // we assume the last item has the nextCursor (for demonstration).
          const lastItem = pageData[pageData.length - 1];
          setCursor(lastItem._id); // or some cursor field
          setHasNextPage(true);
        } else {
          setHasNextPage(false);
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          // Fetch was canceled, ignore
        } else {
          setError(err);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [fetchPage, initialLimit]
  );

  // Load the first page on mount
  useEffect(() => {
    loadPage(undefined);
  }, [loadPage]);

  // Public: load the next page
  const loadNextPage = useCallback(() => {
    if (hasNextPage && !loading) {
      loadPage(cursor);
    }
  }, [hasNextPage, loading, loadPage, cursor]);

  // Polling: re‐fetch the first page every pollIntervalMs
  const startPolling = useCallback(() => {
    if (pollingRef.current) return; // already polling
    pollingRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      // Reset histories and reload from scratch
      setHistories([]);
      setCursor(undefined);
      loadPage(undefined);
    }, pollIntervalMs);
  }, [loadPage, pollIntervalMs]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  return {
    histories,
    loading,
    error,
    hasNextPage,
    loadNextPage,
    startPolling,
    stopPolling,
  };
}