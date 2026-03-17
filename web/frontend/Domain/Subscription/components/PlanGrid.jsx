// web/frontend/domains/subscription/components/PlanGrid.jsx
import React, { memo } from "react";
import { Spinner, Text, Banner, Box, InlineStack, BlockStack } from "@shopify/polaris";
import PlanCard from "./PlanCard";

/**
 * Component for displaying a grid of subscription plans
 * Memoized to prevent unnecessary re-renders
 */
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
    isSubscribing, // track subscription processing
    selectedPlan, // identify which plan is being processed
  }) => {
    if (isLoading) {
      return (
        <BlockStack alignment="center" blockAlignment="center" spacing="500">
          <Spinner size="large" />
          <Text variant="bodyMd">Loading subscription plans...</Text>
        </BlockStack>
      );
    }

    if (error) {
      return (
        <Banner tone="critical" title="Error Loading Plans">
          <Text as="p">{error}</Text>
        </Banner>
      );
    }

    if (!plans || plans.length === 0) {
      return (
        <Banner tone="info" title="No Plans Available">
          <Text as="p">
            There are currently no subscription plans available. Please check
            back later.
          </Text>
        </Banner>
      );
    }

    return (
      <InlineStack wrap gap="500">
        {plans.map((plan, index) => (
          <Box key={index} width="45%">
            <PlanCard
              plan={plan}
              isActive={activePlan?.name === plan.name}
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
  }
);

PlanGrid.displayName = "PlanGrid";

export default PlanGrid;