# Phase 4 Validation Gates

Run these gates after Phase 3 backfill and before cutting reads over to
`ActiveCatalogSnapshot`.

```powershell
npm run validate:phase4-catalog-gates
```

For a single shop:

```powershell
npm run validate:phase4-catalog-gates -- --shop=example.myshopify.com
```

The command fails closed by default when an active batch is missing products,
variants, collection memberships, or inventory levels, or when active variants
do not have a product in the same `catalogBatchId`.

If a shop intentionally does not have a domain, document the exception in the
runbook/change ticket and pass it explicitly:

```powershell
npm run validate:phase4-catalog-gates -- --allow-missing=example.myshopify.com:collections,inventory
```

Allowed domain names are `products`, `variants`, `collections`, and
`inventory`. Do not use an allowance as a general workaround; it is only for
known, documented domain absence.

## Surface Parity

For a fixed shop and filter, require exact count parity before read cutover:

```powershell
npm run validate:phase4-surface-parity -- --shop=example.myshopify.com --filter-json='[]'
```

For larger filters, put the JSON array in a file:

```powershell
npm run validate:phase4-surface-parity -- --shop=example.myshopify.com --filter-file=./parity-filter.json
```

Use `--target-level=VARIANT` when the edit/export surface targets variants.
The command compares preview, export, execute, and undo/replay counts between
the legacy `mirrorBatchId` scope and the new `catalogBatchId` scope. Any
mismatch exits non-zero.
