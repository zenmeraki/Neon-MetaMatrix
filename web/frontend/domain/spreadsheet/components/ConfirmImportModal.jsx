import { Modal, Banner, Text, Box, BlockStack, List, TextField } from "@shopify/polaris";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const LARGE_IMPORT_THRESHOLD = 1000;
const CONFIRM_TEXT = "IMPORT";

export default function ConfirmImportModal({
  open,
  onClose,
  onConfirm,
  loading,
  summary = null,
}) {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState("");

  const validRows = Number(summary?.validRows || 0);
  const invalidRows = Number(summary?.invalidRows || 0);
  const fieldsChanged = Array.isArray(summary?.fieldsChanged)
    ? summary.fieldsChanged
    : [];

  const requiresTypedConfirm = validRows >= LARGE_IMPORT_THRESHOLD;
  const typedConfirmValid =
    !requiresTypedConfirm || confirmText.trim().toUpperCase() === CONFIRM_TEXT;

  const primaryDisabled = loading || !typedConfirmValid;

  const handleClose = () => {
    if (loading) return;
    setConfirmText("");
    onClose?.();
  };

  const handleConfirm = () => {
    if (primaryDisabled) return;
    onConfirm?.();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("spreadsheetConfirmTitle")}
      primaryAction={{
        content: t("spreadsheetConfirmPrimary"),
        destructive: true,
        onAction: handleConfirm,
        loading,
        disabled: primaryDisabled,
      }}
      secondaryActions={[
        {
          content: t("cancel", { defaultValue: "Cancel" }),
          onAction: handleClose,
          disabled: loading,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p">{t("spreadsheetConfirmMessage")}</Text>

          {summary ? (
            <Box>
              <List>
                <List.Item>
                  {t("spreadsheetConfirmValidRows", {
                    count: validRows,
                    defaultValue: `${validRows.toLocaleString()} valid rows`,
                  })}
                </List.Item>
                <List.Item>
                  {t("spreadsheetConfirmInvalidRows", {
                    count: invalidRows,
                    defaultValue: `${invalidRows.toLocaleString()} invalid rows`,
                  })}
                </List.Item>
                <List.Item>
                  {t("spreadsheetConfirmFields", {
                    count: fieldsChanged.length,
                    defaultValue: `${fieldsChanged.length} fields will be changed`,
                  })}
                </List.Item>
                <List.Item>
                  {summary.undoAvailable
                    ? t("spreadsheetConfirmUndoAvailable", {
                        defaultValue: "Undo will be available after import.",
                      })
                    : t("spreadsheetConfirmUndoUnavailable", {
                        defaultValue: "Undo availability is not confirmed.",
                      })}
                </List.Item>
              </List>
            </Box>
          ) : null}

          {requiresTypedConfirm ? (
            <TextField
              label={t("spreadsheetTypedConfirmLabel", {
                defaultValue: `Type ${CONFIRM_TEXT} to continue`,
              })}
              value={confirmText}
              onChange={setConfirmText}
              autoComplete="off"
              disabled={loading}
            />
          ) : null}

          <Banner tone="critical">
            <Text as="p">
              {t("spreadsheetConfirmBanner", {
                defaultValue:
                  "This import may update existing Shopify products. Review row count, changed fields, and undo availability before continuing.",
              })}
            </Text>
          </Banner>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
