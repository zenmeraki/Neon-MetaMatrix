import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Divider,
  Box,
  Icon,
  Collapsible,
  Spinner,
  Banner,
  Layout,
} from '@shopify/polaris';
import { CheckIcon, StarFilledIcon } from '@shopify/polaris-icons';
import { Modal } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import {
  redirectToAuthWithReturnTo,
  redirectToTopLevel,
  useAuthenticatedFetch,
} from "../hooks/useAuthenticatedFetch";
import { useNavigate } from "react-router-dom"

function isSessionErrorMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("session expired") ||
    normalized.includes("shopify session missing") ||
    normalized.includes("unauthorized")
  );
}

export default function PricingPage() {
  const { t } = useTranslation();
  const fetchWithAuth = useAuthenticatedFetch();
  const navigate = useNavigate()
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const [showFreeModal, setShowFreeModal] = useState(false);
  const [selectedFreePlan, setSelectedFreePlan] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subscriptionError, setSubscriptionError] = useState(null);
  const [subscribing, setSubscribing] = useState(null);

  // ✅ Move fetchPlans outside of useEffect so we can reuse it
  const fetchPlans = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetchWithAuth('/api/subscription/get-plans');
      if (!response) return;
      const data = await response.json();

      if (data.success && data.plans) {
        setPlans(data.plans);
      }
      else {
        setError(t("pricingLoadPlansFailed"));
      }
    } catch (err) {
      console.error('Error fetching plans:', err);
      setError(t("pricingLoadPlansRetry"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  // ✅ Also refetch when returning from Shopify payment page
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const charge_id = urlParams.get('charge_id');

    // If returning from payment confirmation, refetch plans
    if (charge_id) {
      fetchPlans();
    }
  }, []);

  const faqs = [
    {
      question: t("pricingFaqSubscriptionsQuestion"),
      answer: t("pricingFaqSubscriptionsAnswer"),
    },
    {
      question: t("pricingFaqLimitsQuestion"),
      answer: t("pricingFaqLimitsAnswer"),
    },
    {
      question: t("pricingFaqCancelQuestion"),
      answer: t("pricingFaqCancelAnswer"),
    },
    {
      question: t("pricingFaqSwitchQuestion"),
      answer: t("pricingFaqSwitchAnswer"),
    },

    {
      question: t("pricingFaqSecurityQuestion"),
      answer: t("pricingFaqSecurityAnswer"),
    },
  ];

  const toggleFaq = (index) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  const getPlanTranslationKey = (planKey, suffix) => `pricingPlan.${planKey}.${suffix}`;

  const getLocalizedPlanName = (plan) =>
    t(getPlanTranslationKey(plan.key, "name"), { defaultValue: plan.name });

  const getLocalizedPlanDescription = (plan) =>
    t(getPlanTranslationKey(plan.key, "description"), { defaultValue: plan.description });

  const getLocalizedPlanHighlight = (plan) =>
    t(getPlanTranslationKey(plan.key, "highlight"), { defaultValue: plan.highlight });

  const getLocalizedPlanButtonText = (plan) =>
    t(getPlanTranslationKey(plan.key, "buttonText"), { defaultValue: plan.buttonText });

  const getLocalizedPlanFeatures = (plan) =>
    (plan.features || []).map((feature, index) =>
      t(getPlanTranslationKey(plan.key, `features.${index}`), { defaultValue: feature }),
    );

  const handleSelectPlan = async (plan) => {
    try {
      setSubscribing(plan.key);
      setSubscriptionError(null);

      const response = await fetchWithAuth("/api/subscription/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planKey: plan.key,
          returnUrl: `${window.location.origin}/pricing`,
        }),
      });
      if (!response) return;

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || t("pricingSubscriptionFailed"));
      }

      // ✅ Handle FREE plan - refetch to update UI
      if (!data.confirmationUrl) {
        // alert("Free plan activated successfully");
        setSubscribing(null);
        // ✅ Refetch plans to update the UI
        await fetchPlans();
        return;
      }

      // Redirect to Shopify payment page for paid plans
      redirectToTopLevel(data.confirmationUrl);
    } catch (err) {
      console.error("Subscription error:", err);
      const message =
        err?.message || t("pricingStartSubscriptionFailed");
      setSubscriptionError({
        message,
        requiresReconnect: isSessionErrorMessage(message),
      });
      setSubscribing(null);
    }
  };

  if (loading) {
    return (
      <Page>
        <Layout>
          <Layout.Section>
            <Box paddingBlockStart="1600" paddingBlockEnd="1600">
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="large" />
                <Text variant="bodyLg" as="p" tone="subdued">
                  {t("pricingLoadingPlans")}
                </Text>
              </BlockStack>
            </Box>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <Layout>
          <Layout.Section>
            <Box paddingBlockStart="400">
              <Banner tone="critical" title={t("pricingErrorTitle")}>
                <p>{error}</p>
              </Banner>
            </Box>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title={t("pricingPageTitle")}
      subtitle={t("pricingPageSubtitle")}
    >
      <Layout>
        <Layout.Section>
          {subscriptionError && (
            <Box paddingBlockEnd="400">
              <Banner
                tone="critical"
                title={t("pricingErrorTitle")}
                action={subscriptionError.requiresReconnect ? {
                  content: t("common.reconnectShopify", "Reconnect Shopify"),
                  onAction: () => redirectToAuthWithReturnTo(),
                } : undefined}
                onDismiss={() => setSubscriptionError(null)}
              >
                <p>{subscriptionError.message}</p>
              </Banner>
            </Box>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
            marginBottom: '40px'
          }}>
            {plans.map((plan) => (
              <div key={plan.key} style={{
                position: 'relative',
                height: '100%'
              }}>
                <Card>
                  {plan.isCurrent && (
                    <Box position="absolute" insetBlockStart="200" insetInlineEnd="200">
                      <Badge tone="success">{t("pricingCurrentPlan")}</Badge>
                    </Box>
                  )}
                  <div style={{
                    background: plan.popular ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
                    margin: plan.popular ? '-20px -20px 0 -20px' : '0',
                    padding: plan.popular ? '12px 20px' : '0',
                    borderRadius: plan.popular ? '16px 16px 0 0' : '0',
                  }}>
                    {plan.popular && (
                      <InlineStack align="center" gap="200" blockAlign="center">
                        <Text variant="headingSm" as="p" tone="text-inverse">
                          {t("pricingMostPopular")}
                        </Text>
                      </InlineStack>
                    )}
                  </div>

                  <Box paddingBlockStart={plan.popular ? "400" : "0"}>
                      <BlockStack gap="500">
                      <BlockStack gap="200">
                        <Text variant="headingXl" as="h2">
                          {getLocalizedPlanName(plan)}
                        </Text>
                        <Text variant="bodyMd" as="p" tone="subdued">
                          {getLocalizedPlanDescription(plan)}
                        </Text>
                      </BlockStack>

                      <BlockStack gap="200">
                        <InlineStack align="start" blockAlign="end" gap="200">
                          <Text variant="heading3xl" as="p" fontWeight="bold">
                            ${plan.price}
                          </Text>

                          {plan.compareAtPrice && plan.compareAtPrice > plan.price && (
                            <Text variant="headingMd" as="p" tone="subdued">
                              <span style={{ textDecoration: "line-through", opacity: 0.7 }}>
                                ${plan.compareAtPrice}
                              </span>
                            </Text>
                          )}

                          <Box paddingBlockEnd="100">
                            <Text variant="headingMd" as="p" tone="subdued">
                              {t("pricingPerMonth")}
                            </Text>
                          </Box>
                        </InlineStack>


                        {plan.isFree ? (
                          <Badge tone="success">{t("pricingFreeForever")}</Badge>
                        ) : (
                          <Text variant="bodySm" as="p" tone="subdued">
                            {getLocalizedPlanHighlight(plan)}
                          </Text>
                        )}
                      </BlockStack>

                      <Button
                        variant={plan.isCurrent ? "primary" : plan.buttonVariant}
                        size="large"
                        fullWidth
                        disabled={plan.isCurrent || subscribing === plan.key}
                        onClick={() => {
                          if (plan.isFree) {
                            setSelectedFreePlan(plan);
                            setShowFreeModal(true);
                          } else {
                            handleSelectPlan(plan);
                          }
                        }}
                      >
                        {subscribing === plan.key ? (
                          <InlineStack gap="200" align="center">
                            <Spinner size="small" />
                            <Text as="span">{t("pricingProcessing")}</Text>
                          </InlineStack>
                        ) : plan.isCurrent ? (
                          t("pricingCurrentPlanButton")
                        ) : (
                          getLocalizedPlanButtonText(plan)
                        )}
                      </Button>

                      <Divider />

                      <BlockStack gap="300">
                        <Text variant="headingMd" as="h3">
                          {t("pricingWhatsIncluded")}
                        </Text>
                        <BlockStack gap="300">
                          {getLocalizedPlanFeatures(plan).map((feature, featureIndex) => (
                            <InlineStack key={featureIndex} gap="300" blockAlign="start">
                              <div style={{
                                marginTop: '2px',
                                color: '#008060',
                                flexShrink: 0
                              }}>
                                <Icon source={CheckIcon} tone="success" />
                              </div>
                              <Text variant="bodyMd" as="p">
                                {feature}
                              </Text>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      </BlockStack>
                    </BlockStack>
                  </Box>
                </Card>
              </div>
            ))}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Box paddingBlockStart="800" paddingBlockEnd="400">
            <BlockStack gap="600" inlineAlign="center">
              <BlockStack gap="300" inlineAlign="center">
                <Text variant="heading2xl" as="h2" alignment="center">
                  {t("pricingFaqTitle")}
                </Text>
                <Box maxWidth="600px">
                  <Text variant="bodyLg" as="p" tone="subdued" alignment="center">
                    {t("pricingFaqSubtitle")}
                  </Text>
                </Box>
              </BlockStack>

              <Box width="100%" maxWidth="800px">
                <BlockStack gap="300">
                  {faqs.map((faq, index) => (
                    <Card key={index}>
                      <Box>
                        <Button
                          variant="plain"
                          textAlign="left"
                          fullWidth
                          onClick={() => toggleFaq(index)}
                          disclosure={openFaqIndex === index ? 'up' : 'down'}
                        >
                          <Text variant="headingMd" as="h3">
                            {faq.question}
                          </Text>
                        </Button>
                        <Collapsible
                          open={openFaqIndex === index}
                          id={`faq-${index}`}
                          transition={{ duration: '200ms', timingFunction: 'ease-in-out' }}
                        >
                          <Box paddingBlockStart="400">
                            <Divider />
                            <Box paddingBlockStart="400">
                              <Text variant="bodyMd" as="p" tone="subdued">
                                {faq.answer}
                              </Text>
                            </Box>
                          </Box>
                        </Collapsible>
                      </Box>
                    </Card>
                  ))}
                </BlockStack>
              </Box>
            </BlockStack>
          </Box>
        </Layout.Section>

        <Layout.Section>
          <Box paddingBlockStart="400" paddingBlockEnd="800">
            <Card>
              <Box padding="600">
                <BlockStack gap="400" inlineAlign="center">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingLg" as="h3" alignment="center">
                      {t("pricingSupportTitle")}
                    </Text>
                    <Text variant="bodyMd" as="p" tone="subdued" alignment="center">
                      {t("pricingSupportSubtitle")}
                    </Text>
                  </BlockStack>
                  <InlineStack gap="300" align="center">
                    <Button variant="primary" size="large"
                      onClick={() => navigate("/suggestionpage")}
                    >
                      {t("pricingContactSupport")}
                    </Button>

                  </InlineStack>
                </BlockStack>
              </Box>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
      <Modal
        open={showFreeModal}
        onClose={() => setShowFreeModal(false)}
        title={t("pricingFreeModalTitle")}
        primaryAction={{
          content: t("pricingConfirm"),
          onAction: async () => {
            setShowFreeModal(false);
            if (selectedFreePlan) {
              await handleSelectPlan(selectedFreePlan);
            }
          },
        }}
        secondaryActions={[
          {
            content: t("pricingCancel"),
            onAction: () => setShowFreeModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text variant="bodyMd" as="p">
            {t("pricingFreeModalBodyLine1")}
            <br />
            <br />
            {t("pricingFreeModalBodyLine2")}
            <br />
            <br />
            {t("pricingFreeModalBodyLine3")}
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
