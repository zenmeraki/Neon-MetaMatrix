import React from "react";
import { Modal, Text } from "@shopify/polaris";
import { t } from "i18next";

function AlertUndo({ show, handleClose, undoEditHistory, loading = false }) {
  return (
    <Modal
      open={show}
      onClose={handleClose}
      title={t("undoEdit")}
      size="small"
      primaryAction={{
        content: t("yesUndoEdit"),
        tone: "critical",
        onAction: undoEditHistory,
        loading,
        disabled: loading,
      }}
      secondaryActions={[
        {
          content: t("cancel"),
          onAction: handleClose,
        },
      ]}
    >
      <Modal.Section>
        <Text as="p" variant="bodyMd">
          {t("confirmUndoMessage")}
        </Text>
      </Modal.Section>
    </Modal>
  );
}

export default React.memo(AlertUndo);
