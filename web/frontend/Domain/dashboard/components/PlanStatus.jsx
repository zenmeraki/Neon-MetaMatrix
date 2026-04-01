// web/frontend/domains/dashboard/components/PlanStatus.jsx
import React from "react";
import { Banner, Spinner } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";
import { usePlanStatus } from "../hooks/usePlanStatus";

/**
 * Component to display plan status and warnings
 */
const PlanStatus = () => {
  const { t } = useTranslation(undefined, { i18n: appI18n });
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
      title={t("planWarningTitle", { defaultValue: "Plan required" })}
      tone="warning"
      onDismiss={dismissAlert}
      action={{
        content: t("planUpgrade", { defaultValue: "Upgrade plan" }),
        url: "/plans",
      }}
    >
      <p>
        {t("planWarningMessage", {
          defaultValue:
            "Purchase a plan for seamless and efficient app performance.",
        })}
      </p>
    </Banner>
  );
};

export default PlanStatus;
