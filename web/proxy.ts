import { type NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { authMode, isPublic, trustedHeaders } from "@/lib/auth-mode";

/** The session and the cookies Better Auth refreshes with it; null when there is none or the lookup fails. */
async function lookup(req: NextRequest) {
  try {
    return await getAuth().api.getSession({ headers: req.headers, returnHeaders: true });
  } catch (e) {
    // A locked or unreadable auth.db signs everyone out; say why in the log.
    console.error("Session lookup failed:", e);
    return null;
  }
}

/**
 * Builtin mode: every request gets the identity header from the session, never from the browser, and only signed-in
 * people get past the public pages. The identity is the account's id, not its email: addresses are not verified, so
 * signing up with someone's email must not open data that email owned (for example from a Cloudflare Access setup).
 * Behind Cloudflare Access, Cloudflare does both and this lets everything through.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (authMode() === "cloudflare") return pathname === "/login" ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();

  const open = isPublic(pathname);
  // Public pages and files need no session; the login page looks, to send signed-in people on.
  const session = open && pathname !== "/login" ? null : await lookup(req);
  const user = session?.response?.user;

  let res: NextResponse;
  if (!user && !open) {
    if (pathname.startsWith("/api/") || pathname.toLowerCase().startsWith("/digimv/")) {
      res = NextResponse.json({ detail: "Meld je aan." }, { status: 401 });
    } else {
      const login = new URL("/login", req.url);
      if (pathname !== "/") login.searchParams.set("next", pathname + search);
      res = NextResponse.redirect(login);
    }
  } else if (user && pathname === "/login") {
    res = NextResponse.redirect(new URL("/", req.url));
  } else {
    res = NextResponse.next({ request: { headers: trustedHeaders(req.headers, user?.id) } });
  }
  // Better Auth renews the session and its five-minute cookie cache through Set-Cookie; the browser needs them.
  for (const cookie of session?.headers?.getSetCookie() ?? []) res.headers.append("set-cookie", cookie);
  return res;
}

// Next's own files (scripts, images, the dev reload socket) carry no private data.
export const config = { matcher: ["/((?!_next/).*)"] };
