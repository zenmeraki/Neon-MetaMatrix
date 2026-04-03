import React, { useEffect, useState } from "react";
import { Select } from "@shopify/polaris";
import { getFieldActions } from "../constants";
import { useTranslation } from "react-i18next";

const EditTypeSelector = ({ selectedField, editType, onEditTypeChange }) => {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState(editType?.value || "");

  const editOptions = getFieldActions(selectedField?.value);

  // Sync when parent updates editType
  useEffect(() => {
    setLocalValue(editType?.value || "");
  }, [editType]);

  const handleChange = (value) => {
    const selected = editOptions.find((opt) => opt.value === value);
    setLocalValue(value);
    onEditTypeChange(selected);
  };

  // Convert to Polaris Select format
  const options = editOptions.map((option) => ({
    label: t(option.label),
    value: option.value,
  }));

  return (
    <Select
      label={t("HowToEdit")}
      options={options}
      value={localValue}
      onChange={handleChange}
      disabled={!selectedField || editOptions.length === 0}
    />
  );
};

export default EditTypeSelector;
