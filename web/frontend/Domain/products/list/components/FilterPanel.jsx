// FilterPanel.jsx
import React, { memo, useState, useRef, useCallback } from "react";
import { Box, BlockStack, Select, Button, Text } from "@shopify/polaris";
import FilterValueInput from "./FilterValueInput";
import { operatorRequiresValue, getTranslatedOperatorLabel,normalizeAutocompleteOption } from "../utils/filterUtils";

async function fetchAutocompleteOptions(filter, query, setOptions, setLoading) {
  if (!filter.api) return;
  setLoading(true);
  try {
    const res = await fetch(
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

const FilterPanel = memo(function FilterPanel({ filter, onFilterChange,onApplied, t }) {
  // ✅ Each filter owns its own state — no cross-filter re-renders
  const [draft, setDraft] = useState({
    operator: filter.operators[0] || "",
    value: "",
  });
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef(null);

  const handleSearch = useCallback((query) => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchAutocompleteOptions(filter, query, setOptions, setLoading);
    }, 300);
  }, [filter]);

  const handleApply = useCallback(() => {
    onFilterChange(filter.key, draft);
    onApplied();
  }, [filter.key, draft, onFilterChange,onApplied]);

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