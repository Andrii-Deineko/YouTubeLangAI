import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

// Dev shim for chrome extension APIs when previewed directly in a browser
if (typeof window !== 'undefined' && (!window.chrome || !window.chrome.storage)) {
  const memStore = new Map<string, string>();
  const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void> = [];

  const defaultSampleCards = [
    {
      id: 'demo-card-1',
      word: 'subtle',
      lemma: 'subtle',
      translation: 'тонкий, неуловимый',
      aiExplanation: {
        lemma: 'subtle',
        partOfSpeech: 'adjective',
        contextualTranslation: 'едва заметный',
        literalTranslation: 'тонкий',
        grammarNote: 'Silent "b" pronunciation: /ˈsʌt.əl/',
        nuanceExplanation: 'Used for things so delicate or precise as to be difficult to analyze or detect.',
        examples: [
          { source: 'There is a subtle difference between the two expressions.', translation: 'Между этими двумя выражениями есть едва заметная разница.' }
        ]
      },
      contextSentence: 'There is a subtle distinction here that learners often miss.',
      contextTranslation: 'Здесь есть тонкое различие, которое изучающие язык часто упускают.',
      videoId: 'dQw4w9WgXcQ',
      videoTitle: 'Advanced English Nuances & Idioms',
      timestampSec: 42,
      screenshotBase64: null,
      sourceLang: 'en',
      nativeLang: 'ru',
      createdAt: new Date().toISOString(),
      fsrsState: {
        due: new Date().toISOString(),
        stability: 1.0,
        difficulty: 5.0,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        state: 0
      }
    }
  ];

  try {
    if (!localStorage.getItem('yt_lang_ai_vocabulary')) {
      localStorage.setItem('yt_lang_ai_vocabulary', JSON.stringify(defaultSampleCards));
    }
  } catch {}

  (window as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getURL: (path: string) => path,
      sendMessage: (req: { type?: string }, callback?: (res: unknown) => void) => {
        if (!callback) return;
        if (req?.type === 'ANKI_TEST') {
          callback({ ok: true, version: 6 });
        } else if (req?.type === 'LLM_TEST') {
          callback({ ok: true, message: 'LLM connection ok (mock)' });
        } else if (req?.type === 'FETCH_AVAILABLE_MODELS') {
          callback({ ok: true, models: ['gpt-4o-mini', 'gemini-2.5-flash', 'llama3.1'] });
        } else {
          callback({ ok: true });
        }
      },
      lastError: null
    },
    permissions: {
      request: async () => true
    },
    tabs: {
      create: (opts: { url: string }) => {
        window.open(opts.url, '_blank');
      }
    },
    storage: {
      local: {
        async get(keys: unknown) {
          const res: Record<string, unknown> = {};
          const readKey = (k: string) => {
            const raw = memStore.get(k) ?? localStorage.getItem(k);
            if (raw) {
              try { return JSON.parse(raw); } catch { return raw; }
            }
            return undefined;
          };

          if (typeof keys === 'string') {
            res[keys] = readKey(keys);
          } else if (Array.isArray(keys)) {
            for (const k of keys) {
              res[k] = readKey(k);
            }
          } else if (keys && typeof keys === 'object') {
            for (const [k, defaultVal] of Object.entries(keys)) {
              const val = readKey(k);
              res[k] = val !== undefined ? val : defaultVal;
            }
          }
          return res;
        },
        async set(items: Record<string, unknown>) {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const [k, v] of Object.entries(items)) {
            const strVal = JSON.stringify(v);
            const oldValRaw = memStore.get(k) ?? localStorage.getItem(k);
            const oldValue = oldValRaw ? JSON.parse(oldValRaw) : undefined;
            memStore.set(k, strVal);
            try { localStorage.setItem(k, strVal); } catch {}
            changes[k] = { oldValue, newValue: v };
          }
          for (const listener of listeners) {
            listener(changes, 'local');
          }
        }
      },
      onChanged: {
        addListener: (fn: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) => {
          listeners.push(fn);
        },
        removeListener: (fn: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) => {
          const idx = listeners.indexOf(fn);
          if (idx >= 0) listeners.splice(idx, 1);
        }
      }
    }
  };
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
