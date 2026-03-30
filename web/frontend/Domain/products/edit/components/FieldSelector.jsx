import React, { useState, useMemo, useCallback } from "react";
import { Autocomplete, Icon } from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { getAllFields, getFieldDefinition } from "../constants";
import { useTranslation } from "react-i18next";

const FieldSelector = ({ selectedField, onFieldChange }) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");

  const allFields = getAllFields();

  /**
   * Build sectioned options:
   * - Product Fields
   * - Variant Fields
   */
  const options = useMemo(() => {
    const query = inputValue.toLowerCase();

    const filterAndMap = (category) =>
      allFields
        .filter((f) => f.category === category)
        .filter((f) => t(f.label).toLowerCase().includes(query))
        .map((f) => ({
          value: f.value,
          label: t(f.label),
        }));

    const productFields = filterAndMap("product");
    const variantFields = filterAndMap("variant");
    const dangerFields = filterAndMap("danger");

    const sections = [];



    if (productFields.length) {
      sections.push({
        title: t("Product fields"),
        options: productFields,
      });
    }

    if (variantFields.length) {
      sections.push({
        title: t("Variant fields"),
        options: variantFields,
      });
    }

    if (dangerFields.length) {
      sections.push({
        title: t("Danger zone"),
        options: dangerFields,
      });
    }

    return sections;
  }, [inputValue, allFields, t]);

  const handleSelect = useCallback(
    (selected) => {
      const fieldDef = getFieldDefinition(selected[0]);
      if (fieldDef) {
        onFieldChange(fieldDef);
        setInputValue("");
      }
    },
    [onFieldChange]
  );

  const textField = (
    <Autocomplete.TextField
      label={t("fieldToEdit")}
      value={inputValue}
      onChange={setInputValue}
      placeholder={t(selectedField?.label || "Select a field")}
      prefix={<Icon source={SearchIcon} />}
      autoComplete="off"
    />
  );

  return (
    <Autocomplete
      options={options} // 👈 sectioned options
      selected={[selectedField?.value || ""]}
      onSelect={handleSelect}
      textField={textField}
    />
  );
};

export default FieldSelector;
