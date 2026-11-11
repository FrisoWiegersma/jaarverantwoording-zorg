/** The chat models on offer. The picker shows these and the chat route accepts nothing else. */

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
  /** Thinking levels the model accepts, lowest first. */
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

const MINIMAL: EffortLevel = { id: "minimal", label: "Minimaal", hint: "Denkt bijna niet na. Voor één cijfer dat je snel wilt weten." };
const LOW: EffortLevel = { id: "low", label: "Laag", hint: "Denkt kort na. Snel, voor eenvoudige vragen." };
const MEDIUM: EffortLevel = { id: "medium", label: "Middel", hint: "Denkt eerst even na. Goed voor de meeste vragen." };
const HIGH: EffortLevel = { id: "high", label: "Hoog", hint: "Denkt grondig na. Trager, het best voor vergelijkingen." };

// Levels checked against the Gemini API on 2026-11-11: Flash and Pro refuse "minimal".
export const MODELS: ModelOption[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Snel en nauwkeurig, de standaard",
    efforts: [LOW, MEDIUM, HIGH],
    defaultEffort: "high",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    description: "Grondiger bij lastige vragen, wel trager",
    efforts: [LOW, MEDIUM, HIGH],
    defaultEffort: "high",
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    description: "Snelst, voor eenvoudige opzoekvragen",
    efforts: [MINIMAL, LOW, MEDIUM, HIGH],
    defaultEffort: "low",
  },
];

// ponytail: every listed model has a 1M-token window; make it per model when one doesn't.
export const CONTEXT_WINDOW = 1_048_576;

/** A listed model and a level it accepts, whatever came in (a request body, an old saved choice). */
export function pickModel(model?: unknown, effort?: unknown): ModelSelection {
  const m = MODELS.find((x) => x.id === model) ?? MODELS[0];
  return { model: m.id, effort: m.efforts.find((x) => x.id === effort)?.id ?? m.defaultEffort };
}
