// web/frontend/domains/subscription/components/SubscriptionConfirmModal.jsx
import React, { memo } from "react";
import { Modal, Text, Box } from "@shopify/polaris";
import { t } from "i18next";

/**
 * Modal for confirming subscription
 * Memoized to prevent unnecessary re-renders
 */
const SubscriptionConfirmModal = memo(
  ({ open, plan, onConfirm, onCancel, isLoading }) => {
    if (!plan) return null;

    return (
      <Modal
        open={open}
        onClose={onCancel}
        title={t("confirmSubscription", { defaultValue: "Confirm Subscription" })}
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
  }
);

SubscriptionConfirmModal.displayName = "SubscriptionConfirmModal";

export default SubscriptionConfirmModal;