import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const file = join(await mkdtemp(join(tmpdir(), "errorlog-")), "sub", "errors.jsonl");
process.env.ERROR_LOG = file;
const { errorEntry, logError } = await import("./error-log.ts");
const chat = { id: "c1", model: "gemini", effort: "high" };

test("a failed tool call is appended with its input; project tools keep input out; long text is cut", async () => {
  await logError(errorEntry(chat, 3, "list_links", { url: "https://x.nl/" }, new Error("robots.txt disallows")));
  await logError(errorEntry(chat, 4, "search_project_documents", { query: "geheim" }, new Error("Project niet beschikbaar")));
  await logError(errorEntry(chat, null, null, undefined, Object.assign(new Error("x".repeat(5000)), { statusCode: 429 })));
  const [a, b, c] = (await readFile(file, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(a.tool, "list_links");
  assert.equal(a.input, '{"url":"https://x.nl/"}');
  assert.equal(a.error, "Error: robots.txt disallows");
  assert.equal(b.input, undefined);
  assert.equal(c.status, 429);
  assert.ok(c.error.length < 2100);
});
