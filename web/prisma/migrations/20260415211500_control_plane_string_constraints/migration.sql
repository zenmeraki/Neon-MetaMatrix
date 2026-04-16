-- Enforce finite control-plane vocabularies for fields Prisma still models as
-- String during the transition to first-class enums.
--
-- Constraints are NOT VALID so historical drift does not block deploy. New and
-- updated rows are checked immediately.

CREATE OR REPLACE FUNCTION add_control_plane_check_constraint(
  table_name text,
  constraint_name text,
  expression text
) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = constraint_name
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
      table_name,
      constraint_name,
      expression
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT add_control_plane_check_constraint(
  'SyncRun',
  'SyncRun_runType_enum_ck',
  '"runType" IN (''FULL_BASELINE'', ''DOMAIN_REPAIR'')'
);

SELECT add_control_plane_check_constraint(
  'SyncRun',
  'SyncRun_domain_enum_ck',
  '"domain" IS NULL OR "domain" IN (''PRODUCT'', ''COLLECTION'', ''PRODUCT_TYPE'', ''METAFIELD'', ''INVENTORY'')'
);

SELECT add_control_plane_check_constraint(
  'SyncRun',
  'SyncRun_status_enum_ck',
  '"status" IN (''PENDING'', ''RUNNING'', ''COMPLETED'', ''FAILED'', ''CANCELLED'')'
);

SELECT add_control_plane_check_constraint(
  'SyncRun',
  'SyncRun_stage_enum_ck',
  '"stage" IS NULL OR "stage" IN (
    ''QUEUED'',
    ''SHOPIFY_BULK_RUNNING'',
    ''SHOPIFY_BULK_CREATED'',
    ''SHOPIFY_BULK_CANCELING'',
    ''SHOPIFY_BULK_COMPLETED'',
    ''SHOPIFY_BULK_FAILED'',
    ''SHOPIFY_BULK_CANCELED'',
    ''SHOPIFY_BULK_CANCELLED'',
    ''SHOPIFY_BULK_EXPIRED'',
    ''SHOPIFY_BULK_NOT_FOUND'',
    ''SHOPIFY_BULK_STATUS_UNKNOWN'',
    ''BULK_ARTIFACT_READY'',
    ''MIRROR_STAGING'',
    ''STAGED_COMPLETE'',
    ''MIRROR_ACTIVATED'',
    ''MIRROR_STAGING_FAILED'',
    ''PRODUCT_TYPE_STAGING'',
    ''PRODUCT_TYPE_COMPLETED'',
    ''PRODUCT_TYPE_FAILED'',
    ''COLLECTION_MEMBERSHIP_STAGING'',
    ''COLLECTION_MEMBERSHIP_COMPLETED'',
    ''COLLECTION_MEMBERSHIP_FAILED'',
    ''TRACKED_METAFIELD_STAGING'',
    ''TRACKED_METAFIELD_COMPLETED'',
    ''TRACKED_METAFIELD_FAILED'',
    ''INVENTORY_LEVEL_STAGING'',
    ''INVENTORY_LEVEL_COMPLETED'',
    ''INVENTORY_LEVEL_FAILED'',
    ''SNAPSHOT_FAILED'',
    ''FAILED'',
    ''COMPLETED'',
    ''IDLE'',
    ''SYNC_START_FAILED'',
    ''PRODUCT_TYPE_SYNC_START_FAILED'',
    ''COLLECTION_SYNC_START_FAILED'',
    ''PRODUCT_METAFIELD_SYNC_START_FAILED'',
    ''VARIANT_METAFIELD_SYNC_START_FAILED'',
    ''INVENTORY_LEVEL_SYNC_START_FAILED''
  )'
);

SELECT add_control_plane_check_constraint(
  'SyncRun',
  'SyncRun_triggerSource_enum_ck',
  '"triggerSource" IS NULL OR "triggerSource" IN (
    ''MANUAL'',
    ''INITIAL_SYNC'',
    ''WEBHOOK'',
    ''SCHEDULE'',
    ''PRODUCT_TYPE_SYNC'',
    ''COLLECTION_SYNC'',
    ''PRODUCT_METAFIELD_SYNC'',
    ''VARIANT_METAFIELD_SYNC'',
    ''INVENTORY_LEVEL_SYNC''
  )'
);

SELECT add_control_plane_check_constraint(
  'SyncArtifact',
  'SyncArtifact_artifactType_enum_ck',
  '"artifactType" IN (
    ''BULK_JSONL'',
    ''PRODUCT_VARIANT_BASELINE_JSONL'',
    ''PRODUCT_TYPE_JSONL'',
    ''COLLECTION_MEMBERSHIP_JSONL'',
    ''PRODUCT_TRACKED_METAFIELDS_JSONL'',
    ''VARIANT_TRACKED_METAFIELDS_JSONL'',
    ''INVENTORY_LEVEL_JSONL'',
    ''BULK_MUTATION_INPUT_JSONL'',
    ''BULK_MUTATION_RESULT_JSONL'',
    ''EXPORT_CSV''
  )'
);

