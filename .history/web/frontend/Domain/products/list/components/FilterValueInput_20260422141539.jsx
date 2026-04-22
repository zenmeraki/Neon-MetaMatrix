import React, { useState, useEffect } from "react";
import { ChoiceList, TextField, Autocomplete } from "@shopify/polaris";

function FilterValueInput({
  filter,
  value,
  onChange,
  onSearch,
  options,
  loading,
  t,
}) {
  const [inputValue, setInputValue] = useState(value || "");

  // ✅ keep display in sync if draft.value is reset externally (e.g. after apply)
  useEffect(() => {
    if (!value) {
      setInputValue("");
    }
  }, [value]);

  if (filter.isSearchable) {
    return (
      <Autocomplete
        options={options}
        selected={value ? [value] : []}
        loading={loading}
        onSelect={([selected]) => {
          const selectedOption = options.find((o) => o.value === selected);
          const label = selectedOption?.label ?? selected;
          onChange(selected);        // ✅ set draft.value to selected option value
          setInputValue(label);      // ✅ show readable label in the input
        }}
        textField={
          <Autocomplete.TextField
            labelHidden
            placeholder={t("searchPlaceholderField", {
              field: t(`fieldLabels.${filter.key}`, filter.label),
            })}
            autoComplete="off"
            value={inputValue}
            onFocus={() => onSearch(inputValue)}
            onChange={(text) => {
              setInputValue(text);
              onChange(text);   // ✅ update draft.value as user types — enables the button
              onSearch(text);   // ✅ fetch matching options
            }}
          />
        }
      />
    );
  }

  if (filter.type === "enum") {
    return (
      <ChoiceList
        titleHidden
        choices={filter.values.map((entry) => ({
          label: t(`filterValueLabels.${entry}`, entry),
          value: entry,
        }))}
        selected={value ? [value] : []}
        onChange={([next]) => onChange(next)}
      />
    );
  }

  if (filter.type === "number") {
    return <TextField type="number" labelHidden value={value} onChange={onChange} />;
  }

  if (filter.type === "date") {
    return <TextField type="date" labelHidden value={value} onChange={onChange} />;
  }

  return <TextField labelHidden value={value} onChange={onChange} />;
}

export default FilterValueInput;