import { parentPort, workerData } from "node:worker_threads";
import { serializeProductIdBitmap } from "../roaringBitmapIdMapper.js";

function postResult(payload) {
  parentPort?.postMessage(payload);
}

try {
  const { productIds = [] } = workerData || {};
  const { serialized, mapper } = serializeProductIdBitmap(productIds);

  postResult({
    result: {
      serialized,
      mapperProductIds: mapper.productIds,
    },
  });
} catch (error) {
  postResult({
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
}
