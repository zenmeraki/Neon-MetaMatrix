import React from "react";
import { Banner, Button } from "@shopify/polaris";

const PlanBanner = ({ plan }) => {
  // If no plan data or user is on premium plan, don't show banner
  if (!plan || plan.active) return null;

  const editLimitReached = plan.currentEditCount >= plan.maxEdits;

  return (
    <Banner
      title={editLimitReached ? "Free Plan Limit Reached" : "Free Plan Usage"}
      tone={editLimitReached ? "critical" : "info"}
    >
      <p>
        {editLimitReached ? (
          <>
            You’ve reached your free plan limit! ({plan.currentEditCount}/{plan.maxEdits} edits).
          </>
        ) : (
          <>
            Free Plan: {plan.currentEditCount}/{plan.maxEdits} edits used this month. 
            Max {plan.maxProductsPerEdit} products per edit.
          </>
        )}
      </p>
      <div style={{ marginTop: "8px" }}>
        <Button
          variant="primary"
          size="slim"
          url="/plans"
        >
          {editLimitReached ? "Upgrade Now" : "Upgrade"}
        </Button>
      </div>
    </Banner>
  );
};

export default PlanBanner;