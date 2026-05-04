import React, { useState, useMemo, useCallback } from "react";
import {
  Autocomplete,
  Icon,
  Text,
  Box,
  InlineStack,
  BlockStack,
  Badge,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { getAllFields, getFieldDefinition } from "../constants";
import { useTranslation } from "react-i18next";

// Badge tone per category
const CATEGORY_BADGE_TONE = {
  product: "info",
  variant: "success",
  danger: "critical",
};

// Category sort order
const CATEGORY_ORDER = ["product", "variant", "danger"];

const FieldSelector = ({ selectedField, onFieldChange }) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [popoverActive, setPopoverActive] = useState(false);

  const allFields = getAllFields();

  const options = useMemo(() => {
    const query = inputValue.toLowerCase().trim();

    const filterAndMap = (category) =>
      allFields
        .filter((f) => f.category === category)
        .filter((f) =>
          query
            ? t(f.label, { defaultValue: f.label })
                .toLowerCase()
                .includes(query)
            : true
        )
        .map((f) => ({
          value: f.value,
          label: t(f.label, { defaultValue: f.label }),
          category,
        }));

    const sections = [];

    for (const category of CATEGORY_ORDER) {
      const fields = filterAndMap(category);
      if (!fields.length) continue;

      const categoryLabel =
        category === "product"
          ? t("productFields", { defaultValue: "Product fields" })
          : category === "variant"
          ? t("variantFields", { defaultValue: "Variant fields" })
          : t("dangerZone", { defaultValue: "Danger zone" });

      sections.push({
        title: categoryLabel,
        options: fields.map((f) => ({
          value: f.value,
          // Render label with inline category badge
          label: (
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text as="span" variant="bodyMd">
                {f.label}
              </Text>
              {category === "danger" && (
                <Badge tone="critical" size="small">
                  {t("dangerZoneShort", { defaultValue: "Danger" })}
                </Badge>
              )}
            </InlineStack>
          ),
        })),
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
        setPopoverActive(false);
      }
    },
    [onFieldChange]
  );

  const handleInputChange = useCallback((val) => {
    setInputValue(val);
    setPopoverActive(true);
  }, []);

  const selectedCategory = selectedField?.category;
  const selectedLabel = selectedField
    ? t(selectedField.label, { defaultValue: selectedField.label })
    : "";

  const textField = (
    <Autocomplete.TextField
      label={
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {t("fieldToEdit", { defaultValue: "Field to edit" })}
          </Text>
          {selectedCategory && (
            <Badge
              tone={CATEGORY_BADGE_TONE[selectedCategory] ?? "info"}
              size="small"
            >
              {selectedCategory === "product"
                ? t("categoryProduct", { defaultValue: "Product" })
                : selectedCategory === "variant"
                ? t("categoryVariant", { defaultValue: "Variant" })
                : t("categoryDanger", { defaultValue: "Danger" })}
            </Badge>
          )}
        </InlineStack>
      }
      value={inputValue}
      onChange={handleInputChange}
      onFocus={() => setPopoverActive(true)}
      placeholder={
        selectedLabel ||
        t("fieldSelectorPlaceholder", { defaultValue: "Search fields…" })
      }
      prefix={<Icon source={SearchIcon} tone="subdued" />}
      autoComplete="off"
      clearButton={Boolean(inputValue)}
      onClearButtonClick={() => setInputValue("")}
    />
  );

  return (
    <BlockStack gap="0">
      <Autocomplete
        options={options}
        selected={selectedField?.value ? [selectedField.value] : []}
        onSelect={handleSelect}
        textField={textField}
        loading={false}
        emptyState={
          <Box padding="400">
            <BlockStack gap="100" align="center">
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                {t("fieldSelectorNoResults", {
                  defaultValue: "No fields match your search",
                })}
              </Text>
            </BlockStack>
          </Box>
        }
      />

      {/* Selected field hint below the input */}
      {selectedField && !inputValue && (
        <Box paddingBlockStart="100" paddingInlineStart="100">
          <Text as="p" variant="bodySm" tone="subdued">
            {t("fieldSelectorSelected", { defaultValue: "Selected:" })}{" "}
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {selectedLabel}
            </Text>
          </Text>
        </Box>
      )}
    </BlockStack>
  );
};

export default FieldSelector;