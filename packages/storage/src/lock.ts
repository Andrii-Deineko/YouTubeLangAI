export const STORAGE_LOCK_NAME = 'langai-storage-lock';

const lockQueues = new Map<string, Promise<void>>();

function enqueueInProcessLock<T>(lockName: string, op: () => Promise<T>): Promise<T> {
  const prev = lockQueues.get(lockName) ?? Promise.resolve();
  const resultPromise = prev.then(op, op);
  const tail = resultPromise.then(
    () => undefined,
    () => undefined
  );
  lockQueues.set(lockName, tail);
  return resultPromise;
}

/**
 * Executes an async operation under a cross-context Web Lock when available,
 * falling back to an in-process FIFO Promise queue in environments without
 * `navigator.locks` (such as Node/Vitest or insecure contexts).
 */
export async function withStorageLock<T>(
  lockName: string,
  op: () => Promise<T>
): Promise<T> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.locks &&
    typeof navigator.locks.request === 'function'
  ) {
    let started = false;
    try {
      return await navigator.locks.request(lockName, async () => {
        started = true;
        return await op();
      });
    } catch (err) {
      if (started) {
        throw err;
      }
      // Fall back to in-process queue if Web Locks is disallowed (e.g. insecure origin)
    }
  }

  return enqueueInProcessLock(lockName, op);
}
