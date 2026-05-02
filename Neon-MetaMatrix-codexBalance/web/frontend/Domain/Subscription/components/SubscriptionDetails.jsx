// web/frontend/domains/subscription/components/SubscriptionDetails.jsx
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
import { t } from "i18next";

/**
 * Component for displaying subscription details
 * Memoized to prevent unnecessary re-renders
 */
const SubscriptionDetails = memo(({ activePlan, isLoading, error }) => {
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
          defaultValue: "Error Loading Subscription",
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
              defaultValue: "No Active Subscription",
            })}
          >
            <Text>
              {t("noActiveSubscriptionMessage", {
                defaultValue:
                  "You don't have an active subscription. Select a plan below to subscribe.",
              })}
            </Text>
          </Banner>
        </Box>
      </Card>
    );
  }

  const { name /*, currentEditCount, maxEdits*/ } = activePlan;

  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          <Text variant="headingMd">
            {t("currentSubscription", { defaultValue: "Current Subscription" })}
          </Text>
          <BlockStack gap="200">
            <InlineStack gap="200" align="center">
              <Text variant="headingMd">{t("plan", { defaultValue: "Plan" })}:</Text>
              <Badge tone={name === "Free Version" ? "attention" : "success"}>
                {name}
              </Badge>
            </InlineStack>

            {/* Future usage tracking */}
            {/* <InlineStack align="space-between">
              <Text variant="bodyMd">{t("usage", { defaultValue: "Usage" })}:</Text>
              <Text variant="bodyMd">
                {currentEditCount} / {maxEdits || t("unlimited", { defaultValue: "Unlimited" })} edits
              </Text>
            </InlineStack> */}
          </BlockStack>
        </BlockStack>
      </Box>
    </Card>
  );
});

SubscriptionDetails.displayName = "SubscriptionDetails";

export default SubscriptionDetails;