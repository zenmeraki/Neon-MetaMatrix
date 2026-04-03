// web/frontend/domains/dashboard/components/PlanStatus.jsx
import React from "react";
import { Banner, Spinner, Button } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { usePlanStatus } from "../hooks/usePlanStatus";

/**
 * Component to display plan status and warnings
 */
const PlanStatus = () => {
  const { t } = useTranslation();
  const { loading, showAlert, dismissAlert } = usePlanStatus();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[140px]">
        <Spinner size="large" />
      </div>
    );
  }

  if (!showAlert) return null;

  return (
    <Banner
      title={t("plan.warningTitle", "Plan Required")}
      status="warning"
      onDismiss={dismissAlert}
      action={{ content: t("plan.upgrade", "Upgrade Plan"), url: "/plans" }}
    >
      <p>{t("plan.warningMessage", "Purchase a plan for seamless and efficient app performance.")}</p>
    </Banner>
  );
};

export default PlanStatus;