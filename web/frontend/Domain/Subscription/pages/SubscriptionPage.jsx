// web/frontend/domains/subscription/pages/SubscriptionPage.jsx
import React, { useState, useCallback } from "react";
import {
  Page,
  Layout,
  BlockStack,
  Frame,
  Toast,
  Card,
  Text,
  InlineStack,
  Divider,
  Icon,
  Collapsible,
  Button,
  Box,
} from "@shopify/polaris";
import {
  QuestionCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@shopify/polaris-icons";

// Custom hooks
import { useSubscriptionPlans } from "../hooks/useSubscriptionPlans";
import { useActivePlan } from "../hooks/useActivePlan";
import { useSubscription } from "../hooks/useSubscription";

// Components
import PlanGrid from "../components/PlanGrid";
import SubscriptionConfirmModal from "../components/SubscriptionConfirmModal";
import SubscriptionDetails from "../components/SubscriptionDetails";

import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

const SubscriptionPage = () => {
  const [openItems, setOpenItems] = useState({});
  const { t } = useTranslation(undefined, { i18n: appI18n });

  const {
    plans,
    isLoading: isPlansLoading,
    error: plansError,
    getPlanColor,
    getPlanBackgroundColor,
    getPlanBorderColor,
  } = useSubscriptionPlans();

  const {
    activePlan,
    isLoading: isActivePlanLoading,
    error: activePlanError,
  } = useActivePlan();

  const {
    selectedPlan,
    showConfirmModal,
    isSubscribing,
    error: subscriptionError,
    handleSelectPlan,
    handleCancelSelection,
    handleConfirmSubscription,
  } = useSubscription();

  const [toastState, setToastState] = useState({
    active: false,
    content: "",
    error: false,
  });

  const showErrorToast = (message) => {
    setToastState({
      active: true,
      content: message,
      error: true,
    });
  };

  if (subscriptionError) {
    showErrorToast(`Failed to process subscription: ${subscriptionError}`);
  }

  const handleManageSubscription = () => {
    setToastState({
      active: true,
      content: "Subscription management will open here",
      error: false,
    });
  };

  const memoizedConfirmSubscription = useCallback(() => {
    handleConfirmSubscription();
  }, [handleConfirmSubscription]);

  const memoizedCancelSelection = useCallback(() => {
    handleCancelSelection();
  }, [handleCancelSelection]);

  const faqs = [
    {
      id: "subscriptions",
      question: t("faq_subscriptions_question"),
      answer: t("faq_subscriptions_answer"),
    },
    {
      id: "limits",
      question: t("faq_limits_question"),
      answer: t("faq_limits_answer"),
    },
    {
      id: "cancel",
      question: t("faq_cancel_question"),
      answer: t("faq_cancel_answer"),
    },
  ];

  const toggleItem = (id) => {
    setOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Frame>
      <Page fullWidth>
        {/* <PromotionBanner /> */}

        <Box maxWidth="1200px" margin="0 auto" paddingInline="1rem" paddingBlock="2rem">
          <Layout>
            {/* Header */}
            <Layout.Section>
              <BlockStack gap="400" inlineAlign="center">
                <Text variant="headingLg" as="h3">
                  {t("choosePlan")}
                </Text>
                <Box maxWidth="32rem">
                  <Text variant="bodyMd" as="p" tone="subdued">
                    {t("subscription_cta_description")}
                  </Text>
                </Box>
              </BlockStack>
            </Layout.Section>

            {/* Active Plan */}
            {(activePlan || isActivePlanLoading || activePlanError) && (
              <Layout.Section>
                <SubscriptionDetails
                  activePlan={activePlan}
                  isLoading={isActivePlanLoading}
                  onManage={handleManageSubscription}
                />
              </Layout.Section>
            )}

            {/* Plans Grid */}
            <Layout.Section>
              <PlanGrid
                plans={plans}
                activePlan={activePlan}
                isLoading={isPlansLoading}
                error={plansError}
                onSubscribe={handleSelectPlan}
                getPlanColor={getPlanColor}
                getPlanBackgroundColor={getPlanBackgroundColor}
                getPlanBorderColor={getPlanBorderColor}
                isSubscribing={isSubscribing}
                selectedPlan={selectedPlan}
              />
            </Layout.Section>

            {/* FAQ Section */}
            <Layout.Section>
              <Box maxWidth="900px" marginInline="auto">
                <Card padding="400">
                  <BlockStack gap="400" inlineAlign="center">
                    {/* FAQ Header */}
                    <BlockStack inlineAlign="center" gap="200">
                      <InlineStack align="center" blockAlign="center">
                        <Box
                          background="bg-subdued"
                          borderRadius="full"
                          padding="400"
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          height="48px"
                          width="48px"
                        >
                          <Icon source={QuestionCircleIcon} />
                        </Box>
                      </InlineStack>
                      <Text variant="headingLg" as="h2">
                        {t("faqTitle")}
                      </Text>
                      <Box maxWidth="32rem">
                        <Text variant="bodyMd" as="p" tone="subdued">
                          {t("faqSubtitle")}
                        </Text>
                      </Box>
                    </BlockStack>

                    <Divider />

                    {/* FAQ Items */}
                    <BlockStack gap="200" width="100%">
                      {faqs.map((faq) => (
                        <Card key={faq.id}>
                          <Box padding="400">
                            <BlockStack gap="200">
                              <Button
                                variant="plain"
                                size="large"
                                textAlign="left"
                                onClick={() => toggleItem(faq.id)}
                                fullWidth
                              >
                                <InlineStack align="space-between" blockAlign="center">
                                  <Text variant="headingMd" as="h3">
                                    {faq.question}
                                  </Text>
                                  <Icon source={openItems[faq.id] ? ChevronUpIcon : ChevronDownIcon} />
                                </InlineStack>
                              </Button>

                              <Collapsible open={openItems[faq.id]} id={`faq-${faq.id}`}>
                                <Box paddingBlockStart="200" borderBlockStartWidth="025" borderColor="border">
                                  <Text variant="bodyMd" as="p" tone="subdued">
                                    {faq.answer}
                                  </Text>
                                </Box>
                              </Collapsible>
                            </BlockStack>
                          </Box>
                        </Card>
                      ))}
                    </BlockStack>

                    <Divider />

                    {/* Contact Support */}
                    <BlockStack inlineAlign="center" gap="200" paddingBlock="400">
                      <Text variant="bodyMd" as="p">
                        {t("Still_have_questions")}
                      </Text>
                      <Box maxWidth="32rem">
                        <Text variant="bodyMd" as="p" tone="subdued">
                          {t("Contact_Support")}
                        </Text>
                      </Box>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </Box>
            </Layout.Section>

          </Layout>
        </Box>

        {/* Confirmation Modal */}
        <SubscriptionConfirmModal
          open={showConfirmModal}
          plan={selectedPlan}
          onConfirm={memoizedConfirmSubscription}
          onCancel={memoizedCancelSelection}
          isLoading={isSubscribing}
        />

        {/* Toast */}
        {toastState.active && (
          <Toast
            content={toastState.content}
            tone={toastState.error ? "critical" : "success"}
            onDismiss={() => setToastState({ ...toastState, active: false })}
            duration={4500}
          />
        )}
      </Page>
    </Frame>
  );
};

export default SubscriptionPage;
