import type { AiProvider } from './enums';

export interface AiModelPreset {
  readonly label: string;
  readonly provider: AiProvider;
  readonly base_url: string;
  readonly model: string;
}

export const AI_MODEL_PRESETS: readonly AiModelPreset[] = [
  {
    label: 'DeepSeek 最新对话',
    provider: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    label: 'OpenAI GPT-5 mini',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
  },
  {
    label: 'OpenAI GPT-5',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-5',
  },
  {
    label: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
  },
  {
    label: 'Gemini 2.5 Flash',
    provider: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
  },
  {
    label: 'Gemini 3 Flash',
    provider: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3-flash-preview',
  },
  {
    label: 'OpenRouter',
    provider: 'openai_compatible',
    base_url: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.6',
  },
] as const;
