import React from "react";
import { Modal, Text, BlockStack, List, Banner, TextField } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";

const LARGE_UNDO_THRESHOLD = 1000;
const UNDO_CONFIRM_TEXT = "UNDO";

function AlertUndo({
  show,
  handleClose,
  undoEditHistory,
  loading = false,
  summary = null,
}) {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState("");

  const targetCount = Number(summary?.targetCount || 0);
  const conflictCount =
    summary?.conflictCount == null ? null : Number(summary.conflictCount || 0);
  const canUndo = summary?.canUndo === true;
  const undoBlockedReason = summary?.undoBlockedReason || null;
  const requiresTypedConfirm = targetCount >= LARGE_UNDO_THRESHOLD;
  const typedConfirmValid =
    !requiresTypedConfirm || confirmText.trim().toUpperCase() === UNDO_CONFIRM_TEXT;

  const primaryDisabled = loading || !canUndo || !typedConfirmValid;

  const conflictMessage = useMemo(() => {
    if (conflictCount == null) {
      return t("undoConflictCheckPending", {
        defaultValue: "Conflict check will run before undo executes.",
      });
    }
    if (conflictCount > 0) {
      return t("undoConflictsDetected", {
        defaultValue: "{{count}} conflicts detected.",
        count: conflictCount,
      });
    }
    return t("undoConflictsNone", {
      defaultValue: "No conflicts detected by backend check.",
    });
  }, [conflictCount, t]);

  const onClose = () => {
    if (loading) return;
    setConfirmText("");
    handleClose?.();
  };

  const onConfirm = () => {
    if (primaryDisabled) return;
    undoEditHistory?.();
  };

  return (
    <Modal
      open={show}
      onClose={onClose}
      title={t("undoEdit")}
      size="small"
      primaryAction={{
        content: t("yesUndoEdit"),
        destructive: true,
        onAction: onConfirm,
        loading,
        disabled: primaryDisabled,
      }}
      secondaryActions={[
        {
          content: t("cancel"),
          onAction: onClose,
          disabled: loading,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            {t("confirmUndoMessage")}
          </Text>

          <List>
            <List.Item>
              {t("undoTargetCount", {
                defaultValue: "Targets: {{count}}",
                count: targetCount,
              })}
            </List.Item>
            <List.Item>
              {t("undoExecutionId", {
                defaultValue: "Execution: {{value}}",
                value: summary?.executionId || "-",
              })}
            </List.Item>
            <List.Item>
              {t("undoTargetSnapshotId", {
                defaultValue: "Target snapshot: {{value}}",
                value: summary?.targetSnapshotId || "-",
              })}
            </List.Item>
            <List.Item>
              {t("undoMirrorBatchId", {
                defaultValue: "Mirror batch: {{value}}",
                value: summary?.mirrorBatchId || "-",
              })}
            </List.Item>
          </List>

          <Banner tone={conflictCount > 0 ? "warning" : "info"}>
            <Text as="p">{conflictMessage}</Text>
          </Banner>

          {undoBlockedReason ? (
            <Banner tone="critical">
              <Text as="p">{undoBlockedReason}</Text>
            </Banner>
          ) : null}

          {requiresTypedConfirm ? (
            <TextField
              label={t("undoTypedConfirmLabel", {
                defaultValue: `Type ${UNDO_CONFIRM_TEXT} to continue`,
              })}
              value={confirmText}
              onChange={setConfirmText}
              autoComplete="off"
              disabled={loading}
            />
          ) : null}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

export default React.memo(AlertUndo);
