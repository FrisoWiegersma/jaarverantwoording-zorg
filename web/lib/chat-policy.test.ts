import assert from "node:assert/strict";
import { test } from "node:test";
import { generateText, isStepCount, tool, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { finalAnswerStep, finishWhenPresented, MAX_STEPS, missingAnswer, outOfBudget, progressTitle, RESEARCH_STEPS, RESEARCH_TOKENS, researchEnd } from "./chat-policy.ts";
import { presentAnswer, richAnswerSchema } from "./rich-answer.ts";

const answer = { summary: "Bronnen gecontroleerd. ".repeat(1000), view: "table" as const,
  figures: [{ organization: "Testzorg", label: "Omzet", year: 2025, amount: "1.000", unit: "€", href: "/bron/2025/1/1", quote: "Omzet 1.000" }] };
const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
const finishReason = { unified: "tool-calls" as const, raw: undefined };
const tools = {
  lookup: tool({ inputSchema: z.object({}), execute: async () => ({ found: true }) }),
  present_answer: tool({ inputSchema: richAnswerSchema, execute: async (input) => presentAnswer(input) }),
};

test("long reports retain validation and support the summaries that failed in production", () => {
  assert.ok(answer.summary.length > 21283);
  assert.equal(presentAnswer(answer).summary, answer.summary);
  assert.equal(richAnswerSchema.safeParse({ ...answer, summary: "x".repeat(60001) }).success, false);
  assert.equal(richAnswerSchema.safeParse({ ...answer, summary: "test" }).success, false, "a placeholder is not an answer");
  assert.equal(richAnswerSchema.safeParse({ ...answer, figures: [{ ...answer.figures[0], year: 2014 }] }).success, true, "Open DIS starts in 2014");
  assert.equal(richAnswerSchema.safeParse({ ...answer, figures: [{ ...answer.figures[0], amount: "NaN" }] }).success, false);
});

test("a failed presentation is corrected instead of stopping the tool loop", async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "tool-call", toolCallId: `present-${calls}`, toolName: "present_answer",
      input: JSON.stringify(calls++ === 0 ? { ...answer, summary: "x".repeat(60001) } : answer) }],
    finishReason, usage, warnings: [],
  }) });
  const result = await generateText({ model, tools, prompt: "Presenteer de gevonden cijfers", stopWhen: [isStepCount(MAX_STEPS), finishWhenPresented] });
  assert.equal(calls, 2);
  assert.equal(result.steps[0].toolResults.length, 0);
  assert.equal(finishWhenPresented(result), true);
});

test("large research requests get a final answer after their bounded research budget", async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async (options) => {
    const toolName = calls < RESEARCH_STEPS ? "lookup" : "present_answer";
    if (calls >= RESEARCH_STEPS) {
      assert.deepEqual(options.tools?.map((t) => "name" in t ? t.name : ""), ["present_answer"]);
      assert.match(String(options.prompt[0].content), /benoem expliciet wat nog ontbreekt/);
    }
    return { content: [{ type: "tool-call", toolCallId: `call-${calls++}`, toolName, input: JSON.stringify(toolName === "lookup" ? {} : answer) }], finishReason, usage, warnings: [] };
  } });
  const result = await generateText({ model, tools, prompt: "Vergelijk veel organisaties", instructions: "Citeer je bronnen.",
    prepareStep: ({ stepNumber }) => finalAnswerStep(stepNumber, "Citeer je bronnen."), stopWhen: [isStepCount(MAX_STEPS), finishWhenPresented] });
  assert.equal(calls, RESEARCH_STEPS + 1);
  assert.equal(finishWhenPresented(result), true);
});

test("tool-only or failed turns get an explicit explanation, completed answers do not", () => {
  const blank: UIMessage = { id: "a", role: "assistant", parts: [{ type: "step-start" }] };
  assert.ok(missingAnswer({ ...blank, parts: [{ type: "text", text: "Ik ga dit onderzoeken." }, { type: "step-start" }] }));
  assert.match(missingAnswer(blank)!, /gevonden bronnen zijn bewaard/);
  assert.equal(missingAnswer({ ...blank, parts: [{ type: "text", text: "Een antwoord met bronnen." }] }), null);
  assert.equal(missingAnswer({ ...blank, parts: [{ type: "tool-present_answer", toolCallId: "p", state: "output-available", input: answer, output: presentAnswer(answer) }] }), null);
  assert.ok(missingAnswer({ ...blank, parts: [{ type: "tool-present_answer", toolCallId: "p", state: "output-error", input: {}, errorText: "Ongeldige samenvatting" }] }));
});


test("the budget transition forces presentation, with a final text fallback", () => {
  assert.equal(finalAnswerStep(RESEARCH_STEPS, "Onderzoek").toolChoice, "auto");
  assert.deepEqual(finalAnswerStep(RESEARCH_STEPS, "Onderzoek").activeTools, ["present_answer"]);
  const fallback = finalAnswerStep(MAX_STEPS - 1, "Onderzoek");
  assert.equal(fallback.toolChoice, "none");
  assert.deepEqual(fallback.activeTools, []);
  assert.match(fallback.instructions!, /gewone tekst met bronlinks/);
});

test("a recoverable tool error does not label a running or completed answer as stopped", () => {
  const failed = { label: "PDF lezen", status: "error" };
  assert.equal(progressTitle([failed, { label: "Antwoord schrijven", status: "running" }], false), "Antwoord schrijven");
  assert.equal(progressTitle([failed, { label: "Cijfers klaargezet", status: "done" }], true), "Antwoord klaar · 1 stap mislukt");
  assert.equal(progressTitle([failed], false), "Gestopt bij: PDF lezen");
  assert.equal(progressTitle([{ label: "Cijfers klaargezet", status: "done" }], true, "4m 36s"), "Nagezocht in 4m 36s");
});

test("the token budget ends research early, and the final steps count from there", () => {
  const steps = (...input: number[]) => input.map((inputTokens) => ({ usage: { inputTokens } }));
  assert.equal(researchEnd(steps(1000, 2000)), RESEARCH_STEPS);
  const over = steps(RESEARCH_TOKENS / 2, RESEARCH_TOKENS / 2, 10);
  assert.equal(researchEnd(over), 2);
  assert.equal(finalAnswerStep(1, "Onderzoek", over.slice(0, 1)).toolChoice, undefined);
  assert.equal(finalAnswerStep(2, "Onderzoek", over.slice(0, 2)).toolChoice, "auto");
  assert.equal(finalAnswerStep(4, "Onderzoek", [...over, ...steps(10)]).toolChoice, "none");
  assert.equal(outOfBudget({ steps: over }), false);
  assert.equal(outOfBudget({ steps: [...over, ...steps(10, 10)] }), true);
  assert.equal(researchEnd(steps(undefined as unknown as number)), RESEARCH_STEPS);  // a provider without usage: steps only
});
