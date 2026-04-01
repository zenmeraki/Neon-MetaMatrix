import { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  setSelectedPlan,
  clearSelectedPlan,
  selectSelectedPlan,
  selectSubscriptionStatus,
  selectSubscriptionError,
  createSubscription,
  setActivePlan,
} from "../../../store/slices/subscriptionSlice";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import { openTopLevelUrl } from "../../../utils/embeddedNavigation";

export const useSubscription = () => {
  const dispatch = useDispatch();
  const fetchFn = useAuthenticatedFetch();

  const selectedPlan = useSelector(selectSelectedPlan);
  const status = useSelector(selectSubscriptionStatus);
  const error = useSelector(selectSubscriptionError);

  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const isSubscribing = status === "loading";

  const handleSelectPlan = useCallback(
    (plan) => {
      dispatch(setSelectedPlan(plan));
      setShowConfirmModal(true);
    },
    [dispatch],
  );

  const handleCancelSelection = useCallback(() => {
    setShowConfirmModal(false);
    dispatch(clearSelectedPlan());
  }, [dispatch]);

  const handleConfirmSubscription = useCallback(async () => {
    if (!selectedPlan) {
      return;
    }

    try {
      const result = await dispatch(
        createSubscription({ plan: selectedPlan, fetchFn }),
      );

      if (createSubscription.fulfilled.match(result)) {
        setShowConfirmModal(false);
        const { confirmationUrl, name } = result.payload;

        if (confirmationUrl) {
          openTopLevelUrl(confirmationUrl);
        } else if (name === "Free Version") {
          dispatch(setActivePlan({ name: "Free Version" }));
        }
      }
    } catch (error) {
      console.error("Subscription error:", error);
    }
  }, [dispatch, fetchFn, selectedPlan]);

  return {
    selectedPlan,
    showConfirmModal,
    isSubscribing,
    error,
    handleSelectPlan,
    handleCancelSelection,
    handleConfirmSubscription,
    setShowConfirmModal,
  };
};
