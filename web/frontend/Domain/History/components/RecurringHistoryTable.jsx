// web/frontend/domains/history/components/RecurringHistoryTable.jsx
import React, { memo, useCallback, useEffect, useState } from "react";
import { Eye, Play, Pause, Settings, Trash2 } from "lucide-react";
import {
  DataTable,
  Badge,
  Button,
  ButtonGroup,
  Spinner,
  Box,
  Text,
  Modal,
  TextContainer,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
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
    onRefresh,
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
    const { t, i18n } = useTranslation();

    const handleCloseDetails = useCallback(() => {
      setOpen(false);
      setHistoryItem(null);
      setDetailsError(null);
    }, []);

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

    const handleToggleStatus = async (id, currentStatus) => {
      const normalizedCurrentStatus = currentStatus?.toLowerCase();
      const newStatus =
        normalizedCurrentStatus === "active" ? "Inactive" : "Active";

      try {
        const response = await fetch(`/api/products/update-recurring-edit/${id}/toggle`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });

        if (response.ok) {
          setLocalHistories((prev) =>
            prev.map((h) => (h.id === id ? { ...h, status: newStatus } : h))
          );
        } else {
          console.error("Failed to toggle recurring edit status");
        }
      } catch (error) {
        console.error("Error toggling recurring edit:", error);
      }
    };

    const handleEdit = (id) => {
      // Navigate to edit recurring schedule
      // You can implement navigation to edit form here
    };

    const handleDelete = (item) => {
      setDeleteRecurringItem(item);
      setShowDeleteModal(true);
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
        <div style={{ padding: "20px", textAlign: "center" }}>
          <Spinner accessibilityLabel="Loading recurring edits" size="large" />
        </div>
      );
    }

    if (!localHistories || localHistories.length === 0) {
      return (
        <div style={{ padding: "20px", textAlign: "center" }}>
          <Text as="span" tone="subdued">
            {emptyStateMessage}
          </Text>
        </div>
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
        shop,
        createdAt,
      } = item;

      const normalizedStatus = status?.toLowerCase();

      return [
        title || "Untitled",
        renderStatusBadge(status),
        renderFrequencyBadge(frequency),
        `${successfulRuns} / ${totalRuns}`,
        // formatNextRun(item),
        // user,
        formatCreatedTime(createdAt),
        <ButtonGroup key={_id} spacing="tight">
          <Button
            size="slim"
            icon={<Eye size={14} />}
            onClick={() => onViewDetails(_id)}
          >
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
        </ButtonGroup>,
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
              <div style={{ textAlign: "center", marginTop: "16px" }}>
                <Button loading={isLoadingMore} onClick={onLoadMore}>
                  {t("loadMore")}
                </Button>
              </div>
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
          onUpdated={onRefresh}
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
