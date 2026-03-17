import React from "react";
import { Select } from "@shopify/polaris";

const RoundingSelector = ({ selectedField, rounding, onRoundingChange }) => {
  if (selectedField.type !== "number") return null;

  const options = [
    { label: "Don't round the value", value: "Don't round the value" },
    {
      label: "Round to nearest whole number",
      value: "Round to nearest whole number",
    },
    { label: "Round to 2 decimal places", value: "Round to 2 decimal places" },
  ];

  return (
    <Select
      label="Rounding"
      options={options}
      value={rounding}
      onChange={onRoundingChange}
    />
  );
};

export default RoundingSelector;
