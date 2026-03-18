// web/frontend/domains/subscription/hooks/useActivePlan.js
import { useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
 fetchSubscriptionPlans,
  selectActivePlan,
  selectActivePlanStatus,
  selectActivePlanError,
} from "../../../store/slices/subscriptionSlice";

/**
 * Custom hook for managing active subscription plan
 * @returns {Object} Active plan state and handlers
 */
export const useActivePlan = () => {
  const dispatch = useDispatch();

  // Redux selectors
  const activePlan = useSelector(selectActivePlan);
  const status = useSelector(selectActivePlanStatus);
  const error = useSelector(selectActivePlanError);

  // Compute loading state
  const isLoading = status === "loading";
  // Check for charge_id in URL
  const urlParams = new URLSearchParams(window.location.search);
  const chargeId = urlParams.get("charge_id");

  // Verify current plan
  const verifyPlan = useCallback(() => {
    dispatch(fetchSubscriptionPlans());
  }, [dispatch]);

 

  // Check initial state based on URL
  useEffect(() => {
    // if (chargeId) {
    //   activatePlanBilling(chargeId);
    // } else {
    activePlan == null && verifyPlan();
    // }
  }, [chargeId, activatePlanBilling, verifyPlan, activePlan]);

  // Clean up URL after activation
  useEffect(() => {
    if (chargeId && activePlan) {
      const currentUrl = new URL(window.location.href);
      if (currentUrl.searchParams.has("charge_id")) {
        currentUrl.searchParams.delete("charge_id");
        window.history.replaceState({}, document.title, currentUrl.toString());
      }
    }
  }, [chargeId, activePlan]);

  return {
    activePlan,
    isLoading,
    error,
    verifyPlan,
    chargeId,
  };
};
