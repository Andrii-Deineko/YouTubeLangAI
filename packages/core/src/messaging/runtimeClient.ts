import type { RuntimeRequest, RuntimeResponse } from '@langai/contracts';

export function isExtensionContextValid(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      Boolean(chrome.runtime?.id) &&
      typeof chrome.runtime?.sendMessage === 'function'
    );
  } catch {
    return false;
  }
}

export function sendRuntimeMessage<T>(req: RuntimeRequest): Promise<RuntimeResponse<T>> {
  if (!isExtensionContextValid()) {
    return Promise.reject(new Error('Extension context invalidated'));
  }

  return new Promise<RuntimeResponse<T>>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(req, (response: RuntimeResponse<T> | undefined) => {
        const lastError = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : undefined;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('Empty response from service worker'));
          return;
        }
        resolve(response);
      });
    } catch (err: unknown) {
      reject(err instanceof Error ? err : new Error('Extension context invalidated'));
    }
  });
}
