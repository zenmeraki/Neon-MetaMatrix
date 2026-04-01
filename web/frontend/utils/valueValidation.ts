import { ValidationRule } from "../Domain/products/edit/hooks/useFiledValidation";

export const getValueValidationRules = (
  isPercentage: boolean,
  isFixedValue: boolean
): ValidationRule => {
  // ✅ Percentage (0–100)
  if (isPercentage) {
    return {
      required: true,
      isNumber: true,
      min: 0,
      max: 100,
    };
  }

  // ✅ Fixed price (positive integer)
  if (isFixedValue) {
    return {
      required: true,
      isNumber: true,
      integer: true,
      min: 0,
    };
  }

  return {};
};
