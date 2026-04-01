import React, { Suspense } from "react";

import PrivacyPage from "../Domain/Privacy/page/PrivacyPage";
import { Box } from "@shopify/polaris";

function PrivacyPolicy() {
  return (
    <Box>
      <PrivacyPage />
    </Box>
  );
}

export default PrivacyPolicy;
