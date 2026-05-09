function estimateRowBytes(row) {
  return Buffer.byteLength(JSON.stringify(row || {}), "utf8");
}

function resolveMutationType(row) {
  const planned = row?.plannedChanges;
  if (Array.isArray(planned) && planned.some((c) => c?.field === "deleteProducts")) {
    return "PRODUCT_DELETE";
  }
  return row?.variantId ? "VARIANT_MUTATION" : "PRODUCT_MUTATION";
}

function resolveEntityType(row) {
  return row?.variantId ? "VARIANT" : "PRODUCT";
}

export function partitionMutationWork(items = [], options = {}) {
  const source = Array.isArray(items) ? items : [];
  const maxBytes = Math.max(1024, Number(options?.maxPartitionBytes || 2_500_000));
  const partitions = [];

  const sorted = [...source].sort((a, b) => Number(a.ordinal || 0) - Number(b.ordinal || 0));

  let current = null;
  for (const row of sorted) {
    const mutationType = resolveMutationType(row);
    const entityType = resolveEntityType(row);
    const bytes = estimateRowBytes(row);

    const needsNew =
      !current ||
      current.mutationType !== mutationType ||
      current.entityType !== entityType ||
      current.estimatedBytes + bytes > maxBytes;

    if (needsNew) {
      if (current) partitions.push(current);
      current = {
        partitionOrdinal: partitions.length + 1,
        mutationType,
        entityType,
        ordinalStart: Number(row.ordinal || 0),
        ordinalEnd: Number(row.ordinal || 0),
        estimatedBytes: 0,
        targetCount: 0,
        targets: [],
      };
    }

    current.targets.push({
      ordinal: row.ordinal,
      productId: row.productId,
      variantId: row.variantId || null,
      targetHash: row.targetHash || null,
    });
    current.targetCount += 1;
    current.estimatedBytes += bytes;
    current.ordinalEnd = Number(row.ordinal || current.ordinalEnd);
  }

  if (current) partitions.push(current);
  return partitions;
}
