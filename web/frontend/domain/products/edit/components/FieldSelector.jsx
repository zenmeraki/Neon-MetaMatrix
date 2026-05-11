import React, { useState, useMemo, useCallback } from "react";
import { Autocomplete, Icon } from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { getAllFields, getFieldDefinition } from "../constants";
import { useTranslation } from "react-i18next";

function FieldSelector({ selectedField, onFieldChange }) {
  const { t, i18n } = useTranslation();
  const [inputValue, setInputValue] = useState("");

  const allFields = useMemo(() => getAllFields(), []);

  const translatedFields = useMemo(
    () =>
      allFields.map((field) => {
        const label = t(field.label, { defaultValue: field.label });

        return {
          ...field,
          translatedLabel: label,
          searchLabel: label.toLowerCase(),
        };
      }),
    [allFields, t, i18n.language]
  );

  const options = useMemo(() => {
    const query = inputValue.trim().toLowerCase();

    const filterAndMap = (category) =>
      translatedFields
        .filter((field) => field.category === category)
        .filter((field) => !query || field.searchLabel.includes(query))
        .map((field) => ({
          value: field.value,
          label: field.translatedLabel,
        }));

    const sections = [];

    const productFields = filterAndMap("product");
    const variantFields = filterAndMap("variant");
    const dangerFields = filterAndMap("danger");

    if (productFields.length) {
      sections.push({
        title: t("productFields", { defaultValue: "Product fields" }),
        options: productFields,
      });
    }

    if (variantFields.length) {
      sections.push({
        title: t("variantFields", { defaultValue: "Variant fields" }),
        options: variantFields,
      });
    }

    if (dangerFields.length) {
      sections.push({
        title: t("dangerZone", { defaultValue: "Danger zone" }),
        options: dangerFields,
      });
    }

    return sections;
  }, [inputValue, translatedFields, t]);

  const selectedFieldLabel = selectedField?.label
    ? t(selectedField.label, { defaultValue: selectedField.label })
    : "";

  const handleSelect = useCallback(
    (selected) => {
      const selectedValue = selected?.[0];
      if (!selectedValue) return;

      const fieldDef = getFieldDefinition(selectedValue);
      if (!fieldDef) return;

      onFieldChange({
        ...fieldDef,
        requiresConfirmation: fieldDef.category === "danger",
      });

      setInputValue("");
    },
    [onFieldChange]
  );

  const textField = (
    <Autocomplete.TextField
      label={t("fieldToEdit", { defaultValue: "Field to edit" })}
      value={inputValue}
      onChange={setInputValue}
      placeholder={
        selectedFieldLabel ||
        t("selectField", { defaultValue: "Select a field" })
      }
      prefix={<Icon source={SearchIcon} />}
      autoComplete="off"
    />
  );

  return (
    <Autocomplete
      options={options}
      selected={selectedField?.value ? [selectedField.value] : []}
      onSelect={handleSelect}
      textField={textField}
    />
  );
}

export default React.memo(FieldSelector);
