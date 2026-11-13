import assert from "node:assert/strict";
import test from "node:test";
import { canonicalModel, pickModel } from "./models.ts";
import { availableModels, providerOptions } from "./providers.ts";

const ids = (env: Record<string, string>) => availableModels(env).map((m) => m.id);

test("a provider is on when its key is set", () => {
  assert.deepEqual(ids({}), []);
  assert.ok(ids({ GEMINI_API_KEY: "k" }).every((id) => id.startsWith("google:")));
  assert.ok(ids({ ANTHROPIC_API_KEY: "k" }).includes("anthropic:claude-sonnet-5-5"));
  assert.deepEqual(ids({ DEEPSEEK_API_KEY: "k" }), ["deepseek:deepseek-v4-pro", "deepseek:deepseek-v4-flash"]);
  assert.deepEqual(ids({ OPENAI_API_KEY: "k" }), ["openai:gpt-6.1-sol", "openai:gpt-6.1-terra", "openai:gpt-6-astra"]);
  assert.deepEqual(ids({ OPENAI_API_KEY: "k", OPENAI_MODELS: "gpt-a, gpt-b" }), ["openai:gpt-a", "openai:gpt-b"]);
  assert.deepEqual(ids({ OPENAI_COMPATIBLE_BASE_URL: "http://localhost:11434/v1", OPENAI_COMPATIBLE_MODELS: "qwen3:32b" }), ["compatible:qwen3:32b"]);
});

test("the chat only accepts a configured model, and old bare Gemini ids still resolve", () => {
  const models = availableModels({ ANTHROPIC_API_KEY: "k" });
  assert.equal(pickModel("google:gemini-3.8-flash", "high", models)?.model, "anthropic:claude-sonnet-5-5");
  assert.equal(pickModel("compatible:qwen3:32b", "high", availableModels({ OPENAI_COMPATIBLE_BASE_URL: "x", OPENAI_COMPATIBLE_MODELS: "qwen3:32b" }))?.model, "compatible:qwen3:32b");
  assert.equal(pickModel(undefined, undefined, []), null);
  assert.equal(canonicalModel("gemini-3.8-flash"), "google:gemini-3.8-flash");
  assert.equal(pickModel("gemini-3.8-flash", "low")?.model, "google:gemini-3.8-flash");
});

test("each provider gets the thinking level its own way", () => {
  assert.deepEqual(providerOptions({ model: "google:gemini-3.8-flash", effort: "high" }), { google: { thinkingConfig: { thinkingLevel: "high" } } });
  const claude = providerOptions({ model: "anthropic:claude-opus-5-5", effort: "minimal" }).anthropic;
  assert.equal(claude.effort, "low");
  assert.notDeepEqual(claude.thinking, { type: "disabled" }, "Opus 5.5 refuses thinking turned off");
  assert.deepEqual(providerOptions({ model: "openai:gpt-6.1-sol", effort: "medium" }), { openai: { reasoningEffort: "medium" } });
  assert.deepEqual(providerOptions({ model: "deepseek:deepseek-v4-pro", effort: "high" }), { deepseek: { reasoningEffort: "high" } });
  assert.deepEqual(providerOptions({ model: "compatible:qwen3:32b", effort: "medium" }), {});
});
