import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createProviderRegistry, type JSONValue } from "ai";
import { HIGH, LOW, MEDIUM, MODELS, type ModelOption, type ModelSelection, type Provider } from "./models.ts";

/**
 * Which AI providers this server may use, from .env, the way LobeHub and LibreChat do it: a provider is on when its key
 * is set. Google, Anthropic, DeepSeek and OpenAI by key; anything else that speaks the OpenAI API (Ollama, OpenRouter, Mistral,
 * Groq, vLLM) through one OPENAI_COMPATIBLE_* slot. Server only: it reads the keys.
 */
type Env = Record<string, string | undefined>;

const list = (value?: string) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function providers(env: Env) {
  const on: Parameters<typeof createProviderRegistry>[0] = {};
  if (env.GEMINI_API_KEY) on.google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
  if (env.ANTHROPIC_API_KEY) on.anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  if (env.DEEPSEEK_API_KEY) on.deepseek = createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY });
  if (env.OPENAI_API_KEY) on.openai = createOpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL || undefined });
  if (env.OPENAI_COMPATIBLE_BASE_URL) {
    on.compatible = createOpenAICompatible({ name: "compatible", baseURL: env.OPENAI_COMPATIBLE_BASE_URL, apiKey: env.OPENAI_COMPATIBLE_API_KEY || undefined });
  }
  return on;
}

// ponytail: 128k for models named in .env, whose real window we don't know; it only scales the context meter.
const listed = (provider: Provider, id: string, description: string): ModelOption => ({
  id: `${provider}:${id}`,
  name: id,
  description,
  provider,
  contextWindow: 128_000,
  efforts: provider === "openai" ? [LOW, MEDIUM, HIGH] : [],
  defaultEffort: "medium",
});

/** The models people can pick: the curated ones of each configured provider, then the ones .env names. */
export function availableModels(env: Env = process.env): ModelOption[] {
  const on = providers(env);
  return [
    ...MODELS.filter((m) => m.provider in on),
    // OpenAI's line-up on 2026-11-13 (developers.openai.com/api/docs/models): Sol balanced, Terra fast, Astra the flagship.
    ...("openai" in on ? list(env.OPENAI_MODELS || "gpt-6.1-sol,gpt-6.1-terra,gpt-6-astra").map((id) => listed("openai", id, "OpenAI")) : []),
    ...("compatible" in on ? list(env.OPENAI_COMPATIBLE_MODELS).map((id) => listed("compatible", id, env.OPENAI_COMPATIBLE_NAME || "Eigen endpoint")) : []),
  ];
}

let registry: ReturnType<typeof createProviderRegistry> | undefined;
/** The AI SDK model for a `provider:model` id from availableModels(). */
export const languageModel = (id: string) => (registry ??= createProviderRegistry(providers(process.env))).languageModel(id as `${string}:${string}`);

/** The thinking level, said the way each provider takes it. */
export function providerOptions({ model, effort }: ModelSelection): Record<string, Record<string, JSONValue>> {
  switch (model.split(":")[0]) {
    case "google":
      return { google: { thinkingConfig: { thinkingLevel: effort } } };
    case "anthropic":
      return {
        anthropic: {
          effort: effort === "minimal" ? "low" : effort,
          // The 5.5 models think adaptively and refuse thinking turned off. Pruning old tool results edits earlier turns,
          // which invalidates the thinking replayed after them: drop those blocks instead of failing the answer.
          thinking: { type: "adaptive", blockBinding: { prefixMismatchBehavior: "drop_block" } },
          // Every step of the tool loop resends the conversation; cache it.
          cacheControl: { type: "ephemeral" },
        },
      };
    case "deepseek":
      return { deepseek: { reasoningEffort: effort === "high" ? "high" : "low" } };
    case "openai":
      return { openai: { reasoningEffort: effort } };
    default:
      return {};
  }
}
