import React, { memo } from "react";
import {
  ChoiceList,
  TextField,
  Autocomplete,
} from "@shopify/polaris";

const FilterValueInput = memo(function FilterValueInput({
  filter,
  value,
  inputText,
  onChange,
  onSearch,
  options,
  loading,
  placeholder,
  enumChoices,
}) {
  if (filter.isSearchable) {
    return (
      <Autocomplete
        options={options}
        selected={value ? [value] : []}
        loading={loading}
        onSelect={([selected]) => {
          const option = options.find((entry) => entry.value === selected);
          onChange(selected, option?.label || selected || "");
        }}
        textField={
          <Autocomplete.TextField
            labelHidden
            placeholder={placeholder}
            autoComplete="off"
            value={inputText}
            onFocus={() => onSearch(inputText || "")}
            onChange={onSearch}
          />
        }
      />
    );
  }

  if (filter.type === "enum") {
    return (
      <ChoiceList
        titleHidden
        choices={enumChoices}
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
});

export default FilterValueInput;