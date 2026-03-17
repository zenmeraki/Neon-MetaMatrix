import React, { memo, Suspense, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  InlineStack,
  BlockStack,
  Icon,
  Button,
  Spinner,
  Text,
  Box,
  Divider,
  Badge,
  Banner,
  Select,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  EditIcon,
  ExportIcon,
  ImportIcon,
  PlusIcon,
} from "@shopify/polaris-icons";

import { useStoreAccess } from "../hooks/useStoreAccess";

const PromotionalContent = React.lazy(() =>
  import("../components/PromotionalContent")
);

/* =======================
   LANGUAGE OPTIONS
======================= */
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

/* =======================
   ACTION CARD
======================= */
const ActionCard = memo(({ title, value, icon }) => (
  <Card>
    <Box padding="400">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Icon source={icon} tone="subdued" />
          {value}
        </InlineStack>
        <Text variant="headingSm" as="h6">
          {title}
        </Text>
      </BlockStack>
    </Box>
  </Card>
));

/* =======================
   DASHBOARD PAGE
======================= */
const DashboardPage = () => {
  const { i18n, t } = useTranslation();
  const { storeAccess, loadingStoreData } = useStoreAccess();
  const navigate = useNavigate();

  /* =======================
     LANGUAGE CHANGE HANDLER
  ======================= */
  const handleLanguageChange = (value) => {
    i18n.changeLanguage(value);
    localStorage.setItem("appLanguage", value);
  };

  const bulkEdits = storeAccess?.totalbulkEditCount ?? 0;

  const activityCards = [
    {
      title: t("bulkEdits"),
      value: loadingStoreData ? (
        <Spinner size="small" />
      ) : (
        <Badge tone="success">{bulkEdits}</Badge>
      ),
      icon: EditIcon,
    },
    {
      title: t("productExports"),
      value: loadingStoreData ? <Spinner size="small" /> : <Badge>0</Badge>,
      icon: ExportIcon,
    },
    {
      title: t("productImports"),
      value: loadingStoreData ? <Spinner size="small" /> : <Badge>0</Badge>,
      icon: ImportIcon,
    },
  ];

  return (
    <Page title={t("dashboard")}
      subtitle={t("manageStoreOperations")}
      primaryAction={{
        content: t("editNow"),
        icon: PlusIcon,
        onAction: () => navigate("/products")
      }}>
      {/* 🌍 LANGUAGE DROPDOWN */}
      <Box paddingBlockEnd="300">
        <InlineStack align="end">
          <Select
            label="Language"
            labelInline
            options={LANGUAGE_OPTIONS}
            value={i18n.language}
            onChange={handleLanguageChange}
          />
        </InlineStack>
      </Box>
      {storeAccess?.isCreditAvailable && (
        <Box paddingBlockEnd="300">
          <Banner tone="success" title="🎉 Free Access Activated">
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                You can use the app free for 1 month. If you need an extension,
                please email us — we’re happy to help.
              </Text>

              <InlineStack align="end">
                <Button
                  size="slim"
                  onClick={() => navigate("/suggestionpage")}
                >
                  Request Extension
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        </Box>
      )}
      {storeAccess?.isProductInitialySyning && (
        <Box paddingBlockEnd="300">
          <Banner tone="info">
            <BlockStack gap="200">
              <InlineStack gap="200" align="start">
                <Text as="p" variant="bodyMd">
                  Your products are syncing in the background. You can continue
                  using the app — data will update automatically once syncing
                  completes.
                </Text>
              </InlineStack>

              <InlineStack align="end">
                <Button size="slim" onClick={() => navigate("/refresh")}>
                  Check status
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        </Box>
      )}
      <Layout>
        {/* OVERVIEW */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h2">
              {t("overview")}
            </Text>

            <InlineStack gap="400" wrap={false}>
              {activityCards.map((card, index) => (
                <div key={index} style={{ flex: 1, minWidth: "200px" }}>
                  <ActionCard {...card} />
                </div>
              ))}
            </InlineStack>

          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* THINGS TO DO */}
        {/* <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h5">
              {t("thingsToDo")}
            </Text>
            <InlineStack gap="300" wrap>
              <Link to="/edit" style={{ textDecoration: "none", flex: 1 }}>
                <Button fullWidth>{t("newBulkEdit")}</Button>
              </Link>
              <Link style={{ textDecoration: "none", flex: 1 }}>
                <Button fullWidth>{t("uploadSpreadsheet")}</Button>
              </Link>
              <Link style={{ textDecoration: "none", flex: 1 }}>
                <Button fullWidth>{t("exportData")}</Button>
              </Link>
            </InlineStack>
          </BlockStack>
        </Layout.Section> */}

        {/* PROMOTIONAL CONTENT */}
        <Layout.Section>
          <Suspense fallback={null}>
            <PromotionalContent />
          </Suspense>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default DashboardPage;
