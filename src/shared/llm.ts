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
    'Respond ONLY with a valid JSON object matching this exact schema:',
    '{',
    '  "lemma": "base dictionary form of the target word/phrase",',
    '  "partOfSpeech": "part of speech / idiom / phrasal verb",',
    '  "contextualTranslation": "accurate translation fitting this exact scene context",',
    '  "literalTranslation": "literal word-for-word translation if slang/idiom/phrasal verb, otherwise null",',
    '  "grammarNote": "concise note on grammar form, tense, case, or collocation",',
    '  "nuanceExplanation": "1-2 sentences explaining meaning, tone, register, or slang nuance in this line",',
    '  "examples": [',
    '    { "source": "Natural example sentence 1 in the target language", "translation": "Translation 1" },',
    '    { "source": "Natural example sentence 2 in the target language", "translation": "Translation 2" }',
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
    headers
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

export async function requestAIExplanation(
  params: AIExplainRequestParams
): Promise<AIExplanation> {
  const endpoint = resolveChatCompletionsUrl(params.llmConfig.baseUrl);
  const apiKey = params.llmConfig.apiKey.trim();
  const model = params.llmConfig.model.trim() || 'gpt-4o-mini';

  if (!apiKey && !isLocalEndpoint(endpoint)) {
    throw new Error('API key is missing. Configure your LLM API key in Extension Settings.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: buildAIExplainMessages(params)
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  if (!response.ok) {
    const errorMessage = extractHttpErrorMessage(responseText, response.statusText);
    throw new Error(`HTTP ${response.status} (${endpoint}, model=${model}): ${errorMessage}`);
  }

  const data = JSON.parse(responseText) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`LLM returned an empty response (${endpoint})`);
  }

  return parseAIExplanation(content, params.target);
}
