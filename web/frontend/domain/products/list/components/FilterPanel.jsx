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
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

const MIN_AUTOCOMPLETE_QUERY_LENGTH = 2;
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

async function fetchAutocompleteOptions({ fetchWithAuth, api, query, signal }) {
  if (!api) return [];

  const response = await fetchWithAuth(
    `${api}?search=${encodeURIComponent(query)}&isNameOnly=true`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(`Autocomplete failed ${response.status}`);
  }

  const data = await response.json();

  const items = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
    ? data
    : [];

  return items.map(normalizeAutocompleteOption).filter(Boolean);
}

function isEmptyFilterValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return !String(value || "").trim();
}

const FilterPanel = memo(function FilterPanel({
  filter,
  initialFilter,
  onApply,
  onCancel,
  t,
}) {
  const fetchWithAuth = useAuthenticatedFetch();

  const operators = useMemo(
    () => (Array.isArray(filter.operators) ? filter.operators : []),
    [filter.operators]
  );

  const initialOperator = initialFilter?.operator || operators[0] || "";
  const initialValue = initialFilter?.value || "";

  const [draft, setDraft] = useState({
    operator: initialOperator,
    value: initialValue,
    inputText: initialValue,
  });

  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [autocompleteError, setAutocompleteError] = useState(false);

  const debounceTimer = useRef(null);
  const abortControllerRef = useRef(null);
  const requestSeqRef = useRef(0);

  const fieldLabel = filter.translatedLabel || filter.label || filter.key;

  const stableFilter = useMemo(
    () => filter,
    [
      filter.key,
      filter.type,
      filter.api,
      filter.isSearchable,
      filter.allowEmptySearchPreload,
      filter.label,
      filter.translatedLabel,
      JSON.stringify(filter.operators || []),
      JSON.stringify(filter.values || []),
    ]
  );

  const cancelAutocomplete = useCallback(() => {
    clearTimeout(debounceTimer.current);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  useEffect(() => {
    cancelAutocomplete();

    setDraft({
      operator: initialFilter?.operator || operators[0] || "",
      value: initialFilter?.value || "",
      inputText: initialFilter?.value || "",
    });

    setOptions([]);
    setLoading(false);
    setAutocompleteError(false);
  }, [
    cancelAutocomplete,
    filter.key,
    initialFilter?.operator,
    initialFilter?.value,
    operators,
  ]);

  useEffect(() => {
    return () => cancelAutocomplete();
  }, [cancelAutocomplete]);

  useEffect(() => {
    if (!filter.isSearchable || !draft.value) return;

    const match = options.find((option) => option.value === draft.value);

    if (match?.label && match.label !== draft.inputText) {
      setDraft((prev) => ({ ...prev, inputText: match.label }));
    }
  }, [draft.value, draft.inputText, filter.isSearchable, options]);

  const operatorOptions = useMemo(
    () =>
      operators.map((operator) => ({
        label: getTranslatedOperatorLabel(t, operator),
        value: operator,
      })),
    [operators, t]
  );

  const placeholder = useMemo(
    () =>
      t("searchPlaceholderField", {
        field: fieldLabel,
        defaultValue: `Search ${fieldLabel}`,
      }),
    [fieldLabel, t]
  );

  const enumChoices = useMemo(() => {
    if (filter.type !== "enum" || !Array.isArray(filter.values)) return [];

    return filter.values.map((entry) => ({
      label: t(`filterValueLabels.${entry}`, { defaultValue: entry }),
      value: entry,
    }));
  }, [filter.type, filter.values, t]);

  const runAutocompleteRequest = useCallback(
    async (query) => {
      if (!filter.api) return;

      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;

      abortControllerRef.current?.abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setAutocompleteError(false);

      try {
        const nextOptions = await fetchAutocompleteOptions({
          fetchWithAuth,
          api: filter.api,
          query,
          signal: controller.signal,
        });

        if (controller.signal.aborted || requestSeq !== requestSeqRef.current) {
          return;
        }

        setOptions(nextOptions);
      } catch (error) {
        if (error?.name === "AbortError") return;

        if (import.meta.env.DEV) {
          console.error("Autocomplete error", {
            filter: filter.key,
            error,
          });
        }

        if (requestSeq === requestSeqRef.current) {
          setOptions([]);
          setAutocompleteError(true);
        }
      } finally {
        if (
          !controller.signal.aborted &&
          requestSeq === requestSeqRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [fetchWithAuth, filter.api, filter.key]
  );

  const handleSearch = useCallback(
    (query) => {
      const raw = String(query || "");
      const normalized = raw.trim();
      const allowEmpty = Boolean(filter.allowEmptySearchPreload);

      setDraft((prev) => ({
        ...prev,
        inputText: raw,
        value: normalized ? prev.value : "",
      }));

      clearTimeout(debounceTimer.current);
      abortControllerRef.current?.abort();
      setAutocompleteError(false);

      if (!allowEmpty && normalized.length < MIN_AUTOCOMPLETE_QUERY_LENGTH) {
        setOptions([]);
        setLoading(false);
        return;
      }

      if (allowEmpty && normalized.length === 0) {
        runAutocompleteRequest("");
        return;
      }

      debounceTimer.current = setTimeout(() => {
        runAutocompleteRequest(normalized);
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    },
    [filter.allowEmptySearchPreload, runAutocompleteRequest]
  );

  const handleValueChange = useCallback((value, text = value) => {
    setDraft((prev) => ({
      ...prev,
      value,
      inputText: text,
    }));
  }, []);

  const handleOperatorChange = useCallback((operator) => {
    setDraft((prev) => ({ ...prev, operator }));
  }, []);

  const isApplyDisabled = useMemo(
    () =>
      operatorRequiresValue(draft.operator) && isEmptyFilterValue(draft.value),
    [draft.operator, draft.value]
  );

  const handleApply = useCallback(() => {
    const normalizedValue =
      typeof draft.value === "string" ? draft.value.trim() : draft.value;

    onApply({
      field: filter.key,
      operator: draft.operator,
      value: normalizedValue,
    });
  }, [draft.operator, draft.value, filter.key, onApply]);

  return (
    <Box width="100%" minWidth="280px" maxWidth="360px" padding="200">
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          {t("configureField", {
            field: fieldLabel,
            defaultValue: `Configure ${fieldLabel}`,
          })}
        </Text>

        {operators.length > 0 ? (
          <Select
            label={t("filterOperator", { defaultValue: "Filter operator" })}
            labelHidden
            options={operatorOptions}
            value={draft.operator}
            onChange={handleOperatorChange}
          />
        ) : null}

        <FilterValueInput
          filter={stableFilter}
          value={draft.value}
          inputText={draft.inputText}
          options={options}
          loading={loading}
          placeholder={placeholder}
          enumChoices={enumChoices}
          onChange={handleValueChange}
          onSearch={handleSearch}
        />

        {autocompleteError ? (
          <Text as="p" variant="bodySm" tone="critical">
            {t("autocompleteLoadFailed", {
              defaultValue: "Could not load suggestions.",
            })}
          </Text>
        ) : null}

        <InlineStack gap="200" align="end">
          <Button type="button" onClick={onCancel}>
            {t("cancel", { defaultValue: "Cancel" })}
          </Button>

          <Button
            type="button"
            variant="primary"
            disabled={isApplyDisabled}
            onClick={handleApply}
          >
            {t("addFilter", { defaultValue: "Add filter" })}
          </Button>
        </InlineStack>
      </BlockStack>
    </Box>
  );
});

export default FilterPanel;
