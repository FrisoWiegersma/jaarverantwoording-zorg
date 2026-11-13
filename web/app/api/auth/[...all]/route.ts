import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { authMode } from "@/lib/auth-mode";

// Better Auth's endpoints (sign-in, sign-up, session, sign-out). Behind Cloudflare Access the app has no login.
const handle = (req: Request) => {
  if (authMode() === "cloudflare") return Response.json({ detail: "Aanmelden gaat via Cloudflare Access." }, { status: 404 });
  const { GET, POST } = toNextJsHandler(getAuth());
  return req.method === "GET" ? GET(req) : POST(req);
};

export { handle as GET, handle as POST };
