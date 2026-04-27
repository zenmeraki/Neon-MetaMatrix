// web/frontend/domains/subscription/pages/SubscriptionPage.jsx
import React, { useState, useCallback, useEffect } from "react";
import {
  Page,
  Layout,
  BlockStack,
  Frame,
  Banner,
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

const SubscriptionPage = () => {
  const [openItems, setOpenItems] = useState({});
  const { t } = useTranslation();

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

  useEffect(() => {
    if (subscriptionError) {
      showErrorToast(`Failed to process subscription: ${subscriptionError}`);
    }
  }, [subscriptionError]);

  const handleManageSubscription = () => {
    setToastState({
      active: true,
      content: t("currentSubscription"),
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
        <Box maxWidth="1200px" margin="0 auto" paddingInline="1rem" paddingBlock="2rem">
          <Layout>
            {/* Header */}
            <Layout.Section>
              <BlockStack gap="400" align="center">
                <Text variant="headingLg" as="h3" alignment="center">
                  {t("choosePlan")}
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued" alignment="center">
                  {t("subscription_cta_description")}
                </Text>
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
                  <BlockStack gap="400" align="center">
                    {/* FAQ Header */}
                    <BlockStack align="center" gap="200">
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
                      <Text variant="headingLg" as="h2" alignment="center">
                        {t("faqTitle")}
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued" alignment="center">
                        {t("faqSubtitle")}
                      </Text>
                    </BlockStack>

                    <Divider />

                    {/* FAQ Items */}
                    <BlockStack gap="200" width="100%">
                      {faqs.map((faq, index) => (
                        <Card key={faq.id} sectioned>
                          <Button
                            variant="plain"
                            size="large"
                            textAlign="left"
                            onClick={() => toggleItem(faq.id)}
                            width="100%"
                          >
                            <InlineStack align="center" justify="space-between" blockAlign="center" width="100%">
                              <Text variant="headingMd" as="h3">
                                {faq.question}
                              </Text>
                              <Icon source={openItems[faq.id] ? ChevronUpIcon : ChevronDownIcon} />
                            </InlineStack>
                          </Button>

                          <Collapsible open={openItems[faq.id]} id={`faq-${faq.id}`}>
                            <Box paddingBlock="400" paddingInline="200" borderBlockStart="divider">
                              <Text variant="bodyMd" as="p" tone="subdued">
                                {faq.answer}
                              </Text>
                            </Box>
                          </Collapsible>
                        </Card>
                      ))}
                    </BlockStack>

                    <Divider />

                    {/* Contact Support */}
                    <BlockStack align="center" gap="200" paddingBlock="400">
                      <Text variant="bodyMd" as="p" alignment="center">
                        {t("Still_have_questions")}
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued" alignment="center">
                        {t("Contact_Support")}
                      </Text>
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
