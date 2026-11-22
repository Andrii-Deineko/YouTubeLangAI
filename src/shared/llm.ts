import type { LLMTestResult } from '../types/messages';
import type { LLMConfig } from '../types/settings';
import type { AIExample, AIExplanation } from '../types/vocabulary';

export interface AIExplainRequestParams {
  target: string;
  prevSentence: string;
  currentSentence: string;
  nextSentence: string;
  videoTitle: string;
  nativeLang: string;
  llmConfig: LLMConfig;
  fallbackModel?: string;
}

export class LLMRequestError extends Error {
  public status?: number;
  public endpoint?: string;
  public model?: string;
  public retryAfter?: string | null;

  constructor(
    message: string,
    options?: {
      status?: number;
      endpoint?: string;
      model?: string;
      retryAfter?: string | null;
    }
  ) {
    super(message);
    this.name = 'LLMRequestError';
    this.status = options?.status;
    this.endpoint = options?.endpoint;
    this.model = options?.model;
    this.retryAfter = options?.retryAfter;
  }
}

function parseRetryAfterHeader(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;
  const seconds = Number.parseInt(headerValue, 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 10000);
  }
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    if (diff > 0) {
      return Math.min(diff, 10000);
    }
  }
  return null;
}

function getRetryDelay(
  attemptIndex: number,
  retryAfterHeader: string | null | undefined
): number {
  const parsedHeader = parseRetryAfterHeader(retryAfterHeader);
  if (parsedHeader !== null) {
    return parsedHeader;
  }
  const baseDelays = [1000, 2200, 4500];
  const base = baseDelays[attemptIndex] ?? 4500;
  const jitter = Math.floor(Math.random() * (base * 0.25));
  return base + jitter;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(err: unknown): boolean {
  if (err instanceof LLMRequestError && err.status) {
    return [429, 502, 503, 504].includes(err.status);
  }
  if (
    err instanceof TypeError ||
    (err instanceof Error && /failed to fetch|network|timeout/i.test(err.message))
  ) {
    return true;
  }
  return false;
}

interface ChatCompletionMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

export function buildAIExplainMessages(params: AIExplainRequestParams): ChatCompletionMessage[] {
  const systemPrompt = [
    'You are an expert bilingual lexicographer and language tutor.',
    'Analyze the target word or phrase strictly within the provided YouTube video scene context.',
    `All explanations, translations, grammar notes, and nuance explanations MUST be written in the learner's native language code "${params.nativeLang}".`,
    'Be extremely concise, direct, and avoid any filler words.',
    'Respond ONLY with a valid JSON object matching this exact schema:',
    '{',
    '  "lemma": "base dictionary form of the target word/phrase",',
    '  "partOfSpeech": "part of speech / idiom / phrasal verb",',
    '  "contextualTranslation": "accurate translation fitting this exact scene context",',
    '  "literalTranslation": "literal word-for-word translation if slang/idiom/phrasal verb, otherwise null",',
    '  "grammarNote": "concise note on grammar form, tense, case, or collocation (1-2 short sentences, max 140 chars)",',
    '  "nuanceExplanation": "concise note on tone, register, or slang nuance in this line (1-2 short sentences, max 160 chars)",',
    '  "examples": [',
    '    { "source": "Short natural conversational sentence 1 in target language", "translation": "Concise translation 1" },',
    '    { "source": "Short natural conversational sentence 2 in target language", "translation": "Concise translation 2" }',
    '  ]',
    '}'
  ].join('\n');

  const userPrompt = [
    `Video Title: ${params.videoTitle || 'YouTube Video'}`,
    `Target word/phrase: "${params.target}"`,
    `Previous line: "${params.prevSentence || '(none)'}"`,
    `Current line: "${params.currentSentence}"`,
    `Next line: "${params.nextSentence || '(none)'}"`,
    `Learner native language: ${params.nativeLang}`
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

function stripMarkdownJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function parseExamples(value: unknown): AIExample[] {
  if (!Array.isArray(value)) return [];
  const parsed: AIExample[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const source = asString(obj.source);
    const translation = asString(obj.translation);
    if (source && translation) {
      parsed.push({ source, translation });
    }
  }
  return parsed.slice(0, 3);
}

export function parseAIExplanation(rawContent: string, fallbackTarget: string): AIExplanation {
  const cleaned = stripMarkdownJsonFence(rawContent);
  const parsed: unknown = JSON.parse(cleaned);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM did not return a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  const contextualTranslation = asString(obj.contextualTranslation);
  if (!contextualTranslation) {
    throw new Error('LLM JSON missing contextualTranslation');
  }

  const literalRaw = obj.literalTranslation;
  const literalTranslation =
    typeof literalRaw === 'string' && literalRaw.trim().length > 0
      ? literalRaw.trim()
      : null;

  return {
    lemma: asString(obj.lemma, fallbackTarget),
    partOfSpeech: asString(obj.partOfSpeech, 'phrase'),
    contextualTranslation,
    literalTranslation,
    grammarNote: asString(obj.grammarNote),
    nuanceExplanation: asString(obj.nuanceExplanation),
    examples: parseExamples(obj.examples)
  };
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

export function resolveModelsUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return 'https://api.openai.com/v1/models';
  }
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.replace(/\/chat\/completions$/, '/models');
  }
  if (/\/v\d+[a-z0-9_-]*(\/openai)?$/i.test(trimmed) || trimmed.endsWith('/openai')) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/v1/models`;
}

const NON_TEXT_MODEL_SUBSTRINGS = [
  'embedding',
  'imagen',
  'tts',
  'whisper',
  'dall-e',
  'moderation',
  'aqa'
] as const;

interface ModelsListResponse {
  data?: Array<{
    id?: unknown;
  }>;
}

export async function fetchAvailableModels(
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const endpoint = resolveModelsUrl(baseUrl);
  const cleanKey = apiKey.trim();

  if (!cleanKey && !isLocalEndpoint(endpoint)) {
    throw new Error(`API key is missing for ${endpoint}`);
  }

  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  if (cleanKey) {
    headers.Authorization = `Bearer ${cleanKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(15_000)
  });

  const responseText = await response.text();
  if (!response.ok) {
    const errorMessage = extractHttpErrorMessage(responseText, response.statusText);
    throw new Error(`HTTP ${response.status} (${endpoint}): ${errorMessage}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid JSON from ${endpoint}`);
  }

  const modelsObj = parsed as ModelsListResponse | null;
  if (!modelsObj || !Array.isArray(modelsObj.data)) {
    throw new Error(`Unexpected /models response format from ${endpoint}`);
  }

  const uniqueModels = new Set<string>();
  for (const item of modelsObj.data) {
    if (!item || typeof item.id !== 'string') continue;
    const cleanId = item.id.replace(/^models\//, '').trim();
    if (!cleanId) continue;

    const lowerId = cleanId.toLowerCase();
    const isNonText = NON_TEXT_MODEL_SUBSTRINGS.some((sub) => lowerId.includes(sub));
    if (isNonText) continue;

    uniqueModels.add(cleanId);
  }

  return Array.from(uniqueModels).sort((a, b) => a.localeCompare(b));
}

function isLocalEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1'
    );
  } catch {
    return false;
  }
}

