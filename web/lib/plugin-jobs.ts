import { setTimeout } from "node:timers/promises";

/** MCP servers return either structured content or JSON encoded in text content blocks. */
function jobState(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    try { return jobState(JSON.parse(value), depth + 1); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const state = jobState(item, depth + 1);
      if (state) return state;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if (object.isError) return null;
  if (typeof object.status === "string") return object;
  for (const key of ["structuredContent", "content", "text", "result", "job", "data"]) {
    const state = jobState(object[key], depth + 1);
    if (state) return state;
  }
  return null;
}

/** Keep a status tool running while its remote job runs, rather than spending a model step per poll.
 * Only read-only status tools are retried; creating or exporting a design is never replayed here. */
export async function waitForPluginJob<T>(
  toolName: string,
  call: (continuationToken?: string) => Promise<T>,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    now?: () => number;
    sleep?: (delay: number) => Promise<void>;
  } = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((delay) => setTimeout(delay, undefined, { signal: options.signal }));
  const deadline = now() + (options.timeoutMs ?? 120_000);
  let attempt = 0;
  let continuationToken: string | undefined;
  while (true) {
    options.signal?.throwIfAborted();
    const result = await call(continuationToken);
    if (!/^get[-_].*async[-_]job$/.test(toolName)) return result;
    const state = jobState(result);
    if (!state || !["in_progress", "pending", "queued", "running", "polled_too_early"].includes(String(state.status))) return result;
    if (typeof state.continuation_token === "string") continuationToken = state.continuation_token;
    const remaining = deadline - now();
    const policy = state.polling_policy as { wait_seconds?: unknown } | undefined;
    const seconds = policy?.wait_seconds;
    const delay = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Math.min(2000 * 2 ** Math.min(attempt++, 2), 8000);
    if (remaining <= delay) return result;
    await sleep(delay);
  }
}
