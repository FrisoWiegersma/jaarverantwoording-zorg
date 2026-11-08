import { getToolName, isToolUIPart, type UIMessage } from "ai";

export const RESEARCH_STEPS = 24;
export const MAX_STEPS = RESEARCH_STEPS + 3;

/** Failed calls must remain in the loop so the model can correct their input. */
export function finishWhenPresented({ steps }: { steps: ReadonlyArray<{ toolResults: ReadonlyArray<{ toolName: string }> }> }) {
  return steps.at(-1)?.toolResults.some((result) => result.toolName === "present_answer") ?? false;
}

export function finalAnswerStep(stepNumber: number, instructions: string) {
  if (stepNumber < RESEARCH_STEPS) return {};
  const plainTextFallback = stepNumber === MAX_STEPS - 1;
  return {
    activeTools: plainTextFallback ? [] : ["present_answer"] as ["present_answer"],
    toolChoice: plainTextFallback ? "none" as const : { type: "tool" as const, toolName: "present_answer" as const },
    instructions: instructions + "\nHet onderzoeksbudget is bereikt. Zoek niets meer op. Geef nu een antwoord met wat je al hebt gevonden; benoem expliciet wat nog ontbreekt. " +
      (plainTextFallback
        ? "De presentatie is niet gelukt. Geef je antwoord nu in gewone tekst met bronlinks."
        : "Gebruik present_answer voor cijfers, met maximaal 200 rijen en een samenvatting van maximaal 60.000 tekens. Herstel een eventuele validatiefout en probeer de presentatie opnieuw."),
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
