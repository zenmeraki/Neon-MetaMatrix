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

  // State for autocomplete
  const [autocompleteOptions, setAutocompleteOptions] = useState([]);
  const [autocompleteInputValue, setAutocompleteInputValue] = useState("");
  // Update the state for autocomplete to track multiple selections
  const [selectedOptions, setSelectedOptions] = useState([]);

  // Add this after the config constant
  const [loadingAutocomplete, setLoadingAutocomplete] = useState(false);
  // State for locations
  const [apiLocations, setApiLocations] = useState([]);

  // Debounce ref
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
    autocompleteInputValue && setSupportValue(autocompleteInputValue);
  }, [autocompleteInputValue]);
  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Fetch locations for inventory
  useEffect(() => {
    if (inputType === InputType.LOCATION_SELECT) {
      fetchLocations();
    }
  }, [inputType]);

  // Fetch autocomplete options
  const fetchAutocompleteOptions = useCallback(
    async (searchQuery) => {
      if (!config.apiEndpoint) return;

      setLoadingAutocomplete(true);
      try {
        // Add search query as parameter if provided
        const url = searchQuery
          ? `${config.apiEndpoint}?isNameOnly=true&search=${encodeURIComponent(
            searchQuery
          )}`
          : config.apiEndpoint;

        const res = await fetch(url);
        const json = await res.json();

        if (!res.ok) throw new Error(json.message || "Failed to fetch options");

        // Transform API response to autocomplete options format
        const options = (json.data || json).map((item) => ({
          value: String(item[config.valueKey || "value"]),
          label: item[config.labelKey || "label"],
        }));

        setAutocompleteOptions(options);
      } catch (err) {
        console.error("Failed to fetch autocomplete options:", err);
        setHelperText(err.message || "Failed to load options");
        setAutocompleteOptions([]);
      } finally {
        setLoadingAutocomplete(false);
      }
    },
    [config.apiEndpoint, config.labelKey, config.valueKey]
  );

  // Fetch locations
  const fetchLocations = async () => {
    try {
      const res = await fetch("/api/location/get-all");
      const json = await res.json();

      if (!res.ok) throw new Error(json.message || "Failed to fetch locations");

      const locationOptions = [
        ...json.data.map((loc) => ({
          label: loc.title,
          value: String(loc.id),
        })),
      ];
      onLocationChange(
        locationOptions.length > 0 ? locationOptions[0].value : "all"
      );

      setApiLocations(locationOptions);
    } catch (err) {
      console.error("Failed to fetch locations:", err);
    }
  };

  // Initial fetch for autocomplete
  useEffect(() => {
    if (inputType === InputType.API_AUTOCOMPLETE) {
      fetchAutocompleteOptions("");
    }
  }, [inputType, fetchAutocompleteOptions]);

  const validationRules = useMemo(
    () => getValueValidationRules(isPercentage, isFixedValue),
    [isPercentage, isFixedValue]
  );

  const error = useFieldValidation(value, validationRules);

  const handleChange = (val) => {
    if (typeof val !== "string") return;

    setHelperText("");

    if (isNumeric) {
      // if (val.includes("-")) {
      //   setHelperText("Negative value is not allowed");
      //   return;
      // }
      if (!/^\d*\.?\d*$/.test(val)) return;
      // if (isPercentage && Number(val) > 100) return;
    }

    onChange(val);
  };

  const getLabel = () => {
    if (editType?.value?.toLowerCase().includes("decrease"))
      return t("DecreaseValue", { defaultValue: "Decrease Value" });

    if (editType?.value?.toLowerCase().includes("increase"))
      return t("IncreaseValue", { defaultValue: "Increase Value" });

    if (editType?.value?.toLowerCase().includes("set"))
      return t("new_value", { defaultValue: "New Value" });

    return t(config.inputHelperLabel || "value", {
      defaultValue: config.inputHelperLabel || "Value",
    });
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
        if (newValue.length > 0) {
          fetchAutocompleteOptions(newValue);
        } else {
          fetchAutocompleteOptions("");
        }
      }, 500); // 500ms debounce delay
    },
    [fetchAutocompleteOptions]
  );

  const updateSelection = useCallback(
    (selected) => {
      if (allowMultiple) {
        // Multiple selection mode
        setSelectedOptions(selected);

        // Get labels for display
        const selectedLabels = selected
          .map((selectedItem) => {
            const matchedOption = autocompleteOptions.find((option) => {
              return option.value === selectedItem;
            });
            return matchedOption?.label;
          })
          .filter(Boolean);

        setAutocompleteInputValue(selectedLabels.join(", "));

        // Pass array of IDs for multiple selection
        onChange(selected.join(","));

        // Set support value with collection names for display
        setSupportValue && setSupportValue(selectedLabels.join(", "));
      } else {
        // Single selection mode (existing logic)
        const selectedValue = selected.map((selectedItem) => {
          const matchedOption = autocompleteOptions.find((option) => {
            return option.value === selectedItem;
          });
          return matchedOption && matchedOption.label;
        });

        setSelectedOptions(selected);
        setAutocompleteInputValue(selectedValue[0] || "");
        onChange(selected[0] || "");

        // Set support value with category name for display
        setSupportValue && setSupportValue(selectedValue[0] || "");
      }
    },
    [autocompleteOptions, onChange, allowMultiple, setSupportValue]
  );

  const autocompleteTextField = (
    <Autocomplete.TextField
      onChange={updateAutocompleteText}
      label={t(config.inputHelperLabel || "select_category", {
        defaultValue: config.inputHelperLabel || "Select Category",
      })}
      value={autocompleteInputValue}
      prefix={<Icon source={SearchIcon} />}
      placeholder={
        allowMultiple
          ? t("search_multiple", { defaultValue: "Search and select multiple..." })
          : t("search", { defaultValue: "Search..." })
      }
      autoComplete="off"
      error={helperText}
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
              label={t(config.searchLabel || "search_for", {
                defaultValue: config.searchLabel || "Search For",
              })}
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
              autoComplete="off"
            />

            <TextField
              label={t(config.replaceLabel || "replace_with", {
                defaultValue: config.replaceLabel || "Replace With",
              })}
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
            error={helperText || error}
            autoComplete="off"
          />
          <Select
            label={t("location", { defaultValue: "Location" })}
            options={apiLocations}
            value={locationValue || "all"}
            onChange={onLocationChange}
            disabled={apiLocations.length === 0}
          />
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
        <Banner tone="critical">
          <Text as="p">
            {editType?.inputHelperLabel ||
              t("permanent_action", {
                defaultValue: "This action is permanent and cannot be undone.",
              })}
          </Text>
        </Banner>
      );

    default:
      return (
        <TextField
          label={getLabel()}
          value={typeof value === "string" ? value : ""}
          onChange={handleChange}
          error={helperText || error}
          autoComplete="off"
        />
      );
  }
};

export default ValueInput;
