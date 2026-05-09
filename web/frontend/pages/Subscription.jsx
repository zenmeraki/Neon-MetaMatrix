import React, { Suspense } from "react";
import SubscriptionPage from "../domain/subscription/pages/SubscriptionPage";
import { Box } from "@shopify/polaris";

function Subscription() {
  return (
  <Box>
    <SubscriptionPage/>
  </Box>
  );
}

export default Subscription;
