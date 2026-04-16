# Phase 0 Pre-Migration Audit

Before any schema migration, freeze functional changes in these areas except for
observability, read-only audit tooling, and explicitly reviewed hotfixes:

- sync ingest
- snapshot activation
- filter compiler
- export targeting
- undo/replay targeting
- scheduled edit/export targeting

Run the read-only production audit:

```sh
npm run audit:phase0-batches
```

The audit reports:

- distinct `Store.activeMirrorBatchId` values by shop
- distinct `CatalogSnapshot.catalogBatchId` values by shop
- distinct active `CatalogSnapshot.catalogBatchId` values by shop
- product counts by `(shop, mirrorBatchId)`
- variant counts by `(shop, mirrorBatchId)`
- collection membership counts by `(shop, catalogBatchId)`
- inventory level counts by `(shop, catalogBatchId)`

Structured batch observability events:

- `catalog_batch_resolution`
- `catalog_batch_ingest_write`
- `catalog_batch_activation`
- `catalog_batch_filter`
- `catalog_batch_export`
- `catalog_batch_edit_execution`

Each event includes the common fields `shop`, `syncRunId`, `bulkOperationId`,
`oldMirrorBatchId`, `newCatalogBatchId`, `resolvedCatalogBatchId`, and `path`.
