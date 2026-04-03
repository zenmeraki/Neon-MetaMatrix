import { Badge } from "@shopify/polaris";
import { getStatusColor } from "../utils/productHelpers";

export default function StatusBadge({ status }) {
    return <Badge tone={getStatusColor(status)}>{status}</Badge>;
}
