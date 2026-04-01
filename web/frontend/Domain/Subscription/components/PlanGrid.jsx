import React, { memo } from "react";
import { Spinner, Text, Banner, Box, InlineStack, BlockStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";
import PlanCard from "./PlanCard";

const PlanGrid = memo(
  ({
    plans,
    activePlan,
    isLoading,
    error,
    onSubscribe,
    getPlanColor,
    getPlanBackgroundColor,
    getPlanBorderColor,
    isSubscribing,
    selectedPlan,
  }) => {
    const { t } = useTranslation(undefined, { i18n: appI18n });

    if (isLoading) {
      return (
        <BlockStack gap="500" inlineAlign="center">
          <Spinner size="large" />
          <Text variant="bodyMd">
            {t("loadingSubscriptionPlans", {
              defaultValue: "Loading subscription plans...",
            })}
          </Text>
        </BlockStack>
      );
    }

    if (error) {
      return (
        <Banner
          tone="critical"
          title={t("errorLoadingPlans", {
            defaultValue: "Error loading plans",
          })}
        >
          <Text as="p">{error}</Text>
        </Banner>
      );
    }

    if (!plans || plans.length === 0) {
      return (
        <Banner
          tone="info"
          title={t("noPlansAvailableTitle", {
            defaultValue: "No plans available",
          })}
        >
          <Text as="p">
            {t("noPlansAvailableBody", {
              defaultValue:
                "There are currently no subscription plans available. Please check back later.",
            })}
          </Text>
        </Banner>
      );
    }

    return (
      <InlineStack wrap gap="500">
        {plans.map((plan) => (
          <Box key={plan.plan_id} width="45%">
            <PlanCard
              plan={plan}
              isActive={activePlan?.plan_id === plan.plan_id}
              onSubscribe={onSubscribe}
              getPlanColor={getPlanColor}
              getPlanBackgroundColor={getPlanBackgroundColor}
              getPlanBorderColor={getPlanBorderColor}
              isSubscribing={isSubscribing}
              selectedPlan={selectedPlan}
            />
          </Box>
        ))}
      </InlineStack>
    );
  },
);

PlanGrid.displayName = "PlanGrid";

export default PlanGrid;
