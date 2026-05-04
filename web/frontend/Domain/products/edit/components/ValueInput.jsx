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
  Box,
  BlockStack,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import { getFieldDefinition, InputType, FieldType } from "../constants";
import { useFieldValidation } from "../hooks/useFiledValidation";
import { getValueValidationRules } from "../../../../utils/valueValidation";

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
  const [helperText, setHelperText] = useState("");

  const [autocompleteOptions, setAutocompleteOptions] = useState([]);
  const [autocompleteInputValue, setAutocompleteInputValue] = useState("");
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [loadingAutocomplete, setLoadingAutocomplete] = useState(false);
  const [apiLocations, setApiLocations] = useState([]);

  const debounceTimerRef = useRef(null);

  const fieldDef = getFieldDefinition(selectedField?.value);
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

  useEffect(() => {
    if (autocompleteInputValue) setSupportValue(autocompleteInputValue);
  }, [autocompleteInputValue]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (inputType === InputType.LOCATION_SELECT) fetchLocations();
  }, [inputType]);

  const fetchAutocompleteOptions = useCallback(
    async (searchQuery) => {
      if (!config.apiEndpoint) return;
      setLoadingAutocomplete(true);
      try {
        const url = searchQuery
          ? `${config.apiEndpoint}?isNameOnly=true&search=${encodeURIComponent(searchQuery)}`
          : config.apiEndpoint;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || "Failed to fetch options");
        setAutocompleteOptions(
          (json.data || json).map((item) => ({
            value: String(item[config.valueKey || "value"]),
            label: item[config.labelKey || "label"],
          }))
        );
      } catch (err) {
        setHelperText(err.message || "Failed to load options");
        setAutocompleteOptions([]);
      } finally {
        setLoadingAutocomplete(false);
      }
    },
    [config.apiEndpoint, config.labelKey, config.valueKey]
  );

  const fetchLocations = async () => {
    try {
      const res = await fetch("/api/location/get-all");
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to fetch locations");
      const locationOptions = json.data.map((loc) => ({
        label: loc.title,
        value: String(loc.id),
      }));
      onLocationChange(locationOptions.length > 0 ? locationOptions[0].value : "all");
      setApiLocations(locationOptions);
    } catch (err) {
      console.error("Failed to fetch locations:", err);
    }
  };

  useEffect(() => {
    if (inputType === InputType.API_AUTOCOMPLETE) fetchAutocompleteOptions("");
  }, [inputType, fetchAutocompleteOptions]);

  const validationRules = useMemo(
    () => getValueValidationRules(isPercentage, isFixedValue),
    [isPercentage, isFixedValue]
  );

  const error = useFieldValidation(value, validationRules);

  const handleChange = (val) => {
    if (typeof val !== "string") return;
    setHelperText("");
    if (isNumeric && !/^\d*\.?\d*$/.test(val)) return;
    onChange(val);
  };

  const getLabel = () => {
    const v = editType?.value?.toLowerCase() || "";
    if (v.includes("decrease")) return t("DecreaseValue", { defaultValue: "Decrease by" });
    if (v.includes("increase")) return t("IncreaseValue", { defaultValue: "Increase by" });
    if (v.includes("set")) return t("new_value", { defaultValue: "New value" });
    return config.inputHelperLabel ? t(config.inputHelperLabel) : t("value", { defaultValue: "Value" });
  };

  const getSuffix = () => {
    if (isPercentage) return "%";
    if (isFixedValue) return null;
    return null;
  };

  const updateAutocompleteText = useCallback(
    (newValue) => {
      setAutocompleteInputValue(newValue);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        fetchAutocompleteOptions(newValue.length > 0 ? newValue : "");
      }, 500);
    },
    [fetchAutocompleteOptions]
  );

  const updateSelection = useCallback(
    (selected) => {
      if (allowMultiple) {
        setSelectedOptions(selected);
        const selectedLabels = selected
          .map((s) => autocompleteOptions.find((o) => o.value === s)?.label)
          .filter(Boolean);
        setAutocompleteInputValue(selectedLabels.join(", "));
        onChange(selected.join(","));
        setSupportValue && setSupportValue(selectedLabels.join(", "));
      } else {
        const matched = autocompleteOptions.find((o) => o.value === selected[0]);
        setSelectedOptions(selected);
        setAutocompleteInputValue(matched?.label || "");
        onChange(selected[0] || "");
        setSupportValue && setSupportValue(matched?.label || "");
      }
    },
    [autocompleteOptions, onChange, allowMultiple, setSupportValue]
  );

  const autocompleteTextField = (
    <Autocomplete.TextField
      onChange={updateAutocompleteText}
      label={
        config.inputHelperLabel
          ? t(config.inputHelperLabel)
          : t("selectCategory", { defaultValue: "Search" })
      }
      value={autocompleteInputValue}
      prefix={<Icon source={SearchIcon} tone="subdued" />}
      placeholder={
        allowMultiple
          ? t("search_multiple", { defaultValue: "Search and select multiple…" })
          : t("search", { defaultValue: "Search…" })
      }
      autoComplete="off"
      clearButton={Boolean(autocompleteInputValue)}
      onClearButtonClick={() => {
        setAutocompleteInputValue("");
        setSelectedOptions([]);
        onChange("");
        fetchAutocompleteOptions("");
      }}
      error={helperText}
    />
  );

  switch (inputType) {
    case InputType.CHOICE_LIST:
      return (
        <Box>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="medium">
              {t(editType?.inputHelperLabel || "Select option", {
                defaultValue: editType?.inputHelperLabel || "Select option",
              })}
            </Text>
            <ChoiceList
              title=""
              titleHidden
              choices={(config.choices || []).map((choice) => ({
                ...choice,
                label: t(choice.label, { defaultValue: choice.label }),
              }))}
              selected={value !== undefined && value !== null ? [String(value)] : []}
              onChange={(selected) => onChange(selected[0] ?? "")}
            />
          </BlockStack>
        </Box>
      );

    case InputType.SEARCH_REPLACE:
      return (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd" fontWeight="medium">
            {t("searchAndReplace", { defaultValue: "Search & Replace" })}
          </Text>
          <FormLayout>
            <FormLayout.Group condensed>
              <TextField
                label={config.searchLabel ? t(config.searchLabel) : t("searchFor", { defaultValue: "Search for" })}
                value={typeof searchReplace?.search === "string" ? searchReplace.search : ""}
                onChange={(val) =>
                  onSearchReplaceChange?.({
                    search: val,
                    replace: searchReplace?.replace || "",
                  })
                }
                placeholder={t("searchPlaceholder", { defaultValue: "Text to find…" })}
                autoComplete="off"
              />
              <TextField
                label={config.replaceLabel ? t(config.replaceLabel) : t("replaceWith", { defaultValue: "Replace with" })}
                value={typeof searchReplace?.replace === "string" ? searchReplace.replace : ""}
                onChange={(val) =>
                  onSearchReplaceChange?.({
                    search: searchReplace?.search || "",
                    replace: val,
                  })
                }
                placeholder={t("replacePlaceholder", { defaultValue: "Replacement text…" })}
                autoComplete="off"
              />
            </FormLayout.Group>
          </FormLayout>
        </BlockStack>
      );

    case InputType.LOCATION_SELECT:
      return (
        <FormLayout>
          <FormLayout.Group condensed>
            <TextField
              label={getLabel()}
              value={typeof value === "string" ? value : ""}
              onChange={handleChange}
              suffix={getSuffix()}
              error={helperText || error}
              autoComplete="off"
            />
            <Select
              label={t("location", { defaultValue: "Inventory location" })}
              options={apiLocations}
              value={locationValue || "all"}
              onChange={onLocationChange}
              disabled={apiLocations.length === 0}
              placeholder={
                apiLocations.length === 0
                  ? t("loadingLocations", { defaultValue: "Loading locations…" })
                  : undefined
              }
            />
          </FormLayout.Group>
        </FormLayout>
      );

    case InputType.API_AUTOCOMPLETE:
      return (
        <BlockStack gap="100">
          <Autocomplete
            options={autocompleteOptions}
            selected={selectedOptions}
            onSelect={updateSelection}
            loading={loadingAutocomplete}
            textField={autocompleteTextField}
            allowMultiple={allowMultiple}
            emptyState={
              <Box padding="400">
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  {t("noOptionsFound", { defaultValue: "No options found" })}
                </Text>
              </Box>
            }
          />
          {allowMultiple && selectedOptions.length > 0 && (
            <Box paddingBlockStart="100">
              <InlineStack gap="150" wrap>
                {selectedOptions.map((opt) => {
                  const label = autocompleteOptions.find((o) => o.value === opt)?.label || opt;
                  return (
                    <Badge key={opt} tone="info">
                      {label}
                    </Badge>
                  );
                })}
              </InlineStack>
            </Box>
          )}
        </BlockStack>
      );

    case InputType.NONE:
      return (
        <Banner tone="warning">
          <Text as="p" variant="bodyMd">
            {editType?.inputHelperLabel
              ? t(editType.inputHelperLabel)
              : t("permanentAction", { defaultValue: "This action cannot be undone. Review carefully before applying." })}
          </Text>
        </Banner>
      );

    default:
      return (
        <TextField
          label={getLabel()}
          value={typeof value === "string" ? value : ""}
          onChange={handleChange}
          suffix={getSuffix()}
          error={helperText || error}
          autoComplete="off"
          placeholder={
            isPercentage
              ? t("percentagePlaceholder", { defaultValue: "e.g. 10" })
              : t("valuePlaceholder", { defaultValue: "Enter value…" })
          }
        />
      );
  }
};

export default ValueInput;