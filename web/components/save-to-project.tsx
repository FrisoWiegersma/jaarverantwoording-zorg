"use client";

import Link from "next/link";
import { AlertTriangle, Check, FolderPlus, Loader2, Plus, Search, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { projectRequest, type Project } from "@/lib/projects";
import { cn } from "@/lib/utils";

/** A public file the answer cites: the href to save it by, what makes two citations the same file, and its name. */
export type SaveFile = { href: string; key: string; label: string };
type Result = { id: string; name: string; added: number; existing: number; errors: string[] };

const EASE = [0.23, 1, 0.32, 1] as const;
const SPRING = { type: "spring", bounce: 0, duration: 0.35 } as const;
const ROW = { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: "auto" }, exit: { opacity: 0, height: 0 }, transition: SPRING };
const RING = "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
const PRIMARY = cn("inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 font-semibold text-primary-foreground text-sm transition-[filter,opacity] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100", RING);
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Save the cited file, or every file the answer cites, to one or more projects. */
export function SaveToProject({ file, all = [] }: { file: SaveFile; all?: SaveFile[] }) {
  const [open, setOpen] = useState(false);
  const [savedTo, setSavedTo] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const reopened = useRef(false);
  useEffect(() => {
    if (!open && reopened.current) trigger.current?.focus();
    reopened.current = open;
  }, [open]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="border-t pt-4" data-no-copy>
        <AnimatePresence initial={false} mode="wait">
          {open ? (
            <Picker all={all} file={file} key="picker" onClose={() => setOpen(false)} onSaved={setSavedTo} />
          ) : (
            <motion.button
              animate={{ opacity: 1, scale: 1 }}
              className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors hover:bg-muted", RING)}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
              initial={{ opacity: 0, scale: 0.96 }}
              key="trigger"
              onClick={() => setOpen(true)}
              ref={trigger}
              transition={{ duration: 0.18, ease: EASE }}
              type="button"
              whileTap={{ scale: 0.97 }}
            >
              {savedTo ? <Check aria-hidden="true" className="size-4" /> : <FolderPlus aria-hidden="true" className="size-4" />}
              {savedTo ? `Opgeslagen in ${plural(savedTo, "project", "projecten")}` : "Opslaan in project"}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function Picker({ file, all, onClose, onSaved }: { file: SaveFile; all: SaveFile[]; onClose: () => void; onSaved: (n: number) => void }) {
  const uid = useId();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"one" | "all">("one");
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState("");
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    projectRequest("")
      .then((list: Project[]) => {
        if (!live) return;
        setProjects(list);
        // Inside a project, or with only one, that project is the likely choice.
        const current = window.location.pathname.match(/^\/projecten\/([a-f0-9]{32})/)?.[1];
        const guess = list.find((p) => p.id === current)?.id ?? (list.length === 1 ? list[0].id : undefined);
        if (guess) setPicked(new Set([guess]));
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [attempt]);

  const files = scope === "all" ? all : [file];
  const q = fold(query.trim());
  const shown = projects?.filter((p) => fold(p.name).includes(q)) ?? [];
  const canCreate = Boolean(projects && q && !projects.some((p) => fold(p.name) === q));
  const saving = progress !== null && !results;

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const create = async () => {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    setError("");
    try {
      const p: Project = await projectRequest("", "POST", { name });
      setProjects((list) => [{ ...p, doc_count: 0 }, ...(list ?? [])]);
      setPicked((s) => new Set(s).add(p.id));
      setQuery("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // ponytail: one request at a time, so the server never copies many PDFs at once; a bulk endpoint if answers cite dozens.
  const save = async () => {
    const targets = (projects ?? []).filter((p) => picked.has(p.id));
    const total = targets.length * files.length;
    let done = 0;
    setError("");
    setProgress([0, total]);
    const out: Result[] = [];
    for (const p of targets) {
      const r: Result = { id: p.id, name: p.name, added: 0, existing: 0, errors: [] };
      for (const f of files) {
        try {
          const { existing } = await projectRequest(`/${p.id}/saved-files`, "POST", { href: f.href });
          if (existing) r.existing++;
          else r.added++;
        } catch (e) {
          r.errors.push(files.length > 1 ? `${f.label}: ${(e as Error).message}` : (e as Error).message);
        }
        setProgress([++done, total]);
      }
      out.push(r);
    }
    setResults(out);
    onSaved(out.filter((r) => r.added + r.existing > 0).length);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (shown.length === 1) toggle(shown[0].id);
    else if (!shown.length && canCreate) create();
  };

  return (
    <motion.div
      animate={{ height: "auto", opacity: 1 }}
      className="-m-1 overflow-hidden p-1"
      exit={{ height: 0, opacity: 0 }}
      initial={{ height: 0, opacity: 0 }}
      onAnimationComplete={() => card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving) {
          e.stopPropagation();
          onClose();
        }
      }}
      transition={SPRING}
    >
      <div aria-labelledby={`${uid}-title`} className="space-y-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border" ref={card} role="group">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold" id={`${uid}-title`}>
              Opslaan in project
            </p>
            <p className="text-muted-foreground text-sm">Een kopie voor volgende gesprekken. Maximaal 25 MB per bestand.</p>
          </div>
          <button aria-label="Sluit" className={cn("-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted", RING)} disabled={saving} onClick={onClose} type="button">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <AnimatePresence initial={false} mode="wait">
          {results ? (
            <motion.div animate={{ opacity: 1, y: 0 }} className="space-y-3" initial={{ opacity: 0, y: 8 }} key="done" transition={{ duration: 0.25, ease: EASE }}>
              <ul className="space-y-1" role="status">
                {results.map((r, i) => {
                  const ok = r.added + r.existing > 0;
                  return (
                    <motion.li
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-3 rounded-xl bg-muted/60 px-3 py-2.5"
                      initial={{ opacity: 0, y: 6 }}
                      key={r.id}
                      transition={{ delay: 0.06 * i, duration: 0.25, ease: EASE }}
                    >
                      {ok ? <Tick draw on /> : <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />}
                      <span className="min-w-0 flex-1 text-sm">
                        <Link className="font-medium underline-offset-2 hover:underline" href={`/projecten/${r.id}`}>
                          {r.name}
                        </Link>
                        <span className="block text-muted-foreground">
                          {[r.added && `${plural(r.added, "bestand", "bestanden")} toegevoegd`, r.existing && `${plural(r.existing, "bestand stond", "bestanden stonden")} er al`].filter(Boolean).join(" · ") || "Niet opgeslagen"}
                        </span>
                        {r.errors.map((e) => (
                          <span className="block text-destructive" key={e}>
                            {e}
                          </span>
                        ))}
                      </span>
                    </motion.li>
                  );
                })}
              </ul>
              <div className="flex justify-end">
                <motion.button className={PRIMARY} onClick={onClose} type="button" whileTap={{ scale: 0.97 }}>
                  Klaar
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div className="space-y-3" exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }} key="pick">
              {all.length > 1 && (
                <div>
                  <div aria-label="Welke bestanden" className="grid grid-cols-2 rounded-full bg-muted p-1 text-sm" role="group">
                    {(["one", "all"] as const).map((s) => (
                      <button aria-pressed={scope === s} className={cn("relative min-h-9 rounded-full px-3 font-medium transition-colors", scope === s ? "text-foreground" : "text-muted-foreground hover:text-foreground", RING)} disabled={saving} key={s} onClick={() => setScope(s)} type="button">
                        {scope === s && <motion.span className="absolute inset-0 rounded-full bg-card shadow-sm ring-1 ring-border" layoutId={`${uid}-scope`} transition={SPRING} />}
                        <span className="relative">{s === "one" ? "Dit bestand" : `Alle ${all.length} bestanden`}</span>
                      </button>
                    ))}
                  </div>
                  <AnimatePresence initial={false}>
                    {scope === "all" && (
                      <motion.ul {...ROW} className="overflow-hidden text-muted-foreground text-sm">
                        {all.map((f) => (
                          <li className="mt-1.5 flex items-center gap-2 first:mt-2.5" key={f.key}>
                            <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                            <span className="truncate">{f.label}</span>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>
              )}

              <label className="flex min-h-11 items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <input
                  aria-label="Zoek of maak een project"
                  autoComplete="off"
                  autoFocus
                  className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  disabled={saving}
                  enterKeyHint="done"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Zoek of maak een project"
                  value={query}
                />
              </label>

              <div aria-label="Projecten" className="-mx-1 max-h-64 overflow-y-auto overscroll-contain" role="group">
                {!projects && !error && [0, 1, 2].map((i) => <div className="mx-1 my-1 h-11 animate-pulse rounded-xl bg-muted" key={i} />)}
                <AnimatePresence initial={false}>
                  {shown.map((p) => (
                    <motion.div {...ROW} className="overflow-hidden px-1" key={p.id}>
                      <motion.button
                        aria-checked={picked.has(p.id)}
                        className={cn("my-0.5 flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left text-sm transition-colors hover:bg-muted", picked.has(p.id) && "bg-muted/60", RING)}
                        disabled={saving}
                        onClick={() => toggle(p.id)}
                        role="checkbox"
                        type="button"
                        whileTap={{ scale: 0.985 }}
                      >
                        <Tick on={picked.has(p.id)} />
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        {p.doc_count != null && <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{plural(p.doc_count, "bestand", "bestanden")}</span>}
                      </motion.button>
                    </motion.div>
                  ))}
                  {canCreate && (
                    <motion.div {...ROW} className="overflow-hidden px-1" key="create">
                      <motion.button className={cn("my-0.5 flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left text-sm transition-colors hover:bg-muted", RING)} disabled={creating || saving} onClick={create} type="button" whileTap={{ scale: 0.985 }}>
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-dashed border-muted-foreground/50">
                          {creating ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <Plus aria-hidden="true" className="size-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          Nieuw project <span className="font-medium">“{query.trim()}”</span>
                        </span>
                      </motion.button>
                    </motion.div>
                  )}
                </AnimatePresence>
                {projects?.length === 0 && !q && <p className="px-3 py-2 text-muted-foreground text-sm">Nog geen projecten. Typ een naam om er een te maken.</p>}
              </div>

              {error && (
                <p className="text-destructive text-sm" role="alert">
                  {error}{" "}
                  {!projects && (
                    <button className="underline underline-offset-2" onClick={() => { setError(""); setAttempt((n) => n + 1); }} type="button">
                      Opnieuw
                    </button>
                  )}
                </p>
              )}

              <div className="flex justify-end">
                <motion.button className={PRIMARY} disabled={!picked.size || saving} onClick={save} type="button" whileTap={{ scale: 0.97 }}>
                  {saving ? (
                    <>
                      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                      <span>
                        Opslaan… <span className="tabular-nums">{progress[0]}/{progress[1]}</span>
                      </span>
                    </>
                  ) : picked.size ? (
                    <>
                      <FolderPlus aria-hidden="true" className="size-4" />
                      <span>
                        {files.length > 1 ? `${files.length} bestanden` : "Opslaan"} in <Count n={picked.size} /> {picked.size === 1 ? "project" : "projecten"}
                      </span>
                    </>
                  ) : (
                    "Kies een project"
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** A checkbox mark that draws itself. `draw` animates it in on mount, for a result. */
function Tick({ on, draw = false }: { on: boolean; draw?: boolean }) {
  return (
    <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-150", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 bg-background")}>
      <svg className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} viewBox="0 0 24 24">
        <motion.path animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }} d="M5 12.5l4.5 4.5L19 7.5" initial={draw ? { pathLength: 0, opacity: 0 } : false} transition={{ duration: draw ? 0.35 : 0.2, delay: draw ? 0.1 : 0, ease: EASE }} />
      </svg>
    </span>
  );
}

/** A number that rolls to its new value. */
function Count({ n }: { n: number }) {
  return (
    <span className="inline-flex overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span animate={{ y: 0, opacity: 1 }} className="tabular-nums" exit={{ y: "-100%", opacity: 0 }} initial={{ y: "100%", opacity: 0 }} key={n} transition={SPRING}>
          {n}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
