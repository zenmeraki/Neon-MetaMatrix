import { memo, useCallback, useMemo } from "react";
import { Banner, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

const PlanBanner = memo(function PlanBanner({ plan, onUpgrade }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const hasUsablePlan =
    plan &&
    plan.active !== true &&
    plan.maxEdits != null &&
    plan.currentEditCount != null &&
    plan.maxProductsPerEdit != null;

  const handleUpgrade = useCallback(() => {
    if (onUpgrade) {
      onUpgrade();
      return;
    }

    navigate("/plans");
  }, [navigate, onUpgrade]);

  const bannerContent = useMemo(() => {
    if (!hasUsablePlan) return null;

    const currentEditCount = plan.currentEditCount ?? 0;
    const maxEdits = plan.maxEdits ?? 0;
    const maxProductsPerEdit = plan.maxProductsPerEdit ?? 0;
    const editLimitReached = currentEditCount >= maxEdits;

    return {
      tone: editLimitReached ? "critical" : "info",
      title: editLimitReached
        ? t("plan.freeLimitReached", "Free plan limit reached")
        : t("plan.freeUsage", "Free plan usage"),
      message: editLimitReached
        ? t(
            "plan.freeLimitReachedMessage",
            "You've reached your free plan limit: {{currentEditCount}}/{{maxEdits}} edits.",
            { currentEditCount, maxEdits }
          )
        : t(
            "plan.freeUsageMessage",
            "Free plan: {{currentEditCount}}/{{maxEdits}} edits used this month. Max {{maxProductsPerEdit}} products per edit.",
            { currentEditCount, maxEdits, maxProductsPerEdit }
          ),
      actionContent: editLimitReached
        ? t("plan.upgradeNow", "Upgrade now")
        : t("plan.upgrade", "Upgrade"),
    };
  }, [hasUsablePlan, plan, t]);

  if (!bannerContent) return null;

  return (
    <Banner
      title={bannerContent.title}
      tone={bannerContent.tone}
      action={{
        content: bannerContent.actionContent,
        onAction: handleUpgrade,
      }}
    >
      <Text as="p" variant="bodyMd">
        {bannerContent.message}
      </Text>
    </Banner>
  );
});

export default PlanBanner;
