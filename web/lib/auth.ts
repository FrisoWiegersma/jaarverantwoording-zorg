import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { allowedEmail } from "./auth-mode.ts";

/**
 * BETTER_AUTH_SECRET, or else one made on first start and kept beside the accounts, as Open WebUI does with its key:
 * nobody has to configure a secret, and it survives updates in the web-data volume.
 */
function secretIn(dir: string) {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const file = path.join(dir, ".auth-secret");
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    const secret = randomBytes(32).toString("hex");
    try {
      writeFileSync(file, secret, { mode: 0o600, flag: "wx" });
      return secret;
    } catch {
      return readFileSync(file, "utf8").trim(); // another bundle of this server wrote it first
    }
  }
}

/**
 * The built-in login (AUTH_MODE=builtin): email and password, accounts in data/auth.db (node:sqlite, so no native
 * module in the image). Created on first use, never at build time, and only in builtin mode.
 */
function create() {
  const dir = path.resolve("data");
  mkdirSync(dir, { recursive: true });
  const secret = secretIn(dir);
  return betterAuth({
    database: new DatabaseSync(path.join(dir, "auth.db")),
    secret,
    // Compose sets APP_ORIGIN; without it (npm run dev) Better Auth takes the address from the request.
    baseURL: process.env.APP_ORIGIN,
    // Addresses are not verified (no mail is sent): AUTH_ALLOW_SIGNUP=false closes sign-up once everyone has an account.
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true, disableSignUp: process.env.AUTH_ALLOW_SIGNUP?.trim().toLowerCase() === "false" },
    // The proxy reads the session on every request: a signed cookie for five minutes instead of a database read.
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && !allowedEmail(ctx.body?.email)) {
          throw new APIError("FORBIDDEN", { message: "Dit e-mailadres mag hier geen account maken.", code: "EMAIL_NOT_ALLOWED" });
        }
      }),
    },
  });
}

let instance: ReturnType<typeof create> | undefined;
export const getAuth = () => (instance ??= create());

/**
 * Creates or updates the account tables; run once at server start (instrumentation.ts). Without them nobody can sign
 * in, and Next only logs a failed start and keeps serving errors, so stop the process and let the container show why.
 */
export async function migrateAuth() {
  try {
    const { runMigrations } = await getMigrations(getAuth().options);
    await runMigrations();
  } catch (e) {
    console.error(`The login could not start: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
