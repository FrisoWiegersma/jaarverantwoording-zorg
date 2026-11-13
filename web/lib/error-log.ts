import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// A volume in compose.yaml, so it survives the redeploy that recreates the container.
const FILE = process.env.ERROR_LOG ?? "logs/errors.jsonl";

const cut = (v: unknown, n = 2000) => {
  const s = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
  // Head and tail: a validation error puts the input first and the reason last.
  return s.length > n ? `${s.slice(0, n / 2)} … ${s.slice(-n / 2)}` : s;
};

interface Chat { id: string; model: string; effort?: string }

// "fetch failed" says nothing; its cause says which (ECONNRESET, UND_ERR_SOCKET, a timeout).
const causeOf = (e: Error) => {
  const c = e.cause as { code?: string; message?: string } | undefined;
  return c ? ` (cause: ${cut(c.code ?? c.message ?? String(c), 300)})` : "";
};

/** One failure with what's needed to reproduce it: the tool, its input and the error. Project tools keep their input private. */
export function errorEntry(chat: Chat, step: number | null, tool: string | null, input: unknown, error: unknown) {
  return {
    at: new Date().toISOString(), chat: chat.id, model: chat.model, effort: chat.effort, step, tool,
    input: tool && !tool.includes("_project_") ? cut(input) : undefined,
    error: error instanceof Error ? `${error.name}: ${cut(error.message)}${causeOf(error)}` : cut(error),
    status: (error as { statusCode?: number } | null)?.statusCode,
  };
}

// ponytail: one growing file, no rotation; a few KB per failure. Truncate by hand if it ever gets big.
export async function logError(entry: ReturnType<typeof errorEntry>) {
  console.error("chat.failure", JSON.stringify(entry));
  try {
    await mkdir(dirname(FILE), { recursive: true });
    await appendFile(FILE, `${JSON.stringify(entry)}\n`);
  } catch (e) { console.error("errorlog.write", (e as Error).message); }
}
