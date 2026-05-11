import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Frame,
  InlineStack,
  Modal,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch";

const TRIGGER_OPTIONS = [
  { label: "Event", value: "EVENT" },
  { label: "Scheduled", value: "SCHEDULED" },
  { label: "Hybrid", value: "HYBRID" },
];

const TEMPLATE_OPTIONS = [
  { label: "Low stock protection", value: "low_stock" },
  { label: "Normalize Nike vendor", value: "vendor_normalize" },
  { label: "Missing SEO title", value: "missing_seo" },
];

const SAMPLE_RULES = {
  low_stock: {
    title: "Low stock protection",
    executionMode: "REALTIME",
    conditions: [
      { field: "variant.inventoryQuantity", operator: "LT", value: 3 },
      { field: "product.status", operator: "EQ", value: "ACTIVE" },
    ],
    actions: [{ field: "tag", editOption: "append", value: "low-stock" }],
  },
  vendor_normalize: {
    title: "Normalize Nike vendor",
    executionMode: "REALTIME",
    conditions: [{ field: "product.vendor", operator: "IN", value: ["NIKE", "nike", "Nike Inc", "Nike "] }],
    actions: [{ field: "vendor", editOption: "replace", value: "Nike" }],
  },
  missing_seo: {
    title: "Missing SEO title",
    executionMode: "REALTIME",
    conditions: [{ field: "product.seoTitle", operator: "IS_NULL", value: null }],
    actions: [{ field: "tag", editOption: "append", value: "needs-seo" }],
  },
};

function statusTone(status) {
  if (status === "ACTIVE") return "success";
  if (status === "PAUSED") return "warning";
  if (status === "FAILED") return "critical";
  return "info";
}

