//web/frontend/Domain/Dashboard/hooks/useStoreAccess.js
import { useReducer, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAppBridge } from '@shopify/app-bridge-react';
import { useAuthenticatedFetch } from '../../../hooks/useAuthenticatedFetch';
import { dashboardService } from '../services/dashboardService';

// -- Reducer & initial state --
const initialState = {
  storeAccess: null,
  loading: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, storeAccess: action.payload };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.payload };
    default:
      return state;
  }
}

export function useStoreAccess() {
  // App Bridge fetch & error toast
  const app = useAppBridge();
  const fetchWithAuth = useAuthenticatedFetch();

  const [state, dispatch] = useReducer(reducer, initialState);
  const controllerRef = useRef(null);
  const pendingRef = useRef(null);
  const cacheRef = useRef({ data: null, ts: 0, shopKey: null });

  const CACHE_TTL = 30 * 1000; // 30s for webhook status freshness

  // Detect slow connections
  const connection = navigator.connection || {};
  const isSlow =
    connection.saveData === true ||
    /(2g)/.test(connection.effectiveType || '');

  // Memoized derived alert flag
  const computedAlert = useMemo(
    () => !state.storeAccess?.webhookenableStatus?.bulkOperation,
    [state.storeAccess?.webhookenableStatus?.bulkOperation]
  );

  // Debounced loading indicator
  const startTimeout = useRef();
  const scheduleLoading = useCallback(() => {
    clearTimeout(startTimeout.current);
    startTimeout.current = setTimeout(
      () => dispatch({ type: 'FETCH_START' }),
      100
    );
  }, []);

  // Retry logic
  const retryFetch = useCallback(async (fn, attempts = 3, delay = 500) => {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === attempts - 1) throw err;
        await new Promise(r => setTimeout(r, delay * 2 ** i));
      }
    }
  }, []);

  // Core fetch, with dedupe, cache, and cancellation
  const verifyStoreAccess = useCallback(() => {
    // Skip auto-fetch on very slow networks
    // if (isSlow) return Promise.resolve();

    // Cancel previous
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    const signal = controllerRef.current.signal;

    // Return existing promise if any
    if (pendingRef.current) return pendingRef.current;

    // Cache hit?
    if (Date.now() - cacheRef.current.ts < CACHE_TTL && cacheRef.current.shopKey) {
      dispatch({ type: 'FETCH_SUCCESS', payload: cacheRef.current.data });
      return Promise.resolve(cacheRef.current.data);
    }

    scheduleLoading();
    const promise = retryFetch(
      () =>
        dashboardService
          .getStoreAccessData({ fetchFn: fetchWithAuth, signal }),
      3,
      500
    )
      .then(data => {
        const resolvedShopKey =
          data?.data?.shopUrl ||
          data?.shopUrl ||
          data?.data?.shop ||
          data?.shop ||
          null;
        cacheRef.current = { data, ts: Date.now(), shopKey: resolvedShopKey };
        dispatch({ type: 'FETCH_SUCCESS', payload: data });
        return data;
      })
.catch(err => {
  if (err.name === 'AbortError') {
    // Silently ignore AbortError
    return;
  }

  dispatch({
    type: 'FETCH_ERROR',
    payload: err.message || 'Failed to load store data',
  });
  app.toast?.show?.(err.message || 'Error', { duration: 5000, isError: true });

  throw err;
})

      .finally(() => {
        pendingRef.current = null;
      });

    pendingRef.current = promise;
    return promise;
  }, [app, fetchWithAuth, isSlow, retryFetch, scheduleLoading]);

  // Auto‑fetch on mount
  useEffect(() => {
    verifyStoreAccess();
    return () => {
      controllerRef.current?.abort();
      clearTimeout(startTimeout.current);
      cacheRef.current = { data: null, ts: 0, shopKey: null };
    };
  }, []);

  return useMemo(
    () => ({
      storeAccess: state.storeAccess,
      loadingStoreData: state.loading,
      errorStoreData: state.error,
      showAlertStoreData: computedAlert,
      dismissAlertStoreData: () => {}, // no local state
      verifyStoreAccess, // manual refresh
    }),
    [state.storeAccess, state.loading, state.error, computedAlert, verifyStoreAccess]
  );
}
