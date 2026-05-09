import { Box } from "@shopify/polaris";
import { useParams } from "react-router-dom";
import ProductCodeSnippetDetailPage from "../../domain/productCodeSnippets/pages/ProductCodeSnippetDetailPage";

export default function ProductCodeSnippetDetailRoute() {
  const { id } = useParams();

  return (
    <Box padding="400">
      <ProductCodeSnippetDetailPage snippetId={id} />
    </Box>
  );
}
