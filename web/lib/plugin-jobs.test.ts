import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForPluginJob } from "./plugin-jobs.ts";

test("a JSON-text Canva job completes inside one tool invocation", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await waitForPluginJob("get-create-design-async-job", async () => ({
    content: [{ type: "text", text: JSON.stringify({ job: { status: ++calls < 4 ? "in_progress" : "success", id: "existing-job" } }) }],
  }), { sleep: async (delay) => { delays.push(delay); } });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [2000, 4000, 8000]);
  assert.match(result.content[0].text, /success/);
});

test("creation, failed jobs and unknown responses are never retried", async () => {
  for (const [name, result] of [
    ["create-design", { status: "in_progress" }],
    ["get-create-design-async-job", { structuredContent: { job: { status: "failed" } } }],
    ["get-create-design-async-job", { text: "Please contact support" }],
    ["get-create-design-async-job", { isError: true, content: [{ text: '{"status":"pending"}' }] }],
  ] as const) {
    let calls = 0;
    assert.equal(await waitForPluginJob(name, async () => { calls++; return result; }), result);
    assert.equal(calls, 1);
  }
});

test("pending jobs have a bounded wait and keep their latest job status", async () => {
  let time = 0;
  let calls = 0;
  const result = await waitForPluginJob("get-create-design-async-job", async () => {
    calls++;
    return { structuredContent: { job: { id: "job-1", status: "in_progress" } } };
  }, { now: () => time, timeoutMs: 10_000, sleep: async (delay) => { time += delay; } });
  assert.equal(calls, 3);
  assert.equal(time, 6000);
  assert.equal(result.structuredContent.job.id, "job-1");
});

test("Stop cancels polling without another remote call", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(waitForPluginJob("get-create-design-async-job", async () => {
    calls++;
    return { status: "pending" };
  }, { signal: controller.signal, sleep: async () => { controller.abort(); } }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("Canva polling obeys server wait times and rotates continuation tokens", async () => {
  const tokens: (string | undefined)[] = [];
  const delays: number[] = [];
  const result = await waitForPluginJob("get-create-design-async-job", async (token) => {
    tokens.push(token);
    return { content: [{ type: "text", text: JSON.stringify(tokens.length < 3 ? {
      job_id: "same-job", status: tokens.length === 1 ? "polled_too_early" : "in_progress",
      continuation_token: `token-${tokens.length}`,
      polling_policy: { wait_seconds: tokens.length === 1 ? 30 : 5 },
    } : { job_id: "same-job", status: "completed", design: { url: "https://www.canva.com/design/test/view" } }) }] };
  }, { sleep: async (delay) => { delays.push(delay); } });
  assert.deepEqual(tokens, [undefined, "token-1", "token-2"]);
  assert.deepEqual(delays, [30_000, 5000]);
  assert.match(result.content[0].text, /completed/);
});

test("a server wait longer than the remaining budget is never shortened", async () => {
  let slept = false;
  const pending = { status: "in_progress", continuation_token: "latest", polling_policy: { wait_seconds: 180 } };
  assert.equal(await waitForPluginJob("get-create-design-async-job", async () => pending, {
    timeoutMs: 1000, sleep: async () => { slept = true; },
  }), pending);
  assert.equal(slept, false);
});

test("Presenton waits on its existing task without repeating creation", async () => {
  let calls = 0;
  const result = await waitForPluginJob("get_presentation_async_job", async () => ({
    presentation_id: "same-id", status: ++calls < 3 ? "pending" : "completed",
  }), { sleep: async () => {} });
  assert.equal(calls, 3);
  assert.equal(result.presentation_id, "same-id");
  assert.equal(result.status, "completed");
});
