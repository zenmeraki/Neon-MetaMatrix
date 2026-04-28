import React, { memo, useCallback, useMemo } from "react";
import { ChoiceList, TextField, Autocomplete } from "@shopify/polaris";

const FilterValueInput = memo(function FilterValueInput({
  filter,
  value,
  inputText,
  onChange,
  onSearch,
  options = [],
  loading = false,
  placeholder = "",
  enumChoices = [],
}) {
  const label =
    filter?.translatedLabel || filter?.label || filter?.key || "Filter value";

  const selectedValues = useMemo(() => {
    if (value === undefined || value === null || value === "") return [];
    return [String(value)];
  }, [value]);

  const safeOptions = useMemo(
    () =>
      options.map((option) => ({
        label: String(option?.label ?? option?.value ?? ""),
        value: String(option?.value ?? ""),
      })),
    [options]
  );

  const safeEnumChoices = useMemo(
    () =>
      enumChoices.map((choice) => ({
        label: String(choice?.label ?? choice?.value ?? ""),
        value: String(choice?.value ?? ""),
      })),
    [enumChoices]
  );

  const handleAutocompleteSelect = useCallback(
    ([selected]) => {
      const selectedValue = selected || "";
      const option = safeOptions.find((entry) => entry.value === selectedValue);

      onChange(selectedValue, option?.label || selectedValue);
    },
    [onChange, safeOptions]
  );

  const handleTextChange = useCallback(
    (nextValue) => {
      onChange(nextValue, nextValue);
    },
    [onChange]
  );

  const handleChoiceChange = useCallback(
    ([nextValue]) => {
      const selectedValue = nextValue || "";
      onChange(selectedValue, selectedValue);
    },
    [onChange]
  );

  const handleFocus = useCallback(() => {
    if (typeof onSearch === "function") {
      onSearch(inputText || "");
    }
  }, [inputText, onSearch]);

  if (filter?.isSearchable) {
    return (
      <Autocomplete
        options={safeOptions}
        selected={selectedValues}
        loading={loading}
        onSelect={handleAutocompleteSelect}
        textField={
          <Autocomplete.TextField
            label={label}
            labelHidden
            placeholder={placeholder}
            autoComplete="off"
            value={inputText || ""}
            onFocus={handleFocus}
            onChange={onSearch}
          />
        }
      />
    );
  }

  if (filter?.type === "enum") {
    return (
      <ChoiceList
        title={label}
        titleHidden
        choices={safeEnumChoices}
        selected={selectedValues}
        onChange={handleChoiceChange}
      />
    );
  }

  if (filter?.type === "number") {
    return (
      <TextField
        type="number"
        label={label}
        labelHidden
        value={String(value ?? "")}
        autoComplete="off"
        placeholder={placeholder}
        onChange={handleTextChange}
      />
    );
  }

  if (filter?.type === "date") {
    return (
      <TextField
        type="date"
        label={label}
        labelHidden
        value={String(value ?? "")}
        autoComplete="off"
        onChange={handleTextChange}
      />
    );
  }

  return (
    <TextField
      label={label}
      labelHidden
      value={String(value ?? "")}
      autoComplete="off"
      placeholder={placeholder}
      onChange={handleTextChange}
    />
  );
});

export default FilterValueInput;
