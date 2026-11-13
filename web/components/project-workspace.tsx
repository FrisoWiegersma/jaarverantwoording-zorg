"use client";

import Link from "next/link";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileText, FolderOpen, FolderUp, MessageSquare, Plus, SlidersHorizontal, Upload, X } from "lucide-react";
import SmoothTab from "@/components/kokonutui/smooth-tab";
import AI_Prompt from "@/components/kokonutui/ai-prompt";
import SwitchButton from "@/components/kokonutui/switch-button";
import { Textarea } from "@/components/ui/textarea";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { SourceView } from "@/components/evidence";
import { History } from "@/components/history";
import { Logo } from "@/components/logo";
import { ChatPage } from "@/components/chat";
import { conversationId, rememberConversation } from "@/lib/chat-session";
import { citationKey, type Citation } from "@/lib/citations";
import { entryFiles, projectRequest, type Project, type ProjectDocument } from "@/lib/projects";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 text-sm hover:bg-muted disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
const input = "w-full rounded-xl border bg-background px-3 py-2.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
const modal = "project-modal mx-auto max-w-xl px-6 pb-6 pt-4 sm:bottom-auto! sm:top-1/2! sm:-translate-y-1/2! sm:rounded-2xl!";
type Saved = { id: string; title: string; updated: string };
type Conversation = { id: string; messages: UIMessage[]; initialQuestion?: string };
const states: Record<string, string> = { queued: "In wachtrij", processing: "Verwerken…", needs_ocr: "OCR-toestemming nodig", error: "Verwerking mislukt" };

