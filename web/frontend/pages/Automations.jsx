import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Checkbox,
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
  { label: "On sync completed", value: "ON_SYNC_COMPLETED" },
  { label: "On product changed", value: "ON_PRODUCT_CHANGED" },
  { label: "Scheduled", value: "SCHEDULED" },
  { label: "Manual", value: "MANUAL" },
];

const SAMPLE_RULES = {
  low_stock: {
    name: "Low stock protection",
    triggerType: "ON_SYNC_COMPLETED",
    ruleAstJson: {
      type: "group",
      op: "AND",
      children: [
        {
          type: "condition",
          field: "variant.inventoryQuantity",
          operator: "lt",
          value: 3,
        },
        {
          type: "condition",
          field: "product.status",
          operator: "eq",
          value: "ACTIVE",
        },
      ],
    },
    actionsJson: [
      {
        type: "BULK_EDIT",
        status: "ENABLED",
        maxTargets: 10000,
        operation: {
          field: "product.tags",
          action: "append",
          value: "low-stock",
        },
      },
    ],
  },
  vendor_normalize: {
    name: "Normalize Nike vendor",
    triggerType: "ON_SYNC_COMPLETED",
    ruleAstJson: {
      type: "condition",
      field: "product.vendor",
      operator: "in",
      value: ["NIKE", "nike", "Nike Inc", "Nike "],
    },
    actionsJson: [
      {
        type: "BULK_EDIT",
        status: "ENABLED",
        maxTargets: 10000,
        operation: {
          field: "product.vendor",
          action: "set",
          value: "Nike",
        },
      },
    ],
  },
  missing_seo: {
    name: "Missing SEO title",
    triggerType: "ON_SYNC_COMPLETED",
    ruleAstJson: {
      type: "condition",
      field: "product.seoTitle",
      operator: "is_empty",
      value: null,
    },
    actionsJson: [
      {
        type: "BULK_EDIT",
        status: "ENABLED",
        maxTargets: 10000,
        operation: {
          field: "product.tags",
          action: "append",
          value: "needs-seo",
        },
      },
    ],
  },
};

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
  const [formTriggerType, setFormTriggerType] = useState("ON_SYNC_COMPLETED");
  const [formTemplate, setFormTemplate] = useState("low_stock");
  const [promoteModal, setPromoteModal] = useState({
    open: false,
    ruleId: "",
    runId: "",
    targetCount: 0,
  });
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [promoteApproved, setPromoteApproved] = useState(false);
  const [promoteCap, setPromoteCap] = useState("");

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchWithAuth("/api/automations");
      if (!response) return;
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Failed to load automations");
      }
      setRules(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setError(err.message || "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const template = useMemo(() => SAMPLE_RULES[formTemplate], [formTemplate]);

  const createRule = useCallback(async () => {
    if (!formName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const payload = {
        name: formName.trim(),
        triggerType: formTriggerType,
        ruleAstJson: template.ruleAstJson,
        actionsJson: template.actionsJson,
        triggerConfig: {},
      };
      const response = await fetchWithAuth("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response) return;
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Failed to create automation");
      }
      setShowCreate(false);
      setFormName("");
      await loadRules();
    } catch (err) {
      setError(err.message || "Failed to create automation");
    } finally {
      setCreating(false);
    }
  }, [fetchWithAuth, formName, formTriggerType, loadRules, template]);

  const setRuleStatus = useCallback(
    async (id, action) => {
      setError("");
      const response = await fetchWithAuth(`/api/automations/${id}/${action}`, {
        method: "POST",
      });
      if (!response) return;
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Failed to update status");
      }
      await loadRules();
    },
    [fetchWithAuth, loadRules],
  );

  const loadRuns = useCallback(
    async (id) => {
      setError("");
      const response = await fetchWithAuth(`/api/automations/${id}/runs`);
      if (!response) return;
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Failed to load runs");
      }
      setRunsByRule((prev) => ({ ...prev, [id]: result.data || [] }));
      setActiveRunsRuleId(id);
    },
    [fetchWithAuth],
  );

  const promoteRun = useCallback(async () => {
    if (!promoteModal.ruleId || !promoteModal.runId) return;
    setPromoteLoading(true);
    setError("");
    try {
      const response = await fetchWithAuth(
        `/api/automations/${promoteModal.ruleId}/runs/${promoteModal.runId}/promote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approved: promoteApproved,
            maxApprovedTargets: Number(promoteCap),
          }),
        },
      );
      if (!response) return;
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Failed to promote run");
      }
      setPromoteModal({ open: false, ruleId: "", runId: "", targetCount: 0 });
      setPromoteApproved(false);
      setPromoteCap("");
      await loadRuns(promoteModal.ruleId);
    } catch (err) {
      setError(err.message || "Failed to promote run");
    } finally {
      setPromoteLoading(false);
    }
  }, [fetchWithAuth, loadRuns, promoteApproved, promoteCap, promoteModal]);

  function bucketForRun(run) {
    if (run.status === "FAILED") return "FAILED";
    if (run.status === "PREVIEW_READY") return "SAFE";
    if (run.status === "READY_TO_EXECUTE") return "SAFE";
    if (String(run.errorCode || "").includes("CAP_EXCEEDED")) return "CONFLICT";
    return "SAFE";
  }

  const previewRun = useCallback(
    async (id) => {
      setError("");
      const response = await fetchWithAuth(`/api/automations/${id}/preview-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response) return;
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || "Failed to start preview run");
      }
      await loadRules();
      await loadRuns(id);
    },
    [fetchWithAuth, loadRules, loadRuns],
  );

  return (
    <Frame>
      <Page
        title="Automations"
        subtitle="Create, activate, pause, and preview deterministic automation runs."
        primaryAction={{ content: "Create rule", onAction: () => setShowCreate(true) }}
      >
        <BlockStack gap="400">
          {error ? (
            <Banner tone="critical">
              <Text as="p">{error}</Text>
            </Banner>
          ) : null}

          {loading ? <Text as="p">Loading automations…</Text> : null}

          {!loading &&
            rules.map((rule) => (
              <Card key={rule.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingSm">
                        {rule.name}
                      </Text>
                      <Text as="p" tone="subdued">
                        {rule.triggerType} · {rule.status}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button onClick={() => void loadRuns(rule.id)} variant="plain">
                        Runs
                      </Button>
                      <Button onClick={() => void previewRun(rule.id)}>Preview run</Button>
                      {rule.status === "ACTIVE" ? (
                        <Button tone="critical" onClick={() => void setRuleStatus(rule.id, "pause")}>
                          Pause
                        </Button>
                      ) : (
                        <Button onClick={() => void setRuleStatus(rule.id, "activate")}>
                          Activate
                        </Button>
                      )}
                    </InlineStack>
                  </InlineStack>

                  {activeRunsRuleId === rule.id && Array.isArray(runsByRule[rule.id]) ? (
                    <BlockStack gap="100">
                      <InlineStack gap="200">
                        <Badge tone="success">
                          SAFE{" "}
                          {
                            (runsByRule[rule.id] || []).filter((run) => bucketForRun(run) === "SAFE")
                              .length
                          }
                        </Badge>
                        <Badge tone="warning">
                          CONFLICT{" "}
                          {
                            (runsByRule[rule.id] || []).filter(
                              (run) => bucketForRun(run) === "CONFLICT",
                            ).length
                          }
                        </Badge>
                        <Badge tone="critical">
                          FAILED{" "}
                          {
                            (runsByRule[rule.id] || []).filter((run) => bucketForRun(run) === "FAILED")
                              .length
                          }
                        </Badge>
                      </InlineStack>
                      {(runsByRule[rule.id] || []).slice(0, 10).map((run) => (
                        <InlineStack key={run.id} align="space-between">
                          <Text as="p" tone="subdued">
                            {run.status} · {run.triggerReason || "N/A"} · {run.mirrorBatchId} · targets{" "}
                            {Number(run.targetCount || 0).toLocaleString()}
                          </Text>
                          {run.status === "PREVIEW_READY" ? (
                            <Button
                              size="slim"
                              onClick={() => {
                                setPromoteModal({
                                  open: true,
                                  ruleId: rule.id,
                                  runId: run.id,
                                  targetCount: Number(run.targetCount || 0),
                                });
                                setPromoteCap(String(Number(run.targetCount || 0)));
                                setPromoteApproved(false);
                              }}
                            >
                              Promote preview
                            </Button>
                          ) : null}
                        </InlineStack>
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
          title="Create automation rule"
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
                label="Rule name"
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
                options={[
                  { label: "Low stock protection", value: "low_stock" },
                  { label: "Normalize Nike vendor", value: "vendor_normalize" },
                  { label: "Missing SEO title", value: "missing_seo" },
                ]}
                onChange={setFormTemplate}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>

        <Modal
          open={promoteModal.open}
          onClose={() => {
            if (promoteLoading) return;
            setPromoteModal({ open: false, ruleId: "", runId: "", targetCount: 0 });
          }}
          title="Promote preview to execute"
          primaryAction={{
            content: "Promote",
            onAction: () => void promoteRun(),
            loading: promoteLoading,
            disabled:
              promoteLoading ||
              !promoteApproved ||
              !Number.isFinite(Number(promoteCap)) ||
              Number(promoteCap) < Number(promoteModal.targetCount || 0),
          }}
          secondaryActions={[
            {
              content: "Cancel",
              disabled: promoteLoading,
              onAction: () =>
                setPromoteModal({ open: false, ruleId: "", runId: "", targetCount: 0 }),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p" tone="subdued">
                Preview targets: {Number(promoteModal.targetCount || 0).toLocaleString()}
              </Text>
              <TextField
                label="Max approved targets"
                type="number"
                value={promoteCap}
                onChange={setPromoteCap}
                autoComplete="off"
              />
              <Checkbox
                label="I approve promoting this preview run to execution"
                checked={promoteApproved}
                onChange={setPromoteApproved}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </Page>
    </Frame>
  );
}
