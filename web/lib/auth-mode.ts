/**
 * Who someone is. Two modes, as Open WebUI has them:
 * - `cloudflare`: Cloudflare Access signs people in and sets IDENTITY on every request; the app has no login.
 * - `builtin` (the default): the app's own login (Better Auth). proxy.ts drops any IDENTITY the browser sends and
 *   sets it to the signed-in account's id, so the routes and the Python API read one trusted header in both modes.
 */

/** The internal identity header. Only Cloudflare (cloudflare mode) or proxy.ts (builtin mode) may set it. */
export const IDENTITY = "cf-access-authenticated-user-email";

export type AuthMode = "builtin" | "cloudflare";

export const authMode = (env: string | undefined = process.env.AUTH_MODE): AuthMode =>
  env?.trim().toLowerCase() === "cloudflare" ? "cloudflare" : "builtin";

/** AUTH_ALLOWED_EMAILS: addresses or @domains, comma-separated. Empty lets anyone sign up. */
export function allowedEmail(email: unknown, list: string | undefined = process.env.AUTH_ALLOWED_EMAILS) {
  const rules = (list ?? "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  if (typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  return rules.some((r) => (r.startsWith("@") ? e.endsWith(r) : e === r));
}

/** The request headers the app sees: never the browser's own IDENTITY, only the signed-in account. */
export function trustedHeaders(incoming: Headers, user: string | null | undefined) {
  const headers = new Headers(incoming);
  headers.delete(IDENTITY);
  if (user) headers.set(IDENTITY, user);
  return headers;
}

// App routes and the API: private however the path is spelled (Next matches the /digimv rewrite case-insensitively)
// and whatever it ends in (page images are .png, Excel files .xlsx).
const PRIVATE = /^\/(digimv|bron|organisatie|vergelijk|projecten)(\/|$)|^\/api\/(?!auth\/)/;

/** Reachable without signing in: the login, Better Auth's endpoints, the landing page and the files in public/. */
export function isPublic(pathname: string) {
  const p = pathname.toLowerCase();
  if (PRIVATE.test(p)) return false;
  return p === "/login" || p.startsWith("/api/auth/") || p === "/landing" || p.startsWith("/landing/") || /\.[a-z0-9]+$/.test(p);
}
