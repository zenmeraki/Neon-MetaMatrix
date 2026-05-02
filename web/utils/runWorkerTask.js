import { Worker } from "node:worker_threads";

const DEFAULT_TIMEOUT_MS = 30_000;

export function runWorkerTask(workerUrl, workerData, options = {}) {
  const {
    transferList = [],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData,
      transferList,
    });

    let settled = false;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Worker task timed out after ${timeoutMs}ms`));
      worker.terminate().catch(() => {});
    }, timeoutMs);

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.removeAllListeners();
    }

    worker.once("message", (message) => {
      cleanup();

      if (message?.error) {
        const error = new Error(message.error.message || "Worker task failed");
        error.stack = message.error.stack || error.stack;
        reject(error);
        return;
      }

      resolve(message?.result);
    });

    worker.once("error", (error) => {
      cleanup();
      reject(error);
    });

    worker.once("exit", (code) => {
      if (settled) {
        return;
      }

      cleanup();

      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
        return;
      }

      reject(new Error("Worker exited without returning a result"));
    });
  });
}
