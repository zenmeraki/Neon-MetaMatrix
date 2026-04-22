import React, {
  memo,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { Box, BlockStack, Select, Button, InlineStack, Text } from "@shopify/polaris";
import FilterValueInput from "./FilterValueInput";
import {
  operatorRequiresValue,
  getTranslatedOperatorLabel,
  normalizeAutocompleteOption,
} from "../utils/filterUtils";

async function fetchAutocompleteOptions({
  filter,
  query,
  signal,
  setOptions,
  setLoading,
}) {
  if (!filter.api) return;

  setLoading(true);

  try {
    const res = await fetch(
      `${filter.api}?search=${encodeURIComponent(query)}&isNameOnly=true`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        credentials: "same-origin",
        signal,
      }
    );

    if (!res.ok) {
      throw new Error(`Autocomplete request failed with ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Autocomplete endpoint did not return JSON");
    }

    const data = await res.json();

    if (signal.aborted) return;

    const items = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];

    setOptions(items.map(normalizeAutocompleteOption).filter(Boolean));
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    console.error("Autocomplete fetch failed:", {
      filterKey: filter?.key,
      filterApi: filter?.api,
      query,
      error,
    });

    setOptions([]);
  } finally {
    if (!signal.aborted) {
      setLoading(false);
    }
  }
}

const FilterPanel = memo(function FilterPanel({
  filter,
  initialFilter,
  onApply,
  onCancel,
  t,
}) {
  const [draft, setDraft] = useState({
    operator: initialFilter?.operator || filter.operators[0] || "",
    value: initialFilter?.value || "",
    inputText: initialFilter?.value || "",
  });
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  const debounceTimer = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    setDraft({
      operator: initialFilter?.operator || filter.operators[0] || "",
      value: initialFilter?.value || "",
      inputText: initialFilter?.value || "",
    });
    setOptions([]);
    setLoading(false);
  }, [filter.key, filter.operators, initialFilter?.operator, initialFilter?.value]);

  useEffect(() => {
    return () => {
      clearTimeout(debounceTimer.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!filter.isSearchable || !draft.value || options.length === 0) return;

    const selectedOption = options.find((option) => option.value === draft.value);
    if (selectedOption?.label && selectedOption.label !== draft.inputText) {
      setDraft((prev) => ({
        ...prev,
        inputText: selectedOption.label,
      }));
    }
  }, [filter.isSearchable, draft.value, draft.inputText, options]);

 const MIN_AUTOCOMPLETE_QUERY_LENGTH = 2;

const handleSearch = useCallback(
  (query) => {
    const normalizedQuery = String(query || "").trimStart();

    setDraft((prev) => ({
      ...prev,
      inputText: query,
      value: normalizedQuery ? prev.value : "",
    }));

    clearTimeout(debounceTimer.current);
    abortControllerRef.current?.abort();

    const allowEmptyPreload = Boolean(filter.allowEmptySearchPreload);

    if (
      !allowEmptyPreload &&
      normalizedQuery.length < MIN_AUTOCOMPLETE_QUERY_LENGTH
    ) {
      setOptions([]);
      setLoading(false);
      return;
    }

    if (allowEmptyPreload && normalizedQuery.length === 0) {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      fetchAutocompleteOptions({
        filter,
        query: "",
        signal: controller.signal,
        setOptions,
        setLoading,
      });
      return;
    }

    debounceTimer.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      fetchAutocompleteOptions({
        filter,
        query: normalizedQuery,
        signal: controller.signal,
        setOptions,
        setLoading,
      });
    }, 300);
  },
  [filter]
);

  const handleValueChange = useCallback(
    (nextValue, nextInputText = nextValue) => {
      setDraft((prev) => ({
        ...prev,
        value: nextValue,
        inputText: nextInputText,
      }));
    },
    []
  );

  const handleApply = useCallback(() => {
    onApply({
      field: filter.key,
      operator: draft.operator,
      value: draft.value,
    });
  }, [filter.key, draft.operator, draft.value, onApply]);

  return (
    <Box width="280px" padding="200">
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
          inputText={draft.inputText}
          options={options}
          loading={loading}
          t={t}
          onChange={handleValueChange}
          onSearch={handleSearch}
        />

        <InlineStack gap="200" align="end">
          <Button onClick={onCancel}>
            {t("cancel", "Cancel")}
          </Button>
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
        </InlineStack>
      </BlockStack>
    </Box>
  );
});

export default FilterPanel;