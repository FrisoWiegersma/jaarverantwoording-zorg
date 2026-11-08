"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, X } from "lucide-react";
import ActionSearchBar from "@/components/kokonutui/action-search-bar";
import SwitchButton from "@/components/kokonutui/switch-button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Logo } from "@/components/logo";
import { projectRequest, type Project } from "@/lib/projects";

export default function Projects() {
  const [items, setItems] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => { projectRequest("").then(setItems).catch((e) => setError(e.message)); }, []);
  const create = async () => {
    setBusy(true); setError("");
    try { const p = await projectRequest("", "POST", { name }); router.push(`/projecten/${p.id}`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="min-h-dvh">
    <header className="flex h-16 items-center justify-between px-4 sm:px-8"><Link className="inline-flex min-h-11 items-center" href="/"><Logo /></Link><div className="flex items-center gap-3"><Link className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground" href="/">Chat</Link><SwitchButton /></div></header>
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12 sm:px-8">
      <div className="flex items-center justify-between gap-4"><h1 className="text-3xl font-semibold">Projecten</h1><button className="raised inline-flex min-h-11 items-center gap-2 rounded-full px-4" onClick={() => setCreating(!creating)}><Plus className="size-4" />Nieuw project</button></div>
      <p className="mt-3 mb-8 text-muted-foreground">Gesprekken met je eigen context en bronnen.</p>
      {error && <p role="alert" className="mb-5 rounded-xl border p-4">{error}</p>}
      <Drawer handleOnly open={creating} onOpenChange={setCreating}><DrawerContent className="project-modal mx-auto max-w-xl px-6 pb-6 pt-4 sm:bottom-auto! sm:top-1/2! sm:-translate-y-1/2! sm:rounded-2xl!">
        <div className="mb-5 flex items-center justify-between"><DrawerTitle className="text-xl font-medium">Project aanmaken</DrawerTitle><button aria-label="Sluit project aanmaken" className="size-11 rounded-full hover:bg-muted" onClick={() => setCreating(false)}><X className="mx-auto size-4" /></button></div>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); create(); }}><label className="block space-y-2"><span className="text-sm">Projectnaam</span><div className="flex items-center gap-3 rounded-xl border bg-muted px-3"><FolderOpen className="size-5 shrink-0 text-muted-foreground" /><input className="min-h-12 min-w-0 flex-1 bg-transparent outline-none" required maxLength={200} placeholder="Bijvoorbeeld: Personeelskosten zorgsector" value={name} onChange={(e) => setName(e.target.value)} /></div></label><DrawerDescription className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Bewaar gesprekken, bronnen en instructies samen in één project.</DrawerDescription>{error && <p role="alert" className="text-sm">{error}</p>}<div className="flex justify-end"><button disabled={busy || !name.trim()} className="min-h-11 rounded-full bg-primary px-5 text-primary-foreground disabled:opacity-40">Project aanmaken</button></div></form>
      </DrawerContent></Drawer>
      {!!items.length && <ActionSearchBar label="Zoek een project" placeholder="Zoek projecten…" onQueryChange={setQuery} onSelect={(item) => router.push(`/projecten/${item.id}`)} empty="Geen projecten gevonden." className="mb-5 max-w-none" items={items.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).map((p) => ({ id: p.id, label: p.name, icon: <FolderOpen className="size-4" /> }))} />}
      <ul className="divide-y">{items.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).map((p) => <li key={p.id}><Link href={`/projecten/${p.id}`} className="flex items-center gap-4 rounded-xl px-3 py-5 hover:bg-muted"><FolderOpen className="size-5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-medium">{p.name}</span><span className="text-sm text-muted-foreground">{new Date(p.updated).toLocaleDateString("nl-NL")}</span></Link></li>)}</ul>
    </main>
  </div>;
}
