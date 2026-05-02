import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Divider,
  Box,
  List,
  Spinner,
  Banner,
} from "@shopify/polaris";
import { ArrowLeftIcon } from "@shopify/polaris-icons";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function ExportHistoryDetailsPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();

  const [exportJob, setExportJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const pollingRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const normalizeStatusKey = useCallback((status) => {
    const normalized = String(status || "").trim().toLowerCase();

    if (normalized === "completed") return "completed";
    if (normalized === "failed") return "failed";
    if (normalized === "processing") return "processing";
    return "pending";
  }, []);

  const getStatusTone = useCallback(
    (status) => {
      switch (normalizeStatusKey(status)) {
        case "completed":
          return "success";
        case "failed":
          return "critical";
        case "processing":
          return "info";
        case "pending":
        default:
          return "attention";
      }
    },
    [normalizeStatusKey],
  );

  const getStatusLabel = useCallback(
    (status) => {
      switch (normalizeStatusKey(status)) {
        case "completed":
          return t("historyStatus.completed", { defaultValue: t("completed") });
        case "failed":
          return t("historyStatus.failed", { defaultValue: t("failed") });
        case "processing":
          return t("historyStatus.processing", { defaultValue: t("processing") });
        case "pending":
        default:
          return t("historyStatus.pending", { defaultValue: t("pending") });
      }
    },
    [normalizeStatusKey, t],
  );

  const getExportTypeLabel = useCallback(
    (type, rawType) => {
      const normalized = String(rawType || type || "").trim().toLowerCase();

      if (normalized === "manual export") {
        return t("exportType.manual", { defaultValue: t("ManualExport") });
      }

      if (normalized === "scheduled export") {
        return t("exportType.scheduled", { defaultValue: t("ScheduledExport") });
      }

      return type || rawType || "-";
    },
    [t],
  );

  const getTranslatedFieldLabel = useCallback(
    (field) => {
      if (!field) return "-";

      const direct = t(`fieldLabels.${field}`, { defaultValue: "" });
      if (direct) return direct;

      const normalizedMap = {
        ProductTitle: "title",
        ProductDescription: "description",
        Vendor: "vendor",
        ProductType: "productType",
        CreatedAt: "created_at",
        UpdatedAt: "updated_at",
        PublishedAt: "published_at",
        Handle: "handle",
        TemplateSuffix: "theme_template",
        Tags: "tags",
        Status: "status",
        VariantTitle: "variant_title",
        Price: "price",
        SKU: "sku",
        Barcode: "barcode",
        InventoryQuantity: "inventory_quantity",
        InventoryPolicy: "inventory_policy",
        Weight: "weight",
        WeightUnit: "weight_unit",
      };

      const mappedKey = normalizedMap[field];
      if (mappedKey) {
        const mapped = t(`fieldLabels.${mappedKey}`, { defaultValue: "" });
        if (mapped) return mapped;
      }

      return field;
    },
    [t],
  );

  const formatDuration = useCallback(
    (ms) => {
      if (!ms) return "-";
      return `${(ms / 1000).toFixed(2)} ${t("common.seconds", {
        defaultValue: "seconds",
      })}`;
    },
    [t],
  );

  const formatDate = useCallback((date) => {
    if (!date) return "-";
    return new Date(date).toLocaleString();
  }, []);

  const fetchExportDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/history/get-export-details/${id}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to fetch export details");
      }

      const job = data.data;

      setExportJob(job);
      setError(null);

      const currentStatus = normalizeStatusKey(job?.status);

      if (currentStatus === "pending" || currentStatus === "processing") {
        if (!pollingRef.current) {
          pollingRef.current = setInterval(() => {
            fetchExportDetails();
          }, 5000);
        }
      } else {
        stopPolling();
      }
    } catch (err) {
      setError(err?.message || "Failed to fetch export details");
      stopPolling();
    } finally {
      setLoading(false);
    }
  }, [id, normalizeStatusKey, stopPolling]);

  useEffect(() => {
    fetchExportDetails();

    return () => {
      stopPolling();
    };
  }, [fetchExportDetails, stopPolling]);

  const pageTitle = useMemo(() => {
    return exportJob?.filename || t("exportDetails.title");
  }, [exportJob?.filename, t]);

  if (loading) {
    return (
      <Page title={t("loadingExportDetails")}>
        <Box padding="600">
          <InlineStack align="center">
            <Spinner size="large" />
          </InlineStack>
        </Box>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title={t("exportDetails.title")}>
        <Layout>
          <Layout.Section>
            <Banner tone="critical">{error}</Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!exportJob) return null;

  const {
    status,
    type,
    rawType,
    totalItems,
    durationMs,
    startedAt,
    completedAt,
    fields = [],
    fileUrl,
    error: jobError,
  } = exportJob;

  const translatedStatus = getStatusLabel(status);
  const translatedType = getExportTypeLabel(type, rawType);

  return (
    <Page
      title={pageTitle}
      backAction={{
        content: t("exportDetails.back"),
        icon: ArrowLeftIcon,
        onAction: () => navigate(-1),
      }}
      primaryAction={
        normalizeStatusKey(status) === "completed"
          ? {
              content: t("exportDetails.downloadCsv"),
              onAction: () => window.open(fileUrl, "_blank"),
            }
          : undefined
      }
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd">
                  {t("exportDetails.summary.title")}
                </Text>

                <Badge tone={getStatusTone(status)}>{translatedStatus}</Badge>
              </InlineStack>

              <Divider />

              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text tone="subdued">
                    {t("exportDetails.summary.type")}
                  </Text>
                  <Text>{translatedType}</Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text tone="subdued">
                    {t("exportDetails.summary.totalItems")}
                  </Text>
                  <Text>{totalItems ?? "-"}</Text>
                </BlockStack>
              </InlineStack>

              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text tone="subdued">
                    {t("exportDetails.summary.startedAt")}
                  </Text>
                  <Text>{formatDate(startedAt)}</Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text tone="subdued">
                    {t("exportDetails.summary.completedAt")}
                  </Text>
                  <Text>{formatDate(completedAt)}</Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text tone="subdued">
                    {t("exportDetails.summary.duration")}
                  </Text>
                  <Text>{formatDuration(durationMs)}</Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">
                {t("exportDetails.fields.title")}
              </Text>
              <Divider />

              {fields.length > 0 ? (
                <List type="bullet">
                  {fields.map((field, index) => (
                    <List.Item key={`${field}-${index}`}>
                      {getTranslatedFieldLabel(field)}
                    </List.Item>
                  ))}
                </List>
              ) : (
                <Text tone="subdued">
                  {t("exportDetails.fields.empty")}
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {normalizeStatusKey(status) === "failed" && jobError ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" tone="critical">
                  {t("exportDetails.error.title")}
                </Text>
                <Divider />
                <Box
                  padding="400"
                  background="bg-critical-subdued"
                  borderRadius="200"
                >
                  <Text tone="critical">{jobError}</Text>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}
      </Layout>
    </Page>
  );
}