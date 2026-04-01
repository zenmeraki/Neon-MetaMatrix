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
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

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
    isPlansDisabled = true,
  }) => {
    const { t } = useTranslation(undefined, { i18n: appI18n });
    const { name, price, Features } = plan;

    const isThisPlanBeingProcessed =
      isSubscribing && selectedPlan?.plan_id === plan.plan_id;

    const isThisPlanSelected = selectedPlan?.plan_id === plan.plan_id;

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
          borderBlockStart={`4px solid ${getPlanBorderColor(plan)}`}
          minHeight="450px"
          display="flex"
          flexDirection="column"
          opacity={isPlansDisabled ? 0.4 : 1}
          transition="opacity 0.3s ease-in-out"
          pointerEvents={isPlansDisabled ? "none" : "auto"}
        >
          <Box padding="400">
            <BlockStack gap="400" inlineAlign="center">
              <Box
                background={getPlanBackgroundColor(plan)}
                paddingInline="16px"
                paddingBlock="8px"
                borderRadius="20px"
                width="fit-content"
              >
                <Text variant="headingMd" as="h3" color={getPlanColor(plan)}>
                  {name}
                </Text>
              </Box>
              <Text variant="headingXl" as="p">
                <span style={{ fontSize: "1rem", verticalAlign: "top" }}>$</span>
                {price === 0 ? "0" : price}
              </Text>
            </BlockStack>
          </Box>

          <Box padding="400" paddingBlockStart="0" flex="1">
            <BlockStack gap="400">
              {Features?.map((feature, index) => (
                <InlineStack
                  key={index}
                  gap="200"
                  align="start"
                  blockAlign="start"
                  paddingBlockEnd="10px"
                >
                  <Box flexShrink={0}>
                    <Icon
                      source={CheckCircleIcon}
                      tone="success"
                      color={getPlanColor(plan)}
                    />
                  </Box>
                  <Text variant="bodyMd">{feature}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Box>

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
  },
);

PlanCard.displayName = "PlanCard";

export default PlanCard;
