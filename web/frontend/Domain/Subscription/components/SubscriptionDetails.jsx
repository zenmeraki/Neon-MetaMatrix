import React, { memo } from "react";
import {
  Text,
  Card,
  InlineStack,
  Badge,
  Banner,
  Spinner,
  Box,
  BlockStack,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const SubscriptionDetails = memo(({ activePlan, isLoading, error }) => {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <Card>
        <Box padding="400" textAlign="center">
          <Spinner size="small" />
          <Box paddingBlockStart="200">
            <Text variant="bodyMd">
              {t("loadingSubscription", {
                defaultValue: "Loading subscription details...",
              })}
            </Text>
          </Box>
        </Box>
      </Card>
    );
  }

  if (error) {
    return (
      <Banner
        tone="critical"
        title={t("errorLoadingSubscription", {
          defaultValue: "Error loading subscription",
        })}
      >
        <Text>{error}</Text>
      </Banner>
    );
  }

  if (!activePlan) {
    return (
      <Card>
        <Box padding="400">
          <Banner
            tone="info"
            title={t("noActiveSubscriptionTitle", {
              defaultValue: "No active subscription",
            })}
          >
            <Text>
              {t("noActiveSubscriptionMessage", {
                defaultValue:
                  "You do not have an active subscription. Select a plan below to subscribe.",
              })}
            </Text>
          </Banner>
        </Box>
      </Card>
    );
  }

  const { name } = activePlan;

  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          <Text variant="headingMd">
            {t("currentSubscription", { defaultValue: "Current subscription" })}
          </Text>
          <BlockStack gap="200">
            <InlineStack gap="200" align="center">
              <Text variant="headingMd">
                {t("plan", { defaultValue: "Plan" })}:
              </Text>
              <Badge tone={activePlan?.planType === "freeversion" ? "attention" : "success"}>
                {name}
              </Badge>
            </InlineStack>
          </BlockStack>
        </BlockStack>
      </Box>
    </Card>
  );
});

SubscriptionDetails.displayName = "SubscriptionDetails";

export default SubscriptionDetails;
