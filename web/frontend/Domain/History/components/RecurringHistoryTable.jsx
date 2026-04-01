// web/frontend/domains/history/components/RecurringHistoryTable.jsx
import React, { memo, useCallback, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import {
  DataTable,
  Badge,
  Button,
  Spinner,
  Box,
  Text,
  BlockStack,
  InlineStack,
  Modal,
  TextContainer,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";
import RecurringEditViewModal from "./RecurringEditView";

/**
 * Component for displaying the recurring history table (Polaris v13)
 */
const RecurringHistoryTable = memo(
  ({
    histories,
    isLoading,
    isLoadingMore,
    hasMore,
    onLoadMore,
    emptyStateMessage = "No recurring edits found.",
  }) => {
    const [open, setOpen] = useState(false);
    const [historyItem, setHistoryItem] = useState(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [detailsError, setDetailsError] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteRecurringItem, setDeleteRecurringItem] = useState(null);
    const [localHistories, setLocalHistories] = useState(histories);
    const { t, i18n } = useTranslation(undefined, { i18n: appI18n });

    // Status badge colors for recurring edits
    const renderStatusBadge = (status) => {
      let tone = "attention";
      const normalizedStatus = status?.toLowerCase();

      switch (normalizedStatus) {
        case "active":
          tone = "success";
          break;
        case "inactive":
        case "paused":
          tone = "warning";
          break;
        case "completed":
          tone = "info";
          break;
        case "failed":
          tone = "critical";
          break;
        case "expired":
          tone = "subdued";
          break;
        default:
          tone = "attention";
      }
      return <Badge tone={tone}>{t(normalizedStatus) || status}</Badge>;
    };

    // Render frequency badge
    const renderFrequencyBadge = (frequency) => {
      return (
        <Badge tone="info">{t(frequency?.toLowerCase()) || frequency}</Badge>
      );
    };

    const onViewDetails = async (id) => {
      setIsLoadingDetails(true);
      setDetailsError(null);
      setHistoryItem(null);

      try {
        setOpen(true);
        const response = await fetch(
          `/api/products/get-recurring-edit/${id}?lang=${i18n.language}`
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        setHistoryItem(data.data);
      } catch (error) {
        console.error("Error fetching recurring edit details:", error);
        setDetailsError(
          error.message || "Failed to load recurring edit details"
        );
      } finally {
        setIsLoadingDetails(false);
      }
    };

    const handleDeleteClose = useCallback(() => {
      setShowDeleteModal(false);
      setDeleteRecurringItem(null);
    }, []);

    const handleDeleteRecurring = useCallback(async () => {
      if (!deleteRecurringItem?.id) return;

      setDeleteLoading(true);
      try {
        const response = await fetch(
          `/api/products/delete-recurring-edit/${deleteRecurringItem.id}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
          }
        );

        if (response.ok) {
          setShowDeleteModal(false);
          setLocalHistories((prev) =>
            prev.filter((h) => h.id !== deleteRecurringItem.id)
          );
        } else {
          const err = await response.json();
          console.error(
            "Delete failed:",
            err.error || "Failed to delete recurring edit"
          );
        }
      } catch (error) {
        console.error("Unexpected error during delete:", error.message);
      }
      setDeleteLoading(false);
    }, [deleteRecurringItem]);

    useEffect(() => {
      setLocalHistories(histories);
    }, [histories]);

    // Format next run time
    const formatNextRun = (item) => {
      const { nextRun, status } = item;
      const normalizedStatus = status?.toLowerCase();

      if (normalizedStatus === "inactive" || normalizedStatus === "paused") {
        return (
          <Text as="span" tone="subdued" italic>
            {t("paused")}
          </Text>
        );
      }
      if (!nextRun) {
        return (
          <Text as="span" tone="subdued">
            {t("notScheduled")}
          </Text>
        );
      }
      try {
        return new Date(nextRun).toLocaleString();
      } catch {
        return "Date unavailable";
      }
    };

    // Format created time
    const formatCreatedTime = (createdAt) => {
      try {
        return new Date(createdAt).toLocaleString();
      } catch {
        return "Date unavailable";
      }
    };

    if (isLoading) {
      return (
        <Box padding="500">
          <BlockStack gap="300" inlineAlign="center">
            <Spinner accessibilityLabel="Loading recurring edits" size="large" />
          </BlockStack>
        </Box>
      );
    }

    if (!localHistories || localHistories.length === 0) {
      return (
        <Box padding="500">
          <BlockStack gap="300" inlineAlign="center">
            <Text as="span" tone="subdued">
              {emptyStateMessage}
            </Text>
          </BlockStack>
        </Box>
      );
    }

    const rows = localHistories.map((item) => {
      const {
        _id,
        title,
        status,
        frequency,
        totalRuns = 0,
        successfulRuns = 0,
        createdAt,
      } = item;

      return [
        title || "Untitled",
        renderStatusBadge(status),
        renderFrequencyBadge(frequency),
        `${successfulRuns} / ${totalRuns}`,
        // formatNextRun(item),
        // user,
        formatCreatedTime(createdAt),
        <InlineStack key={_id} gap="200">
          <Button size="slim" icon={<Eye size={14} />} onClick={() => onViewDetails(_id)}>
            {t("view")}
          </Button>
          {/* <Button
            size="slim"
            icon={isActive ? <Pause size={14} /> : <Play size={14} />}
            onClick={() => canToggle && handleToggleStatus(_id, status)}
            disabled={!canToggle}
            tone={isActive ? "critical" : "success"}
          >
            {isActive ? t("pause") : t("resume")}
          </Button>
          <Button
            size="slim"
            icon={<Settings size={14} />}
            onClick={() => handleEdit(_id)}
          >
            {t("edit")}
          </Button>
          <Button
            size="slim"
            icon={<Trash2 size={14} />}
            onClick={() => canDelete && handleDelete(item)}
            disabled={!canDelete}
            tone="critical"
          >
            {t("delete")}
          </Button> */}
        </InlineStack>,
      ];
    });

    return (
      <Box>
        <DataTable
          columnContentTypes={[
            "text", // Title
            "text", // Status
            "text", // Frequency
            "text", // Runs
            // "text", // Next Run
            // "text", // User
            "text", // Created
            "text", // Actions
          ]}
          headings={[
            t("title"),
            t("statusLabel"),
            t("frequency"),
            t("runs"),
            // t("nextRun"),
            // t("user"),
            t("created"),
            t("actions"),
          ]}
          rows={rows}
          footerContent={
            hasMore ? (
              <Box paddingBlockStart="400">
                <BlockStack inlineAlign="center">
                  <Button loading={isLoadingMore} onClick={onLoadMore}>
                    {t("loadMore")}
                  </Button>
                </BlockStack>
              </Box>
            ) : null
          }
        />

        {/* <HistoryDetails
          open={open}
          historyItem={historyItem}
          onClose={handleCloseDetails}
          isLoading={isLoadingDetails}
          error={null}
        /> */}
        <RecurringEditViewModal
          data={historyItem}
          error={detailsError}
          isLoading={isLoadingDetails}
          open={open}
          onClose={() => setOpen(false)}
        />

        <Modal
          open={showDeleteModal}
          onClose={handleDeleteClose}
          title={t("deleteRecurringEdit")}
          primaryAction={{
            content: t("delete"),
            onAction: handleDeleteRecurring,
            loading: deleteLoading,
            destructive: true,
          }}
          secondaryActions={[
            {
              content: t("cancel"),
              onAction: handleDeleteClose,
            },
          ]}
        >
          <Modal.Section>
            <TextContainer>
              <p>
                {t("deleteRecurringConfirmation", {
                  title: deleteRecurringItem?.title || "",
                })}
              </p>
              <p>
                <Text tone="subdued">{t("deleteRecurringWarning")}</Text>
              </p>
            </TextContainer>
          </Modal.Section>
        </Modal>
      </Box>
    );
  }
);

RecurringHistoryTable.displayName = "RecurringHistoryTable";

export default RecurringHistoryTable;
