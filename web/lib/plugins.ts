export type PluginTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type Plugin = {
  id: string;
  handle: string;
  name: string;
  description: string;
  url: string;
  transport: "auto" | "streamable_http" | "sse";
  has_token: boolean;
  header_keys: string[];
  tools: PluginTool[];
  enabled: boolean;
  updated: string;
  sync_error?: string;
  needs_oauth?: boolean;
  builtin?: boolean;
};

export type PluginPreset = {
  id: string;
  handle: string;
  name: string;
  description: string;
  url: string;
  transport: "auto" | "streamable_http" | "sse";
  source?: "verified" | "registry";
};

export async function pluginRequest(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/digimv/plugins${path}`, {
    method,
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.detail
        ? typeof data.detail === "string"
          ? data.detail
          : "Controleer de ingevulde velden."
        : "Plugin-aanvraag mislukt"
    );
  }
  return data;
}

/** Extract unique @handle mentions from a message. Only matches @tokens preceded by start-of-text or whitespace (never email addresses). */
export function extractPluginMentions(text: string, availableHandles?: Iterable<string>): string[] {
  const allowed = availableHandles ? new Set(Array.from(availableHandles, (h) => h.toLowerCase())) : null;
  const found: string[] = [];
  const re = /(?:^|[\s([{"'«“])@([a-z0-9][a-z0-9_-]{1,30})\b/gi;
  for (let m; (m = re.exec(text)) !== null; ) {
    const handle = m[1].toLowerCase();
    if ((!allowed || allowed.has(handle)) && !found.includes(handle)) {
      found.push(handle);
    }
  }
  return found;
}

/** Detect an @mention token currently being typed at the caret position so the inline Kokonut UI autocomplete can open. */
export function findActiveMention(
  text: string,
  caret: number
): { query: string; start: number; end: number } | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const quoted = /(?:^|\s)@"([^"\n]{0,200})$/i.exec(before);
  if (quoted) {
    const start = caret - quoted[1].length - 2;
    const tail = /^[^"\n]*(?:")?/.exec(text.slice(caret))?.[0] ?? "";
    return { query: quoted[1].toLowerCase(), start, end: caret + tail.length };
  }
  const match = /(?:^|[\s([{"'«“])@([a-z0-9_.-]{0,120})$/i.exec(before);
  if (!match) return null;
  const query = match[1].toLowerCase();
  const start = caret - query.length - 1; // index of '@'
  const after = text.slice(caret);
  const tail = /^[a-z0-9_.-]*/i.exec(after)?.[0] ?? "";
  return { query, start, end: caret + tail.length };
}

/** Namespace an MCP tool as mcp__<handle>__<tool> (safe for OpenAI, Anthropic, Gemini tool name limits). */
export function mcpToolKey(handle: string, toolName: string): string {
  const safeHandle = handle.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 20);
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 37);
  return `mcp__${safeHandle}__${safeTool}`;
}

export function parseMcpToolKey(key: string): { handle: string; tool: string } | null {
  const match = /^mcp__([a-z0-9][a-z0-9_-]{1,20})__([a-zA-Z0-9_-]{1,40})$/.exec(key);
  if (!match) return null;
  return { handle: match[1], tool: match[2] };
}

export type PluginArtifact = {
  id: string;
  plugin: string;
  pluginName: string;
  tool: string;
  title: string;
  url: string;
  embedUrl: string | null;
  thumbnailUrl?: string;
  designId?: string;
  downloadUrl?: string;
  format?: string;
  revision?: string;
  pages?: { url: string; number: number }[];
};

/** Turn a public Canva, Figma or Google Slides/Docs link into an embeddable view URL when supported. */
export function toEmbedUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "canva.com" && u.pathname.startsWith("/design/")) {
      const base = `${u.origin}${u.pathname.replace(/\/(edit|view)\/?$/, "")}/view`;
      return `${base}?embed`;
    }
    if (host === "figma.com" && /^\/(file|design|proto|board)\//.test(u.pathname)) {
      return `https://www.figma.com/embed?embed_host=mcp&url=${encodeURIComponent(rawUrl)}`;
    }
    if (host === "docs.google.com" && /^\/presentation\/d\/[^/]+/.test(u.pathname)) {
      const m = /^(\/presentation\/d\/[^/]+)/.exec(u.pathname);
      if (m) return `${u.origin}${m[1]}/embed`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Decode MCP JSON text blocks before inspecting URLs; never treat JSON fragments as links. */
export function pluginObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 10 || value == null) return [];
  if (typeof value === "string") {
    try { return pluginObjects(JSON.parse(value), depth + 1); } catch { return []; }
  }
  if (Array.isArray(value)) return value.flatMap((item) => pluginObjects(item, depth + 1));
  if (typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  return [obj, ...Object.values(obj).flatMap((item) => pluginObjects(item, depth + 1))];
}