SELECT add_control_plane_check_constraint(
  'CatalogSnapshot',
  'CatalogSnapshot_status_enum_ck',
  '"status" IN (''BUILDING'', ''ACTIVE'', ''SUPERSEDED'', ''FAILED'')'
);

SELECT add_control_plane_check_constraint(
  'DomainFreshness',
  'DomainFreshness_domain_enum_ck',
  '"domain" IN (''PRODUCT'', ''COLLECTION'', ''PRODUCT_TYPE'', ''METAFIELD'', ''INVENTORY'')'
);

SELECT add_control_plane_check_constraint(
  'DomainFreshness',
  'DomainFreshness_status_enum_ck',
  '"status" IN (''FRESH'', ''RUNNING'', ''STALE'', ''REPAIR_REQUIRED'', ''UNKNOWN'')'
);

SELECT add_control_plane_check_constraint(
  'FieldAuthorityRegistry',
  'FieldAuthorityRegistry_authorityDomain_enum_ck',
  '"authorityDomain" IN (
    ''PRODUCT_VARIANT_BASELINE'',
    ''COLLECTION_MEMBERSHIP'',
    ''PRODUCT_TRACKED_METAFIELDS'',
    ''VARIANT_TRACKED_METAFIELDS'',
    ''PRODUCT_TYPE_ONLY'',
    ''PRODUCT_IDENTITY_LIGHT''
  )'
);

SELECT add_control_plane_check_constraint(
  'FieldAuthorityRegistry',
  'FieldAuthorityRegistry_status_enum_ck',
  '"status" IN (''ACTIVE'', ''DEPRECATED'', ''DISABLED'')'
);

SELECT add_control_plane_check_constraint(
  'TargetSnapshotSet',
  'TargetSnapshotSet_ownerType_enum_ck',
  '"ownerType" IN (''EDIT_HISTORY'', ''EXPORT_JOB'')'
);

SELECT add_control_plane_check_constraint(
  'TargetSnapshotSet',
  'TargetSnapshotSet_sourceType_enum_ck',
  '"sourceType" IS NULL OR "sourceType" IN (''FILTER'', ''EXPLICIT'')'
);

SELECT add_control_plane_check_constraint(
  'TargetSnapshotSet',
  'TargetSnapshotSet_status_enum_ck',
  '"status" IN (''BUILDING'', ''ACTIVE'', ''SUPERSEDED'', ''FAILED'')'
);

SELECT add_control_plane_check_constraint(
  'TargetSnapshotSet',
  'TargetSnapshotSet_targetLevel_enum_ck',
  '"targetLevel" IN (''PRODUCT'', ''VARIANT'')'
);

SELECT add_control_plane_check_constraint(
  'BulkMutationSubmission',
  'BulkMutationSubmission_mutationType_enum_ck',
  '"mutationType" IN (''PRODUCT_SET'', ''UNDO_PRODUCT_EDIT'')'
);

SELECT add_control_plane_check_constraint(
  'BulkMutationSubmission',
  'BulkMutationSubmission_status_enum_ck',
  '"status" IN (''PLANNED'', ''SUBMITTED'', ''RUNNING'', ''COMPLETED'', ''FAILED'', ''CANCELLED'')'
);

SELECT add_control_plane_check_constraint(
  'BulkMutationSubmission',
  'BulkMutationSubmission_failureCategory_enum_ck',
  '"failureCategory" IS NULL OR "failureCategory" IN (''INTERNAL'', ''SHOPIFY'', ''VALIDATION'', ''TIMEOUT'', ''CONCURRENCY'')'
);

SELECT add_control_plane_check_constraint(
  'BulkMutationSubmission',
  'BulkMutationSubmission_failureStage_enum_ck',
  '"failureStage" IS NULL OR "failureStage" IN (
    ''bulk_edit_dispatch'',
    ''queue_dispatch'',
    ''scheduled_queue_dispatch'',
    ''target_snapshot_freeze'',
    ''target_integrity_check'',
    ''queue_execution'',
    ''export_worker'',
    ''retryable'',
    ''retryable_execution'',
    ''retryable_export'',
    ''retryable_import_edit'',
    ''planned'',
    ''queued'',
    ''dispatching'',
    ''awaiting_shopify'',
    ''finalizing'',
    ''completed'',
    ''partial'',
    ''failed'',
    ''cancelled''
  )'
);

SELECT add_control_plane_check_constraint(
  'BulkMutationOutcome',
  'BulkMutationOutcome_status_enum_ck',
  '"status" IN (''SUCCESS'', ''FAILED'', ''SKIPPED'')'
);

