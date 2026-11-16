"use client";

import Link from "next/link";
import { useEffect, useState, ViewTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, FolderOpen, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import ActionSearchBar from "@/components/kokonutui/action-search-bar";
import SwitchButton from "@/components/kokonutui/switch-button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Logo } from "@/components/logo";
import { projectRequest, type Project } from "@/lib/projects";

export default function Projects() {
  const [items, setItems] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    projectRequest("")
      .then((rows) => { setItems(rows); setLoaded(true); })
      .catch((e) => { setError(e.message); setLoaded(true); });
  }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await projectRequest("", "POST", { name });
      router.push(`/projecten/${p.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The delete dialog shows its own error: the page's error sits behind it and belongs to the create form.
  const closeDelete = () => {
    setConfirmDelete(null);
    setDeleteError("");
  };

  const remove = async (p: Project) => {
    setBusy(true);
    setDeleteError("");
    try {
      await projectRequest(`/${p.id}`, "DELETE");
      setItems((prev) => prev.filter((item) => item.id !== p.id));
      closeDelete();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const filtered = items.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <ViewTransition default="none" enter="page" exit="page">
      <MotionConfig reducedMotion="user">
        <div className="min-h-dvh">
          <header className="flex h-16 items-center justify-between px-4 sm:px-8">
            <Link className="inline-flex min-h-11 items-center" href="/"><Logo /></Link>
            <div className="flex items-center gap-3">
              <Link className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground" href="/">Chat</Link>
              <SwitchButton />
            </div>
          </header>

          <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Projecten</h1>
                <p className="mt-2 text-muted-foreground">Gesprekken met je eigen context en bronnen.</p>
              </div>
              <button className="raised inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.98]" onClick={() => setCreating(true)}>
                <Plus className="size-4" />Nieuw project
              </button>
            </div>

            {error && <p role="alert" className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">{error}</p>}

            <div className="mt-8">
              {!!items.length && (
                <ActionSearchBar
                  label="Zoek een project"
                  placeholder="Zoek projecten…"
                  onQueryChange={setQuery}
                  onSelect={(item) => router.push(`/projecten/${item.id}`)}
                  empty="Geen projecten gevonden."
                  className="mb-5 max-w-none"
                  items={filtered.map((p) => ({ id: p.id, label: p.name, icon: <FolderOpen className="size-4" /> }))}
                />
              )}

              {loaded && !items.length && !error && (
                <div className="raised flex flex-col items-center rounded-2xl px-6 py-12 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <FolderOpen className="size-6" />
                  </span>
                  <h2 className="mt-4 text-lg font-medium">Nog geen projecten</h2>
                  <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                    Bundel eigen pdf’s, notities en instructies met openbare zorgdata in één werkruimte.
                  </p>
                  <button className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground" onClick={() => setCreating(true)}>
                    <Plus className="size-4" />Eerste project aanmaken
                  </button>
                </div>
              )}

              <ul className="space-y-2.5">
                <AnimatePresence initial={false}>
                  {filtered.map((p) => (
                    <motion.li
                      key={p.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.18 }}
                      className="raised group flex items-center gap-2 rounded-2xl p-1.5 transition-colors hover:bg-muted/40"
                    >
                      <Link href={`/projecten/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl px-3 py-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <FolderOpen className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.name}</span>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><FileText className="size-3.5" />{p.doc_count ?? 0} bronnen</span>
                            <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5" />{p.chat_count ?? 0} gesprekken</span>
                            <span>{new Date(p.updated).toLocaleDateString("nl-NL")}</span>
                          </div>
                        </div>
                      </Link>
                      <button
                        type="button"
                        aria-label={`Verwijder ${p.name}`}
                        onClick={() => setConfirmDelete(p)}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          </main>

          <Drawer handleOnly open={creating} onOpenChange={setCreating}>
            <DrawerContent className="project-modal mx-auto max-w-xl px-6 pb-6 pt-4 sm:bottom-auto! sm:top-1/2! sm:-translate-y-1/2! sm:rounded-2xl!">
              <div className="mb-5 flex items-center justify-between">
                <DrawerTitle className="text-xl font-medium">Project aanmaken</DrawerTitle>
                <button aria-label="Sluit project aanmaken" className="size-11 rounded-full hover:bg-muted" onClick={() => setCreating(false)}>
                  <X className="mx-auto size-4" />
                </button>
              </div>
              <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); create(); }}>
                <label className="block space-y-2">
                  <span className="text-sm">Projectnaam</span>
                  <div className="flex items-center gap-3 rounded-xl border bg-muted px-3">
                    <FolderOpen className="size-5 shrink-0 text-muted-foreground" />
                    <input className="min-h-12 min-w-0 flex-1 bg-transparent outline-none" required maxLength={200} placeholder="Bijvoorbeeld: Personeelskosten zorgsector" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                </label>
                <DrawerDescription className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Bewaar gesprekken, bronnen en instructies samen in één project.</DrawerDescription>
                {error && <p role="alert" className="text-sm">{error}</p>}
                <div className="flex justify-end">
                  <button disabled={busy || !name.trim()} className="min-h-11 rounded-full bg-primary px-5 text-primary-foreground disabled:opacity-40">Project aanmaken</button>
                </div>
              </form>
            </DrawerContent>
          </Drawer>

          <Drawer handleOnly open={!!confirmDelete} onOpenChange={(open) => { if (!open) closeDelete(); }}>
            <DrawerContent className="project-modal mx-auto max-w-md px-6 pb-6 pt-4 sm:bottom-auto! sm:top-1/2! sm:-translate-y-1/2! sm:rounded-2xl!">
              <div className="mb-4 flex items-center justify-between">
                <DrawerTitle className="text-xl font-medium">Project verwijderen</DrawerTitle>
                <button aria-label="Annuleren" className="size-11 rounded-full hover:bg-muted" onClick={closeDelete}>
                  <X className="mx-auto size-4" />
                </button>
              </div>
              <DrawerDescription className="text-sm leading-relaxed text-muted-foreground">
                Weet je zeker dat je <strong className="text-foreground">{confirmDelete?.name}</strong> wilt verwijderen? Alle geüploade bronnen en gesprekken in dit project worden definitief gewist.
              </DrawerDescription>
              {deleteError && <p role="alert" className="mt-4 text-sm text-destructive">{deleteError}</p>}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" className="h-11 rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:bg-muted" onClick={closeDelete}>Annuleren</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => confirmDelete && remove(confirmDelete)}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-destructive px-5 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {busy ? "Verwijderen…" : "Definitief verwijderen"}
                </button>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </MotionConfig>
    </ViewTransition>
  );
}
