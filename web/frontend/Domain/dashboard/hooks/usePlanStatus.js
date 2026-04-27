// web/frontend/domains/dashboard/hooks/usePlanStatus.js
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import {
  isActivePlan,
  selectActivePlan,
  selectActivePlanError,
  selectActivePlanStatus,
  fetchSubscriptionPlans,
} from "../../../store/slices/subscriptionSlice";

/**
 * Custom hook for managing subscription plan status
 * @returns {Object} Plan status and related functions
 */
export const usePlanStatus = () => {
  const navigate = useNavigate();
  const fetchWithAuth = useAuthenticatedFetch();

  const activePlan = useSelector(selectActivePlan);
  const planError = useSelector(selectActivePlanError);
  const isActive = useSelector(isActivePlan);
  const planStatus = useSelector(selectActivePlanStatus);
  const [showAlert, setShowAlert] = useState(false);


  useEffect(() => {
    setShowAlert(!isActive);
  }, [isActive]);

  const dispatch = useDispatch();
  // Verify current plan
  const verifyPlan = useCallback(() => {
    dispatch(fetchSubscriptionPlans({ fetchFn: fetchWithAuth }));
  }, [dispatch, fetchWithAuth]);

  useEffect(() => {
    activePlan == null && verifyPlan();
  }, [activePlan, verifyPlan]);

  return {
    loading: planStatus == "loading" ? true : false,
    error: planError,
    showAlert,
    dismissAlert: () => setShowAlert(false),
  };
};
