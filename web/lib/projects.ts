export type Project = { id: string; name: string; context: string; allow_private: boolean; updated: string; doc_count?: number; chat_count?: number };
export type ProjectDocument = { id: string; filename: string; kind: string; pages: number; processed: number; status: string; error: string; archived: number };
export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;

export function projectFileMention(file: Pick<ProjectDocument, "filename">) {
  return `@"${file.filename.replaceAll('"', "’")}"`;
}

/** Resolve names only against the current owner's project inventory, never caller-supplied IDs or paths. */
export function mentionedProjectFiles(text: string, files: ProjectDocument[]) {
  return files.filter((file) => !file.archived && text.toLocaleLowerCase().includes(projectFileMention(file).toLocaleLowerCase()));
}

export async function projectRequest(path: string, method = "GET", body?: unknown) {
  const upload = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/digimv/projects${path}`, { method, cache: "no-store",
    signal: AbortSignal.timeout(upload ? 120_000 : 30_000),
    headers: body instanceof FormData || body === undefined ? {} : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new Error(upload ? "De upload duurde te lang. Controleer bij Bronnen of het bestand is toegevoegd voordat je opnieuw probeert." : "De aanvraag duurde te lang. Probeer opnieuw.");
    }
    throw error;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail ? (typeof data.detail === "string" ? data.detail : "Controleer de ingevulde velden.") : response.status === 413 ? "Maximaal 25 MB per bestand." : "De aanvraag kon niet worden verwerkt. Probeer opnieuw.");
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
