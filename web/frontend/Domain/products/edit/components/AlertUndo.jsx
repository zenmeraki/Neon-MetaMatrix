import React from "react";
import { Modal, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../../utils/i18nUtils";

function AlertUndo({ show, handleClose, undoEditHistory, loading = false }) {
  const { t } = useTranslation(undefined, { i18n: appI18n });

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
