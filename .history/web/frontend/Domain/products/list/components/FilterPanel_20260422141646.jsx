import React, { memo, useState, useRef, useCallback, useEffect } from "react";
import { Box, BlockStack, Select, Button, Text } from "@shopify/polaris";
import { useAuthenticatedFetch } from "@shopify/app-bridge-react";
import FilterValueInput from "./FilterValueInput";
import {
  operatorRequiresValue,
  getTranslatedOperatorLabel,
  normalizeAutocompleteOption,
} from "../utils/filterUtils";

// ✅ accepts signal to cancel stale requests
async function fetchAutocompleteOptions(filter, query, authenticatedFetch, setOptions, setLoading, signal) {
  if (!filter.api) return;
  setLoading(true);
  try {
    const res = await authenticatedFetch(
      `${filter.api}?search=${encodeURIComponent(query)}&isNameOnly=true`,
      { signal } // ✅ pass signal to the request
    );
    if (!res.ok) throw new Error("Failed");
    const data = await res.json();
    const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    setOptions(items.map(normalizeAutocompleteOption).filter(Boolean));
  } catch (err) {
    // ✅ AbortError means a newer request replaced this one — don't clear options
    if (err?.name === "AbortError") return;
    setOptions([]);
  } finally {
    // ✅ only clear loading if this request wasn't aborted
    if (!signal.aborted) {
      setLoading(false);
    }
  }
}

const FilterPanel = memo(function FilterPanel({ filter, onFilterChange, onApplied, t }) {
  const authenticatedFetch = useAuthenticatedFetch();
  const [draft, setDraft] = useState({
    operator: filter.operators[0] || "",
    value: "",
  });
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef(null);
  const abortControllerRef = useRef(null); // ✅ track the current in-flight request

  useEffect(() => {
    return () => {
      clearTimeout(debounceTimer.current);
      abortControllerRef.current?.abort(); // ✅ cancel any in-flight request on unmount
    };
  }, []);

  const handleSearch = useCallback((query) => {
    clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      // ✅ abort the previous request before starting a new one
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      fetchAutocompleteOptions(
        filter,
        query,
        authenticatedFetch,
        setOptions,
        setLoading,
        abortControllerRef.current.signal // ✅ pass the signal
      );
    }, 300);
  }, [filter, authenticatedFetch]);

  const handleApply = useCallback(() => {
    onFilterChange(filter.key, draft);
    onApplied();
  }, [filter.key, draft, onFilterChange, onApplied]);

  return (
    <Box width="280px">
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          {t("configureField", {
            field: t(`fieldLabels.${filter.key}`, filter.label),
          })}
        </Text>

        {filter.operators.length > 0 && (
          <Select
            labelHidden
            options={filter.operators.map((op) => ({
              label: getTranslatedOperatorLabel(t, op),
              value: op,
            }))}
            value={draft.operator}
            onChange={(nextOperator) =>
              setDraft((prev) => ({ ...prev, operator: nextOperator }))
            }
          />
        )}

        <FilterValueInput
          filter={filter}
          value={draft.value}
          options={options}
          loading={loading}
          t={t}
          onChange={(nextValue) =>
            setDraft((prev) => ({ ...prev, value: nextValue }))
          }
          onSearch={handleSearch}
        />

        <Button
          variant="primary"
          disabled={
            operatorRequiresValue(draft.operator)
              ? !String(draft.value || "").trim()
              : false
          }
          onClick={handleApply}
        >
          {t("addFilter")}
        </Button>
      </BlockStack>
    </Box>
  );
});

export default FilterPanel;