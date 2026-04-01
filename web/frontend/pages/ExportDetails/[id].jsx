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
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { openTopLevelUrl } from "../../utils/embeddedNavigation";

export default function ExportHistoryDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [exportJob, setExportJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const pollingRef = useRef(null);
  const isFetchingRef = useRef(false);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const fetchExportDetails = async () => {
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;

    try {
      const res = await fetch(`/api/history/get-export-details/${id}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to fetch export details");
      }

      const nextExportJob = data.data;
      const status = nextExportJob?.status;

      setExportJob(nextExportJob);
      setError(null);

      if (status === "PENDING" || status === "PROCESSING") {
        if (!pollingRef.current) {
          pollingRef.current = setInterval(() => {
            if (!document.hidden) {
              fetchExportDetails();
            }
          }, 5000);
        }
      } else {
        stopPolling();
      }
    } catch (err) {
      setError(err.message);
      stopPolling();
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExportDetails();

    const handleVisibilityChange = () => {
      if (
        !document.hidden &&
        (exportJob?.status === "PENDING" || exportJob?.status === "PROCESSING")
      ) {
        fetchExportDetails();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopPolling();
    };
  }, [id, exportJob?.status]);

  const getStatusTone = (status) => {
    switch (status) {
      case "COMPLETED":
        return "success";
      case "FAILED":
        return "critical";
      case "PROCESSING":
        return "info";
      case "PENDING":
        return "attention";
      default:
        return "attention";
    }
  };

  const formatDuration = (ms) => {
    if (!ms) return "-";
    return `${(ms / 1000).toFixed(2)} seconds`;
  };

  const formatDate = (date) => {
    if (!date) return "-";
    return new Date(date).toLocaleString();
  };

  if (loading) {
    return (
      <Page title="Loading Export Details">
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
      <Page title="Export Details">
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
    filename,
    status,
    type,
    totalItems,
    durationMs,
    startedAt,
    completedAt,
    fields = [],
    fileUrl,
    error: jobError,
  } = exportJob;

  return (
    <Page
      title={filename || "Export Details"}
      backAction={{
        content: "Export History",
        icon: ArrowLeftIcon,
        onAction: () => navigate(-1),
      }}
      primaryAction={
        status === "COMPLETED"
          ? {
              content: "Download CSV",
              onAction: () => openTopLevelUrl(fileUrl),
            }
          : undefined
      }
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd">Export Summary</Text>
                <Badge tone={getStatusTone(status)}>{status}</Badge>
              </InlineStack>

              <Divider />

              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text tone="subdued">Type</Text>
                  <Text>{type || "-"}</Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text tone="subdued">Total Items</Text>
                  <Text>{totalItems ?? "-"}</Text>
                </BlockStack>
              </InlineStack>

              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text tone="subdued">Started At</Text>
                  <Text>{formatDate(startedAt)}</Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text tone="subdued">Completed At</Text>
                  <Text>{formatDate(completedAt)}</Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text tone="subdued">Duration</Text>
                  <Text>{formatDuration(durationMs)}</Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Exported Fields</Text>
              <Divider />

              {fields.length > 0 ? (
                <List type="bullet">
                  {fields.map((field, index) => (
                    <List.Item key={index}>{field}</List.Item>
                  ))}
                </List>
              ) : (
                <Text tone="subdued">No fields available</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {status === "FAILED" && jobError && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" tone="critical">
                  Error Details
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
        )}
      </Layout>
    </Page>
  );
}
