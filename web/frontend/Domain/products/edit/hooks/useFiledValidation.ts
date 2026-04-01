// hooks/useFieldValidation.ts
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n as appI18n } from "../../../../utils/i18nUtils";


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
}

// Pre-compiled regex patterns for performance
const VALIDATION_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/.+/,
  alphanumeric: /^[a-zA-Z0-9]+$/,
  noWhitespace: /^\S+$/,
} as const;

// Error message templates for consistency
const ERROR_MESSAGES = {
  required: 'validation_new.required',
  email: 'validation_new.email',
  url: 'validation_new.url',
  integer: 'validation_new.integer',
  positive: 'validation_new.positive',
  alphanumeric: 'validation_new.alphanumeric',
  noWhitespace: 'validation_new.noWhitespace',
  invalidNumber: 'validation_new.invalidNumber',
  invalidFormat: 'validation_new.invalidFormat',
} as const;


export const useFieldValidation = (
  value: string | number | null | undefined,
  rules: ValidationRule = {}
): string | undefined => {
  const { t } = useTranslation(undefined, { i18n: appI18n });

  const stringValue = String(value ?? '');
  const trimmedValue = stringValue.trim();

  if (rules.required && !trimmedValue) {
    return t('validation_new.required');
  }

  if (!trimmedValue && !rules.required) {
    return undefined;
  }

  const number = Number(stringValue);

  if (rules.isNumber || rules.min != null || rules.max != null || rules.integer || rules.positive) {
    if (isNaN(number)) return t('validation_new.invalidNumber');
    if (rules.integer && !Number.isInteger(number)) return t('validation_new.integer');
    if (rules.positive && number <= 0) return t('validation_new.positive');
    if (rules.min != null && number < rules.min) return t('validation_new.minValue', { min: rules.min });
    if (rules.max != null && number > rules.max) return t('validation_new.maxValue', { max: rules.max });
  }

  if (rules.minLength != null && stringValue.length < rules.minLength) {
    return t('validation_new.minLength', { min: rules.minLength });
  }

  if (rules.maxLength != null && stringValue.length > rules.maxLength) {
    return t('validation_new.maxLength', { max: rules.maxLength });
  }

  if (rules.email && !VALIDATION_PATTERNS.email.test(trimmedValue)) return t('validation_new.email');
  if (rules.url && !VALIDATION_PATTERNS.url.test(trimmedValue)) return t('validation_new.url');
  if (rules.alphanumeric && !VALIDATION_PATTERNS.alphanumeric.test(stringValue)) return t('validation_new.alphanumeric');
  if (rules.noWhitespace && !VALIDATION_PATTERNS.noWhitespace.test(stringValue)) return t('validation_new.noWhitespace');
  if (rules.pattern && !rules.pattern.test(stringValue)) return t('validation_new.invalidFormat');

  if (rules.custom) {
    const customError = rules.custom(stringValue);
    if (customError) return customError;
  }

  return undefined;
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
  return useMemo(() => {
    const errors: Record<string, string | undefined> = {};
    const touchedFields = new Set(Object.keys(touched).filter(key => touched[key]));
    
    Object.entries(fields).forEach(([fieldName, { value, rules }]) => {
      const error = useFieldValidation(value, rules);
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
  }, [fields, touched]);
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
      positive: true,
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