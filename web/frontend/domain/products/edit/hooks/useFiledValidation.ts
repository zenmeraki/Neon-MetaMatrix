// hooks/useFieldValidation.ts
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';


export interface ValidationRule {
  required?: boolean;
  min?: number;
  max?: number;
  isNumber?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: string) => string | undefined;
  // Enterprise additions
  email?: boolean;
  url?: boolean;
  integer?: boolean;
  positive?: boolean;
  alphanumeric?: boolean;
  noWhitespace?: boolean;
  idString?: boolean;
}

// Pre-compiled regex patterns for performance
const VALIDATION_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  alphanumeric: /^[a-zA-Z0-9]+$/,
  noWhitespace: /^\S+$/,
  integer: /^-?\d+$/,
  decimal: /^-?\d+(\.\d+)?$/,
  idString: /^\d+$/,
} as const;

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export function validateField(
  value: string | number | null | undefined,
  rules: ValidationRule = {},
  t: TranslateFn
): string | undefined {
  const stringValue = String(value ?? '');
  const trimmedValue = stringValue.trim();

  if (rules.required && !trimmedValue) {
    return t('validation_new.required');
  }

  if (!trimmedValue && !rules.required) {
    return undefined;
  }

  if (rules.idString && !VALIDATION_PATTERNS.idString.test(trimmedValue)) {
    return t('validation_new.invalidFormat');
  }

  const needsNumericValidation =
    rules.isNumber || rules.min != null || rules.max != null || rules.integer || rules.positive;

  if (needsNumericValidation) {
    if (!VALIDATION_PATTERNS.decimal.test(trimmedValue)) {
      return t('validation_new.invalidNumber');
    }

    if (rules.integer && !VALIDATION_PATTERNS.integer.test(trimmedValue)) {
      return t('validation_new.integer');
    }

    const parsed = Number(trimmedValue);
    if (!Number.isFinite(parsed)) {
      return t('validation_new.invalidNumber');
    }

    if (rules.positive && parsed <= 0) return t('validation_new.positive');
    if (rules.min != null && parsed < rules.min) return t('validation_new.minValue', { min: rules.min });
    if (rules.max != null && parsed > rules.max) return t('validation_new.maxValue', { max: rules.max });
  }

  if (rules.minLength != null && stringValue.length < rules.minLength) {
    return t('validation_new.minLength', { min: rules.minLength });
  }

  if (rules.maxLength != null && stringValue.length > rules.maxLength) {
    return t('validation_new.maxLength', { max: rules.maxLength });
  }

  if (rules.email && !VALIDATION_PATTERNS.email.test(trimmedValue)) return t('validation_new.email');
  if (rules.url) {
    try {
      const parsedUrl = new URL(trimmedValue);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return t('validation_new.url');
      }
    } catch {
      return t('validation_new.url');
    }
  }
  if (rules.alphanumeric && !VALIDATION_PATTERNS.alphanumeric.test(stringValue)) return t('validation_new.alphanumeric');
  if (rules.noWhitespace && !VALIDATION_PATTERNS.noWhitespace.test(stringValue)) return t('validation_new.noWhitespace');
  if (rules.pattern && !rules.pattern.test(stringValue)) return t('validation_new.invalidFormat');

  if (rules.custom) {
    const customError = rules.custom(stringValue);
    if (customError) return customError;
  }

  return undefined;
}

export const useFieldValidation = (
  value: string | number | null | undefined,
  rules: ValidationRule = {}
): string | undefined => {
  const { t } = useTranslation();
  return validateField(value, rules, t);
};

// Enhanced validation hook with multiple fields support for forms
export interface FormValidationState {
  isValid: boolean;
  errors: Record<string, string | undefined>;
  hasErrors: boolean;
  touchedFields: Set<string>;
}

export const useFormValidation = (
  fields: Record<string, { value: string | number | null | undefined; rules: ValidationRule }>,
  touched: Record<string, boolean> = {}
): FormValidationState => {
  const { t } = useTranslation();

  return useMemo(() => {
    const errors: Record<string, string | undefined> = {};
    const touchedFields = new Set(Object.keys(touched).filter(key => touched[key]));
    
    Object.entries(fields).forEach(([fieldName, { value, rules }]) => {
      const error = validateField(value, rules, t);
      if (error) {
        errors[fieldName] = error;
      }
    });
    
    const hasErrors = Object.values(errors).some(error => error !== undefined);
    const isValid = !hasErrors;
    
    return {
      isValid,
      errors,
      hasErrors,
      touchedFields,
    };
  }, [fields, touched, t]);
};

// Utility function for common validation rule sets
export const getCommonValidationRules = (type: 'email' | 'url' | 'phone' | 'shopifyHandle' | 'price' | 'sku'): ValidationRule => {
  const rules: Record<string, ValidationRule> = {
    email: {
      required: true,
      email: true,
      maxLength: 254, // RFC 5321 limit
    },
    url: {
      url: true,
      maxLength: 2048, // Common browser limit
    },
    phone: {
      pattern: /^\+?[\d\s\-\(\)]{10,}$/,
      custom: (value: string) => {
        const digits = value.replace(/\D/g, '');
        if (digits.length < 10) return 'Phone number must have at least 10 digits';
        return undefined;
      }
    },
    shopifyHandle: {
      required: true,
      pattern: /^[a-z0-9\-]+$/,
      minLength: 1,
      maxLength: 255,
      custom: (value: string) => {
        if (value.startsWith('-') || value.endsWith('-')) {
          return 'Handle cannot start or end with a hyphen';
        }
        if (value.includes('--')) {
          return 'Handle cannot contain consecutive hyphens';
        }
        return undefined;
      }
    },
    price: {
      required: true,
      isNumber: true,
      min: 0,
      max: 999999.99,
    },
    sku: {
      pattern: /^[a-zA-Z0-9\-_]+$/,
      minLength: 1,
      maxLength: 255,
      noWhitespace: true,
    }
  };
  
  return rules[type] || {};
};
