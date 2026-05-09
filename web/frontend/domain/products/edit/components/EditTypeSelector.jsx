import React, { useEffect, useMemo, useCallback } from "react";
import { Select } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { getFieldActions } from "../constants";

function EditTypeSelector({ selectedField, editType, onEditTypeChange }) {
  const { t } = useTranslation();

  const selectedFieldValue = selectedField?.value || "";
  const selectedEditTypeValue = editType?.value || "";

  const editOptions = useMemo(
    () => getFieldActions(selectedFieldValue) || [],
    [selectedFieldValue]
  );

  const isCurrentEditTypeValid = useMemo(
    () =>
      Boolean(selectedEditTypeValue) &&
      editOptions.some((option) => option.value === selectedEditTypeValue),
    [editOptions, selectedEditTypeValue]
  );

  useEffect(() => {
    if (!selectedEditTypeValue) return;
    if (isCurrentEditTypeValid) return;

    onEditTypeChange(null);
  }, [isCurrentEditTypeValid, onEditTypeChange, selectedEditTypeValue]);

  const options = useMemo(
    () =>
      editOptions.map((option) => ({
        label: t(option.label, { defaultValue: option.label }),
        value: option.value,
      })),
    [editOptions, t]
  );

  const handleChange = useCallback(
    (value) => {
      const selected = editOptions.find((option) => option.value === value) || null;
      onEditTypeChange(selected);
    },
    [editOptions, onEditTypeChange]
  );

  return (
    <Select
      label={t("HowToEdit", { defaultValue: "How to edit" })}
      options={options}
      value={isCurrentEditTypeValid ? selectedEditTypeValue : ""}
      onChange={handleChange}
      disabled={!selectedFieldValue || editOptions.length === 0}
      placeholder={t("selectEditType", { defaultValue: "Select edit type" })}
      helpText={
        !selectedFieldValue
          ? t("selectFieldFirst", { defaultValue: "Select a field first." })
          : editOptions.length === 0
            ? t("noEditActionsAvailable", {
                defaultValue: "No edit actions available for this field.",
              })
            : undefined
      }
    />
  );
}

export default React.memo(EditTypeSelector);
