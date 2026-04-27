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

const PlanCard = memo(
  ({
    plan,
    isActive,
    onSubscribe,
    getPlanColor,
    getPlanBackgroundColor,
    getPlanBorderColor,
    isSubscribing = false,
    selectedPlan = null,
    isPlansDisabled = false,
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
      if (isThisPlanBeingProcessed || (isSubscribing && isThisPlanSelected)) {
        return `${t("processing")}...`;
      }
      return t("subscribeNow");
    };

    return (
      <Card>
        <Box
          borderBlockStart={`4px solid ${getPlanBorderColor(name)}`}
          opacity={isPlansDisabled ? 0.4 : 1}
          transition="opacity 0.3s ease-in-out"
          pointerEvents={isPlansDisabled ? "none" : "auto"}
        >
          <Box padding="400">
            <BlockStack gap="400">
              <BlockStack gap="400" align="center">
                <Box
                  background={getPlanBackgroundColor(name)}
                  paddingInline="400"
                  paddingBlock="200"
                  borderRadius="500"
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
                  <span style={{ fontSize: "1rem", verticalAlign: "top" }}>
                    $
                  </span>
                  {price === 0 ? "0" : price}
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                {Features?.map((feature, i) => (
                  <InlineStack
                    key={`${name}-${feature}-${i}`}
                    gap="200"
                    align="start"
                    blockAlign="start"
                  >
                    <Box>
                      <Icon
                        source={CheckCircleIcon}
                        tone="success"
                        color={getPlanColor(name)}
                      />
                    </Box>
                    <Text variant="bodyMd" as="p">
                      {feature}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>

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
                loading={
                  isThisPlanBeingProcessed ||
                  (isSubscribing && isThisPlanSelected)
                }
                onClick={() => onSubscribe(plan)}
                fullWidth
              >
                {getButtonText()}
              </Button>
            </BlockStack>
          </Box>
        </Box>
      </Card>
    );
  },
);

PlanCard.displayName = "PlanCard";

export default PlanCard;