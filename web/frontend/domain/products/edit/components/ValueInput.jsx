// ValueInput.jsx
import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  TextField,
  FormLayout,
  ChoiceList,
  Select,
  Autocomplete,
  Icon,
  Text,
  Banner,
  Button,
  InlineStack,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import { getFieldDefinition, InputType, FieldType } from "../constants";
import { useFieldValidation } from "../hooks/useFiledValidation";
import { getValueValidationRules } from "../../../../utils/valueValidation";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

const AUTOCOMPLETE_MIN_QUERY_LENGTH = 2;
const AUTOCOMPLETE_SELECTION_LIMIT = 100;
const NUMERIC_VALUE_REGEX = /^-?\d+(\.\d+)?$/;

const ValueInput = ({
  selectedField,
  editType,
  value,
  onChange,
  searchReplace,
  onSearchReplaceChange,
  locationValue,
  onLocationChange,
  setSupportValue,
}) => {
  const { t } = useTranslation();
  const fetchWithAuth = useAuthenticatedFetch();
  const [helperText, setHelperText] = useState("");

  // State for autocomplete
  const [autocompleteOptions, setAutocompleteOptions] = useState([]);
  const [autocompleteInputValue, setAutocompleteInputValue] = useState("");
  const [selectedOptions, setSelectedOptions] = useState([]);

  // Add this after the config constant
  const [loadingAutocomplete, setLoadingAutocomplete] = useState(false);
  // State for locations
  const [apiLocations, setApiLocations] = useState([]);
  const [locationsCursor, setLocationsCursor] = useState(null);
  const [locationsHasMore, setLocationsHasMore] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [autocompleteSelectionError, setAutocompleteSelectionError] = useState("");

  // Debounce ref
  const debounceTimerRef = useRef(null);
  const autocompleteRequestIdRef = useRef(0);

  const fieldDef = useMemo(
    () => getFieldDefinition(selectedField?.value),
    [selectedField?.value]
  );
  const inputType = editType?.inputType || InputType.SINGLE;
  const config = editType || {};
  const allowMultiple = config.allowMultiple || false;

  const isPercentage = editType?.value?.toLowerCase().includes("percent");
  const isNumeric = fieldDef?.type === FieldType.NUMERIC;
  const isFixedValue =
    fieldDef?.value === "price" &&
    editType?.value?.toLowerCase().includes("set") &&
    !isPercentage;

  useEffect(() => {
    setHelperText("");
  }, [selectedField, editType]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Fetch autocomplete options
  const fetchAutocompleteOptions = useCallback(
    async (searchQuery) => {
      if (!config.apiEndpoint) return;
      const normalizedQuery = String(searchQuery || "").trim();
      const requestId = autocompleteRequestIdRef.current + 1;
      autocompleteRequestIdRef.current = requestId;

      setLoadingAutocomplete(true);
      try {
        const url = `${config.apiEndpoint}?isNameOnly=true&search=${encodeURIComponent(
          normalizedQuery
        )}`;

        const res = await fetchWithAuth(url);
        const json = await res.json();

        if (!res.ok) throw new Error(json.message || "Failed to fetch options");

        // Transform API response to autocomplete options format
        const options = (json.data || json).map((item) => ({
          value: String(item[config.valueKey || "value"]),
          label: item[config.labelKey || "label"],
        }));

        if (autocompleteRequestIdRef.current !== requestId) return;
        setAutocompleteOptions(options);
      } catch (err) {
        if (autocompleteRequestIdRef.current !== requestId) return;
        setHelperText(err.message || "Failed to load options");
        setAutocompleteOptions([]);
      } finally {
        if (autocompleteRequestIdRef.current === requestId) {
          setLoadingAutocomplete(false);
        }
      }
    },
    [config.apiEndpoint, config.labelKey, config.valueKey, fetchWithAuth]
  );

  // Fetch locations
  const fetchLocations = useCallback(async ({ cursor = null, append = false } = {}) => {
    try {
      setLoadingLocations(true);
      const query = new URLSearchParams({ limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const res = await fetchWithAuth(`/api/location/get-all?${query.toString()}`);
      const json = await res.json();

      if (!res.ok) throw new Error(json.message || "Failed to fetch locations");

      const locationOptions = (json.data || []).map((loc) => ({
          label: loc.title,
          value: String(loc.id),
        }));
      setLocationsCursor(json?.pageInfo?.nextCursor || null);
      setLocationsHasMore(Boolean(json?.pageInfo?.hasMore));

      const mergedOptions = append
        ? [
            ...apiLocations,
            ...locationOptions.filter(
              (candidate) => !apiLocations.some((existing) => existing.value === candidate.value)
            ),
          ]
        : locationOptions;

      if (!locationValue && locationOptions.length > 0) {
        onLocationChange(locationOptions[0].value);
      }

      setApiLocations(mergedOptions);
    } catch (err) {
      setHelperText(err.message || "Failed to fetch locations");
    } finally {
      setLoadingLocations(false);
    }
  }, [fetchWithAuth, locationValue, onLocationChange, apiLocations]);

  // Fetch locations for inventory
  useEffect(() => {
    if (inputType === InputType.LOCATION_SELECT) {
      fetchLocations({ cursor: null, append: false });
    }
  }, [inputType, fetchLocations]);

  const validationRules = useMemo(
    () => getValueValidationRules(isPercentage, isFixedValue),
    [isPercentage, isFixedValue]
  );

  const error = useFieldValidation(value, validationRules);

  useEffect(() => {
    if (inputType !== InputType.API_AUTOCOMPLETE) return;
    if (!Array.isArray(value)) {
      setSelectedOptions([]);
      return;
    }
    setSelectedOptions(value.map((item) => String(item)));
  }, [inputType, value]);

  useEffect(() => {
    setAutocompleteOptions([]);
    setAutocompleteInputValue("");
    setSelectedOptions([]);
    setAutocompleteSelectionError("");
  }, [selectedField?.value, editType?.value]);

  const handleChange = (val) => {
    if (typeof val !== "string") return;

    setHelperText("");

    if (isNumeric) {
      if (val === "") {
        onChange("");
        return;
      }
      if (!NUMERIC_VALUE_REGEX.test(val)) return;
      if (val === "." || val === "-" || val === "-.") return;
    }

    onChange(val);
  };

  const getLabel = () => {
    const editOperation = editType?.operation || "";
    const editValueText = String(editType?.value || "").toLowerCase();

    if (editOperation === "decrease" || editValueText.includes("decrease"))
      return t("DecreaseValue");

    if (editOperation === "increase" || editValueText.includes("increase"))
      return t("IncreaseValue");

    if (editOperation === "set" || editValueText.includes("set"))
      return t("new_value");

    return config.inputHelperLabel
      ? t(config.inputHelperLabel)
      : t("value");
  };

  // Autocomplete handlers with proper debounce
  const updateAutocompleteText = useCallback(
    (newValue) => {
      setAutocompleteInputValue(newValue);

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new timer
      debounceTimerRef.current = setTimeout(() => {
        if (newValue.trim().length >= AUTOCOMPLETE_MIN_QUERY_LENGTH) {
          fetchAutocompleteOptions(newValue);
        } else {
          setAutocompleteOptions([]);
          setLoadingAutocomplete(false);
        }
      }, 500); // 500ms debounce delay
    },
    [fetchAutocompleteOptions]
  );

  const updateSelection = useCallback(
    (selected) => {
      if (allowMultiple) {
        const cappedSelection = selected.slice(0, AUTOCOMPLETE_SELECTION_LIMIT);
        setSelectedOptions(cappedSelection);

        const selectedLabels = cappedSelection
          .map((selectedItem) => {
            const matchedOption = autocompleteOptions.find((option) => {
              return option.value === selectedItem;
            });
            return matchedOption?.label;
          })
          .filter(Boolean);

        setAutocompleteInputValue("");
        setAutocompleteSelectionError(
          selected.length > AUTOCOMPLETE_SELECTION_LIMIT
            ? t("selectionLimitReached", {
                defaultValue: `Selection limited to ${AUTOCOMPLETE_SELECTION_LIMIT} items.`,
              })
            : ""
        );

        onChange(cappedSelection);

        setSupportValue && setSupportValue(selectedLabels);
      } else {
        const selectedValue = selected.map((selectedItem) => {
          const matchedOption = autocompleteOptions.find((option) => {
            return option.value === selectedItem;
          });
          return matchedOption && matchedOption.label;
        });

        setSelectedOptions(selected);
        setAutocompleteInputValue(selectedValue[0] || "");
        onChange(selected[0] || "");
        setAutocompleteSelectionError("");

        setSupportValue && setSupportValue(selectedValue[0] || "");
      }
    },
    [autocompleteOptions, onChange, allowMultiple, setSupportValue, t]
  );

  const autocompleteTextField = (
    <Autocomplete.TextField
      onChange={updateAutocompleteText}
      label={
        config.inputHelperLabel
          ? t(config.inputHelperLabel)
          : t("selectCategory")
      }
      value={autocompleteInputValue}
      prefix={<Icon source={SearchIcon} />}
      placeholder={
        allowMultiple
          ? t("search_multiple", { defaultValue: "Search and select multiple..." })
          : t("search", { defaultValue: "Search..." })
      }
      autoComplete="off"
      error={helperText || autocompleteSelectionError}
      helpText={t("autocompleteMinChars", {
        defaultValue: `Type at least ${AUTOCOMPLETE_MIN_QUERY_LENGTH} characters to search.`,
      })}
    />
  );

  switch (inputType) {
    case InputType.CHOICE_LIST:
      return (
        <ChoiceList
          title={t(editType?.inputHelperLabel || "Select Option", {
            defaultValue: editType?.inputHelperLabel || "Select Option",
          })}
          choices={(config.choices || []).map((choice) => ({
            ...choice,
            label: t(choice.label, { defaultValue: choice.label }),
          }))}
          selected={
            value !== undefined && value !== null ? [String(value)] : []
          }
          onChange={(selected) => onChange(selected[0] ?? "")}
        />
      );

    case InputType.SEARCH_REPLACE:
      return (
        <FormLayout>
          <FormLayout.Group condensed>
            <TextField
              label={
                config.searchLabel
                  ? t(config.searchLabel)
                  : t("searchFor")
              }
              value={
                typeof searchReplace?.search === "string"
                  ? searchReplace.search
                  : ""
              }
              onChange={(val) =>
                onSearchReplaceChange?.({
                  search: val,
                  replace: searchReplace?.replace || "",
                })
              }
              error={
                typeof searchReplace?.search === "string" &&
                searchReplace.search.trim().length === 0
                  ? t("searchRequired", { defaultValue: "Search value is required." })
                  : undefined
              }
              autoComplete="off"
            />

            <TextField
              label={
                config.replaceLabel
                  ? t(config.replaceLabel)
                  : t("replaceWith")
              }
              value={
                typeof searchReplace?.replace === "string"
                  ? searchReplace.replace
                  : ""
              }
              onChange={(val) =>
                onSearchReplaceChange?.({
                  search: searchReplace?.search || "",
                  replace: val,
                })
              }
              autoComplete="off"
            />
          </FormLayout.Group>
        </FormLayout>
      );

    case InputType.LOCATION_SELECT:
      return (
        <FormLayout>
          <TextField
            label={getLabel()}
            value={typeof value === "string" ? value : ""}
            onChange={handleChange}
            error={error || undefined}
            helpText={helperText || undefined}
            autoComplete="off"
          />
          <Select
            label={t("location", { defaultValue: "Location" })}
            options={apiLocations}
            value={locationValue || "all"}
            onChange={onLocationChange}
            disabled={apiLocations.length === 0 || loadingLocations}
          />
          {locationsHasMore ? (
            <InlineStack align="start">
              <Button
                variant="plain"
                onClick={() => fetchLocations({ cursor: locationsCursor, append: true })}
                loading={loadingLocations}
                disabled={loadingLocations}
              >
                {t("loadMore", { defaultValue: "Load more" })}
              </Button>
            </InlineStack>
          ) : null}
        </FormLayout>
      );

    // API-driven autocomplete with debounce
    case InputType.API_AUTOCOMPLETE:
      return (
        <Autocomplete
          options={autocompleteOptions}
          selected={selectedOptions}
          onSelect={updateSelection}
          loading={loadingAutocomplete}
          textField={autocompleteTextField}
          allowMultiple={allowMultiple}
        />
      );

    case InputType.NONE:
      return (
        <Banner tone={config.bannerTone || "warning"}>
          <Text as="p">
            {editType?.inputHelperLabel
              ? t(editType.inputHelperLabel)
              : t("permanentAction")}
          </Text>
        </Banner>
      );

    default:
      return (
        <TextField
          label={getLabel()}
          value={typeof value === "string" ? value : ""}
          onChange={handleChange}
          error={error || undefined}
          helpText={helperText || undefined}
          autoComplete="off"
        />
      );
  }
};

export default ValueInput;
