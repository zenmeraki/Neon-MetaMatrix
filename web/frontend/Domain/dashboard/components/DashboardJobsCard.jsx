import { memo } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

function JobRow({ job, failed = false, onView, onRetry, onCopyDiagnostic, t }) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="400">
      <BlockStack gap="050">
        <Text as="p" variant="bodyMd">
          {job.label}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {[job.status, job.detail].filter(Boolean).join(" - ")}
        </Text>
      </BlockStack>

      <InlineStack gap="200">
        <Button variant="plain" onClick={() => onView(job)}>
          {t("view", "View")}
        </Button>
        {failed ? (
          <Button variant="plain" onClick={() => onRetry(job)}>
            {t("retry", "Retry")}
          </Button>
        ) : null}
        {failed && job.diagnosticId ? (
          <Button variant="plain" onClick={() => onCopyDiagnostic(job)}>
            {t("copyDiagnosticId", "Copy diagnostic ID")}
          </Button>
        ) : null}
      </InlineStack>
    </InlineStack>
  );
}

function DashboardJobsCard({ jobs, onViewJob, onRetryJob, onCopyDiagnostic }) {
  const { t } = useTranslation();
  const hasActiveJobs = jobs.active.length > 0;
  const hasFailedJobs = jobs.failed.length > 0;

  if (!hasActiveJobs && !hasFailedJobs) return null;

  return (
    <Card roundedAbove="sm">
      <Box padding="400">
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            {t("jobStatus", "Job status")}
          </Text>

          {hasActiveJobs ? (
            <BlockStack gap="300">
              {jobs.active.map((job) => (
                <JobRow key={job.id} job={job} onView={onViewJob} t={t} />
              ))}
            </BlockStack>
          ) : null}

          {hasFailedJobs ? (
            <Banner tone="critical">
              <BlockStack gap="300">
                {jobs.failed.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    failed
                    onView={onViewJob}
                    onRetry={onRetryJob}
                    onCopyDiagnostic={onCopyDiagnostic}
                    t={t}
                  />
                ))}
              </BlockStack>
            </Banner>
          ) : null}
        </BlockStack>
      </Box>
    </Card>
  );
}

export default memo(DashboardJobsCard);
