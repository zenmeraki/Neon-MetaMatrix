import { useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchHistories,
  loadMoreHistories,
  setHistoryType,
  selectHistories,
  selectHistoryPagination,
  selectHistoryFilters,
  selectHistoryStatus,
  selectHistoryError,
  selectLoadMoreStatus,
} from "../../../store/slices/historySlice";
import { useTranslation } from "react-i18next";

export const TYPE_TO_KEY = {
  "Manual edit": "ManualEdit",
  "Scheduled edit": "ScheduledEdit",
  "Recurring edit": "RecurringEdit",
  "Favorites": "Favorites"
};

export const KEY_TO_TYPE = {
  ManualEdit: "Manual edit",
  ScheduledEdit: "Scheduled edit",
  RecurringEdit: "Recurring edit",
  Favorites: "Favorites"
};

export const useHistoryList = () => {
  const dispatch = useDispatch();
  const { t, i18n } = useTranslation();

  const histories = useSelector(selectHistories);
  const pagination = useSelector(selectHistoryPagination);
  const filters = useSelector(selectHistoryFilters);
  const status = useSelector(selectHistoryStatus);
  const loadMoreStatus = useSelector(selectLoadMoreStatus);
  const error = useSelector(selectHistoryError);

  const isLoading = status === "loading";
  const isLoadingMore = loadMoreStatus === "loading";

  const fetchHistoryData = useCallback((silent = false) => {
    dispatch(
      fetchHistories({
        type: filters.type,
        cursor: null,
        limit: pagination.limit,
        search: filters.search,
        lang: i18n.language || "en",
        silent,
      })
    );
  }, [dispatch, filters.type, filters.search, pagination.limit]);

  const handleTabChange = useCallback(
    (tabIndex, tabTypes) => {
      const selectedLabel = tabTypes[tabIndex].content;
      const selectedKey = Object.keys(KEY_TO_TYPE).find(
        (key) => t(key) === selectedLabel
      );
      const backendValue = KEY_TO_TYPE[selectedKey] || "Manual edit";
      dispatch(setHistoryType(backendValue));
    },
    [dispatch, t]
  );

  const loadMore = useCallback(() => {
    if (pagination.hasNextPage && !isLoadingMore) {
      dispatch(
        loadMoreHistories({
          cursor: pagination.endCursor,
          limit: pagination.limit,
          lang: i18n.language || "en",
        })
      );
    }
  }, [dispatch, pagination.hasNextPage, pagination.endCursor, pagination.limit, isLoadingMore]);

  useEffect(() => {
    fetchHistoryData();
  }, [fetchHistoryData, filters.type, filters.search]);

  useEffect(() => {
    const hasActiveItems = histories.some((h) => {
      const mainActive = ["pending", "processing"].includes(h.status?.toLowerCase());
      const undoActive = ["processing"].includes(h.undo?.status?.toLowerCase());
      return mainActive || undoActive;
    });

    if (!hasActiveItems) return;

    const interval = setInterval(() => {
      fetchHistoryData(true);
    }, 4000);

    return () => clearInterval(interval);
  }, [histories, fetchHistoryData]);

  return {
    histories,
    pagination,
    filters,
    isLoading,
    isLoadingMore,
    error,
    handleTabChange,
    loadMore,
    refetch: fetchHistoryData,
    hasMore: pagination.hasNextPage,
  };
};