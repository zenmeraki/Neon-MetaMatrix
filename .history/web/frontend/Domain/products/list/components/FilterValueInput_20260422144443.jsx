import React, { useEffect, useMemo, useState } from "react";
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

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  useEffect(() => {
    if (!filter.isSearchable) return;

    if (!value) {
      setInputValue("");
      return;
    }

    if (selectedOption?.label) {
      setInputValue(selectedOption.label);
    }
  }, [filter.isSearchable, value, selectedOption]);

  if (filter.isSearchable) {
    return (
      <Autocomplete
        options={options}
        selected={value ? [value] : []}
        loading={loading}
        onSelect={([selected]) => {
          onChange(selected);

          const option = options.find((entry) => entry.value === selected);
          setInputValue(option?.label || selected || "");
        }}
        textField={
          <Autocomplete.TextField
            labelHidden
            autoComplete="off"
            value={inputValue}
            placeholder={t("searchPlaceholderField", {
              field: t(`fieldLabels.${filter.key}`, filter.label),
            })}
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