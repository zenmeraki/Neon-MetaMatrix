// web/frontend/domains/subscription/components/PlanGrid.jsx
import React, { memo } from "react";
import {
  Spinner,
  Text,
  Banner,
  Grid,
  BlockStack,
} from "@shopify/polaris";
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
    isSubscribing,
    selectedPlan,
  }) => {
    if (isLoading) {
      return (
        <BlockStack gap="500" inlineAlign="center" align="center">
          <Spinner size="large" />
          <Text variant="bodyMd" as="p">
            Loading subscription plans...
          </Text>
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

    if (!Array.isArray(plans) || plans.length === 0) {
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
      <Grid>
        {plans.map((plan) => (
          <Grid.Cell
            key={plan.key || plan.name}
            columnSpan={{
              xs: 6,
              sm: 6,
              md: 6,
              lg: 4,
              xl: 4,
            }}
          >
            <PlanCard
              plan={plan}
              isActive={
                activePlan?.key === plan.key ||
                activePlan?.name === plan.name
              }
              onSubscribe={onSubscribe}
              getPlanColor={getPlanColor}
              getPlanBackgroundColor={getPlanBackgroundColor}
              getPlanBorderColor={getPlanBorderColor}
              isSubscribing={isSubscribing}
              selectedPlan={selectedPlan}
            />
          </Grid.Cell>
        ))}
      </Grid>
    );
  },
);

PlanGrid.displayName = "PlanGrid";

export default PlanGrid;