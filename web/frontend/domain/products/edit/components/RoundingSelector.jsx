import React, { useMemo } from "react";
import { Select } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const ROUNDING_OPTIONS = [
  {
    labelKey: "roundingNone",
    defaultLabel: "Don't round the value",
    value: "NONE",
  },
  {
    labelKey: "roundingWhole",
    defaultLabel: "Round to nearest whole number",
    value: "WHOLE",
  },
  {
    labelKey: "roundingTwoDecimals",
    defaultLabel: "Round to 2 decimal places",
    value: "DECIMAL_2",
  },
];

const SUPPORTED_EDIT_TYPES = new Set([
  "set",
  "increment",
  "decrement",
  "multiply",
  "percentage",
  "Set to fixed value",
  "Changed by fixed amount",
  "Increase by percent",
  "Decrease by percent",
  "Set to percentage of compare-at-price",
]);

const RoundingSelector = ({
  selectedField,
  editType,
  rounding,
  onRoundingChange,
}) => {
  const { t } = useTranslation();

  const selectedFieldType = selectedField?.type;
  const selectedEditType = editType?.value || "";
  const shouldShow =
    selectedField?.capabilities?.supportsRounding === true &&
    selectedFieldType === "number" &&
    SUPPORTED_EDIT_TYPES.has(selectedEditType);

  const options = useMemo(
    () =>
      ROUNDING_OPTIONS.map((option) => ({
        label: t(option.labelKey, {
          defaultValue: option.defaultLabel,
        }),
        value: option.value,
      })),
    [t]
  );

  if (!shouldShow) return null;

  return (
    <Select
      label={t("rounding", { defaultValue: "Rounding" })}
      options={options}
      value={rounding || "NONE"}
      onChange={onRoundingChange}
    />
  );
};

export default React.memo(RoundingSelector);
