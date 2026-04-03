import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  TextField,
} from "@shopify/polaris";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import { listProductCodeSnippets } from "../services/productCodeSnippetService";

function getStatusTone(status) {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "ARCHIVED":
      return "critical";
    default:
      return "attention";
  }
}

function formatUpdatedAt(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ProductCodeSnippetListPage() {
  const navigate = useNavigate();
  const fetchFn = useAuthenticatedFetch();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snippets, setSnippets] = useState([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const data = await listProductCodeSnippets(fetchFn, {
          search,
          status,
        });

        if (active) {
          setSnippets(data);
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Failed to load snippets");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [fetchFn, search, status]);

  const emptyState = useMemo(() => {
    if (search || status) {
      return {
        heading: "No snippets match these filters",
        action: {
          content: "Clear filters",
          onAction: () => {
            setSearch("");
            setStatus("");
          },
        },
        image: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png",
      };
    }

    return {
      heading: "Create your first logic snippet",
      action: {
        content: "New snippet",
        onAction: () => navigate("/product-code-snippets/new"),
      },
      image: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png",
    };
  }, [navigate, search, status]);

  return (
    <Page
      title="Snippet Studio"
      subtitle="Build reusable product logic snippets with safe previewing against your product mirror."
      primaryAction={{
        content: "New snippet",
        onAction: () => navigate("/product-code-snippets/new"),
      }}
      fullWidth
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="400">
              <InlineStack gap="300" wrap>
                <Box minWidth="320px">
                  <TextField
                    label="Search snippets"
                    labelHidden
                    value={search}
                    onChange={setSearch}
                    placeholder="Search by snippet title"
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="220px">
                  <Select
                    label="Status"
                    labelHidden
                    value={status}
                    onChange={setStatus}
                    options={[
                      { label: "All statuses", value: "" },
                      { label: "Active", value: "ACTIVE" },
                      { label: "Draft", value: "DRAFT" },
                      { label: "Archived", value: "ARCHIVED" },
                    ]}
                  />
                </Box>
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Box padding="400">
              {loading ? (
                <BlockStack gap="400">
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={6} />
                </BlockStack>
              ) : error ? (
                <Text tone="critical">{error}</Text>
              ) : snippets.length === 0 ? (
                <EmptyState {...emptyState} />
              ) : (
                <BlockStack gap="0">
                  {snippets.map((snippet, index) => (
                    <Box
                      key={snippet.id}
                      paddingBlock={index === 0 ? "0" : "400"}
                      borderBlockStartWidth={index === 0 ? "0" : "025"}
                      borderColor="border"
                    >
                      <InlineStack align="space-between" blockAlign="start" gap="400">
                        <BlockStack gap="150">
                          <InlineStack gap="200" blockAlign="center">
                            <Button
                              variant="plain"
                              textAlign="left"
                              onClick={() => navigate(`/product-code-snippets/${snippet.id}`)}
                            >
                              {snippet.title}
                            </Button>
                            <Badge tone={getStatusTone(snippet.status)}>
                              {snippet.status}
                            </Badge>
                          </InlineStack>
                          <Text tone="subdued" variant="bodySm">
                            {snippet.language} • Updated {formatUpdatedAt(snippet.updatedAt)}
                          </Text>
                          <Text tone="subdued" variant="bodySm">
                            Validation: {snippet.lastValidationStatus || "Not run"}
                          </Text>
                        </BlockStack>

                        <Button onClick={() => navigate(`/product-code-snippets/${snippet.id}`)}>
                          Open
                        </Button>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