export default function Automations() {
  const fetchWithAuth = useAuthenticatedFetch();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runsByRule, setRunsByRule] = useState({});
  const [activeRunsRuleId, setActiveRunsRuleId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState("");
  const [formTriggerType, setFormTriggerType] = useState("EVENT");
  const [formTemplate, setFormTemplate] = useState("low_stock");

  const template = useMemo(() => SAMPLE_RULES[formTemplate], [formTemplate]);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchWithAuth("/api/automatic-rules");
      if (!response) return;
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Failed to load automatic rules");
      }
      setRules(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setError(err.message || "Failed to load automatic rules");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  const loadRuns = useCallback(
    async (id) => {
      setError("");
      try {
        const response = await fetchWithAuth(`/api/automatic-rules/${id}/runs`);
        if (!response) return;
        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || "Failed to load rule runs");
        }
        setRunsByRule((prev) => ({ ...prev, [id]: Array.isArray(result.data) ? result.data : [] }));
        setActiveRunsRuleId(id);
      } catch (err) {
        setError(err.message || "Failed to load rule runs");
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const createRule = useCallback(async () => {
    if (!formName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const payload = {
        title: formName.trim(),
        triggerType: formTriggerType,
        executionMode: template.executionMode,
        conditions: template.conditions,
        actions: template.actions,
        status: "ACTIVE",
      };

      const response = await fetchWithAuth("/api/automatic-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response) return;
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Failed to create rule");
      }
      setShowCreate(false);
      setFormName("");
      await loadRules();
    } catch (err) {
      setError(err.message || "Failed to create rule");
    } finally {
      setCreating(false);
    }
  }, [fetchWithAuth, formName, formTriggerType, loadRules, template]);

  const pauseOrResumeRule = useCallback(
    async (rule) => {
      setError("");
      const action = rule.statusKey === "ACTIVE" ? "pause" : "resume";
      try {
        const response = await fetchWithAuth(`/api/automatic-rules/${rule.id}/${action}`, {
          method: "POST",
        });
        if (!response) return;
        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || "Failed to update rule status");
        }
        await loadRules();
      } catch (err) {
        setError(err.message || "Failed to update rule status");
      }
    },
    [fetchWithAuth, loadRules],
  );

  const runNow = useCallback(
    async (id) => {
      setError("");
      try {
        const response = await fetchWithAuth(`/api/automatic-rules/${id}/run-now`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: false }),
        });
        if (!response) return;
        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || "Failed to queue run");
        }
        await loadRules();
        await loadRuns(id);
      } catch (err) {
        setError(err.message || "Failed to queue run");
      }
    },
    [fetchWithAuth, loadRules, loadRuns],
  );

  const deleteRule = useCallback(
    async (id) => {
      setError("");
      try {
        const response = await fetchWithAuth(`/api/automatic-rules/${id}`, {
          method: "DELETE",
        });
        if (!response) return;
        const result = await response.json();
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || "Failed to delete rule");
        }
        await loadRules();
        if (activeRunsRuleId === id) setActiveRunsRuleId("");
      } catch (err) {
        setError(err.message || "Failed to delete rule");
      }
    },
    [activeRunsRuleId, fetchWithAuth, loadRules],
  );

  return (
    <Frame>
      <Page
        title="Automatic Rules"
        subtitle="Manage automatic product rule lifecycle and execution."
        primaryAction={{ content: "Create rule", onAction: () => setShowCreate(true) }}
      >
        <BlockStack gap="400">
          {error ? (
            <Banner tone="critical">
              <Text as="p">{error}</Text>
            </Banner>
          ) : null}

          {loading ? <Text as="p">Loading automatic rules...</Text> : null}

          {!loading &&
            rules.map((rule) => (
              <Card key={rule.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">
                        {rule.title}
                      </Text>
                      <InlineStack gap="200">
                        <Badge tone={statusTone(rule.statusKey)}>{rule.statusKey || rule.status}</Badge>
                        <Badge>{rule.triggerType}</Badge>
                        <Badge>{rule.executionMode}</Badge>
                      </InlineStack>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button variant="plain" onClick={() => void loadRuns(rule.id)}>
                        Runs
                      </Button>
                      <Button onClick={() => void runNow(rule.id)}>Run now</Button>
                      <Button onClick={() => void pauseOrResumeRule(rule)}>
                        {rule.statusKey === "ACTIVE" ? "Pause" : "Resume"}
                      </Button>
                      <Button tone="critical" variant="plain" onClick={() => void deleteRule(rule.id)}>
                        Delete
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {activeRunsRuleId === rule.id && Array.isArray(runsByRule[rule.id]) ? (
                    <BlockStack gap="100">
                      <InlineStack gap="200">
                        <Badge tone="success">
                          SUCCESS {(runsByRule[rule.id] || []).filter((run) => run.status === "SUCCESS").length}
                        </Badge>
                        <Badge tone="critical">
                          FAILED {(runsByRule[rule.id] || []).filter((run) => run.status === "FAILED").length}
                        </Badge>
                        <Badge tone="warning">
                          SKIPPED {(runsByRule[rule.id] || []).filter((run) => run.status === "SKIPPED").length}
                        </Badge>
                      </InlineStack>
                      {(runsByRule[rule.id] || []).slice(0, 10).map((run) => (
                        <Text key={run.id} as="p" tone="subdued">
                          {run.status} · {run.triggerSource || "N/A"} · {run.scheduledFor ? new Date(run.scheduledFor).toLocaleString() : "N/A"}
                        </Text>
                      ))}
                    </BlockStack>
                  ) : null}
                </BlockStack>
              </Card>
            ))}
        </BlockStack>

        <Modal
          open={showCreate}
          onClose={() => {
            if (creating) return;
            setShowCreate(false);
          }}
          title="Create automatic rule"
          primaryAction={{
            content: "Create",
            loading: creating,
            disabled: creating || !formName.trim(),
            onAction: () => void createRule(),
          }}
          secondaryActions={[
            {
              content: "Cancel",
              disabled: creating,
              onAction: () => setShowCreate(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <TextField
                label="Rule title"
                value={formName}
                onChange={setFormName}
                autoComplete="off"
              />
              <Select
                label="Trigger"
                value={formTriggerType}
                options={TRIGGER_OPTIONS}
                onChange={setFormTriggerType}
              />
              <Select
                label="Template"
                value={formTemplate}
                options={TEMPLATE_OPTIONS}
                onChange={setFormTemplate}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </Page>
    </Frame>
  );
}