function extractHttpErrorMessage(responseText: string, statusText: string): string {
  const trimmed = responseText.trim();
  if (!trimmed) return statusText || 'Empty error body';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as ChatCompletionResponse | undefined;
      if (first?.error?.message) return first.error.message;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as ChatCompletionResponse & { message?: unknown };
      if (obj.error?.message) return obj.error.message;
      if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    }
  } catch {
    // Response is plain text or HTML
  }
  return trimmed.slice(0, 260);
}

export async function testLLMConnection(llmConfig: LLMConfig): Promise<LLMTestResult> {
  const endpoint = resolveChatCompletionsUrl(llmConfig.baseUrl);
  const apiKey = llmConfig.apiKey.trim();
  const model = llmConfig.model.trim() || 'gpt-4o-mini';

  if (!apiKey && !isLocalEndpoint(endpoint)) {
    throw new Error(`API key is missing for ${endpoint}`);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model,
      max_tokens: 5,
      temperature: 0,
      messages: [{ role: 'user', content: 'Reply with OK' }]
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    const errorMessage = extractHttpErrorMessage(responseText, response.statusText);
    throw new Error(`HTTP ${response.status} (${endpoint}, model=${model}): ${errorMessage}`);
  }

  const data = JSON.parse(responseText) as ChatCompletionResponse;
  const replyPreview = data.choices?.[0]?.message?.content?.trim() || 'OK';

  return {
    resolvedUrl: endpoint,
    status: response.status,
    model,
    replyPreview
  };
}

