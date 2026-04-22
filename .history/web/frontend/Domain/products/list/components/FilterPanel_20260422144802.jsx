import React, { memo, useState, useRef, useCallback } from "react";
import { Box, BlockStack, Select, Button, Text } from "@shopify/polaris";
import FilterValueInput from "./FilterValueInput";
import {
  operatorRequiresValue,
  getTranslatedOperatorLabel,
  normalizeAutocompleteOption,
} from "../utils/filterUtils";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch.js";

async function fetchAutocompleteOptions({
  fetchFn,
  filter,
  query,
  setOptions,
  setLoading,
}) {
  if (!filter.api || !fetchFn) return;

  setLoading(true);

  try {
    const response = await fetchFn(
      `${filter.api}?search=${encodeURIComponent(query)}&isNameOnly=true`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response) {
      // Reauth flow triggered
      return;
    }

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      throw new Error(`Autocomplete request failed with ${response.status}`);
    }

    if (!contentType.includes("application/json")) {
      throw new Error("Autocomplete endpoint did not return JSON");
    }

    const data = await response.json();

    const items = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];

    setOptions(items.map(normalizeAutocompleteOption).filter(Boolean));
  } catch (error) {
    console.error("Autocomplete fetch failed:", {
      filterKey: filter?.key,
      filterApi: filter?.api,
      query,
      error,
    });
    setOptions([]);
  } finally {
    setLoading(false);
  }
}

const FilterPanel = memo(function FilterPanel({
  filter,
  onFilterChange,
  onApplied,
  t,
}) {
  const authenticatedFetch = useAuthenticatedFetch();

  const [draft, setDraft] = useState({
    operator: filter.operators[0] || "",
    value: "",
  });
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef(null);

  const handleSearch = useCallback(
    (query) => {
      clearTimeout(debounceTimer.current);

      debounceTimer.current = setTimeout(() => {
        fetchAutocompleteOptions({
          fetchFn: authenticatedFetch,
          filter,
          query,
          setOptions,
          setLoading,
        });
      }, 300);
    },
    [authenticatedFetch, filter]
  );

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