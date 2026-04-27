// web/frontend/Shared/utils/exponentialBackoff.ts
export interface BackoffOptions {
  retries: number;
  factor?: number;    // multiplier per retry (defaults to 2)
  baseDelay?: number; // initial delay in ms (defaults to 500ms)
}

export async function backoff<T>(
  fn: () => Promise<T>,
  { retries, factor = 2, baseDelay = 500 }: BackoffOptions
): Promise<T> {
  let attempt = 0;
  let delay = baseDelay;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
      delay *= factor; // exponential backoff
    }
  }
}
