import assert from "node:assert/strict";
import { test } from "node:test";
import { mutationAllowed, projectApi } from "./project-server.ts";
import { record, replay, startAnswer, stopAnswer } from "./streams.ts";
import { entryFiles, projectFileMention, mentionedProjectFiles, projectRequest, type ProjectDocument } from "./projects.ts";

test("project mutations reject cross-site requests", () => {
  const before = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://zorg.example";
  try {
    assert.equal(mutationAllowed(new Request("https://zorg.example/api/chat", { headers: { origin: "https://evil.test" } })), false);
    assert.equal(mutationAllowed(new Request("https://zorg.example/api/chat", { headers: { origin: "https://zorg.example" } })), true);
    assert.equal(mutationAllowed(new Request("https://zorg.example/api/chat", { headers: { "sec-fetch-site": "cross-site" } })), false);
  } finally { if (before === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = before; }
});

test("quoted file mentions preserve spaces and resolve only within the active project", () => {
  const file: ProjectDocument = { id: "one", filename: "Presentation 2021.pptx", kind: "pptx", status: "ready", pages: 5, processed: 5, archived: 0, error: "" };
  const text = `Maak met @canva een presentatie in de stijl van ${projectFileMention(file)}`;
  assert.equal(projectFileMention(file), '@"Presentation 2021.pptx"');
  assert.deepEqual(mentionedProjectFiles(text, [file]), [file]);
  assert.deepEqual(mentionedProjectFiles(text, [{ ...file, archived: 1 }]), []);
  assert.deepEqual(mentionedProjectFiles(text, [{ ...file, filename: "Other.pptx" }]), []);
});

test("uploads have a timeout and report size limits instead of generic proxy failures", async () => {
  const original = globalThis.fetch;
  const upload = new FormData();
  upload.set("file", new Blob(["test"]), "test.pptx");
  try {
    globalThis.fetch = async (_url, init) => {
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init?.body, upload);
      return new Response("", { status: 413 });
    };
    await assert.rejects(projectRequest("/p/documents", "POST", upload), /25 MB/);
    globalThis.fetch = async () => { throw new DOMException("timeout", "TimeoutError"); };
    await assert.rejects(projectRequest("/p/documents", "POST", upload), /Controleer bij Bronnen/);
  } finally { globalThis.fetch = original; }
});

test("project requests require identity and forward it to the private API", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("cf-access-authenticated-user-email"), "alice@example.test");
    assert.equal(init?.cache, "no-store");
    return Response.json({ detail: "Privémateriaal naar het AI-model is uitgeschakeld" }, { status: 403 });
  };
  try {
    await assert.rejects(projectApi(new Request("https://zorg.example"), "/projects/a"), /Meld je aan/);
    assert.equal(calls, 0);
    await assert.rejects(projectApi(new Request("https://zorg.example", { headers: { "cf-access-authenticated-user-email": "alice@example.test" } }), "/projects/a/model-context"), /uitgeschakeld/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("streams with the same chat ID stay isolated by owner", async () => {
  const a = startAnswer("same-id", "alice");
  const b = startAnswer("same-id", "bob");
  assert.equal(a.stop.signal.aborted, false);
  await record("same-id", a, new ReadableStream({ start(c) { c.enqueue("data: private-alice\n\n"); c.close(); } }));
  assert.equal(replay("same-id", "stranger"), null);
  const stream = replay("same-id", "alice")!;
  const reader = stream.getReader();
  await reader.read(); // reconnect keepalive comment
  assert.equal((await reader.read()).value, "data: private-alice\n\n");
  await reader.cancel();
  stopAnswer("same-id", "alice");
  assert.equal(b.stop.signal.aborted, false);
  const bobStream = replay("same-id", "bob");
  assert.notEqual(bobStream, null);
  await bobStream!.cancel();
  stopAnswer("same-id", "bob");
});

test("dropped folders yield every nested file, across readEntries batches", async () => {
  const file = (name: string) => ({ isFile: true, file: (ok: (f: File) => void) => ok(new File(["x"], name)) });
  const folder = (children: object[]) => ({ isFile: false, createReader: () => {
    const batches = [children.slice(0, 100), children.slice(100), []]; // the browser hands back at most 100 per call
    return { readEntries: (ok: (e: object[]) => void) => ok(batches.shift() || []) };
  } });
  const many = Array.from({ length: 150 }, (_, i) => file(`${i}.pdf`));
  const tree = folder([file("a.pdf"), folder([file("b.md"), folder([])]), ...many]);
  const names = (await entryFiles(tree as unknown as FileSystemEntry)).map((f) => f.name);
  assert.equal(names.length, 152);
  assert.deepEqual(names.slice(0, 2), ["a.pdf", "b.md"]);
  assert.deepEqual(await entryFiles(null), []);
});
