# Schema Naming Contract

This schema uses one vocabulary for operational data. New tables and columns must follow these names unless a column is explicitly marked legacy compatibility debt in `schema.prisma`.

## Time

Use timestamp names that describe lifecycle edges:

- `createdAt`
- `updatedAt`
- `startedAt`
- `completedAt`
- `activatedAt`
- `scheduledFor`

Avoid new names such as `editTime`, `exportTime`, `duration`, or `recordedAt` for control-plane lifecycle state.

## Durations

Use `durationMs` for elapsed time. Do not add new `duration` fields.

## Counts

Use these count names consistently:

- `rowCount`: input, output, artifact, or transport rows.
- `targetCount`: targeted catalog entities.
- `processedCount`: attempted execution count.
- `affectedCount`: successful mutation count.

Avoid `recordCount`, `totalRows`, `totalItems`, and ambiguous `count` fields on new control-plane models.

## Status

Every `status` field must have a finite vocabulary. Prefer Prisma enums when the table is new or when an existing table can be migrated cleanly. For legacy text columns, add raw migration check constraints before introducing new writers.

Do not introduce free-form status strings.

## Type

Do not add generic `type` fields. Use domain-specific names:

- `runType`
- `artifactType`
- `triggerType`
- `mutationType`
- `scopeType`
- `ownerType`
- `sourceType`
- `entityType`

Existing generic `type` fields are legacy compatibility surfaces only.
