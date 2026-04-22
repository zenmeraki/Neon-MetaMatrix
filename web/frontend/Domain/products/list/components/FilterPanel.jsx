import React, {
  memo,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  Box,
  BlockStack,
  Select,
  Button,
  InlineStack,
  Text,
} from "@shopify/polaris";
import FilterValueInput from "./FilterValueInput";
import {
  operatorRequiresValue,
  getTranslatedOperatorLabel,
  normalizeAutocompleteOption,
} from "../utils/filterUtils";

const MIN_AUTOCOMPLETE_QUERY_LENGTH = 2;

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
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal,
      }
    );

    if (!res.ok) throw new Error(`Autocomplete failed ${res.status}`);

    const data = await res.json();
    if (signal.aborted) return;

    const items = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];

    setOptions(items.map(normalizeAutocompleteOption).filter(Boolean));
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("Autocomplete error", { filter: filter.key, error });
      setOptions([]);
    }
  } finally {
    if (!signal.aborted) setLoading(false);
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

  // Reset when filter changes
  useEffect(() => {
    setDraft({
      operator: initialFilter?.operator || filter.operators[0] || "",
      value: initialFilter?.value || "",
      inputText: initialFilter?.value || "",
    });
    setOptions([]);
    setLoading(false);
  }, [filter.key, initialFilter]);

  // Cleanup
  useEffect(() => {
    return () => {
      clearTimeout(debounceTimer.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  // Sync label after selection
  useEffect(() => {
    if (!filter.isSearchable || !draft.value) return;

    const match = options.find((o) => o.value === draft.value);
    if (match?.label && match.label !== draft.inputText) {
      setDraft((prev) => ({ ...prev, inputText: match.label }));
    }
  }, [options, draft.value, draft.inputText, filter.isSearchable]);

  // Memoized operator labels
  const operatorOptions = useMemo(
    () =>
      filter.operators.map((op) => ({
        label: getTranslatedOperatorLabel(t, op),
        value: op,
      })),
    [filter.operators, t]
  );

  // Placeholder (only dynamic part)
  const placeholder = useMemo(
    () =>
      t("searchPlaceholderField", {
        field: filter.translatedLabel || filter.label,
      }),
    [t, filter.translatedLabel, filter.label]
  );

  // Enum labels
  const enumChoices = useMemo(() => {
    if (filter.type !== "enum") return [];
    return filter.values.map((entry) => ({
      label: t(`filterValueLabels.${entry}`, entry),
      value: entry,
    }));
  }, [filter.type, filter.values, t]);

  const handleSearch = useCallback(
    (query) => {
      const q = String(query || "").trimStart();

      setDraft((prev) => ({
        ...prev,
        inputText: query,
        value: q ? prev.value : "",
      }));

      clearTimeout(debounceTimer.current);
      abortControllerRef.current?.abort();

      const allowEmpty = Boolean(filter.allowEmptySearchPreload);

      if (!allowEmpty && q.length < MIN_AUTOCOMPLETE_QUERY_LENGTH) {
        setOptions([]);
        setLoading(false);
        return;
      }

      if (allowEmpty && q.length === 0) {
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
          query: q,
          signal: controller.signal,
          setOptions,
          setLoading,
        });
      }, 300);
    },
    [filter]
  );

  const handleValueChange = useCallback((val, text = val) => {
    setDraft((prev) => ({
      ...prev,
      value: val,
      inputText: text,
    }));
  }, []);

  const handleOperatorChange = useCallback((op) => {
    setDraft((prev) => ({ ...prev, operator: op }));
  }, []);

  const handleApply = useCallback(() => {
    onApply({
      field: filter.key,
      operator: draft.operator,
      value: draft.value,
    });
  }, [filter.key, draft, onApply]);

  return (
    <Box width="280px" padding="200">
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          {t("configureField", {
            field: filter.translatedLabel || filter.label,
          })}
        </Text>

        {filter.operators.length > 0 && (
          <Select
            labelHidden
            options={operatorOptions}
            value={draft.operator}
            onChange={handleOperatorChange}
          />
        )}

        <FilterValueInput
          filter={filter}
          value={draft.value}
          inputText={draft.inputText}
          options={options}
          loading={loading}
          placeholder={placeholder}
          enumChoices={enumChoices}
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