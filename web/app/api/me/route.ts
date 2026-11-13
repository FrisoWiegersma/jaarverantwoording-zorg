import { getAuth } from "@/lib/auth";
import { authMode } from "@/lib/auth-mode";
import { userOf } from "@/lib/streams";

/** Who is signed in and how, for the account menu. Builtin: the session's email (the identity header holds the account id). */
export async function GET(req: Request) {
  const mode = authMode();
  const email = mode === "builtin" ? ((await getAuth().api.getSession({ headers: req.headers }))?.user.email ?? "") : userOf(req);
  return Response.json({ mode, email }, { headers: { "cache-control": "no-store" } });
}
