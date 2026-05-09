import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const STATUS_OPTIONS = [
  { label: "Active", value: "ACTIVE" },
  { label: "Draft", value: "DRAFT" },
  { label: "Archived", value: "ARCHIVED" },
];

const KEYBOARD_SAVE_KEYS = new Set(["Enter"]);
const KEYBOARD_CANCEL_KEYS = new Set(["Escape"]);

function normalizeDisplayValue(value, emptyValue) {
  if (React.isValidElement(value)) return value;
  if (value === null || value === undefined || value === "") return emptyValue;
  return String(value);
}

const InlineEditableCell = memo(function InlineEditableCell({
  field,
  value,
  displayValue,
  emptyValue = "-",
  type = "text",
  disabled = false,
  disabledReason = "",
  saving = false,
  onSave,
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(() => String(value ?? ""));
  const renderedDisplayValue = normalizeDisplayValue(
    displayValue ?? value,
    emptyValue
  );

  useEffect(() => {
    if (!editing) {
      setDraftValue(String(value ?? ""));
    }
  }, [editing, value]);

  const translatedStatusOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((option) => ({
        value: option.value,
        label: t(`statusChoices.${option.value.toLowerCase()}`, {
          defaultValue: option.label,
        }),
      })),
    [t]
  );

  const startEditing = useCallback(
    (event) => {
      event.stopPropagation();

      if (disabled || saving) {
        return;
      }

      setEditing(true);
    },
    [disabled, saving]
  );

  const cancelEditing = useCallback(() => {
    setDraftValue(String(value ?? ""));
    setEditing(false);
  }, [value]);

  const saveDraft = useCallback(async () => {
    const normalizedValue =
      type === "number"
        ? Number(draftValue || 0)
        : String(draftValue ?? "").trim();

    if (String(normalizedValue) === String(value ?? "")) {
      setEditing(false);
      return;
    }

    const didSave = await onSave?.(field, normalizedValue);

    if (didSave !== false) {
      setEditing(false);
    }
  }, [draftValue, field, onSave, type, value]);

  const handleKeyDown = useCallback(
    (event) => {
      event.stopPropagation();

      if (KEYBOARD_SAVE_KEYS.has(event.key)) {
        event.preventDefault();
        saveDraft();
      }

      if (KEYBOARD_CANCEL_KEYS.has(event.key)) {
        event.preventDefault();
        cancelEditing();
      }
    },
    [cancelEditing, saveDraft]
  );

  if (editing) {
    return (
      <Box
        minWidth={type === "status" ? "160px" : "180px"}
        maxWidth={type === "status" ? "180px" : "240px"}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <BlockEditor
          type={type}
          draftValue={draftValue}
          statusOptions={translatedStatusOptions}
          saving={saving}
          onChange={setDraftValue}
          onKeyDown={handleKeyDown}
          onSave={saveDraft}
          onCancel={cancelEditing}
          t={t}
        />
      </Box>
    );
  }

  return (
    <Button
      variant="plain"
      textAlign="left"
      fullWidth
      disabled={disabled || saving}
      loading={saving}
      onClick={startEditing}
      accessibilityLabel={
        disabled && disabledReason
          ? `${String(value ?? emptyValue)}. ${disabledReason}`
          : t("editInlineFieldAccessibilityLabel", {
              field,
              defaultValue: `Edit ${field}`,
            })
      }
    >
      <Box maxWidth="220px">
        {React.isValidElement(renderedDisplayValue) ? (
          renderedDisplayValue
        ) : (
          <Text as="span" truncate tone={disabled ? "subdued" : undefined}>
            {renderedDisplayValue}
          </Text>
        )}
      </Box>
    </Button>
  );
});

function BlockEditor({
  type,
  draftValue,
  statusOptions,
  saving,
  onChange,
  onSave,
  onCancel,
  t,
}) {
  return (
    <InlineStack gap="100" blockAlign="center" wrap={false}>
      <Box minWidth="120px">
        {type === "status" ? (
          <Select
            label={t("status", { defaultValue: "Status" })}
            labelHidden
            options={statusOptions}
            value={draftValue || "DRAFT"}
            disabled={saving}
            onChange={onChange}
          />
        ) : (
          <TextField
            label={t("inlineEditValue", { defaultValue: "Value" })}
            labelHidden
            type={type === "number" ? "number" : "text"}
            value={draftValue}
            disabled={saving}
            autoComplete="off"
            onChange={onChange}
          />
        )}
      </Box>

      <Button
        size="slim"
        loading={saving}
        disabled={saving}
        onClick={onSave}
        accessibilityLabel={t("saveInlineEdit", {
          defaultValue: "Save inline edit",
        })}
      >
        {t("save", { defaultValue: "Save" })}
      </Button>

      <Button
        size="slim"
        variant="plain"
        disabled={saving}
        onClick={onCancel}
        accessibilityLabel={t("cancelInlineEdit", {
          defaultValue: "Cancel inline edit",
        })}
      >
        {t("cancel", { defaultValue: "Cancel" })}
      </Button>
    </InlineStack>
  );
}

export default InlineEditableCell;
