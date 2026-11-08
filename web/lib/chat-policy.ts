import { getToolName, isToolUIPart, type UIMessage } from "ai";

export const RESEARCH_STEPS = 24;
export const MAX_STEPS = RESEARCH_STEPS + 3;

/** Failed calls must remain in the loop so the model can correct their input. */
export function finishWhenPresented({ steps }: { steps: ReadonlyArray<{ toolResults: ReadonlyArray<{ toolName: string }> }> }) {
  return steps.at(-1)?.toolResults.some((result) => result.toolName === "present_answer") ?? false;
}

export function finalAnswerStep(stepNumber: number, instructions: string) {
  if (stepNumber < RESEARCH_STEPS) return {};
  return {
    activeTools: ["present_answer"] as ["present_answer"],
    instructions: instructions + "\nHet onderzoeksbudget is bereikt. Zoek niets meer op. Geef nu een antwoord met wat je al hebt gevonden; benoem expliciet wat nog ontbreekt. Gebruik present_answer voor cijfers, met maximaal 200 rijen en een samenvatting van maximaal 60.000 tekens. Herstel een eventuele validatiefout en probeer de presentatie opnieuw. Je mag ook een kort antwoord in tekst met bronlinks geven als de presentatie niet lukt.",
  };
}

export function missingAnswer(message: UIMessage) {
  if (message.role !== "assistant") return null;
  const answered = message.parts.some((part) =>
    (part.type === "text" && part.text.trim()) ||
    (isToolUIPart(part) && getToolName(part) === "present_answer" && part.state === "output-available")
  );
  return answered ? null : "Het onderzoek is onderbroken voordat er een antwoord klaar was. De gevonden bronnen zijn bewaard. Vraag om verder te gaan met de al gevonden gegevens, of maak de vraag kleiner.";
}
