/**
 * An answer keeps going when the browser drops the connection: a phone that locks, a train in a tunnel. Each answer's
 * stream is kept here while it runs and for a while after, so the page can replay it when it comes back
 * (useChat's resume, GET /api/chat/[id]/stream). Stop asks for it explicitly (DELETE on the same path).
 */

type Answer = { user: string; chunks: string[]; done: boolean; waiting: Set<() => void>; stop: AbortController };

// ponytail: in memory, one server process. A restart loses the answers in flight; finished ones are saved conversations.
// One map for the process: each route's bundle gets its own copy of this module.
const answers: Map<string, Answer> = ((globalThis as { __answers?: Map<string, Answer> }).__answers ??= new Map());
const KEEP_MS = 15 * 60_000;

/** Who is asking: Cloudflare Access's signed-in user; empty in local development. */
export const userOf = (req: Request) => req.headers.get("cf-access-authenticated-user-email") ?? "";

function wake(a: Answer) {
  for (const resolve of a.waiting) resolve();
  a.waiting.clear();
}

/** A new answer for this chat; the previous one, if still running, is stopped. */
export function startAnswer(id: string, user: string) {
  const key = `${user}\n${id}`;
  answers.get(key)?.stop.abort();
  const a: Answer = { user, chunks: [], done: false, waiting: new Set(), stop: new AbortController() };
  answers.set(key, a);
  return a;
}

/** Keeps a copy of the answer's server-sent events, read to the end even when nobody is listening any more. */
export async function record(id: string, a: Answer, stream: ReadableStream<string>) {
  const reader = stream.getReader();
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      if (!r.value.startsWith(":")) a.chunks.push(r.value); // keep-alive comments are for the live connection only
      wake(a);
    }
  } catch {
    // the answer failed; what was sent so far stays replayable
  } finally {
    a.done = true;
    wake(a);
    setTimeout(() => { const key = `${a.user}\n${id}`; if (answers.get(key) === a) answers.delete(key); }, KEEP_MS).unref?.();
  }
}

/** The answer from its start, then live until it ends. Null: nothing to resume. */
export function replay(id: string, user: string): ReadableStream<string> | null {
  const a = answers.get(`${user}\n${id}`);
  if (!a || a.user !== user) return null;
  let i = 0;
  let cancelled = false;
  let waiting: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval>;
  return new ReadableStream<string>({
    start(controller) {
      controller.enqueue(": stream-open\n\n");
      heartbeat = setInterval(() => {
        if ((controller.desiredSize ?? 0) > 0) controller.enqueue(": keep-alive\n\n");
      }, 15_000);
      heartbeat.unref?.();
    },
    async pull(controller) {
      while (i >= a.chunks.length && !a.done && !cancelled) {
        await new Promise<void>((resolve) => { waiting = resolve; a.waiting.add(resolve); });
        waiting = undefined;
      }
      if (cancelled) return;
      if (i < a.chunks.length) {
        while (i < a.chunks.length) controller.enqueue(a.chunks[i++]);
      } else {
        clearInterval(heartbeat);
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
      clearInterval(heartbeat);
      if (waiting) { a.waiting.delete(waiting); waiting(); }
      // Only the explicit Stop endpoint aborts generation; closing a reader just detaches it.
    },
  });
}

export function stopAnswer(id: string, user: string) {
  const a = answers.get(`${user}\n${id}`);
  if (a?.user !== user) return;
  a.stop.abort();
  answers.delete(`${user}\n${id}`);
}
