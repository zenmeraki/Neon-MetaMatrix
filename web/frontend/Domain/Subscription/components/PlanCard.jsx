// web/frontend/domains/subscription/components/PlanCard.jsx
import React, { memo } from "react";
import {
  Text,
  Card,
  InlineStack,
  Icon,
  Button,
  Box,
  BlockStack,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { t } from "i18next";

/**
 * Component for displaying a subscription plan card
 * Memoized to prevent unnecessary re-renders
 */
const PlanCard = memo(
  ({
    plan,
    isActive,
    onSubscribe,
    getPlanColor,
    getPlanBackgroundColor,
    getPlanBorderColor,
    isSubscribing = false, // track subscription processing
    selectedPlan = null, // identify which plan is being processed
    isPlansDisabled = false, // control fade effect and disable plans
  }) => {
    const { name, price, Features } = plan;

    const isThisPlanBeingProcessed =
      isSubscribing && selectedPlan?.name === name;

    const isThisPlanSelected = selectedPlan?.name === name;

    const isButtonDisabled =
      isActive ||
      isThisPlanBeingProcessed ||
      (isSubscribing && isThisPlanSelected) ||
      isPlansDisabled;

    const getButtonText = () => {
      if (isPlansDisabled) return t("plansTemporarilyDisabled");
      if (isActive) return t("currentPlan");
      if (isThisPlanBeingProcessed || (isSubscribing && isThisPlanSelected))
        return `${t("processing")}...`;
      return t("subscribeNow");
    };

    return (
      <Card>
        <Box
          borderBlockStart={`4px solid ${getPlanBorderColor(name)}`}
          minHeight="450px"
          display="flex"
          flexDirection="column"
          opacity={isPlansDisabled ? 0.4 : 1}
          transition="opacity 0.3s ease-in-out"
          pointerEvents={isPlansDisabled ? "none" : "auto"}
        >
          {/* Plan Header */}
          <Box padding="400">
            <BlockStack gap="400" align="center">
              <Box
                background={getPlanBackgroundColor(name)}
                paddingInline="16px"
                paddingBlock="8px"
                borderRadius="20px"
                width="fit-content"
              >
                <Text
                  variant="headingMd"
                  as="h3"
                  alignment="center"
                  color={getPlanColor(name)}
                >
                  {name}
                </Text>
              </Box>
              <Text variant="headingXl" as="p" alignment="center">
                <span style={{ fontSize: "1rem", verticalAlign: "top" }}>$</span>
                {price === 0 ? "0" : price}
              </Text>
            </BlockStack>
          </Box>

        
          {/* Features */}
          <Box padding="400" paddingBlockStart="0" flex="1">
            <BlockStack gap="400" align="start"> 
              {Features?.map((feature, i) => (
                <InlineStack
                  key={i}
                  gap="200"
                  align="start"       
                  blockAlignment="start" 
                  paddingBlockEnd="10px"
                >
                  <Box flexShrink={0}>
                    <Icon
                      source={CheckCircleIcon}
                      tone="success"
                      color={getPlanColor(name)}
                    />
                  </Box>
                  <Text variant="bodyMd">{feature}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Box>



          {/* Action Button */}
          <Box padding="400" paddingBlockStart="0">
            <Button
              variant={
                !isActive &&
                  !isThisPlanBeingProcessed &&
                  !(isSubscribing && isThisPlanSelected) &&
                  !isPlansDisabled
                  ? "primary"
                  : "secondary"
              }
              disabled={isButtonDisabled}
              size="large"
              loading={isThisPlanBeingProcessed || (isSubscribing && isThisPlanSelected)}
              onClick={() => onSubscribe(plan)}
              fullWidth
            >
              {getButtonText()}
            </Button>
          </Box>
        </Box>
      </Card>
    );
  }
);

PlanCard.displayName = "PlanCard";

export default PlanCard;
