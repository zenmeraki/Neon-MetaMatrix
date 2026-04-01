import React, {
  useState,
  useEffect,
  useCallback,
  useDeferredValue,
  useMemo,
} from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Spinner,
  EmptyState,
  Pagination,
  DataTable,
  Box,
  Icon,
  useBreakpoints,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";

export default function ImportHistory() {
  const [importHistory, setImportHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const { mdDown } = useBreakpoints();
  const fetchWithAuth = useAuthenticatedFetch();
  const deferredImportHistory = useDeferredValue(importHistory);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetchWithAuth(
          `/api/history/get-shop-importhistory?page=${currentPage}&limit=10`,
        );

        if (!res) {
          return;
        }

        const result = await res.json();

        if (result.success) {
          setImportHistory(result.data);
          setTotalPages(result.totalPages);
        }
      } catch (err) {
        console.error("Error fetching import history:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentPage, fetchWithAuth]);

  const getStatusBadge = (status, processedRows, totalRows, errorRows) => {
    switch (status) {
      case "completed":
        return errorRows > 0 ? (
          <Badge tone="warning" icon={AlertCircleIcon}>
            Completed with errors
          </Badge>
        ) : (
          <Badge tone="success" icon={CheckCircleIcon}>
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge tone="critical" icon={AlertCircleIcon}>
            Failed
          </Badge>
        );
      case "pending":
      case "processing":
        return (
          <Badge tone="attention" icon={ClockIcon}>
            {status === "pending" ? "Pending" : "Processing"}
          </Badge>
        );
      default:
        return <Badge tone="subdued">Unknown</Badge>;
    }
  };

  const formatDate = (dateString) =>
    new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const handleViewDetails = useCallback((_id) => {}, []);

  const ActionButtons = ({ item }) => (
    <InlineStack align="end" gap="200">
      <Button
        variant="plain"
        size="slim"
        onClick={() => handleViewDetails(item.id)}
      >
        <Icon source={ViewIcon} />
      </Button>
    </InlineStack>
  );

  const MobileCardView = ({ data }) => (
    <BlockStack gap="300">
      {data.map((item) => (
        <Card key={item.id} padding="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {item.filename}
            </Text>

            <InlineStack align="space-between">
              <Text as="p" tone="subdued">
                Status:
              </Text>
              {getStatusBadge(
                item.status,
                item.processedRows,
                item.totalRows,
                item.errorRows,
              )}
            </InlineStack>

            <InlineStack align="space-between">
              <Text as="p" tone="subdued">
                Total Rows:
              </Text>
              <Text as="p">{item.totalRows}</Text>
            </InlineStack>

            <InlineStack align="space-between">
              <Text as="p" tone="subdued">
                Date:
              </Text>
              <Text as="p">{formatDate(item.createdAt)}</Text>
            </InlineStack>

            <InlineStack align="end">
              <Button
                variant="plain"
                size="slim"
                onClick={() => handleViewDetails(item.id)}
              >
                <Icon source={ViewIcon} />
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ))}
    </BlockStack>
  );

  const tableRows = useMemo(
    () =>
      deferredImportHistory.map((item) => [
        item.filename,
        getStatusBadge(
          item.status,
          item.processedRows,
          item.totalRows,
          item.errorRows,
        ),
        item.totalRows.toLocaleString(),
        formatDate(item.createdAt),
        <ActionButtons item={item} key={item.id} />,
      ]),
    [deferredImportHistory],
  );

  if (loading) {
    return (
      <Page title="Import History" compactTitle fullWidth>
        <Card>
          <Box padding="800" textAlign="center">
            <Spinner size="large" />
            <Box paddingBlockStart="200">
              <Text as="p" variant="bodyMd">
                Loading import history...
              </Text>
            </Box>
          </Box>
        </Card>
      </Page>
    );
  }

  const emptyState =
    deferredImportHistory.length === 0 ? (
      <EmptyState
        heading="No import history found"
        description="When you import CSV files, they will appear here with their status and details."
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <Button variant="primary" url="/Spreadsheet">
          Import Products
        </Button>
      </EmptyState>
    ) : null;

  return (
    <Page
      title="Import History"
      subtitle="View and manage your product import history"
      compactTitle
      fullWidth
      primaryAction={{ content: "Import Products", url: "/import" }}
    >
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Recent Imports
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Track the status and progress of your CSV imports
                </Text>
              </BlockStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {deferredImportHistory.length} import
                {deferredImportHistory.length !== 1 ? "s" : ""} found
              </Text>
            </InlineStack>

            {emptyState}

            {deferredImportHistory.length > 0 && (
              <>
                {mdDown ? (
                  <MobileCardView data={deferredImportHistory} />
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "text", "text"]}
                    headings={["File Name", "Status", "Total Rows", "Date", "Actions"]}
                    rows={tableRows}
                  />
                )}

                {totalPages > 1 && (
                  <InlineStack align="center" blockAlign="center">
                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() => setCurrentPage(currentPage - 1)}
                      hasNext={currentPage < totalPages}
                      onNext={() => setCurrentPage(currentPage + 1)}
                      label={`Page ${currentPage} of ${totalPages}`}
                    />
                  </InlineStack>
                )}
              </>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
