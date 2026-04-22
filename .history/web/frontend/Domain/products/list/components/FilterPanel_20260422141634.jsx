import React, { memo, useState, useRef, useCallback, useEffect } from "react"; // ✅ add useEffect
import { Box, BlockStack, Select, Button, Text } from "@shopify/polaris";
import { useAuthenticatedFetch } from "@shopify/app-bridge-react";
import FilterValueInput from "./FilterValueInput";
import {
  operatorRequiresValue,
  getTranslatedOperatorLabel,
  normalizeAutocompleteOption,
} from "../utils/filterUtils";

// ✅ authenticatedFetch is now correctly in the parameter list
async function fetchAutocompleteOptions(filter, query, authenticatedFetch, setOptions, setLoading) {
  if (!filter.api) return;
  setLoading(true);
  try {
    const res = await authenticatedFetch(
      `${filter.api}?search=${encodeURIComponent(query)}&isNameOnly=true`
    );
    if (!res.ok) throw new Error("Failed");
    const data = await res.json();
    const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    setOptions(items.map(normalizeAutocompleteOption).filter(Boolean));
  } catch {
    setOptions([]);
  } finally {
    setLoading(false);
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

  // ✅ clear pending timer on unmount — prevents stale async work and leak
  useEffect(() => {
    return () => clearTimeout(debounceTimer.current);
  }, []);

  const handleSearch = useCallback((query) => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchAutocompleteOptions(filter, query, authenticatedFetch, setOptions, setLoading);
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