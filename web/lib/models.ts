/**
 * The chat models on offer, per provider. lib/providers.ts keeps the ones whose provider has a key and adds the
 * OpenAI and OpenAI-compatible models named in .env; the picker shows that list and the chat route accepts nothing else.
 * Ids are `provider:model`, as the AI SDK's provider registry takes them.
 */

export type Provider = "google" | "anthropic" | "deepseek" | "openai" | "compatible";

/** Headings in the picker. */
export const PROVIDER_NAMES: Record<Provider, string> = { google: "Google", anthropic: "Anthropic", deepseek: "DeepSeek", openai: "OpenAI", compatible: "Eigen endpoint" };

export type Effort = "minimal" | "low" | "medium" | "high";

export interface EffortLevel {
  id: Effort;
  label: string;
  /** One line on the trade-off, shown under the track. */
  hint: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  provider: Provider;
  /** Tokens, for the context meter. */
  contextWindow: number;
  /** Thinking levels the model accepts, lowest first; none for an endpoint whose models we don't know. */
  efforts: EffortLevel[];
  defaultEffort: Effort;
}

export interface ModelSelection {
  model: string;
  effort: Effort;
}

/** The last answer's context window: what went in at its first step, and what its reading added by the last. */
export interface ContextUse {
  prompt: number;
  sources: number;
}

/** What the chat route stamps on an answer (app/api/chat/route.ts); answers from before have none of it. */
export interface AnswerMeta {
  model?: string;
  effort?: Effort;
  /** Server clock, ms. */
  startedAt?: number;
  finishedAt?: number;
  context?: ContextUse;
}

export const MINIMAL: EffortLevel = { id: "minimal", label: "Minimaal", hint: "Denkt bijna niet na. Voor één cijfer dat je snel wilt weten." };
export const LOW: EffortLevel = { id: "low", label: "Laag", hint: "Denkt kort na. Snel, voor eenvoudige vragen." };
export const MEDIUM: EffortLevel = { id: "medium", label: "Middel", hint: "Denkt eerst even na. Goed voor de meeste vragen." };
export const HIGH: EffortLevel = { id: "high", label: "Hoog", hint: "Denkt grondig na. Trager, het best voor vergelijkingen." };

const GEMINI_WINDOW = 1_048_576;
const CLAUDE_WINDOW = 1_000_000;

// Gemini levels checked against the Gemini API on 2026-11-11: Flash and Pro refuse "minimal". The Claude 5.5 models
// take effort low to max and think adaptively by default.
export const MODELS: ModelOption[] = [
  {
    id: "google:gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Snel en nauwkeurig, de standaard",
    provider: "google",
    contextWindow: GEMINI_WINDOW,
    efforts: [LOW, MEDIUM, HIGH],
    defaultEffort: "high",
  },
  {
    id: "google:gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    description: "Grondiger bij lastige vragen, wel trager",
    provider: "google",
    contextWindow: GEMINI_WINDOW,
    efforts: [LOW, MEDIUM, HIGH],
    defaultEffort: "high",
  },
  {
    id: "google:gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    description: "Snelst, voor eenvoudige opzoekvragen",
    provider: "google",
    contextWindow: GEMINI_WINDOW,
    efforts: [MINIMAL, LOW, MEDIUM, HIGH],
    defaultEffort: "low",
  },
  {
    id: "anthropic:claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    description: "Sterk en vlot, goed in lange zoektochten",
    provider: "anthropic",
    contextWindow: CLAUDE_WINDOW,
    efforts: [LOW, MEDIUM, HIGH],
    defaultEffort: "high",
  },
  {
    id: "anthropic:claude-opus-5-5",
    name: "Claude Opus 5.5",
    description: "Het grondigst, voor de lastigste vragen",
    provider: "anthropic",
    contextWindow: CLAUDE_WINDOW,
    efforts: [LOW, MEDIUM, HIGH],
    defaultEffort: "medium",
  },
  {
    id: "anthropic:claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    description: "Snel en goedkoop, voor eenvoudige vragen",
    provider: "anthropic",
    contextWindow: CLAUDE_WINDOW,
    efforts: [LOW, MEDIUM, HIGH],
    defaultEffort: "low",
  },
  // DeepSeek V4 (api-docs.deepseek.com, 2026-11-13) thinks by default, at effort low or high.
  // ponytail: 128k window not checked against DeepSeek's docs; it only scales the context meter.
  {
    id: "deepseek:deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "Sterk en voordelig",
    provider: "deepseek",
    contextWindow: 128_000,
    efforts: [LOW, HIGH],
    defaultEffort: "high",
  },
  {
    id: "deepseek:deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description: "Snel en zeer voordelig",
    provider: "deepseek",
    contextWindow: 128_000,
    efforts: [LOW, HIGH],
    defaultEffort: "low",
  },
];

/** Answers and saved choices from before providers name the Gemini model bare. */
export const canonicalModel = (id: unknown) => (typeof id === "string" && id && !id.includes(":") ? `google:${id}` : id);

/** "Gemini 3.8 Flash · Hoog · 34 s" for under an answer; only the parts the metadata has. */
export function answerLabel({ model, effort, startedAt, finishedAt }: AnswerMeta) {
  const id = canonicalModel(model);
  const m = MODELS.find((x) => x.id === id);
  const seconds = startedAt != null && finishedAt != null ? Math.max(1, Math.round((finishedAt - startedAt) / 1000)) : null;
  return [
    m?.name ?? model?.replace(/^[a-z]+:/, ""),
    [MINIMAL, LOW, MEDIUM, HIGH].find((e) => e.id === effort)?.label,
    seconds == null ? null : seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`,
  ].filter(Boolean).join(" · ");
}

/**
 * A model from `models` and a level it accepts, whatever came in (a request body, an old saved choice). Null only
 * when no model is configured at all.
 */
export function pickModel(model?: unknown, effort?: unknown, models: ModelOption[] = MODELS): ModelSelection | null {
  const id = canonicalModel(model);
  const m = models.find((x) => x.id === id) ?? models[0];
  if (!m) return null;
  return { model: m.id, effort: m.efforts.find((x) => x.id === effort)?.id ?? m.defaultEffort };
}
