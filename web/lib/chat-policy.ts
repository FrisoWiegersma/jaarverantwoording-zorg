import { getToolName, isToolUIPart, type UIMessage } from "ai";

export const RESEARCH_STEPS = 24;
/** The UI's text for a call to a tool that wasn't offered (Gemini still asks for one after research ended): never run, so not failed. */
export const SKIPPED = "Niet uitgevoerd: het onderzoek was al afgerond.";
export const MAX_STEPS = RESEARCH_STEPS + 3;
/** Input tokens over all steps, the cost of an answer: every step resends the conversation. With parallel tool calls a
 * step can read a lot, so research also ends here. ponytail: fixed; the dearest answers in the 2026-11-11 eval used
 * 0.3M (fte of 7 UMCs) and 1.5M (an open-ended 7-UMC search). Tune from the input field of chat.finish. */
export const RESEARCH_TOKENS = 600_000;

type Steps = ReadonlyArray<{ usage: { inputTokens: number | undefined } }>;

/** The step the final answer starts at: the step budget, or the step after the one that reached the token budget. */
export function researchEnd(steps: Steps) {
  let used = 0;
  for (const [i, step] of steps.entries()) {
    used += step.usage.inputTokens ?? 0;
    if (used >= RESEARCH_TOKENS) return Math.min(i + 1, RESEARCH_STEPS);
  }
  return RESEARCH_STEPS;
}

/** Two tries at present_answer, then one in plain text, counted from where research ended. */
export function outOfBudget({ steps }: { steps: Steps }) {
  return steps.length >= researchEnd(steps) + 3;
}

/** Failed calls must remain in the loop so the model can correct their input. */
export function finishWhenPresented({ steps }: { steps: ReadonlyArray<{ toolResults: ReadonlyArray<{ toolName: string }> }> }) {
  return steps.at(-1)?.toolResults.some((result) => result.toolName === "present_answer") ?? false;
}

export function finalAnswerStep(stepNumber: number, instructions: string, steps: Steps = []) {
  const end = researchEnd(steps);
  if (stepNumber < end) return {};
  const plainTextFallback = stepNumber >= end + 2;
  return {
    activeTools: plainTextFallback ? [] : ["present_answer"] as ["present_answer"],
    // Not forced: an answer without sourced figures would have to invent rows for present_answer.
    toolChoice: plainTextFallback ? "none" as const : "auto" as const,
    instructions: instructions + "\nHet onderzoeksbudget is bereikt. Zoek niets meer op. Geef nu een antwoord met wat je al hebt gevonden; benoem expliciet wat nog ontbreekt. " +
      (plainTextFallback
        ? "De presentatie is niet gelukt. Geef je antwoord nu in gewone tekst met bronlinks."
        : "Heb je drie of meer gevonden getallen met bronlink, gebruik dan present_answer (maximaal 200 rijen, samenvatting maximaal 60.000 tekens) en herstel een eventuele validatiefout; anders antwoord je in gewone tekst met bronlinks."),
  };
}

export function missingAnswer(message: UIMessage) {
  if (message.role !== "assistant") return null;
  const finalStep = Math.max(0, message.parts.findLastIndex((part) => part.type === "step-start"));
  const answered = message.parts.some((part) =>
    isToolUIPart(part) && getToolName(part) === "present_answer" && part.state === "output-available"
  ) || message.parts.slice(finalStep).some((part) => part.type === "text" && part.text.trim());
  return answered ? null : "Het onderzoek is onderbroken voordat er een antwoord klaar was. De gevonden bronnen zijn bewaard. Vraag om verder te gaan met de al gevonden gegevens, of maak de vraag kleiner.";
}


export function progressTitle(steps: ReadonlyArray<{ label: string; status: string }>, completed: boolean, elapsed?: string) {
  const running = steps.find((step) => step.status === "running");
  if (running) return running.label;
  const failures = steps.filter((step) => step.status === "error");
  if (completed && failures.length) return `Antwoord klaar · ${failures.length} ${failures.length === 1 ? "stap" : "stappen"} mislukt`;
  if (completed || (steps.length > 0 && !failures.length)) return elapsed ? `Nagezocht in ${elapsed}` : "Nagezocht";
  if (failures.length) return `Gestopt bij: ${failures[0].label}`;
  return "Aan de slag";
}