export function mergePluginArtifacts(items: PluginArtifact[]): PluginArtifact[] {
  const merged = new Map<string, PluginArtifact>();
  for (const item of items) {
    const key = `${item.plugin}:${item.designId ?? item.url}`;
    const old = merged.get(key);
    if (!old) { merged.set(key, item); continue; }
    merged.set(key, {
      ...old,
      title: item.title.endsWith("-ontwerp") ? old.title : item.title,
      url: old.embedUrl ? old.url : item.url,
      embedUrl: old.embedUrl || item.embedUrl,
      thumbnailUrl: item.thumbnailUrl || old.thumbnailUrl,
      downloadUrl: item.downloadUrl || old.downloadUrl,
      format: item.format || old.format,
      revision: item.revision || old.revision,
      pages: item.pages || old.pages,
    });
  }
  return Array.from(merged.values());
}

const NON_DELIVERABLE_TOOLS =
  /^(?:search|list|find|browse|start[-_]editing|perform[-_]editing|cancel[-_]editing|copy[-_]design|move[-_]item|create[-_]folder|create[-_]comment|reply[-_]to[-_]comment|resolve[-_]comment|upload[-_]asset|get[-_]upload[-_]asset|get[-_](?:assets|brand|export[-_]formats|design[-_](?:pages|content|thumbnail|thumbnails)|presenter[-_]notes|slide))(?:$|[-_])/i;

function canvaDesignId(o: Record<string, unknown>): string | undefined {
  if (typeof o.id === "string" && /^D[\w-]{10}$/.test(o.id)) return o.id;
  if (typeof o.design_id === "string" && /^D[\w-]{10}$/.test(o.design_id)) return o.design_id;
  return undefined;
}