SELECT add_control_plane_check_constraint(
  'EditHistory',
  'EditHistory_executionState_enum_ck',
  '"executionState" IN (''planned'', ''queued'', ''dispatching'', ''awaiting_shopify'', ''finalizing'', ''completed'', ''partial'', ''failed'', ''failed_integrity_check'', ''cancelled'')'
);

SELECT add_control_plane_check_constraint(
  'EditHistory',
  'EditHistory_status_enum_ck',
  '"status" IN (''pending'', ''processing'', ''completed'', ''failed'', ''cancelled'', ''partial'')'
);

SELECT add_control_plane_check_constraint(
  'EditHistory',
  'EditHistory_editedType_contract_ck',
  '"editedType" IS NULL OR "editedType" IN (
    ''mixed'',
    ''Set text to value'',
    ''Add text to end'',
    ''Remove text from end'',
    ''Add text to beginning'',
    ''Remove text from beginning'',
    ''Limit length of text'',
    ''Remove text from a word to the end'',
    ''Remove text up to and including a word'',
    ''Search/Replace'',
    ''Increase by percent'',
    ''Decrease by percent'',
    ''Changed by fixed amount'',
    ''Set to fixed value'',
    ''Set to percentage of compare-at-price'',
    ''Add tag(s) to product'',
    ''Remove tag(s) from product'',
    ''Set tags (overwrites existing)'',
    ''Rename tag'',
    ''Search/replace within tag name'',
    ''Add to collection'',
    ''Remove from collection'',
    ''Set status'',
    ''Set taxable'',
    ''SET_INVENTORY_POLICY''
  )'
);

SELECT add_control_plane_check_constraint(
  'EditExecutionSummary',
  'EditExecutionSummary_executionState_enum_ck',
  '"executionState" IN (''planned'', ''queued'', ''dispatching'', ''awaiting_shopify'', ''finalizing'', ''completed'', ''partial'', ''failed'', ''failed_integrity_check'', ''cancelled'')'
);

SELECT add_control_plane_check_constraint(
  'EditExecutionSummary',
  'EditExecutionSummary_status_enum_ck',
  '"status" IN (''pending'', ''processing'', ''completed'', ''failed'', ''cancelled'', ''partial'')'
);

SELECT add_control_plane_check_constraint(
  'EditExecutionSummary',
  'EditExecutionSummary_failureStage_enum_ck',
  '"failureStage" IS NULL OR "failureStage" IN (
    ''bulk_edit_dispatch'',
    ''queue_dispatch'',
    ''scheduled_queue_dispatch'',
    ''target_snapshot_freeze'',
    ''target_integrity_check'',
    ''queue_execution'',
    ''retryable'',
    ''retryable_execution'',
    ''retryable_import_edit''
  )'
);

SELECT add_control_plane_check_constraint(
  'BulkEditJobOutbox',
  'BulkEditJobOutbox_status_enum_ck',
  '"status" IN (''PENDING'', ''DISPATCHING'', ''DISPATCHED'', ''FAILED_RETRYABLE'', ''FAILED'')'
);

SELECT add_control_plane_check_constraint(
  'ChangeRecord',
  'ChangeRecord_scope_enum_ck',
  '"scope" IN (''product'', ''variant'', ''mixed'')'
);

SELECT add_control_plane_check_constraint(
  'ChangeRecord',
  'ChangeRecord_status_enum_ck',
  '"status" IN (''pending'', ''processing'', ''completed'', ''failed'', ''SUCCEEDED'', ''PARTIAL'', ''SKIPPED'')'
);

SELECT add_control_plane_check_constraint(
  'MirrorReconcileSignal',
  'MirrorReconcileSignal_status_enum_ck',
  '"status" IN (''pending'', ''processing'', ''pendingActivation'', ''completed'', ''failed'')'
);

SELECT add_control_plane_check_constraint(
  'OperationFingerprint',
  'OperationFingerprint_operationType_enum_ck',
  '"operationType" IN (''Product'', ''Collection'', ''ProductType'', ''TrackedMetafield'', ''InventoryLevel'', ''all'')'
);

SELECT add_control_plane_check_constraint(
  'OperationFingerprint',
  'OperationFingerprint_status_enum_ck',
  '"status" IN (''RESERVED'', ''CONSUMED'', ''FAILED'')'
);

SELECT add_control_plane_check_constraint(
  'WebhookDelivery',
  'WebhookDelivery_status_enum_ck',
  '"status" IN (''RECEIVED'', ''PROCESSING'', ''PROCESSED'', ''FAILED'', ''SKIPPED'')'
);

DROP FUNCTION add_control_plane_check_constraint(text, text, text);
