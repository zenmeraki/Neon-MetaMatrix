import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Normalize a raw API item into the {label, value} shape that
 * Polaris <Autocomplete> expects.
 *
 * Accepts strings, numbers, or objects with any of the common
 * label/value field names returned by the filter-values API.
 */
function normalizeAutocompleteOption(item) {
  if (item === null || item === undefined) return null;

  if (typeof item === "string" || typeof item === "number") {
    const normalized = String(item).trim();
    if (!normalized) return null;
    return { label: normalized, value: normalized };
  }

  const label = item.label ?? item.title ?? item.name ?? item.value ?? item.id;
  const value = item.value ?? item.title ?? item.name ?? item.label ?? item.id;

  if (label === undefined || value === undefined) return null;

  const normalizedLabel = String(label).trim();
  const normalizedValue = String(value).trim();

  if (!normalizedLabel || !normalizedValue) return null;

  return { label: normalizedLabel, value: normalizedValue };
}

const EMPTY = [];

/**
 * Per-filter autocomplete hook.
 *
 * Each mounted <FilterControl> that calls this hook owns its own
 * options/loading state, so updating one filter does NOT re-render
 * siblings (fixes issue #6).
 *
 * Results are cached per `filter.key + query` so repeated searches
 * for the same string skip the network round-trip (fixes issue #8).
 *
 * A single AbortController per filter cancels the in-flight request
 * whenever a newer query arrives, keeping concurrency at ≤ 1 per
 * filter (fixes issue #9).
 *
 * @param {object} filter - Filter config object from constants.js
 * @param {string} filter.key
 * @param {string} [filter.api]
 * @param {boolean} [filter.isSearchable]
 */
export function useFilterAutocomplete(filter) {
  const [options, setOptions] = useState(EMPTY);
  const [loading, setLoading] = useState(false);

  // Persisted across renders without triggering re-renders.
  const cacheRef = useRef(/** @type {Map<string, {label:string,value:string}[]>} */ (new Map()));
  const debounceRef = useRef(null);
  const abortRef = useRef(/** @type {AbortController|null} */ (null));

  if (filter.isSearchable && !filter.api) {
    // Surface misconfigured filters early so they are caught in development.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[useFilterAutocomplete] Filter "${filter.key}" has isSearchable=true but no api URL. ` +
          "Autocomplete will be disabled for this filter."
      );
    }
  }

  const search = useCallback(
    (query) => {
      if (!filter.api) return;

      clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(async () => {
        const cacheKey = `${filter.key}:${query}`;

        // Return cached result immediately — no network call needed.
        if (cacheRef.current.has(cacheKey)) {
          setOptions(cacheRef.current.get(cacheKey));
          return;
        }

        // Cancel any previous in-flight request for this filter.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);

        try {
          const res = await fetch(
            `${filter.api}?search=${encodeURIComponent(query)}&isNameOnly=true`,
            { signal: controller.signal }
          );

          if (!res.ok) throw new Error(`filter-values fetch failed: ${res.status}`);

          const data = await res.json();
          const items = Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data)
            ? data
            : [];

          const normalized = items.map(normalizeAutocompleteOption).filter(Boolean);

          // Only update state if this request is still the latest one.
          if (abortRef.current === controller) {
            cacheRef.current.set(cacheKey, normalized);
            setOptions(normalized);
          }
        } catch (err) {
          if (err?.name === "AbortError") return;
          if (abortRef.current === controller) {
            setOptions(EMPTY);
          }
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
            setLoading(false);
          }
        }
      }, 300);
    },
    [filter.api, filter.key]
  );

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return { options, loading, search };
}
