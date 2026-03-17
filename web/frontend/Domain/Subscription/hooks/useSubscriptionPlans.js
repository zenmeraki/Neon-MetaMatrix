// web/frontend/domains/subscription/hooks/useSubscriptionPlans.js
import { useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchSubscriptionPlans,
  selectSubscriptionPlans,
  selectPlansStatus,
  selectPlansError,
} from "../../../store/slices/subscriptionSlice";
import { t } from "i18next";
/**
 * Custom hook for managing subscription plans
 * @returns {Object} Subscription plans state and handlers
 */
export const useSubscriptionPlans = () => {
  const dispatch = useDispatch();

  // Redux selectors
  // const plans = useSelector(selectSubscriptionPlans);
  const plans = [
    {
      _id: {
        $oid: "6725d164de922726c9663d2e",
      },
      plan_id: "freeversion",
      name: "Free Version",
      price: 0,
      billed: "none",
      Features: [
        t("freeversion_feature_1"),
        t("freeversion_feature_2"),
        t("freeversion_feature_3"),
      ],
      billingCycle: "",
      planType: "freeversion",
      description: t("freeversion_description"),
      isActive: true,
    },
    {
      _id: {
        $oid: "6725d196de922726c9663d30",
      },
      plan_id: "Basic_monthly",
      name: "Basic (Monthly)",
      price: 20,
      billed: "Monthly",
      Features: [
        t("Basic_monthly_feature_1"),
        t("Basic_monthly_feature_2"),
        t("Basic_monthly_feature_3"),
      ],
      billingCycle: "monthly",
      planType: "basic",
      description: t("Basic_monthly_description"),
      isActive: true,
    },
    {
      _id: {
        $oid: "6725d1f6de922726c9663d33",
      },
      plan_id: "Advanced_monthly",
      name: "Advanced (Monthly)",
      price: 50,
      billed: "Monthly",
      Features: [
        t("Advanced_monthly_feature_1"),
        t("Advanced_monthly_feature_2"),
        t("Advanced_monthly_feature_3"),
      ],
      billingCycle: "monthly",
      planType: "advanced",
      description: t("Advanced_monthly_description"),
      isActive: true,
    },
    {
      _id: {
        $oid: "6725d21cde922726c9663d35",
      },
      plan_id: "pro_monthly",
      name: "Pro (Monthly)",
      price: 100,
      billed: "Monthly",
      Features: [
        t("pro_monthly_feature_1"),
        t("pro_monthly_feature_2"),
        t("pro_monthly_feature_3"),
      ],
      billingCycle: "monthly",
      planType: "pro",
      description: t("pro_monthly_description"),
      isActive: true,
    },
  ];

  const status = useSelector(selectPlansStatus);
  const error = useSelector(selectPlansError);

  // Compute loading state
  const isLoading = status === "loading";

  // Fetch plans
  const fetchPlans = useCallback(() => {
    dispatch(fetchSubscriptionPlans());
  }, [dispatch]);

  // Fetch plans on mount
  // useEffect(() => {
  //   fetchPlans();
  // }, [fetchPlans]);

  // Utility functions for plan styling
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
    isLoading,
    error,
    fetchPlans,
    getPlanColor,
    getPlanBackgroundColor,
    getPlanBorderColor,
  };
};
