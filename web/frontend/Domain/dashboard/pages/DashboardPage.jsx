import React, { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  { label: "हिंदी", value: "hi" },
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
    <div className="dashboard-metric-card">
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
    </div>
  );
});

function MetricSkeleton() {
  return (
    <div className="dashboard-metric-skeleton">
      <Card roundedAbove="sm">
        <Box padding="500" minHeight="140px">
          <SkeletonBodyText lines={3} />
        </Box>
      </Card>
    </div>
  );
}

function QuickActionCard({ title, description, buttonText, onAction }) {
  return (
    <div className="dashboard-quick-action-card">
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
    </div>
  );
}

function DeferredPromotionalContent() {
  const [shouldLoad, setShouldLoad] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (shouldLoad) return;

    const node = ref.current;
    if (!node || !("IntersectionObserver" in window)) {
      const id = window.setTimeout(() => setShouldLoad(true), 4_000);
      return () => window.clearTimeout(id);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <div ref={ref}>
      <div className="dashboard-promo-slot">
        {shouldLoad ? (
          <Suspense fallback={<SkeletonBodyText lines={8} />}>
            <PromotionalContent />
          </Suspense>
        ) : (
          <div className="dashboard-promo-placeholder">
            <SkeletonBodyText lines={18} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { i18n, t } = useTranslation();
  const { storeAccess, loadingStoreData } = useStoreAccess();
  const navigate = useNavigate();

  const handleLanguageChange = (value) => {
    i18n.changeLanguage(value);
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
                        {t("Overview")}
                      </Text>

                      <Text as="p" variant="bodyMd" tone="subdued">
                        {t("dashboardOverviewDescription")}
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
                              {t("language")}
                            </Text>

                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("chooseDashboardLanguage")}
                            </Text>

                            <Select
                              label="Language"
                              labelHidden
                              options={LANGUAGE_OPTIONS}
                              value={i18n.language}
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
                  title="Free access active"
                  action={{
                    content: "Request extension",
                    onAction: () => navigate("/suggestionPage"),
                  }}
                >
                 <p>{t("freeAccessMessage")}</p>
                </Banner>
              )}

              {storeAccess?.isProductInitialySyning && (
                <Banner
                  tone="info"
                  title="Product sync in progress"
                  action={{
                    content: "Check status",
                    onAction: () => navigate("/refresh"),
                  }}
                >
                 <p>{t("productSyncMessage")}</p>
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
                    {t("quickActions")}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("quickActionsDescription")}
                  </Text>
                </BlockStack>

                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <QuickActionCard
                      title={t("products")}
                      description={t("productsDescription")}
                      buttonText={t("openProducts")}
                      onAction={() => navigate("/products")}
                    />
                  </Grid.Cell>

                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <QuickActionCard
                      title={t("bulkEdit")}
                      description={t("bulkEditDescription")}
                      buttonText={t("createBulkEdit")}
                      onAction={() => navigate("/edit")}
                    />
                  </Grid.Cell>

                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <QuickActionCard
                      title={t("exports")}
                      description={t("exportsDescription")}
                      buttonText={t("createExport")}
                      onAction={() => navigate("/exportdata")}
                    />
                  </Grid.Cell>

                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <QuickActionCard
                      title={t("snippetStudio")}
                      description={t("snippetStudioDescription")}
                      buttonText={t("openSnippetStudio")}
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
                    {t("learnAndOptimize")}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("learnAndOptimizeDescription")}
                  </Text>
                </BlockStack>

                <DeferredPromotionalContent />
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