/** Design IDs connect Canva short links, metadata and exported files into one deliverable. */
export function extractPluginArtifacts(toolCallId: string, toolName: string, output: unknown): PluginArtifact[] {
  const mcp = parseMcpToolKey(toolName);
  if (!mcp || NON_DELIVERABLE_TOOLS.test(mcp.tool) || !output || typeof output !== "object") return [];
  const rec = output as Record<string, unknown>;
  const pluginName = typeof rec.plugin_name === "string" ? rec.plugin_name : mcp.handle;
  const objects = pluginObjects(output);
  if (mcp.handle === "presenton") {
    const a = rec.artifact as PluginArtifact | undefined;
    const safe = (u: unknown): u is string => typeof u === "string" && /^\/digimv\/presentations\/[a-f0-9]{32}\/(?:file\.(?:pdf|pptx)|pages\/[0-9]+)(?:\?v=[a-f0-9]+)?$/.test(u);
    if (!a || a.plugin !== "presenton" || !safe(a.url) || (a.downloadUrl && !safe(a.downloadUrl))) return [];
    return [{
      ...a,
      embedUrl: null,
      pages: a.pages?.filter((p) => safe(p.url)),
      thumbnailUrl: safe(a.thumbnailUrl) ? a.thumbnailUrl : undefined,
      revision: typeof a.revision === "string" ? a.revision : undefined,
    }];
  }
  const design = objects.find((o) => Boolean(canvaDesignId(o)));
  const designId = design ? canvaDesignId(design) : undefined;
  const title = typeof design?.title === "string" ? design.title : undefined;
  const thumbnail = design?.thumbnail as { url?: string } | undefined;
  const thumbnailUrl = thumbnail?.url || objects.map((o) => o.thumbnail_url || o.thumbnailUrl).find((u): u is string => typeof u === "string");
  const items: PluginArtifact[] = [];
  const add = (raw: unknown, label?: string, localObj?: Record<string, unknown>) => {
    if (typeof raw !== "string") return;
    try {
      const url = new URL(raw.trim());
      if (!["http:", "https:"].includes(url.protocol)) return;
      if (/\.(png|jpe?g|webp|gif|svg)$/i.test(url.pathname) || /^(media\.canva\.com|design\.canva\.ai|.*canva-static.*)$/.test(url.hostname) || url.pathname.includes("thumbnail")) return;
      const isDownload = /\.(pptx|pdf|docx|xlsx|zip)$/i.test(url.pathname);
      const localId = localObj ? canvaDesignId(localObj) : undefined;
      const id = localId || designId || (/canva\.com$/.test(url.hostname) ? /\/(D[\w-]{10})(?:\/|$)/.exec(url.pathname)?.[1] : undefined);
      const canonical = mcp.handle === "canva" && id ? `https://www.canva.com/design/${id}/view` : url.href;
      const normalized = canonical.replace(/\/(edit|view)\/?$/, "/view");
      const localThumb = (localObj?.thumbnail as { url?: string } | undefined)?.url;
      items.push({
        id: id ? `${mcp.handle}:${id}` : `${toolCallId}-${items.length}`,
        plugin: mcp.handle, pluginName, tool: mcp.tool,
        title: label || title || `${pluginName}-ontwerp`,
        url: id ? canonical : normalized,
        embedUrl: toEmbedUrl(normalized), thumbnailUrl: localThumb || thumbnailUrl, designId: id,
        ...(isDownload ? { downloadUrl: url.href, format: url.pathname.split(".").at(-1)?.toLowerCase() } : {}),
      });
    } catch { /* Invalid links are not deliverables. */ }
  };
  for (const obj of objects) {
    if (typeof obj.width === "number" && typeof obj.height === "number" && !canvaDesignId(obj) && typeof obj.title !== "string") continue;
    for (const [key, value] of Object.entries(obj)) {
      if (/^(url|uri|edit_url|view_url|href|link|web_url|design_url)$/.test(key)) add(value, typeof obj.title === "string" ? obj.title : typeof obj.name === "string" ? obj.name : undefined, obj);
      if (key === "urls" && Array.isArray(value)) value.forEach((url) => add(url, undefined, obj));
      if (key === "text" && typeof value === "string") {
        try { JSON.parse(value); continue; } catch { /* Plain text may contain Markdown links. */ }
        for (const match of value.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) add(match[2], match[1], obj);
        for (const match of value.matchAll(/https?:\/\/[^\s)"'<>]+/g)) add(match[0], undefined, obj);
      }
    }
  }
  return mergePluginArtifacts(items);
}

/** Extract merged deliverables from all tool calls in a message, excluding uncommitted design copies. */
export function extractMessagePluginArtifacts(
  parts: ReadonlyArray<{ toolCallId: string; toolName: string; state?: string; output?: unknown }>
): PluginArtifact[] {
  const uncommittedCopies = new Set<string>();
  const validArtifacts: PluginArtifact[] = [];
  for (const p of parts) {
    if (p.state !== "output-available") continue;
    const mcp = parseMcpToolKey(p.toolName);
    if (!mcp) continue;
    if (/^copy[-_]design$/i.test(mcp.tool)) {
      for (const obj of pluginObjects(p.output)) {
        const id = canvaDesignId(obj);
        if (id) uncommittedCopies.add(`${mcp.handle}:${id}`);
      }
      continue;
    }
    if (/^(commit[-_]editing[-_]transaction|export[-_]design|get[-_]export[-_]design[-_]async[-_]job)$/i.test(mcp.tool)) {
      uncommittedCopies.clear();
    }
    for (const art of extractPluginArtifacts(p.toolCallId, p.toolName, p.output)) {
      if (!uncommittedCopies.has(art.id)) validArtifacts.push(art);
    }
  }
  return mergePluginArtifacts(validArtifacts);
}

/** Compact MCP tool output for the model context so duplicate content blocks do not blow up token budgets. */
export function mcpToolModelOutput(output: unknown) {
  let text = "";
  if (!output || typeof output !== "object") {
    text = String(output ?? "");
  } else {
    const rec = output as Record<string, unknown>;
    if (rec.structuredContent !== undefined) {
      const plainText = typeof rec.text === "string" && rec.text && !rec.text.trim().startsWith("{") ? rec.text.slice(0, 60_000) : undefined;
      text = JSON.stringify({ ...(plainText ? { text: plainText } : {}), structuredContent: rec.structuredContent }).slice(0, 120_000);
    } else if (typeof rec.text === "string") {
      text = rec.text.slice(0, 120_000);
    } else {
      text = JSON.stringify(output).slice(0, 120_000);
    }
  }
  return {
    type: "content" as const,
    value: [{ type: "text" as const, text }],
  };
}

/** Space repeated status checks for the same async job; ordinary tool calls run immediately. */
export function createPluginPollDelay() {
  const attempts = new Map<string, number>();
  return (pluginId: string, toolName: string, args: unknown): number => {
    if (!/^get[-_].*async[-_]job$/.test(toolName)) return 0;
    const key = JSON.stringify([pluginId, toolName, args]);
    const attempt = attempts.get(key) ?? 0;
    attempts.set(key, attempt + 1);
    return attempt === 0 ? 0 : Math.min(1000 * 2 ** (attempt - 1), 8000);
  };
}
