"use client";

import Link from "next/link";
import { Check, FolderPlus } from "lucide-react";
import { useState } from "react";
import { projectRequest, type Project } from "@/lib/projects";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 text-sm hover:bg-muted disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

export function SaveToProject({ href }: { href: string }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ id: string; existing: boolean } | null>(null);

  const choose = async () => {
    setOpen(true); setBusy(true); setError("");
    try {
      const list: Project[] = await projectRequest("");
      setProjects(list);
      const current = window.location.pathname.match(/^\/projecten\/([a-f0-9]{32})/)?.[1];
      setSelected(list.find((p) => p.id === current)?.id ?? list[0]?.id ?? "");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (saved) return <p className="flex flex-wrap items-center gap-2 text-sm" role="status"><Check className="size-4" aria-hidden="true" />{saved.existing ? "Staat al in" : "Opgeslagen in"} <Link className="underline underline-offset-2" href={`/projecten/${saved.id}`}>{projects?.find((p) => p.id === saved.id)?.name ?? "project"}</Link></p>;

  return <div className="border-t pt-4" data-no-copy>
    {!open ? <button className={button} onClick={choose} type="button"><FolderPlus className="size-4" aria-hidden="true" />Opslaan in project</button> : <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError("");
      try {
        const result = await projectRequest(`/${selected}/saved-files`, "POST", { href });
        setSaved({ id: selected, existing: result.existing });
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      <p className="text-sm font-medium">Bestand opslaan in project</p>
      <p className="text-sm text-muted-foreground">Bewaar een kopie voor volgende gesprekken. Maximaal 25 MB.</p>
      {projects?.length ? <label className="block space-y-1 text-sm"><span>Project</span><select aria-label="Project" className="min-h-11 w-full rounded-xl border bg-background px-3 py-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} required value={selected} onChange={(e) => setSelected(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : projects && <p className="text-sm">Je hebt nog geen projecten. <Link className="underline" href="/projecten" target="_blank" rel="noopener noreferrer">Maak een project</Link>.</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {projects?.length ? <button className={button} disabled={busy || !selected} type="submit">{busy ? "Opslaan…" : "Bestand opslaan"}</button> : <button className={button} disabled={busy} onClick={choose} type="button">{busy ? "Projecten laden…" : "Opnieuw laden"}</button>}
        <button className={button} disabled={busy} onClick={() => setOpen(false)} type="button">Annuleren</button>
      </div>
    </form>}
  </div>;
}
