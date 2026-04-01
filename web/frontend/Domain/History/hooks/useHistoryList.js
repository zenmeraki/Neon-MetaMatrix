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
import { i18n as appI18n } from "../../../utils/i18nUtils";
// Maps backend value to i18n keys
export const TYPE_TO_KEY = {
  "Manual edit": "ManualEdit",
  "Scheduled edit": "ScheduledEdit",
  "Recurring edit": "RecurringEdit",
  "Favorites": "Favorites"
};

// Maps i18n keys to backend value
export const KEY_TO_TYPE = {
  ManualEdit: "Manual edit",
  ScheduledEdit: "Scheduled edit",
  RecurringEdit: "Recurring edit",
  Favorites: "Favorites"
};

export const useHistoryList = () => {
  const dispatch = useDispatch();
const { t,i18n } = useTranslation(undefined, { i18n: appI18n });
  // Redux selectors
  const histories = useSelector(selectHistories);
  const pagination = useSelector(selectHistoryPagination);
  const filters = useSelector(selectHistoryFilters);
  const status = useSelector(selectHistoryStatus);
  const loadMoreStatus = useSelector(selectLoadMoreStatus);
  const error = useSelector(selectHistoryError);

  // Compute loading state
  const isLoading = status === "loading";
  const isLoadingMore = loadMoreStatus === "loading";

  // Fetch histories based on current filters and pagination
  const fetchHistoryData = useCallback(() => {
    dispatch(
      fetchHistories({
        type: filters.type,
        cursor: null, // Initial load should start from beginning
        limit: pagination.limit,
        search: filters.search,
        lang: i18n.language || 'en',
      })
    );
  }, [dispatch, filters.type, filters.search, pagination.limit]);

  // Handle tab change
  const handleTabChange = useCallback(
  (tabIndex, tabTypes) => {
    const selectedLabel = tabTypes[tabIndex].content;

    // Reverse lookup: get i18n key from label
    const selectedKey = Object.keys(KEY_TO_TYPE).find(
      (key) => t(key) === selectedLabel
    );

    // Fallback to default if not found
    const backendValue = KEY_TO_TYPE[selectedKey] || "Manual edit";

    dispatch(setHistoryType(backendValue));
  },
  [dispatch, t]
);

  // Handle loading more items
  const loadMore = useCallback(() => {
    if (pagination.hasNextPage && !isLoadingMore) {
      dispatch(
        loadMoreHistories({
          cursor: pagination.endCursor,
          limit: pagination.limit,
          lang: i18n.language || 'en',
        })
      );
    }
  }, [
    dispatch,
    pagination.hasNextPage,
    pagination.endCursor,
    pagination.limit,
    isLoadingMore,
  ]);

  // Fetch data when filters change
  useEffect(() => {
    fetchHistoryData();
  }, [fetchHistoryData, filters.type, filters.search]);

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
