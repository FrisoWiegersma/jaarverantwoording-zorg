export type Project = { id: string; name: string; context: string; allow_private: boolean; updated: string };
export type ProjectDocument = { id: string; filename: string; kind: string; pages: number; processed: number; status: string; error: string; archived: number };

export async function projectRequest(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/digimv/projects${path}`, { method, cache: "no-store",
    headers: body instanceof FormData || body === undefined ? {} : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail ? (typeof data.detail === "string" ? data.detail : "Controleer de ingevulde velden.") : "Aanvraag mislukt");
  return data;
}
