import assert from "node:assert/strict";
import { test } from "node:test";
import { MODELS, pickModel } from "./models.ts";

test("pickModel only lets through listed models and the levels they accept", () => {
  assert.deepEqual(pickModel("gemini-3.5-flash-lite", "minimal"), { model: "gemini-3.5-flash-lite", effort: "minimal" });
  // Flash refuses minimal: fall back to its own default rather than send a level the API rejects.
  assert.deepEqual(pickModel("gemini-3.8-flash", "minimal"), { model: "gemini-3.8-flash", effort: "high" });
  assert.deepEqual(pickModel("gpt-9", "high"), { model: MODELS[0].id, effort: MODELS[0].defaultEffort });
  assert.deepEqual(pickModel(), { model: MODELS[0].id, effort: MODELS[0].defaultEffort });
  for (const m of MODELS) assert.ok(m.efforts.some((e) => e.id === m.defaultEffort), m.id);
});
