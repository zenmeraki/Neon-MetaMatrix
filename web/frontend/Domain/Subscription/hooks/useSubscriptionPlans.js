import { useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  fetchSubscriptionPlans,
  selectPlansStatus,
  selectPlansError,
} from "../../../store/slices/subscriptionSlice";

const PLAN_STYLE_MAP = {
  free: {
    color: "var(--p-color-text-secondary)",
    backgroundColor: "var(--p-color-bg-secondary-subdued)",
    borderColor: "var(--p-color-border-secondary)",
  },
  basic: {
    color: "var(--p-color-text-info)",
    backgroundColor: "var(--p-color-bg-info-subdued)",
    borderColor: "var(--p-color-border-info)",
  },
  advanced: {
    color: "var(--p-color-text-success)",
    backgroundColor: "var(--p-color-bg-success-subdued)",
    borderColor: "var(--p-color-border-success)",
  },
  pro: {
    color: "var(--p-color-text-primary)",
    backgroundColor: "var(--p-color-bg-primary-subdued)",
    borderColor: "var(--p-color-border-primary)",
  },
};

function normalizePlanType(planType) {
  switch (planType) {
    case "freeversion":
      return "free";
    case "basic":
    case "advanced":
    case "pro":
      return planType;
    default:
      return "free";
  }
}

export const useSubscriptionPlans = () => {
  const dispatch = useDispatch();
  const { t } = useTranslation();

  const plans = useMemo(
    () => [
      {
        _id: {
          $oid: "6725d164de922726c9663d2e",
        },
        plan_id: "freeversion",
        name: t("freeversion_name"),
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
        name: t("Basic_monthly_name"),
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
        name: t("Advanced_monthly_name"),
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
        name: t("pro_monthly_name"),
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
    ],
    [t],
  );

  const status = useSelector(selectPlansStatus);
  const error = useSelector(selectPlansError);
  const isLoading = status === "loading";

  const fetchPlans = useCallback(() => {
    dispatch(fetchSubscriptionPlans());
  }, [dispatch]);

  const getPlanColor = useCallback((plan) => {
    return PLAN_STYLE_MAP[normalizePlanType(plan.planType)].color;
  }, []);

  const getPlanBackgroundColor = useCallback((plan) => {
    return PLAN_STYLE_MAP[normalizePlanType(plan.planType)].backgroundColor;
  }, []);

  const getPlanBorderColor = useCallback((plan) => {
    return PLAN_STYLE_MAP[normalizePlanType(plan.planType)].borderColor;
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
