import React, { useState } from "react";
import {
  ChoiceList,
  TextField,
  Autocomplete,
} from "@shopify/polaris";

function FilterValueInput({
  filter,
  value,
  onChange,
  onSearch,
  options,
  loading,
  t,
}) {
  const [inputValue, setInputValue] = useState("");

  if (filter.isSearchable) {
    return (
      <Autocomplete
        options={options}
        selected={value ? [value] : []}
        loading={loading}
        onSelect={([selected]) => {
          onChange(selected);

          const selectedOption =
            options.find((option) => option.value === selected);

          if (selectedOption) {
            setInputValue(selectedOption.label);
          }
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
        onChange={([next]) => onChange(next)}
      />
    );
  }

  if (filter.type === "number") {
    return (
      <TextField
        type="number"
        labelHidden
        value={value}
        onChange={onChange}
      />
    );
  }

  if (filter.type === "date") {
    return (
      <TextField
        type="date"
        labelHidden
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <TextField
      labelHidden
      value={value}
      onChange={onChange}
    />
  );
}

export default FilterValueInput;