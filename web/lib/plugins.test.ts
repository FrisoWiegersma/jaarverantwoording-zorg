import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPluginPollDelay,
  extractPluginArtifacts,
  extractPluginMentions,
  findActiveMention,
  mcpToolKey,
  mergePluginArtifacts,
  parseMcpToolKey,
  toEmbedUrl,
} from "./plugins.ts";

test("extractPluginMentions finds @plugin handles without matching email addresses", () => {
  assert.deepEqual(
    extractPluginMentions("@canva maak een slide deck voor info@canva.com en gebruik @notion voor notities"),
    ["canva", "notion"]
  );
  assert.deepEqual(
    extractPluginMentions("Gebruik @Canva en @onbekend", ["canva", "linear"]),
    ["canva"]
  );
});

test("Canva short links and PPTX exports merge with design metadata into one preview", () => {
  const id = "DAHa_ukysAE";
  const job = extractPluginArtifacts("poll", "mcp__canva__get-create-design-async-job", {
    plugin_name: "Canva", content: [{ text: JSON.stringify({ status: "completed", design: { id, url: "https://canva.link/example" } }) }],
  });
  const file = extractPluginArtifacts("export", "mcp__canva__export-design", {
    plugin_name: "Canva", text: JSON.stringify({ job: { status: "success", urls: [`https://export-download.canva.com/key/${id}/file.pptx?signature=example`] } }),
  });
  const metadata = extractPluginArtifacts("meta", "mcp__canva__get-design", {
    plugin_name: "Canva", text: JSON.stringify({ design: { id, title: "LUMC omzet 2025", thumbnail: { url: "https://media.canva.com/preview?id=1" }, urls: { view_url: "https://www.canva.com/d/view", edit_url: "https://www.canva.com/d/edit" } } }),
  });
  const merged = mergePluginArtifacts([...job, ...file, ...metadata]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "LUMC omzet 2025");
  assert.equal(merged[0].embedUrl, `https://www.canva.com/design/${id}/view?embed`);
  assert.equal(merged[0].thumbnailUrl, "https://media.canva.com/preview?id=1");
  assert.match(merged[0].downloadUrl!, /file\.pptx\?signature=example$/);
  assert.equal(merged[0].format, "pptx");
});

test("distinct Canva designs remain separate", () => {
  const files = ["DAHa_ukysAE", "DABCDEFGHIJ"].flatMap((id) => extractPluginArtifacts(id, "mcp__canva__export-design", {
    text: JSON.stringify({ job: { urls: [`https://export-download.canva.com/key/${id}/file.pdf`] } }),
  }));
  assert.equal(mergePluginArtifacts(files).length, 2);
  assert.equal(files[0].format, "pdf");
});

test("findActiveMention locates the @token at the caret", () => {
  assert.deepEqual(findActiveMention("@can", 4), { query: "can", start: 0, end: 4 });
  assert.deepEqual(findActiveMention("Maak met @can een deck", 13), { query: "can", start: 9, end: 13 });
  assert.equal(findActiveMention("mail@canva.com", 8), null);
  assert.deepEqual(findActiveMention('@"Presentation 20', 17), { query: "presentation 20", start: 0, end: 17 });
  assert.equal(findActiveMention('@"Presentation 2021.pptx" ', 25), null);
});

test("mcpToolKey and parseMcpToolKey round-trip within provider limits", () => {
  const key = mcpToolKey("canva", "create_presentation");
  assert.equal(key, "mcp__canva__create_presentation");
  assert.ok(key.length <= 64);
  assert.deepEqual(parseMcpToolKey(key), { handle: "canva", tool: "create_presentation" });
  assert.equal(parseMcpToolKey("get_figures"), null);
});

test("async job checks back off independently without delaying design creation", () => {
  const delay = createPluginPollDelay();
  const poll = () => delay("canva", "get-create-design-async-job", { job_id: "job-1" });
  assert.deepEqual(Array.from({ length: 7 }, poll), [0, 1000, 2000, 4000, 8000, 8000, 8000]);
  assert.equal(delay("canva", "get-create-design-async-job", { job_id: "job-2" }), 0);
  assert.equal(delay("other", "get-create-design-async-job", { job_id: "job-1" }), 0);
  assert.equal(delay("canva", "create-design", {}), 0);
  assert.equal(delay("canva", "create-design", {}), 0);
  assert.equal(createPluginPollDelay()("canva", "get-create-design-async-job", { job_id: "job-1" }), 0);
});

test("extractPluginArtifacts parses Canva and Figma URLs and generates embed URLs", () => {
  assert.equal(toEmbedUrl("https://www.canva.com/design/DAG123/view"), "https://www.canva.com/design/DAG123/view?embed");
  assert.equal(toEmbedUrl("https://www.canva.com/design/DAG123/edit"), "https://www.canva.com/design/DAG123/view?embed");
  assert.equal(
    toEmbedUrl("https://www.figma.com/design/ABC123/My-Deck"),
    "https://www.figma.com/embed?embed_host=mcp&url=https%3A%2F%2Fwww.figma.com%2Fdesign%2FABC123%2FMy-Deck"
  );

  const items = extractPluginArtifacts("call-1", "mcp__canva__create_design", {
    plugin: "canva",
    plugin_name: "Canva",
    text: "Presentatie gemaakt: [Kerncijfers 2024](https://www.canva.com/design/DAG999/view)",
    structuredContent: {
      thumbnail_url: "https://canva-static.com/thumb/123.png",
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Kerncijfers 2024");
  assert.equal(items[0].embedUrl, "https://www.canva.com/design/DAG999/view?embed");
  assert.equal(items[0].thumbnailUrl, "https://canva-static.com/thumb/123.png");
});

test("Presenton uses one private artifact for preview and PPTX, rejecting foreign URLs", () => {
  const root = `/digimv/presentations/${"a".repeat(32)}`;
  const artifact = { id: "presenton:a", plugin: "presenton", pluginName: "Presenton", tool: "get_presentation", title: "Example",
    url: `${root}/file.pdf`, embedUrl: null, downloadUrl: `${root}/file.pptx`, pages: [{ number: 1, url: `${root}/pages/1?v=abc` }], thumbnailUrl: `${root}/pages/1?v=abc`, designId: "a".repeat(32), revision: "abc" };
  const status = extractPluginArtifacts("status", "mcp__presenton__get_presentation_async_job", { artifact });
  const edit = extractPluginArtifacts("edit", "mcp__presenton__edit_slide", { artifact: { ...artifact, title: "Edited", revision: "def" } });
  const merged = mergePluginArtifacts([...status, ...edit]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "Edited");
  assert.equal(merged[0].revision, "def");
  assert.equal(merged[0].pages?.length, 1);
  assert.equal(merged[0].downloadUrl, `${root}/file.pptx`);
  assert.deepEqual(extractPluginArtifacts("bad", "mcp__presenton__get_presentation", { artifact: { ...artifact, url: "https://evil.test/file.pdf" } }), []);
});
