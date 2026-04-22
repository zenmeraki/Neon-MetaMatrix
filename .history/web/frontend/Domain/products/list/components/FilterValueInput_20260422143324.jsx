import React, { useState, useEffect } from "react";
import { ChoiceList, TextField, Autocomplete } from "@shopify/polaris";

function FilterValueInput({ filter, value, onChange, onSearch, options, loading, t }) {
  const [inputValue, setInputValue] = useState(value || "");
  const [selectedValue, setSelectedValue] = useState(value || ""); // ✅ separate from typed text

  // ✅ sync both when draft is reset externally (e.g. after apply)
  useEffect(() => {
    if (!value) {
      setInputValue("");
      setSelectedValue("");
    }
  }, [value]);

  if (filter.isSearchable) {
    return (
      <Autocomplete
        options={options}
        selected={selectedValue ? [selectedValue] : []} // ✅ only actual selections, never typed text
        loading={loading}
        onSelect={([selected]) => {
          if (!selected) return; // ✅ guard against empty call from Polaris
          const selectedOption = options.find((o) => o.value === selected);
          const label = selectedOption?.label ?? selected;
          setSelectedValue(selected); // ✅ track the real selected value
          setInputValue(label);
          onChange(selected);
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
              setSelectedValue(""); // ✅ clear selection when user starts typing again
              onChange(text);       // ✅ keeps button enabled while typing
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
    return <TextField type="number" labelHidden value={value} onChange={onChange} />;
  }

  if (filter.type === "date") {
    return <TextField type="date" labelHidden value={value} onChange={onChange} />;
  }

  return <TextField labelHidden value={value} onChange={onChange} />;
}

export default FilterValueInput;