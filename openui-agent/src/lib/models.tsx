import type { ModelOption } from "@openuidev/react-ui";

export const DEFAULT_MODEL = "gemini-3.8-flash";

// Per-model { light, dark } logo pairs — the switcher swaps them by theme.
const logo = {
  google: {
    light: <img src="/logos/google-light.svg" alt="" />,
    dark: <img src="/logos/google-dark.svg" alt="" />,
  },
};

// The app's model menu: Gemini models on your own (paid) GEMINI_API_KEY.
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", group: "Google", logo: logo.google },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", group: "Google", logo: logo.google },
];

const MODEL_IDS = new Set(MODEL_OPTIONS.map((model) => model.id));

/** Absent → default; unknown → null (the route rejects it). */
export function resolveRequestedModel(model: unknown): string | null {
  if (model === undefined || model === null || model === "") return DEFAULT_MODEL;
  return typeof model === "string" && MODEL_IDS.has(model) ? model : null;
}
