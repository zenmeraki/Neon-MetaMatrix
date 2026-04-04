import React, { useState, useCallback, useMemo } from "react";
import { Card, Banner, Toast, BlockStack } from "@shopify/polaris";
import { historyService } from "../services/historyService";
import { useHistoryList } from "../hooks/useHistoryList";
import { useHistorySearch } from "../hooks/useHistorySearch";
import HistoryTable from "../components/HistoryTable";
import RecurringHistoryTable from "../components/RecurringHistoryTable";
import HistoryFilters from "../components/HistoryFilters";
import SaveViewModal from "../components/SaveViewModal";
import { useTranslation } from "react-i18next";
import { KEY_TO_TYPE } from "../hooks/useHistoryList";

const HistoryComponent = () => {
  const { t } = useTranslation();
  const [toastState, setToastState] = useState({
    active: false,
    message: "",
    error: false,
  });
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);

  const tabs = useMemo(
    () => [
      { id: "manual-edits", content: t("ManualEdit") },
      { id: "scheduled-edits", content: t("ScheduledEdit") },
      { id: "recurring-edits", content: t("RecurringEdit") },
    ],
    [t],
  );

  const {
    histories,
    pagination,
    filters,
    isLoading,
    isLoadingMore,
    error,
    handleTabChange,
    loadMore,
    refetch,
  } = useHistoryList();

  const { searchValue, debouncedSearchChange } = useHistorySearch();

  const selectedTabIndex = tabs.findIndex(
    (tab) =>
      tab.content ===
      t(Object.keys(KEY_TO_TYPE).find((key) => KEY_TO_TYPE[key] === filters.type) || "ManualEdit"),
  );

  const handleExport = useCallback(async () => {
    try {
      const blob = await historyService.exportHistory(filters);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `history-export-${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      setToastState({
        active: true,
        message: t("exportStarted") || "Export started. Your file will download shortly.",
        error: false,
      });
    } catch {
      setToastState({
        active: true,
        message: t("exportFailed") || "Failed to export history. Please try again.",
        error: true,
      });
    }
  }, [filters, t]);

  const getEmptyStateMessage = useCallback(() => {
    switch (filters.type) {
      case "Manual edit":
        return t("noManualEdits") || "No manual edits found. Try editing some products first.";
      case "Scheduled edit":
        return t("noScheduledEdits") || "No scheduled edits found. Try scheduling an edit.";
      case "Recurring edit":
        return t("noRecurringEdits") || "No recurring edits found. Try setting up a recurring edit.";
      default:
        return t("noHistory") || "No history items found.";
    }
  }, [filters.type, t]);

  const isRecurringEditTab = filters.type === "Recurring edit";

  return (
    <BlockStack gap="400">
      <Card>
        <HistoryFilters
          searchValue={searchValue}
          onSearchChange={debouncedSearchChange}
          onExport={handleExport}
          onSaveView={() => setShowSaveViewModal(true)}
          selectedTabIndex={selectedTabIndex}
          onTabChange={(index) => {
            if (!isLoading) {
              handleTabChange(index, tabs);
            }
          }}
          tabs={tabs}
        />
      </Card>

      {error && (
        <Banner tone="critical">
          <p>{error}</p>
        </Banner>
      )}

      <Card padding="0">
        {isRecurringEditTab ? (
          <RecurringHistoryTable
            histories={histories}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMore={pagination.hasNextPage}
            emptyStateMessage={getEmptyStateMessage()}
            onLoadMore={loadMore}
            onRefresh={refetch}
          />
        ) : (
          <HistoryTable
            histories={histories}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMore={pagination.hasNextPage}
            emptyStateMessage={getEmptyStateMessage()}
            onLoadMore={loadMore}
          />
        )}
      </Card>

      <SaveViewModal
        isOpen={showSaveViewModal}
        onClose={() => setShowSaveViewModal(false)}
        onSave={(viewData) => {
          setToastState({
            active: true,
            message: `View "${viewData.name}" saved successfully.`,
            error: false,
          });
        }}
        currentFilters={filters}
      />

      {toastState.active && (
        <Toast
          content={toastState.message}
          error={toastState.error}
          onDismiss={() => setToastState({ active: false, message: "", error: false })}
        />
      )}
    </BlockStack>
  );
};

export default HistoryComponent;