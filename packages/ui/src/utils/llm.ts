import type { LLMConfig } from '@langai/contracts';

export function isLocalBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

/**
 * Returns true if the LLM config is usable either via a local keyless endpoint
 * (localhost / 127.0.0.1 / ::1) or via a non-empty API key.
 */
export function isLlmConfigured(llm: Partial<LLMConfig> | undefined | null): boolean {
  if (!llm) return false;
  const baseUrl = llm.baseUrl?.trim() ?? '';
  const apiKey = llm.apiKey?.trim() ?? '';
  return Boolean((baseUrl && isLocalBaseUrl(baseUrl)) || apiKey.length > 0);
}

export function resolveChatCompletionsUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return 'https://api.openai.com/v1/chat/completions';
  }
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  if (/\/v\d+[a-z0-9_-]*(\/openai)?$/i.test(trimmed) || trimmed.endsWith('/openai')) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}
