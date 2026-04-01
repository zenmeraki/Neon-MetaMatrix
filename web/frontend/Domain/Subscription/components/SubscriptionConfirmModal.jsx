import React, { memo } from "react";
import { Modal, Text, Box } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

const SubscriptionConfirmModal = memo(
  ({ open, plan, onConfirm, onCancel, isLoading }) => {
    const { t } = useTranslation(undefined, { i18n: appI18n });

    if (!plan) return null;

    return (
      <Modal
        open={open}
        onClose={onCancel}
        title={t("confirmSubscription", {
          defaultValue: "Confirm subscription",
        })}
        primaryAction={{
          content: t("confirm", { defaultValue: "Confirm" }),
          onAction: onConfirm,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: t("cancel", { defaultValue: "Cancel" }),
            onAction: onCancel,
            disabled: isLoading,
          },
        ]}
      >
        <Box padding="400">
          <Text>
            {t("confirmSubscriptionMessage", {
              defaultValue:
                "Are you sure you want to subscribe to the {{plan}} plan for ${{price}}/month?",
              plan: plan?.name,
              price: plan?.price,
            })}
          </Text>
        </Box>
      </Modal>
    );
  },
);

SubscriptionConfirmModal.displayName = "SubscriptionConfirmModal";

export default SubscriptionConfirmModal;
