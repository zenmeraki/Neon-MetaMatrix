import { memo } from "react";
import { Banner, Spinner, Box, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { usePlanStatus } from "../hooks/usePlanStatus";
import "./PlanStatus.css";

const PlanStatus = memo(function PlanStatus({ onUpgrade }) {
  const { t } = useTranslation();
  const { loading, showAlert, dismissAlert } = usePlanStatus();

  if (loading) {
    return (
      <Box className="PlanStatus__loading">
        <Spinner size="large" />
      </Box>
    );
  }

  if (!showAlert) return null;

  return (
    <Banner
      title={t("plan.warningTitle", "Plan Required")}
      tone="warning"
      onDismiss={dismissAlert}
      action={
        onUpgrade
          ? {
              content: t("plan.upgrade", "Upgrade Plan"),
              onAction: onUpgrade,
            }
          : undefined
      }
    >
      <Text as="p" variant="bodyMd">
        {t(
          "plan.warningMessage",
          "Purchase a plan for seamless and efficient app performance."
        )}
      </Text>
    </Banner>
  );
});

export default PlanStatus;