export function ProjectWorkspace({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [chats, setChats] = useState<Saved[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [question, setQuestion] = useState("");
  const [settings, setSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Project | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Citation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState("");
  const refreshDocs = useCallback(() => projectRequest(`/${id}/documents`).then(setDocuments), [id]);
  const refreshChats = useCallback(async () => {
    const r = await fetch(`/digimv/chats?project_id=${id}`, { cache: "no-store" });
    if (!r.ok) throw new Error("Gesprekken konden niet worden geladen");
    setChats(await r.json());
  }, [id]);
  const openChat = useCallback(async (chatId: string) => {
    setError("");
    try {
      const r = await fetch(`/digimv/chats/${encodeURIComponent(chatId)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Gesprek kon niet worden geopend");
      const saved = await r.json();
      if (saved.project_id !== id) throw new Error("Dit gesprek hoort bij een ander project");
      rememberConversation(chatId);
      setActive({ id: chatId, messages: saved.messages });
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => {
    projectRequest(`/${id}`).then((p) => {
      setProject(p);
      refreshDocs().catch((e) => setError(e.message));
      refreshChats().catch((e) => setError(e.message));
      const chatId = conversationId(new URL(window.location.href));
      if (chatId) openChat(chatId);
    }).catch((e) => setError(e.message));
  }, [id, refreshDocs, refreshChats, openChat]);
  const processing = documents.some((d) => !d.archived && ["queued", "processing"].includes(d.status));
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => { refreshDocs().catch((e) => setError(e.message)); }, 2000);
    return () => clearInterval(timer);
  }, [processing, refreshDocs]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };

  // One request per file, in order: the API takes a single file per upload. Every file is reported, so nothing in a folder is dropped silently.
  const addFiles = async (picked: File[] | Promise<File[]>) => {
    const all = (await picked).filter((f) => !f.name.startsWith(".")); // .DS_Store, ._name.pdf
    const files = all.filter((f) => /\.(pdf|md)$/i.test(f.name));
    const skipped = all.filter((f) => !/\.(pdf|md)$/i.test(f.name)).map((f) => f.name);
    const failed: string[] = [];
    try {
      for (const [i, f] of files.entries()) {
        setUploading(`Uploaden… ${i + 1} van ${files.length}`);
        const data = new FormData(); data.append("file", f);
        await projectRequest(`/${id}/documents`, "POST", data).catch((e: Error) => failed.push(`${f.name} (${e.message})`));
      }
    } finally { setUploading(""); }
    await refreshDocs();
    const list = (names: string[]) => names.slice(0, 5).join("; ") + (names.length > 5 ? ` en ${names.length - 5} meer` : "");
    if (!files.length) throw new Error(skipped.length ? `Geen PDF- of Markdown-bestanden gevonden. Overgeslagen: ${list(skipped)}.` : "Geen bestanden gevonden.");
    if (failed.length || skipped.length) throw new Error([`${files.length - failed.length} van ${all.length} bestanden toegevoegd.`, skipped.length ? `Overgeslagen, alleen PDF en Markdown: ${list(skipped)}.` : "", failed.length ? `Mislukt: ${list(failed)}.` : ""].filter(Boolean).join(" "));
    setAdding(false);
  };
  const visible = documents.filter((d) => !d.archived);
  return <div className={active ? "flex h-dvh flex-col" : "min-h-dvh"}>
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-4 sm:px-8"><Link className="inline-flex min-h-11 items-center" href="/"><Logo /></Link><div className="flex items-center gap-3"><Link className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground" href="/">Chat</Link><Link className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground" href="/projecten">Projecten</Link><SwitchButton /></div></header>
    {error && <p role="alert" className="mx-auto my-3 w-full max-w-3xl rounded-xl border p-3 text-sm">{error}</p>}
    {!project ? <p className="p-8 text-center">{error ? "Project niet beschikbaar" : "Project laden…"}</p> : active ? <>
      <div className="mx-auto flex w-full max-w-4xl shrink-0 items-center justify-between gap-2 border-b px-4 py-3"><button className="min-w-0 truncate text-left font-medium" onClick={() => { rememberConversation(null); setActive(null); refreshChats().catch((e) => setError(e.message)); }}><FolderOpen className="mr-2 inline size-4" />{project.name}</button><div className="flex shrink-0 items-center gap-2"><History projectId={id} current={active.id} onOpen={(messages, chatId) => { rememberConversation(chatId); setActive({ id: chatId, messages }); }} /><button className={button} onClick={() => { rememberConversation(null); setActive(null); }}><Plus className="size-4" />Nieuw gesprek</button></div></div>
      <div className="min-h-0 flex-1"><ChatPage key={active.id} projectId={id} projectName={project.name} conversation={active} initialQuestion={active.initialQuestion} onSaved={() => { refreshChats().catch((e) => setError(e.message)); }} /></div>
    </> : <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-16 sm:px-8 sm:pt-16">
      <div className="mb-7 flex items-center justify-between gap-3"><h1 className="flex min-w-0 items-center gap-3 text-2xl font-medium"><FolderOpen aria-hidden="true" className="size-7 shrink-0" /><span className="truncate">{project.name}</span></h1><button className={button} aria-label="Projectinstructies" onClick={() => { setSettingsDraft(project); setSettings(true); }}><SlidersHorizontal className="size-4" /><span className="hidden sm:inline">Instructies</span></button></div>
      <AI_Prompt value={question} onValueChange={setQuestion} busy={false} onStop={() => {}} placeholder="Stel een vraag binnen dit project…" onSubmit={(text) => { setActive({ id: crypto.randomUUID(), messages: [], initialQuestion: text }); setQuestion(""); }} />
      <div className="mt-8"><SmoothTab label="Projectinhoud" items={[
        { id: "chats", title: "Gesprekken", content: <div className="pt-4"><ul className="divide-y">{chats.map((c) => <li key={c.id}><button className="flex w-full items-center gap-3 rounded-xl px-2 py-4 text-left hover:bg-muted" disabled={busy} onClick={() => openChat(c.id)}><MessageSquare className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{c.title}</span><span className="shrink-0 text-xs text-muted-foreground">{new Date(c.updated).toLocaleDateString("nl-NL")}</span></button></li>)}</ul>{!chats.length && <p className="py-8 text-center text-sm text-muted-foreground">Je gesprekken verschijnen hier.</p>}</div> },
        { id: "sources", title: `Bronnen${visible.length ? ` (${visible.length})` : ""}`, content: <div className="pt-5" data-no-swipe><button className={button} onClick={() => setAdding(true)}><Plus className="size-4" />Bronnen toevoegen</button><ul className="mt-4 divide-y">{visible.map((d) => <li className="flex items-center gap-3 py-4" key={d.id}><FileText className="size-4 shrink-0 text-muted-foreground" /><button className="min-w-0 flex-1 text-left" onClick={() => { const href = `/bron/project/${id}/${d.id}/1`; setSelected({ kind: "project", projectId: id, documentId: d.id, page: 1, href, quote: "", key: citationKey(href, "") }); }}><span className="block truncate">{d.filename}</span><span className="text-xs text-muted-foreground">{states[d.status] || `${d.pages} ${d.kind === "markdown" ? "kennisbestand" : d.kind === "note" ? "tekstbron" : "pagina’s"}`}</span></button>{["error", "needs_ocr"].includes(d.status) && <button className={button} onClick={() => run(async () => { await projectRequest(`/${id}/documents/${d.id}/retry`, "POST"); await refreshDocs(); })}>Opnieuw</button>}<button className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label={`Archiveer ${d.filename}`} onClick={() => run(async () => { await projectRequest(`/${id}/documents/${d.id}/archive`, "POST"); await refreshDocs(); })}><X className="size-4" /></button></li>)}</ul>{!visible.length && <p className="py-8 text-center text-sm text-muted-foreground">Voeg bestanden of tekst toe als context voor dit project.</p>}</div> },
      ]} /></div>
    </main>}
    <Drawer handleOnly open={settings} onOpenChange={setSettings}><DrawerContent className={modal}><div className="mb-4 flex items-center justify-between"><DrawerTitle className="text-xl font-semibold">Projectinstructies</DrawerTitle><button className="size-11 rounded-full hover:bg-muted" aria-label="Sluit instructies" onClick={() => setSettings(false)}><X className="mx-auto size-4" /></button></div><DrawerDescription className="mb-4 text-muted-foreground">Context voor de gesprekken in dit project.</DrawerDescription>{settingsDraft && <form className="space-y-4 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); run(async () => { const p = await projectRequest(`/${id}`, "PUT", settingsDraft); setProject(p); await refreshDocs(); setSettings(false); setNotice("Instructies opgeslagen"); }); }}><label className="block space-y-2"><span className="text-sm">Projectnaam</span><input className={input} required maxLength={200} value={settingsDraft.name} onChange={(e) => setSettingsDraft({ ...settingsDraft, name: e.target.value })} /></label><label className="block space-y-2"><span className="text-sm">Wat moet de assistent weten?</span><Textarea rows={6} maxLength={20000} value={settingsDraft.context} onChange={(e) => setSettingsDraft({ ...settingsDraft, context: e.target.value })} placeholder="Achtergrond, je onderzoeksvraag en hoe je geholpen wilt worden…" /></label><label className="flex items-start gap-3 text-sm"><input className="mt-1 size-4 shrink-0" type="checkbox" checked={settingsDraft.allow_private} onChange={(e) => setSettingsDraft({ ...settingsDraft, allow_private: e.target.checked })} /><span>Projectcontext en bronnen gebruiken met het AI-model<span className="mt-1 block text-xs text-muted-foreground">Sta toe dat relevante tekst en scans naar de AI-aanbieder gaan voor antwoorden en OCR. Uitgeschakeld blijft je materiaal lokaal doorzoekbaar. Eerder verzonden tekst kan niet worden teruggehaald.</span></span></label><div className="flex justify-end"><button disabled={busy} className="min-h-11 rounded-full bg-primary px-5 text-primary-foreground">Opslaan</button></div></form>}</DrawerContent></Drawer>
    <AddSources key={String(adding)} error={error} open={adding} onClose={() => setAdding(false)} busy={busy} uploading={uploading} onFiles={(f) => run(() => addFiles(f))} onNote={(title, text) => run(async () => { await projectRequest(`/${id}/notes`, "POST", { title, text }); await refreshDocs(); setAdding(false); })} />
    <Drawer direction="right" open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DrawerContent className="w-full! max-w-[min(40rem,100vw)]! overflow-y-auto p-5"><div className="mb-4 flex items-center justify-between"><DrawerTitle>Projectbron</DrawerTitle><button className="size-11 rounded-full hover:bg-muted" aria-label="Sluit bron" onClick={() => setSelected(null)}><X className="mx-auto size-4" /></button></div><DrawerDescription className="sr-only">De originele tekst en pagina van de projectbron.</DrawerDescription>{selected && <>{selected.kind === "project" && <label className="mb-4 flex items-center gap-3 text-sm">Pagina<input type="number" className="w-20 rounded-lg border bg-background p-2" min={1} max={documents.find((d) => d.id === selected.documentId)?.pages || 1} value={selected.page} onChange={(e) => { const page = Number(e.target.value); if (page >= 1) { const href = `/bron/project/${id}/${selected.documentId}/${page}`; setSelected({ ...selected, page, href, key: citationKey(href, "") }); } }} /></label>}<SourceView c={selected} docs={{}} /><LocalSearch id={id} onSelect={setSelected} /></>}</DrawerContent></Drawer>
    <span className="sr-only" role="status">{notice}</span>
  </div>;
}

function AddSources({ error, open, onClose, busy, uploading, onFiles, onNote }: { error: string; open: boolean; onClose: () => void; busy: boolean; uploading: string; onFiles: (files: File[] | Promise<File[]>) => void; onNote: (title: string, text: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => { const files = Array.from(e.target.files || []); e.target.value = ""; if (files.length) onFiles(files); };
  const [paste, setPaste] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return <Drawer handleOnly open={open} onOpenChange={(value) => { if (!value) onClose(); }}><DrawerContent className={modal}><div className="mb-5 flex items-center justify-between"><DrawerTitle className="text-xl font-semibold">Bronnen toevoegen</DrawerTitle><button aria-label="Sluit bronnen toevoegen" className="size-11 rounded-full hover:bg-muted" onClick={onClose}><X className="mx-auto size-4" /></button></div><DrawerDescription className="sr-only">Upload PDF- of Markdown-bestanden of een hele map, of plak tekst als projectcontext.</DrawerDescription>
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    <input ref={file} type="file" multiple accept="application/pdf,.pdf,text/markdown,.md" className="sr-only" tabIndex={-1} aria-label="PDF- of Markdown-bestanden kiezen" onChange={pick} />
    <input ref={folder} type="file" {...{ webkitdirectory: "" }} className="sr-only" tabIndex={-1} aria-label="Map kiezen" onChange={pick} />
    {paste ? <form className="space-y-4 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); onNote(title, text); }}><input aria-label="Titel van tekstbron" className={input} required placeholder="Titel, bijvoorbeeld context.md" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /><Textarea aria-label="Brontekst" required rows={8} maxLength={100000} placeholder="Plak je tekst…" value={text} onChange={(e) => setText(e.target.value)} /><div className="flex justify-between"><button className={button} type="button" onClick={() => setPaste(false)}>Terug</button><button disabled={busy} className="min-h-11 rounded-full bg-primary px-5 text-primary-foreground">Toevoegen</button></div></form> : <>
      <button disabled={busy} className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed text-muted-foreground hover:bg-muted" onClick={() => file.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (busy) return; const entries = Array.from(e.dataTransfer.items, (i) => i.webkitGetAsEntry()); onFiles(Promise.all(entries.map(entryFiles)).then((f) => f.flat())); }}><FileText className="size-7" /><span>{busy ? uploading || "Uploaden…" : "Sleep bestanden of mappen hierheen"}</span><span className="text-xs">PDF · Markdown (.md)</span></button>
      <div className="mt-4 grid grid-cols-3 gap-3"><button className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl bg-muted text-sm" disabled={busy} onClick={() => file.current?.click()}><Upload className="size-5" />Bestanden</button><button className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl bg-muted text-sm" disabled={busy} onClick={() => folder.current?.click()}><FolderUp className="size-5" />Map</button><button className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl bg-muted text-sm" disabled={busy} onClick={() => setPaste(true)}><FileText className="size-5" />Tekst plakken</button></div>
    </>}
  </DrawerContent></Drawer>;
}

function LocalSearch({ id, onSelect }: { id: string; onSelect: (c: Citation) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ document_id: string; filename: string; page: number; excerpt: string; href: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; const timer = setTimeout(() => { if (!query.trim()) { setHits([]); return; } projectRequest(`/${id}/search?q=${encodeURIComponent(query)}`).then((r) => { if (live) { setHits(r); setError(""); } }).catch((e) => { if (live) setError(e.message); }); }, 200); return () => { live = false; clearTimeout(timer); }; }, [id, query]);
  return <div className="mt-6 space-y-3 border-t pt-5"><input aria-label="Zoek in projectbronnen" className={input} placeholder="Zoek in alle projectbronnen…" value={query} onChange={(e) => setQuery(e.target.value)} />{error && <p role="alert">{error}</p>}{hits.map((h) => <button className="block w-full rounded-lg p-2 text-left hover:bg-muted" key={h.href} onClick={() => onSelect({ kind: "project", projectId: id, documentId: h.document_id, page: h.page, href: h.href, quote: h.excerpt, key: citationKey(h.href, h.excerpt) })}><span className="block text-sm font-medium">{h.filename} · p. {h.page}</span><span className="line-clamp-3 text-sm text-muted-foreground">{h.excerpt}</span></button>)}</div>;
}
