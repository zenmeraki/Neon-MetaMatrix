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

const MetricCard = memo(function MetricCard({ title, value, icon, tone = "info" }) {
  return (
    <Card>
      <Box padding="400" minHeight="112px">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={icon} tone="subdued" />
              <Text as="span" variant="bodyMd" tone="subdued">
                {title}
              </Text>
            </InlineStack>
            <Badge tone={tone}>{value}</Badge>
          </InlineStack>
          <Text as="p" variant="headingLg">
            {value}
          </Text>
        </BlockStack>
      </Box>
    </Card>
  );
});

function MetricSkeleton() {
  return (
    <Card>
      <Box padding="400" minHeight="112px">
        <BlockStack gap="300">
          <SkeletonBodyText lines={2} />
        </BlockStack>
      </Box>
    </Card>
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
      primaryAction={{
        content: t("editNow"),
        icon: PlusIcon,
        onAction: () => navigate("/products"),
      }}
      secondaryActions={[
        {
          content: t("History"),
          onAction: () => navigate("/history"),
        },
        {
          content: t("SyncData"),
          onAction: () => navigate("/refresh"),
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="500">
              <InlineStack align="space-between" blockAlign="start" gap="400" wrap>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    {t("overview")}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Review activity, check store readiness, and jump back into the workflows merchants use most.
                  </Text>
                </BlockStack>
                <Box minWidth="220px">
                  <Select
                    label="Language"
                    options={LANGUAGE_OPTIONS}
                    value={i18n.language}
                    onChange={handleLanguageChange}
                  />
                </Box>
              </InlineStack>
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
                    onAction: () => navigate("/suggestionpage"),
                  }}
                >
                  <p>
                    You can keep using the app at no cost for the current access window. If you need more time, we can extend it for you.
                  </p>
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
                  <p>
                    Your product mirror is updating in the background. You can continue using the app and refresh the sync page for live status.
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap>
            {loadingStoreData
              ? metricCards.map((card) => (
                  <Box key={card.key} minWidth="220px" maxWidth="320px" width="100%">
                    <MetricSkeleton />
                  </Box>
                ))
              : metricCards.map((card) => (
                  <Box key={card.key} minWidth="220px" maxWidth="320px" width="100%">
                    <MetricCard {...card} />
                  </Box>
                ))}
          </InlineStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <Box padding="500">
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Quick actions
                </Text>
                <Button fullWidth onClick={() => navigate("/products")}>
                  Open products
                </Button>
                <Button fullWidth onClick={() => navigate("/edit")}>
                  Create bulk edit
                </Button>
                <Button fullWidth onClick={() => navigate("/exportdata")}>
                  Create export
                </Button>
                <Button fullWidth onClick={() => navigate("/product-code-snippets")}>
                  Open snippet studio
                </Button>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Box padding="500">
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  Learn and optimize
                </Text>
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
