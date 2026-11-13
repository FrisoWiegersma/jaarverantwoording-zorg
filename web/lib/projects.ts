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

// Every file in a dropped file or folder, recursively. readEntries returns at most 100 entries per call, so read until it is empty.
export async function entryFiles(entry: FileSystemEntry | null): Promise<File[]> {
  if (!entry) return [];
  if (entry.isFile) return [await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail))];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: File[] = [];
  for (let batch; (batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail))).length;) files.push(...(await Promise.all(batch.map(entryFiles))).flat());
  return files;
}
