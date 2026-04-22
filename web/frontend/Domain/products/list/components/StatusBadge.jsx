// src/components/products/StatusBadge.jsx

import React, { memo, useMemo } from "react";
import { Badge } from "@shopify/polaris";
import { getStatusColor } from "../utils/productHelpers";

function StatusBadgeComponent({ status }) {

  /**
   * Normalize status once
   */
  const normalizedStatus =
    status?.toUpperCase() ?? "ARCHIVED";



  /**
   * Memoize tone calculation
   */
  const tone = useMemo(() => {
    return getStatusColor(normalizedStatus);
  }, [normalizedStatus]);



  return (
    <Badge tone={tone}>
      {normalizedStatus}
    </Badge>
  );
}



/**
 * Prevent rerender unless status changes
 */
const StatusBadge = memo(StatusBadgeComponent);

export default StatusBadge;