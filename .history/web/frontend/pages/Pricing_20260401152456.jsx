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
import { useNavigate } from "react-router-dom"
export default function PricingPage() {
  const navigate = useNavigate()
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const [showFreeModal, setShowFreeModal] = useState(false);
  const [selectedFreePlan, setSelectedFreePlan] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subscribing, setSubscribing] = useState(null);

  // ✅ Move fetchPlans outside of useEffect so we can reuse it
  const fetchPlans = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/subscription/get-plans');
      const data = await response.json();

      if (data.success && data.plans) {
        setPlans(data.plans);
      }
      else {
        setError('Failed to load plans');
      }
    } catch (err) {
      console.error('Error fetching plans:', err);
      setError('Failed to load plans. Please try again.');
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
      question: 'How do subscriptions work?',
      answer: 'Our subscription plans are billed monthly through your Shopify account. You can upgrade, downgrade, or cancel your subscription at any time. All charges appear directly on your Shopify invoice.',
    },
    {
      question: 'What happens if I exceed my plan limits?',
      answer: "You'll receive notifications when you're approaching your limit. You can upgrade your plan at any time to increase your limits without losing any data or configurations.",
    },
    {
      question: 'How do I cancel my subscription?',
      answer: 'You can cancel your subscription at any time from the subscription management page. Your plan will remain active until the end of your billing period, and you can continue using all features during that time.',
    },
    {
      question: 'Can I switch between plans?',
      answer: 'Yes! You can upgrade or downgrade at any time. Upgrades take effect immediately with prorated billing, while downgrades take effect at the start of your next billing cycle.',
    },

    {
      question: 'Is my data secure?',
      answer: 'Absolutely. All data is encrypted in transit and at rest. We follow industry best practices and comply with Shopify\'s security requirements to keep your information safe.',
    },
  ];

  const toggleFaq = (index) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  const handleSelectPlan = async (plan) => {
    try {
      setSubscribing(plan.key);

      const response = await fetch("/api/subscription/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planKey: plan.key,
          returnUrl: `${window.location.origin}/pricing`,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || "Subscription failed");
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
      window.top.location.href = data.confirmationUrl;
    } catch (err) {
      console.error("Subscription error:", err);
      alert("Failed to start subscription. Please try again.");
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
                  Loading plans...
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
              <Banner tone="critical" title="Error loading plans">
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
      title='Choose the perfect plan for your business '
      subtitle='Start free and upgrade as you grow. All plans include our core features with no hidden fees.'
    >
      <Layout>
        <Layout.Section>
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
                      <Badge tone="success">Current plan</Badge>
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
                          Most Popular
                        </Text>
                      </InlineStack>
                    )}
                  </div>

                  <Box paddingBlockStart={plan.popular ? "400" : "0"}>
                    <BlockStack gap="500">
                      <BlockStack gap="200">
                        <Text variant="headingXl" as="h2">
                          {plan.name}
                        </Text>
                        <Text variant="bodyMd" as="p" tone="subdued">
                          {plan.description}
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
                              /month
                            </Text>
                          </Box>
                        </InlineStack>


                        {plan.isFree ? (
                          <Badge tone="success">Free forever</Badge>
                        ) : (
                          <Text variant="bodySm" as="p" tone="subdued">
                            {plan.highlight}
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
                            <Text as="span">Processing…</Text>
                          </InlineStack>
                        ) : plan.isCurrent ? (
                          "Current Plan"
                        ) : (
                          plan.buttonText
                        )}
                      </Button>

                      <Divider />

                      <BlockStack gap="300">
                        <Text variant="headingMd" as="h3">
                          What's included
                        </Text>
                        <BlockStack gap="300">
                          {plan.features.map((feature, featureIndex) => (
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
                  Frequently Asked Questions
                </Text>
                <Box maxWidth="600px">
                  <Text variant="bodyLg" as="p" tone="subdued" alignment="center">
                    Everything you need to know about our plans and billing
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
                      Still have questions?
                    </Text>
                    <Text variant="bodyMd" as="p" tone="subdued" alignment="center">
                      Our support team is here to help you choose the right plan
                    </Text>
                  </BlockStack>
                  <InlineStack gap="300" align="center">
                    <Button variant="primary" size="large"
                      onClick={() => navigate("/suggestionpage")}
                    >
                      Contact Support
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
        title="Activate Free Plan?"
        primaryAction={{
          content: "Confirm",
          onAction: async () => {
            setShowFreeModal(false);
            if (selectedFreePlan) {
              await handleSelectPlan(selectedFreePlan);
            }
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowFreeModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text variant="bodyMd" as="p">
            You are about to activate the Free plan.
            <br />
            <br />
            This plan includes limited features. You can upgrade anytime.
            <br />
            <br />
            Do you want to continue?
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}