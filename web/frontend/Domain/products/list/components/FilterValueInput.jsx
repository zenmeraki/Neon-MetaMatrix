import React from "react";
import {
  ChoiceList,
  TextField,
  Autocomplete,
} from "@shopify/polaris";

function FilterValueInput({
  filter,
  value,
  inputText,
  onChange,
  onSearch,
  options,
  loading,
  t,
}) {
  if (filter.isSearchable) {
    return (
      <Autocomplete
        options={options}
        selected={value ? [value] : []}
        loading={loading}
        onSelect={([selected]) => {
          const option = options.find((entry) => entry.value === selected);

          onChange(
            selected,
            option?.label || selected || ""
          );
        }}
        textField={
          <Autocomplete.TextField
            labelHidden
            placeholder={t("searchPlaceholderField", {
              field: t(`fieldLabels.${filter.key}`, filter.label),
            })}
            autoComplete="off"
            value={inputText}
            onFocus={() => onSearch(inputText || "")}
            onChange={(text) => {
              onSearch(text);
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
        onChange={([next]) => onChange(next, next)}
      />
    );
  }

  if (filter.type === "number") {
    return (
      <TextField
        type="number"
        labelHidden
        value={value}
        onChange={(next) => onChange(next, next)}
      />
    );
  }

  if (filter.type === "date") {
    return (
      <TextField
        type="date"
        labelHidden
        value={value}
        onChange={(next) => onChange(next, next)}
      />
    );
  }

  return (
    <TextField
      labelHidden
      value={value}
      onChange={(next) => onChange(next, next)}
    />
  );
}

export default FilterValueInput;