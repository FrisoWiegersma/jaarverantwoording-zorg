import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { replay, stopAnswer, userOf } from "@/lib/streams";

/** Resume: the answer still running (or just finished) for this chat, replayed from its start. 204: nothing to resume. */
export async function GET(req: Request, ctx: RouteContext<"/api/chat/[id]/stream">) {
  const stream = replay((await ctx.params).id, userOf(req));
  if (!stream) return new Response(null, { status: 204 });
  return new Response(stream.pipeThrough(new TextEncoderStream()), { headers: UI_MESSAGE_STREAM_HEADERS });
}

/** Stop: a dropped connection no longer stops an answer, so the Stop button says it out loud. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/chat/[id]/stream">) {
  stopAnswer((await ctx.params).id, userOf(req));
  return new Response(null, { status: 204 });
}
