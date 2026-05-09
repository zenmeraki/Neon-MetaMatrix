import { useCallback, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import {
  fetchSubscriptionPlans,
  selectPlansError,
  selectPlansStatus,
  selectSubscriptionPlans,
} from "../../../store/slices/subscriptionSlice";

export const useSubscriptionPlans = () => {
  const dispatch = useDispatch();
  const fetchWithAuth = useAuthenticatedFetch();
  const rawPlans = useSelector(selectSubscriptionPlans);
  const status = useSelector(selectPlansStatus);
  const error = useSelector(selectPlansError);

  const plans = useMemo(
    () =>
      (rawPlans || []).map((plan) => ({
        ...plan,
        Features: Array.isArray(plan?.Features)
          ? plan.Features
          : Array.isArray(plan?.features)
            ? plan.features
            : [],
      })),
    [rawPlans],
  );

  const fetchPlans = useCallback(() => {
    dispatch(fetchSubscriptionPlans({ fetchFn: fetchWithAuth }));
  }, [dispatch, fetchWithAuth]);

  useEffect(() => {
    if (status === "idle") {
      fetchPlans();
    }
  }, [fetchPlans, status]);

  const getPlanColor = useCallback((planName) => {
    switch (planName) {
      case "Free Version":
        return "var(--p-color-text-secondary)";
      case "Basic (Monthly)":
        return "var(--p-color-text-info)";
      case "Advanced (Monthly)":
        return "var(--p-color-text-success)";
      case "Pro (Monthly)":
        return "var(--p-color-text-primary)";
      default:
        return "var(--p-color-text-secondary)";
    }
  }, []);

  const getPlanBackgroundColor = useCallback((planName) => {
    switch (planName) {
      case "Free Version":
        return "var(--p-color-bg-secondary-subdued)";
      case "Basic (Monthly)":
        return "var(--p-color-bg-info-subdued)";
      case "Advanced (Monthly)":
        return "var(--p-color-bg-success-subdued)";
      case "Pro (Monthly)":
        return "var(--p-color-bg-primary-subdued)";
      default:
        return "var(--p-color-bg-secondary-subdued)";
    }
  }, []);

  const getPlanBorderColor = useCallback((planName) => {
    switch (planName) {
      case "Free Version":
        return "var(--p-color-border-secondary)";
      case "Basic (Monthly)":
        return "var(--p-color-border-info)";
      case "Advanced (Monthly)":
        return "var(--p-color-border-success)";
      case "Pro (Monthly)":
        return "var(--p-color-border-primary)";
      default:
        return "var(--p-color-border-secondary)";
    }
  }, []);

  return {
    plans,
    isLoading: status === "loading",
    error,
    fetchPlans,
    getPlanColor,
    getPlanBackgroundColor,
    getPlanBorderColor,
  };
};