async function callChatCompletionsSingleAttempt(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatCompletionMessage[]
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages
      })
    });
  } catch (netErr: unknown) {
    throw new LLMRequestError(
      netErr instanceof Error ? netErr.message : 'Network error (Failed to fetch)',
      { endpoint, model }
    );
  }

  const responseText = await response.text();
  if (!response.ok) {
    const errorMessage = extractHttpErrorMessage(responseText, response.statusText);
    const retryAfter = response.headers.get('Retry-After');
    throw new LLMRequestError(
      `HTTP ${response.status} (${endpoint}, model=${model}): ${errorMessage}`,
      { status: response.status, endpoint, model, retryAfter }
    );
  }

  let data: ChatCompletionResponse;
  try {
    data = JSON.parse(responseText) as ChatCompletionResponse;
  } catch {
    throw new LLMRequestError(`Invalid JSON from ${endpoint} (model=${model})`, {
      endpoint,
      model
    });
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new LLMRequestError(
      `LLM returned an empty response (${endpoint}, model=${model})`,
      { endpoint, model }
    );
  }

  return content;
}

async function callChatCompletionsWithRetry(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatCompletionMessage[],
  maxRetries = 3
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callChatCompletionsSingleAttempt(endpoint, apiKey, model, messages);
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxRetries && isTransientError(err)) {
        const retryAfter = err instanceof LLMRequestError ? err.retryAfter : null;
        const delay = getRetryDelay(attempt, retryAfter);
        console.warn(
          `[YouTube Lang AI] LLM transient error on model=${model} (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`,
          err
        );
        await wait(delay);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function requestAIExplanation(
  params: AIExplainRequestParams
): Promise<AIExplanation> {
  const endpoint = resolveChatCompletionsUrl(params.llmConfig.baseUrl);
  const apiKey = params.llmConfig.apiKey.trim();
  const primaryModel = params.llmConfig.model.trim() || 'gpt-4o-mini';
  const fallbackModel = params.fallbackModel?.trim();

  if (!apiKey && !isLocalEndpoint(endpoint)) {
    throw new Error('API key is missing. Configure your LLM API key in Extension Settings.');
  }

  const messages = buildAIExplainMessages(params);

  try {
    const content = await callChatCompletionsWithRetry(
      endpoint,
      apiKey,
      primaryModel,
      messages,
      3
    );
    return parseAIExplanation(content, params.target);
  } catch (err: unknown) {
    const isOverloadedOrRateLimited =
      err instanceof LLMRequestError &&
      (err.status === 503 || err.status === 429);

    if (
      isOverloadedOrRateLimited &&
      fallbackModel &&
      fallbackModel.toLowerCase() !== primaryModel.toLowerCase()
    ) {
      console.warn(
        `[YouTube Lang AI] Primary model ${primaryModel} failed with HTTP ${err.status}. Switching to fallback model: ${fallbackModel}`
      );
      try {
        const fallbackContent = await callChatCompletionsWithRetry(
          endpoint,
          apiKey,
          fallbackModel,
          messages,
          2
        );
        return parseAIExplanation(fallbackContent, params.target);
      } catch (fallbackErr: unknown) {
        console.error(
          `[YouTube Lang AI] Fallback model ${fallbackModel} also failed:`,
          fallbackErr
        );
        throw fallbackErr;
      }
    }

    throw err;
  }
}
