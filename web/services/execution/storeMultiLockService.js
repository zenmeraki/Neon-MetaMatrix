import { storeLockService } from "./storeLockService.js";

export async function acquireShopLocks(shop, namespaces) {
  const acquired = [];

  for (const namespace of namespaces) {
    const lock = await storeLockService.acquire(shop, namespace);

    if (!lock.acquired) {
      for (const held of acquired.reverse()) {
        await storeLockService.release(held.key, held.token);
      }

      return {
        acquired: false,
        failedNamespace: namespace,
      };
    }

    acquired.push(lock);
  }

  return {
    acquired: true,
    locks: acquired,
  };
}

export async function releaseShopLocks(locks = []) {
  for (const lock of locks.reverse()) {
    await storeLockService.release(lock.key, lock.token);
  }
}
