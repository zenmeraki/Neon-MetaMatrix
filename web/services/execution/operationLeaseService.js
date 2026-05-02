import { storeOperationRepository } from "../../repositories/storeOperationRepository.js";
import { assertOperationNotTimedOut } from "./operationTimeoutGuard.js";

export const operationLeaseService = {
  async acquire({ operationId, workerId, ttlMs = 30_000 }) {
    const leaseExpiresAt = new Date(Date.now() + ttlMs);
    const result = await storeOperationRepository.acquireLease(
      operationId,
      workerId,
      leaseExpiresAt,
    );

    return {
      acquired: result.count === 1,
      operationId,
      workerId,
      leaseExpiresAt,
    };
  },

  async renew({ operationId, workerId, ttlMs = 30_000 }) {
    const operation = await storeOperationRepository.findById(operationId);
    assertOperationNotTimedOut(operation);

    const leaseExpiresAt = new Date(Date.now() + ttlMs);
    const result = await storeOperationRepository.renewLease(
      operationId,
      workerId,
      leaseExpiresAt,
    );

    return {
      renewed: result.count === 1,
      operationId,
      workerId,
      leaseExpiresAt,
    };
  },

  async release({ operationId, workerId }) {
    const result = await storeOperationRepository.releaseLease(
      operationId,
      workerId,
    );

    return {
      released: result.count === 1,
      operationId,
      workerId,
    };
  },

  async withLease({ operationId, workerId, ttlMs = 30_000 }, fn) {
    const lease = await this.acquire({ operationId, workerId, ttlMs });

    if (!lease.acquired) {
      const error = new Error("LEASE_NOT_ACQUIRED");
      error.code = "LEASE_NOT_ACQUIRED";
      throw error;
    }

    const renewLease = setInterval(() => {
      this.renew({ operationId, workerId, ttlMs }).catch((error) => {
        console.error("Lease renewal failed", {
          operationId,
          error: error.message,
        });
      });
    }, Math.max(1_000, Math.floor(ttlMs / 3)));

    try {
      return await fn(lease);
    } finally {
      clearInterval(renewLease);
      await this.release({ operationId, workerId });
    }
  },
};
