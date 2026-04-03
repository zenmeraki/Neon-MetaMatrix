import React, { memo, Suspense, useMemo } from "react";
import {
  Page,
  Layout,
  Card,
  InlineStack,
  BlockStack,
  Icon,
  Button,
  Text,
  Box,
  Badge,
  Banner,
  Select,
  SkeletonBodyText,
  Grid,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  EditIcon,
  ExportIcon,
  ImportIcon,
  PlusIcon,
} from "@shopify/polaris-icons";
import { i18n as appI18n } from "../../../utils/i18nUtils";
import { useStoreAccess } from "../hooks/useStoreAccess";

const PromotionalContent = React.lazy(() =>
  import("../components/PromotionalContent"),
);

const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Deutsch", value: "de" },
  { label: "Français", value: "fr" },
  { label: "Español", value: "es" },
  { label: "Português", value: "pt" },
  { label: "العربية", value: "ar" },
  { label: "हिन्दी", value: "hi" },
  { label: "中文", value: "zh" },
  { label: "日本語", value: "ja" },
  { label: "한국어", value: "ko" },
  { label: "Русский", value: "ru" },
];

const MetricCard = memo(function MetricCard({
  title,
  value,
  icon,
  tone = "info",
}) {
  return (
    <Card roundedAbove="sm">
      <Box padding="500" minHeight="140px">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start">
            <InlineStack gap="300" blockAlign="center">
              <Box
                background="bg-surface-secondary"
                borderRadius="200"
                padding="300"
              >
                <Icon source={icon} tone={tone} />
              </Box>

              <BlockStack gap="100">
                <Text as="span" variant="bodyLg" fontWeight="semibold">
                  {title}
                </Text>
                <Text
                  as="p"
                  variant="heading2xl"
                  tone={Number(value) > 0 ? "success" : "subdued"}
                >
                  {value}
                </Text>
              </BlockStack>
            </InlineStack>

            <Badge tone={tone}>{title}</Badge>
          </InlineStack>
          <Text as="p" variant="bodyMd" fontWeight="medium">
            {title}
          </Text>
        </BlockStack>
      </Box>
    </Card>
  );
});

function MetricSkeleton() {
  return (
    <Card roundedAbove="sm">
      <Box padding="500" minHeight="140px">
        <SkeletonBodyText lines={3} />
      </Box>
    </Card>
  );
}

