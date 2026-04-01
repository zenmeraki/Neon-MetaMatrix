// web/frontend/domains/subscription/components/PromotionBanner.jsx
import React, { memo } from "react";
import { Banner } from "@shopify/polaris";

/**
 * Component for displaying promotional offers
 * Memoized to prevent unnecessary re-renders
 */
const PromotionBanner = memo(
  ({
    title = "🎉 Limited Time Offer! 🎉",
    content = "🚀 Hurry! Offer Ends Soon | 🎯 Mega Discount Sale | 💰 Subscribe Now and Save Big!",
    onAction,
  }) => {
    return (
      <Banner
        title={title}
        tone="success" // Polaris v13: only `tone` is valid, removed deprecated `status`
        action={{
          content: "Subscribe Now",
          onAction:
            onAction ||
            (() => window.scrollTo({ top: 500, behavior: "smooth" })),
        }}
      >
        <p
          style={{
            color: "black",
            fontWeight: "bold",
            margin: "5px 0",
            padding: "0",
          }}
        >
          {content}
        </p>
      </Banner>
    );
  }
);

PromotionBanner.displayName = "PromotionBanner";

export default PromotionBanner;