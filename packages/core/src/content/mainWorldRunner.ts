import {
  POST_MESSAGE_SOURCE_ISOLATED,
  POST_MESSAGE_SOURCE_MAIN,
  type CapturedTrackPayload,
  type PlayerMainWorldContext,
  type ServicePlugin
} from '@langai/contracts';

export const MAIN_WORLD_TRACKS_EVENT = 'LANGAI_TRACKS_CAPTURED' as const;
export const MAIN_WORLD_LOG_EVENT = 'LANGAI_MAIN_LOG' as const;

export function runMainWorldInterceptor(service: ServicePlugin): () => void {
  const guardKey = `__LANGAI_MAIN_INTERCEPTOR_${service.id}__`;
  const winRecord =
    typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;

  if (winRecord && typeof winRecord[guardKey] === 'function') {
    try {
      (winRecord[guardKey] as () => void)();
    } catch {
      // Ignore previous teardown error
    }
    winRecord[guardKey] = null;
  }

  let isDisabled = false;
  let isTornDown = false;

  const messageListener = (event: MessageEvent): void => {
    if (typeof window === 'undefined' || event.source !== window || !event.data) return;
    if (typeof event.data !== 'object') return;
    const msg = event.data as {
      source?: unknown;
      type?: unknown;
      disabled?: unknown;
    };
    if (msg.source === POST_MESSAGE_SOURCE_ISOLATED && msg.type === 'LANGAI_SET_DISABLED') {
      isDisabled = Boolean(msg.disabled);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('message', messageListener);
  }

  const ctx: PlayerMainWorldContext = {
    emitTracks(payload: CapturedTrackPayload): void {
      if (isTornDown || isDisabled || typeof window === 'undefined') return;
      window.postMessage(
        {
          source: POST_MESSAGE_SOURCE_MAIN,
          type: MAIN_WORLD_TRACKS_EVENT,
          serviceId: service.id,
          payload
        },
        '*'
      );
    },
    log(level: 'info' | 'warn' | 'error', message: string): void {
      if (isTornDown || isDisabled || typeof window === 'undefined') return;
      window.postMessage(
        {
          source: POST_MESSAGE_SOURCE_MAIN,
          type: MAIN_WORLD_LOG_EVENT,
          serviceId: service.id,
          payload: { level, message }
        },
        '*'
      );
    }
  };

  const teardowns: Array<() => void> = [];

  if (typeof service.initMainWorldExtractor === 'function') {
    try {
      const td = service.initMainWorldExtractor(ctx);
      if (typeof td === 'function') {
        teardowns.push(td);
      }
    } catch {
      // Ignore extractor init failure
    }
  }

  for (const player of service.players) {
    if (typeof player.initMainWorldProbe === 'function') {
      try {
        const td = player.initMainWorldProbe(ctx);
        if (typeof td === 'function') {
          teardowns.push(td);
        }
      } catch {
        // Ignore probe init failure
      }
    }
  }

  const teardown = (): void => {
    if (isTornDown) return;
    isTornDown = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', messageListener);
    }
    for (const td of teardowns) {
      try {
        td();
      } catch {
        // Ignore teardown errors
      }
    }
    if (winRecord && winRecord[guardKey] === teardown) {
      winRecord[guardKey] = null;
    }
  };

  if (winRecord) {
    winRecord[guardKey] = teardown;
  }

  return teardown;
}