function QuickActionCard({ title, description, buttonText, onAction }) {
  return (
    <Card roundedAbove="sm">
      <Box padding="500">
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              {title}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {description}
            </Text>
          </BlockStack>

          <Box paddingBlockStart="200">
            <Button fullWidth variant="primary" onClick={onAction}>
              {buttonText}
            </Button>
          </Box>
        </BlockStack>
      </Box>
    </Card>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation(undefined, { i18n: appI18n });
  const { storeAccess, loadingStoreData } = useStoreAccess();
  const navigate = useNavigate();

  const handleLanguageChange = (value) => {
    appI18n.changeLanguage(value);
    localStorage.setItem("appLanguage", value);
  };

  const metricCards = useMemo(
    () => [
      {
        key: "bulk-edits",
        title: t("bulkEdits"),
        value: storeAccess?.totalbulkEditCount ?? 0,
        icon: EditIcon,
        tone: "success",
      },
      {
        key: "exports",
        title: t("productExports"),
        value: storeAccess?.totalExportCount ?? 0,
        icon: ExportIcon,
        tone: "info",
      },
      {
        key: "imports",
        title: t("productImports"),
        value: storeAccess?.totalImportCount ?? 0,
        icon: ImportIcon,
        tone: "attention",
      },
    ],
    [storeAccess, t],
  );

  return (
    <Page
      fullWidth
      title={t("dashboard")}
      subtitle={t("manageStoreOperations")}

    >
      <Layout>
        <Layout.Section>
          <Card roundedAbove="sm">
            <Box padding="500">

              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 7, xl: 7 }}>
                  <Box paddingBlock="200">
                    <BlockStack gap="300">
                      <Text as="h2" variant="heading2xl">
                        {t("overview")}
                      </Text>

                      <Text as="p" variant="bodyMd" tone="subdued">
                        {t("dashboardOverviewDescription", {
                          defaultValue:
                            "Review activity, check store readiness, and jump back into the workflows merchants use most.",
                        })}
                      </Text>
                      <Box paddingBlockStart="400">
                        <InlineStack gap="500" wrap blockAlign="center">
                          <Box>
                            <Button onClick={() => navigate("/history")}>
                              {t("History")}
                            </Button>
                          </Box>

                          <Box>
                            <Button onClick={() => navigate("/refresh")}>
                              {t("SyncData")}
                            </Button>
                          </Box>

                          <Box>
                            <Button
                              variant="primary"
                              icon={PlusIcon}
                              onClick={() => navigate("/products")}
                            >
                              {t("editNow")}
                            </Button>
                          </Box>
                        </InlineStack>
                      </Box>
                    </BlockStack>
                  </Box>
                </Grid.Cell>

                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 3, lg: 5, xl: 5 }}>
                  <InlineStack align="start">
                    <Box width="100%" maxWidth="420px">
                      <Card background="bg-surface-secondary" roundedAbove="sm">
                        <Box padding="350">
                          <BlockStack gap="150">
                            <Text as="h3" variant="headingMd">
                              {t("dashboardLanguageTitle", {
                                defaultValue: "Language",
                              })}
                            </Text>

                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("dashboardLanguageDescription", {
                                defaultValue: "Choose dashboard language.",
                              })}
                            </Text>

                            <Select
                              label={t("dashboardLanguageLabel", {
                                defaultValue: "Language",
                              })}
                              labelHidden
                              options={LANGUAGE_OPTIONS}
                              value={appI18n.language}
                              onChange={handleLanguageChange}
                            />
                          </BlockStack>
                        </Box>
                      </Card>
                    </Box>
                  </InlineStack>
                </Grid.Cell>
              </Grid>
            </Box>
          </Card>
        </Layout.Section>

        {(storeAccess?.isCreditAvailable || storeAccess?.isProductInitialySyning) && (
          <Layout.Section>
            <BlockStack gap="300">
              {storeAccess?.isCreditAvailable && (
                <Banner
                  tone="success"
                  title={t("dashboardFreeAccessTitle", {
                    defaultValue: "Free access active",
                  })}
                  action={{
                    content: t("dashboardFreeAccessAction", {
                      defaultValue: "Request extension",
                    }),
                    onAction: () => navigate("/suggestionpage"),
                  }}
                >
                  <p>
                    {t("dashboardFreeAccessBody", {
                      defaultValue:
                        "You can keep using the app at no cost for the current access window. If you need more time, we can extend it for you.",
                    })}
                  </p>
                </Banner>
              )}

              {storeAccess?.isProductInitialySyning && (
                <Banner
                  tone="info"
                  title={t("dashboardSyncInProgressTitle", {
                    defaultValue: "Product sync in progress",
                  })}
                  action={{
                    content: t("dashboardSyncInProgressAction", {
                      defaultValue: "Check status",
                    }),
                    onAction: () => navigate("/refresh"),
                  }}
                >
                  <p>
                    {t("dashboardSyncInProgressBody", {
                      defaultValue:
                        "Your product mirror is updating in the background. You can continue using the app and refresh the sync page for live status.",
                    })}
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Layout.Section>
        )}

        <Layout.Section>
          <Grid>
            {loadingStoreData
              ? metricCards.map((card) => (
                <Grid.Cell
                  key={card.key}
                  columnSpan={{ xs: 6, sm: 3, md: 2, lg: 4, xl: 4 }}
                >
                  <MetricSkeleton />
                </Grid.Cell>
              ))
              : metricCards.map((card) => (
                <Grid.Cell
                  key={card.key}
                  columnSpan={{ xs: 6, sm: 3, md: 2, lg: 4, xl: 4 }}
                >
                  <MetricCard {...card} />
                </Grid.Cell>
              ))}
          </Grid>
        </Layout.Section>

        <Layout.Section>
          <Card roundedAbove="sm">
            <Box padding="500">
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingLg">
                    {t("dashboardQuickActionsTitle", {
                      defaultValue: "Quick actions",
                    })}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("dashboardQuickActionsDescription", {
                      defaultValue:
                        "Jump directly into the tasks merchants use most often.",
                    })}
                  </Text>
                </BlockStack>

                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <QuickActionCard
                      title={t("Products", { defaultValue: "Products" })}
                      description={t("dashboardQuickProductsDescription", {
                        defaultValue:
                          "Browse your catalog and start working on product data.",
                      })}
                      buttonText={t("dashboardQuickProductsButton", {
                        defaultValue: "Open products",
                      })}
                      onAction={() => navigate("/products")}
                    />
                  </Grid.Cell>

                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <QuickActionCard
                      title={t("dashboardQuickBulkEditTitle", {
                        defaultValue: "Bulk edit",
                      })}
                      description={t("dashboardQuickBulkEditDescription", {
                        defaultValue:
                          "Create and manage edits across products faster.",
                      })}
                      buttonText={t("dashboardQuickBulkEditButton", {
                        defaultValue: "Create bulk edit",
                      })}
                      onAction={() => navigate("/edit")}
                    />
                  </Grid.Cell>

                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <QuickActionCard
                      title={t("dashboardQuickExportsTitle", {
                        defaultValue: "Exports",
                      })}
                      description={t("dashboardQuickExportsDescription", {
                        defaultValue:
                          "Generate product exports for reporting or external workflows.",
                      })}
                      buttonText={t("dashboardQuickExportsButton", {
                        defaultValue: "Create export",
                      })}
                      onAction={() => navigate("/exportdata")}
                    />
                  </Grid.Cell>

                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <QuickActionCard
                      title={t("dashboardQuickSnippetTitle", {
                        defaultValue: "Snippet studio",
                      })}
                      description={t("dashboardQuickSnippetDescription", {
                        defaultValue:
                          "Open reusable product snippets and code utilities.",
                      })}
                      buttonText={t("dashboardQuickSnippetButton", {
                        defaultValue: "Open snippet studio",
                      })}
                      onAction={() => navigate("/product-code-snippets")}
                    />
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card roundedAbove="sm">
            <Box padding="500">
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingLg">
                    {t("dashboardLearnTitle", {
                      defaultValue: "Learn and optimize",
                    })}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("dashboardLearnDescription", {
                      defaultValue:
                        "Best practices, guidance, and product education for faster execution.",
                    })}
                  </Text>
                </BlockStack>

                <Suspense
                  fallback={
                    <Box minHeight="320px">
                      <SkeletonBodyText lines={8} />
                    </Box>
                  }
                >
                  <PromotionalContent />
                </Suspense>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
