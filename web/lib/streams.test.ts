import assert from "node:assert/strict";
import { test } from "node:test";
import { record, replay, startAnswer, stopAnswer } from "./streams.ts";

test("generation continues after a phone disconnect and the entire answer can be replayed", async () => {
  const a = startAnswer("phone-disconnect", "alice");
  let source!: ReadableStreamDefaultController<string>;
  const recording = record("phone-disconnect", a, new ReadableStream({ start(c) { source = c; } }));
  const reader = replay("phone-disconnect", "alice")!.getReader();
  assert.match((await reader.read()).value!, /stream-open/);
  source.enqueue("data: first\n\n");
  assert.equal((await reader.read()).value, "data: first\n\n");
  await reader.cancel();
  assert.equal(a.stop.signal.aborted, false);
  assert.equal(a.waiting.size, 0);
  source.enqueue("data: finished-after-lock\n\n");
  source.close(); await recording;
  const resumed = await new Response(replay("phone-disconnect", "alice")!.pipeThrough(new TextEncoderStream())).text();
  assert.match(resumed, /first/);
  assert.match(resumed, /finished-after-lock/);
  stopAnswer("phone-disconnect", "alice");
});

test("reconnect streams send heartbeats during long tool calls and clean up disconnected readers", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const a = startAnswer("heartbeat", "alice");
  const reader = replay("heartbeat", "alice")!.getReader();
  try {
    await reader.read();
    const pending = reader.read();
    t.mock.timers.tick(15_000);
    assert.equal((await pending).value, ": keep-alive\n\n");
    await reader.cancel();
    assert.equal(a.waiting.size, 0);
    assert.equal(a.stop.signal.aborted, false);
  } finally { stopAnswer("heartbeat", "alice"); t.mock.timers.reset(); }
});

test("the SDK persistence callbacks finish after the HTTP reader disconnects", async () => {
  const { streamText, toUIMessageStream, createUIMessageStreamResponse } = await import("ai");
  const { MockLanguageModelV4 } = await import("ai/test");
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => { finish = resolve; });
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ async start(c) {
    c.enqueue({ type: "stream-start", warnings: [] });
    await wait;
    c.enqueue({ type: "text-start", id: "text" });
    c.enqueue({ type: "text-delta", id: "text", delta: "Antwoord na vergrendeling" });
    c.enqueue({ type: "text-end", id: "text" });
    c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 },
    } });
    c.close();
  } }) }) });
  const a = startAnswer("sdk-disconnect", "alice");
  const saved: string[] = [];
  const result = streamText({ model, prompt: "Test", abortSignal: a.stop.signal });
  const response = createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream,
      onStepEnd: ({ messages }) => { saved.push(`checkpoint:${messages.at(-1)?.parts.filter((p) => p.type === "text").map((p) => p.text).join("")}`); },
      onEnd: ({ messages }) => { saved.push(`final:${messages.at(-1)?.parts.filter((p) => p.type === "text").map((p) => p.text).join("")}`); finish(); },
    }),
    keepAliveMs: 15_000,
    consumeSseStream: ({ stream }) => record("sdk-disconnect", a, stream),
  });
  const reader = response.body!.getReader();
  await reader.read();
  // tee cancellation waits for both branches, so do not await it before releasing the provider.
  const disconnected = reader.cancel();
  release();
  await completed;
  await disconnected;
  assert.deepEqual(saved, ["checkpoint:Antwoord na vergrendeling", "final:Antwoord na vergrendeling"]);
  assert.equal(a.stop.signal.aborted, false);
  stopAnswer("sdk-disconnect", "alice");
});
