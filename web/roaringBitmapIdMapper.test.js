import assert from "node:assert/strict";
import test from "node:test";

import {
  deserializeProductIdBitmap,
  serializeProductIdBitmapAsync,
} from "./services/filterPlanner/roaringBitmapIdMapper.js";

test("async bitmap serialization offloads and round-trips deterministically", async () => {
  const productIds = Array.from(
    { length: 32 },
    (_, index) => `gid://shopify/Product/${1000 + index}`,
  );

  const { serialized, mapper } = await serializeProductIdBitmapAsync(
    productIds,
    undefined,
    { forceWorker: true },
  );

  const { productIds: roundTripped } = deserializeProductIdBitmap(serialized, mapper);

  assert.deepEqual(roundTripped, [...productIds].sort());
});
