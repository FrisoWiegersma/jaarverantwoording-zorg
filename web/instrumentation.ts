/** At server start, in builtin mode: check BETTER_AUTH_SECRET and create or update the account tables. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { authMode } = await import("./lib/auth-mode");
  if (authMode() !== "builtin") return;
  const { migrateAuth } = await import("./lib/auth");
  await migrateAuth();
}
