import { userOf } from "./streams.ts";

export function mutationAllowed(req: Request) {
  const origin = req.headers.get("origin");
  const expected = process.env.APP_ORIGIN ?? new URL(req.url).origin;
  return req.headers.get("sec-fetch-site") !== "cross-site" && (!origin || origin === expected);
}

export async function projectApi(req: Request, path: string, init: RequestInit = {}) {
  const user = userOf(req);
  if (!user) throw new Error("Meld je aan om privéprojecten te gebruiken.");
  const res = await fetch(new URL(path, process.env.DIGIMV_API ?? "http://127.0.0.1:8000"), {
    ...init, cache: "no-store", headers: { ...init.headers, "cf-access-authenticated-user-email": user },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail ?? "Project niet beschikbaar");
  return data;
}
