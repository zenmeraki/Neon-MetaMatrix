import React, { memo, useState } from "react";
import {
  Modal,
  TextField,
  ChoiceList,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

/**
 * Modal for saving custom history views
 * Memoized to prevent unnecessary re-renders
 */
const SaveViewModal = memo(
  ({ isOpen, onClose, onSave, currentFilters = {} }) => {
    const { t } = useTranslation();
    const [viewName, setViewName] = useState("");
    const [isDefault, setIsDefault] = useState(false);

    // Handle save action
    const handleSave = () => {
      onSave({
        name: viewName,
        isDefault,
        filters: currentFilters,
      });

      // Reset form
      setViewName("");
      setIsDefault(false);

      // Close modal
      onClose();
    };

    return (
      <Modal
        size="large"
        open={isOpen}
        onClose={onClose}
        title={t("saveCustomView", { defaultValue: "Save Custom View" })}
        primaryAction={{
          content: t("saveView", { defaultValue: "Save View" }),
          onAction: handleSave,
          disabled: !viewName,
        }}
        secondaryActions={[
          {
            content: t("cancel", { defaultValue: "Cancel" }),
            onAction: onClose,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label={t("viewName", { defaultValue: "View Name" })}
              value={viewName}
              onChange={setViewName}
              autoComplete="off"
              error={
                viewName === ""
                  ? t("viewNameRequired", { defaultValue: "View name is required" })
                  : undefined
              }
            />

            <ChoiceList
              title={t("options", { defaultValue: "Options" })}
              choices={[
                { label: t("setAsDefault", { defaultValue: "Set as default view" }), value: "default" },
              ]}
              selected={isDefault ? ["default"] : []}
              onChange={(selected) => setIsDefault(selected.includes("default"))}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    );
  }
);

SaveViewModal.displayName = "SaveViewModal";

export default SaveViewModal;
