"use client";

import { useChat } from "@ai-sdk/react";
import { generateId, getToolName, isToolUIPart, type UIMessage } from "ai";
import Link from "next/link";
import { Copy, SquarePen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Answer, DrawnCheck } from "@/components/answer";
import { CitationPreviewProvider } from "@/components/citation-preview";
import { RichAnswer } from "@/components/rich-answer";
import type { presentAnswer } from "@/lib/rich-answer";
import { type DocMeta, Evidence } from "@/components/evidence";
import { History } from "@/components/history";
import AILoadingState, { type AgentStep } from "@/components/kokonutui/ai-loading";
import AIContextMeter from "@/components/kokonutui/ai-context-meter";
import AIModelSelector from "@/components/kokonutui/ai-model-selector";
import AI_Prompt from "@/components/kokonutui/ai-prompt";
import CommandButton from "@/components/kokonutui/command-button";
import AITextLoading from "@/components/kokonutui/ai-text-loading";
import ScrollIndex from "@/components/kokonutui/scroll-index";
import SwitchButton from "@/components/kokonutui/switch-button";
import { Logo } from "@/components/logo";
import { announceAnswer, NotifyBell } from "@/components/notify";
import { OrgSearch } from "@/components/org-search";
import { Welcome } from "@/components/welcome";
import { hidePartialLink, parseCitations } from "@/lib/citations";
import { missingAnswer } from "@/lib/chat-policy";
import { conversationId, reconnectOnReturn, rememberConversation } from "@/lib/chat-session";
import { type AnswerMeta, answerLabel, CONTEXT_WINDOW, type ModelSelection, pickModel } from "@/lib/models";
import { cn } from "@/lib/utils";

const richOf = (m: UIMessage) => m.parts.filter(isToolUIPart).flatMap((p) =>
  getToolName(p) === "present_answer" && p.state === "output-available" ? [p.output as ReturnType<typeof presentAnswer>] : []
);

const textOf = (m: UIMessage) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n") + richOf(m).map((r) => `\n\n${r.fallback}`).join("");

type Out = Record<string, unknown> & { length?: number };
const quoted = (s: unknown) => `“${String(s ?? "")}”`;

/** Tool calls as Dutch steps for Kokonut's AI State Loading. `live`: this message is still streaming; once it isn't,
 * a call without a result was stopped, and must not keep spinning. */
function stepsOf(m: UIMessage, live: boolean): AgentStep[] {
  return m.parts.filter(isToolUIPart).map((p) => {
    const input = (p.input ?? {}) as Record<string, unknown>;
    const out = (p.state === "output-available" ? p.output : null) as Out | Out[] | null;
    const status = p.state === "output-available" ? "done" : p.state === "output-error" || !live ? "error" : "running";
    const list = Array.isArray(out) ? out : [];
    let label: string;
    let detail: string[] | undefined;
    switch (getToolName(p)) {
      case "search_organizations":
        label = !out
          ? `Zoeken naar ${quoted(input.query)}`
          : list.length === 1
            ? `Gevonden: ${list[0].name}`
            : list.length
              ? `${list.length} organisaties gevonden voor ${quoted(input.query)}`
              : `Niets gevonden voor ${quoted(input.query)}`;
        break;
      case "get_document": {
        const d = out as Out | null;
        label = d
          ? `${d.type} ${d.year} van ${d.org_name} gelezen, pagina ${input.pages ?? "1-5"}`
          : `Jaarverslag openen, pagina ${input.pages ?? "1-5"}`;
        detail = ["De eerste keer wordt een document omgezet. Dat kan even duren."];
        break;
      }
      case "get_figures": {
        const f = out as Out | null;
        label = !f
          ? `Cijfers opzoeken in de DigiMV-vragenlijst ${input.year}`
          : f.found
            ? `${input.query ? `${quoted(input.query)} uit de` : "Cijfers uit de"} DigiMV-vragenlijst ${f.year} van ${f.name}`
            : `Geen DigiMV-vragenlijst ${input.year} gevonden`;
        break;
      }
      case "search_documents":
        label = out
          ? `${list.length} ${list.length === 1 ? "plek" : "plekken"} gevonden voor ${quoted(input.query)}`
          : `In de tekst zoeken naar ${quoted(input.query)}`;
        break;
      case "get_key_figures": {
        const name = list.find((y) => y.name)?.name;
        label = out ? `Kerncijfers ${list.map((y) => y.year).join(", ")}${name ? ` van ${name}` : ""}` : "Kerncijfers over de jaren opzoeken";
        break;
      }
      case "get_register_entry": {
        const r = out as Out | null;
        label = !r ? `Zorgaanbiedersregister raadplegen (KvK ${input.kvk})`
          : r.found ? `${r.naam} in het Landelijk Register Zorgaanbieders` : `KvK ${input.kvk} staat niet in het register`;
        break;
      }
      case "search_register": {
        const r = out as Out | null;
        label = r ? `${r.total} zorgaanbieders in het register voor ${quoted(input.naam ?? input.postcode)}`
          : `Zorgaanbiedersregister doorzoeken op ${quoted(input.naam ?? input.postcode)}`;
        break;
      }
      case "find_government_body": {
        const n = ((out as Out | null)?.results as unknown[] | undefined)?.length;
        label = n == null ? `Overheid zoeken: ${quoted(input.query)}` : `${n} ${n === 1 ? "overheidsorgaan" : "overheidsorganen"} gevonden voor ${quoted(input.query)}`;
        break;
      }
      case "get_government_finances": {
        const r = out as Out | null;
        label = r ? `${r.verslagsoort} ${r.year} van ${r.naam} (CBS Iv3)${input.taakveld ? `, taakveld ${quoted(input.taakveld)}` : ""}`
          : `Overheidsfinanciën opzoeken bij het CBS (${input.code} ${input.year})`;
        detail = ["Bedragen in duizenden euro's, zoals de overheid ze aan het CBS rapporteerde."];
        break;
      }
      case "search_rulings": {
        const r = out as Out | null;
        label = r ? `${r.total} ${r.total === 1 ? "uitspraak" : "uitspraken"} noemen ${quoted(input.query)}` : `Uitspraken zoeken met ${quoted(input.query)}`;
        break;
      }
      case "get_ruling": {
        const r = out as Out | null;
        label = r ? `Uitspraak ${r.instantie}, ${r.uitspraakdatum} gelezen (deel ${r.part} van ${r.parts})` : `Uitspraak ${input.ecli} lezen`;
        break;
      }
      case "search_woo":
      case "search_publications":
      case "search_regulations":
      case "search_tenders":
      case "search_datasets":
      case "search_cbs": {
        const where = ({ search_woo: "Woo-documenten", search_publications: "officiële bekendmakingen", search_regulations: "lokale regelgeving",
          search_tenders: "Europese aanbestedingen", search_datasets: "data.overheid.nl", search_cbs: "CBS-tabellen" } as Record<string, string>)[getToolName(p)];
        const r = out as Out | null;
        label = r ? `${r.total} resultaten in ${where}${input.query ? ` voor ${quoted(input.query)}` : ""}` : `Zoeken in ${where}${input.query ? `: ${quoted(input.query)}` : ""}`;
        break;
      }
      case "read_document": {
        const r = out as Out | null;
        label = r ? `Document gelezen, ${r.unit === "page" ? "pagina" : "deel"} ${input.pages ?? "1-5"} van ${r.page_count}` : `Document openen: ${input.url}`;
        detail = ["De eerste keer wordt een document opgehaald en omgezet. Dat kan even duren."];
        break;
      }
      case "list_links": {
        const r = out as Out | null;
        label = r ? `${r.matched} links op ${quoted(r.title || input.url)}` : `Links bekijken op ${input.url}`;
        break;
      }
      case "search_public_documents":
        label = out ? `In documenten gezocht naar ${quoted(input.query)}` : `In documenten zoeken naar ${quoted(input.query)}`;
        break;
      case "get_dataset":
        label = out ? `Dataset ${quoted((out as Out).title)}` : "Dataset bekijken";
        break;
      case "read_table": {
        const r = out as Out | null;
        label = r ? `${r.rows_matched} van ${r.rows_total} rijen${input.query ? ` met ${quoted(input.query)}` : ""}` : "Databestand lezen";
        break;
      }
      case "describe_cbs_table":
      case "get_cbs": {
        const r = out as Out | null;
        label = r ? `CBS ${input.table_id}: ${r.title}` : `CBS-tabel ${input.table_id} ${getToolName(p) === "get_cbs" ? "opvragen" : "bekijken"}`;
        break;
      }
      case "list_project_documents":
        label = out ? `${list.length} projectbronnen beschikbaar` : "Projectbronnen bekijken";
        break;
      case "search_project_documents":
        label = out ? `${list.length} projectpassages gevonden` : "Projectdocumenten doorzoeken";
        break;
      case "read_project_page":
        label = out ? "Projectpagina gelezen" : "Projectpagina lezen";
        break;
      case "present_answer":
        label = out ? "Cijfers en bronnen klaargezet" : "Cijfers overzichtelijk maken";
        break;
      default:
        label = getToolName(p);
    }
    if (p.state === "output-error") label = `${label}: mislukt`;
    return { id: p.toolCallId, label, status, detail };
  });
}

/** The site a public document came from, as people say it: menzis.nl. */
const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Openbaar document";
  }
};

/** Organisation name and document type per year/doc_id (title and site per doc/id), from what the tools already returned. */
function docsOf(messages: UIMessage[]) {
  const docs: Record<string, DocMeta> = {};
  for (const p of messages.flatMap((m) => m.parts)) {
    if (!isToolUIPart(p) || p.state !== "output-available") continue;
    const out = p.output as Out & Out[];
    if (getToolName(p) === "search_organizations") {
      for (const o of out) {
        for (const d of o.documents as Out[]) docs[`${d.year}/${d.id}`] = { org: String(o.name), type: String(d.type) };
      }
    } else if (getToolName(p) === "get_document") {
      docs[`${out.year}/${out.doc_id}`] = { org: String(out.org_name), type: String(out.type) };
    } else if (getToolName(p) === "read_document") {
      docs[`doc/${out.id}`] = { org: String(out.title), type: siteOf(String(out.file_url)), url: String(out.url) };
    }
  }
  return docs;
}

/** Typed into the empty prompt of a new chat, one after the other. */
const EXAMPLES = [
  "Wat was de omzet van Alrijne in 2024?",
  "Vergelijk het eigen vermogen van twee ziekenhuizen",
  "Hoeveel fte had Zuyderland in 2023?",
];

/** The shape of a chat while it loads. Fades in after a moment, so a page that is ready at once never flashes it. */
function ChatSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[46rem] px-5 pt-24 sm:px-8" role="status">
      <span className="sr-only">Gesprek laden</span>
      <div aria-hidden="true" style={{ animation: "page-fade 200ms 400ms both" }}>
        <div className="space-y-4 motion-safe:animate-pulse">
          <div className="h-7 w-3/4 rounded-lg bg-muted" />
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="space-y-2.5 pt-4">
            <div className="h-4 rounded bg-muted" />
            <div className="h-4 w-11/12 rounded bg-muted" />
            <div className="h-4 w-4/5 rounded bg-muted" />
          </div>
          <div className="h-44 rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}

/** Markdown links to sources as their label, for pasting the answer as plain text. Same link shape as LINK in
 * lib/citations.ts: the quoted title may hold brackets of its own. */
const plainAnswer = (text: string) =>
  text.replace(/\[([^\]\n]*)\]\(\/bron\/[^\s)"']+(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g, "$1").trim();

/** Under a finished answer: which model answered and how long it took, and a copy of the answer to take along. */
function AnswerBody({ children, done, meta, text }: { children: ReactNode; done: boolean; meta?: AnswerMeta; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"ok" | "error" | null>(null);
  const label = meta ? answerLabel(meta) : "";

  // HTML for Word and mail, with the chips as links to their source; plain text for the rest.
  const copy = async () => {
    try {
      const clone = ref.current!.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[role="tablist"], [role="tabpanel"][inert], [data-no-copy], [aria-hidden="true"], svg').forEach((el) => el.remove());
      clone.querySelectorAll<HTMLElement>("[data-citation]").forEach((chip) => {
        const a = document.createElement("a");
        a.href = new URL(chip.dataset.href ?? "/", window.location.origin).href;
        a.textContent = chip.childNodes[0]?.textContent ?? "bron";
        chip.replaceWith(a);
      });
      clone.querySelectorAll("button").forEach((b) => b.remove());
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([clone.innerHTML], { type: "text/html" }),
        "text/plain": new Blob([plainAnswer(text)], { type: "text/plain" }),
      })]);
      setCopied("ok");
    } catch {
      setCopied("error");
    }
    setTimeout(() => setCopied(null), 2000);
  };

  const button = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold text-[0.9rem] text-foreground transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <>
      <div ref={ref}>{children}</div>
      {done && (
        <div className="mt-3 flex flex-wrap items-center gap-1 text-[0.9rem] text-muted-foreground">
          {label && <span className="mr-auto pr-2">{label}</span>}
          <button className={cn(button, !label && "-ml-3")} onClick={copy} type="button">
            {copied === "ok" ? <DrawnCheck /> : <Copy aria-hidden="true" className="size-4" />}
            Kopieer
          </button>
          <span aria-live="polite" className="sr-only">
            {copied === "ok" ? "Antwoord gekopieerd" : copied === "error" ? "Kopiëren lukte niet" : ""}
          </span>
        </div>
      )}
    </>
  );
}

type Conversation = { id: string; messages: UIMessage[] };
type ChatProps = { projectId?: string; projectName?: string; conversation?: Conversation; initialQuestion?: string; onSaved?: () => void };

export function ChatPage(props: ChatProps) {
  const [session, setSession] = useState<Conversation | null>(props.conversation ?? null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (props.conversation) return;
    let live = true;
    const id = conversationId(new URL(window.location.href));
    if (!id) {
      Promise.resolve().then(() => { if (live) setSession({ id: generateId(), messages: [] }); });
    } else {
      fetch(`/digimv/chats/${encodeURIComponent(id)}`, { cache: "no-store" }).then(async (r) => {
        if (r.status === 404) return { id, messages: [] };
        if (!r.ok) throw new Error("Gesprek laden mislukt. Ververs de pagina om opnieuw te proberen.");
        const saved = await r.json();
        if ((saved.project_id ?? undefined) !== props.projectId) throw new Error("Dit gesprek hoort bij een andere werkruimte.");
        return { id, messages: saved.messages };
      }).then((saved) => { if (live) setSession(saved); }).catch((e) => { if (live) setLoadError(e.message); });
    }
    return () => { live = false; };
  }, [props.conversation, props.projectId]);
  if (loadError) return <p className="p-6 text-center text-muted-foreground" role="alert">{loadError}</p>;
  if (!session) return <ChatSkeleton />;
  return <ChatSession key={session.id} {...props} conversation={session} onOpen={(messages, id) => {
    rememberConversation(messages.length ? id : null);
    setSession({ id, messages });
  }} />;
}

function ChatSession({ projectId, projectName, conversation, initialQuestion, onSaved, onOpen }: ChatProps & { conversation: Conversation; onOpen: (messages: UIMessage[], id: string) => void }) {
  // resume: a dropped connection (a phone that locked) picks the answer up again when the page is back in view.
  const chat = useChat({
    resume: true,
    id: conversation.id,
    messages: conversation.messages,
    onFinish: ({ messages, isAbort, isError }) => {
      const question = messages.findLast((m) => m.role === "user");
      if (question && !isAbort && !isError) announceAnswer(textOf(question));
      onSaved?.();
    },
  });
  const { messages, sendMessage, status, stop, error, regenerate, resumeStream } = chat;
  const [evidence, setEvidence] = useState<{ messageId: string; key: string } | null>(null);
  const busy = status === "submitted" || status === "streaming";
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => reconnectOnReturn(
    () => ["submitted", "streaming", "error"].includes(statusRef.current),
    async (shouldResume) => {
      await stop();
      if (shouldResume()) await resumeStream();
    },
  ), [stop, resumeStream]);
  const lastQuestion = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const docs = useMemo(() => docsOf(messages), [messages]);
  // Rendered only after the session loads in the browser, so reading the saved choice here can't mismatch SSR.
  const [choice, setChoice] = useState<ModelSelection>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("model") ?? "{}");
      return pickModel(saved.model, saved.effort);
    } catch { return pickModel(); }
  });
  const choose = (next: ModelSelection) => {
    setChoice(next);
    try { localStorage.setItem("model", JSON.stringify(next)); } catch {}
  };
  const body = { projectId, ...choice };
  const context = messages.map((m) => (m.metadata as AnswerMeta | undefined)?.context).findLast(Boolean);

  const shownMessage = evidence ? messages.find((m) => m.id === evidence.messageId) : undefined;
  const shownText = shownMessage ? textOf(shownMessage) : "";
  const citations = useMemo(() => parseCitations(shownText), [shownText]);
  const index = Math.max(0, citations.findIndex((c) => c.key === evidence?.key));

  const ask = (text: string) => {
    rememberConversation(chat.id);
    return sendMessage({ text }, { body });
  };
  // The answer runs on even when the connection drops, so Stop tells the server too.
  const halt = () => {
    stop();
    fetch(`/api/chat/${encodeURIComponent(chat.id)}/stream`, { method: "DELETE" }).catch(() => {});
  };
  const load = (saved: UIMessage[], id: string) => {
    // Switching chats detaches the client; the server keeps finishing the previous answer.
    onOpen(saved, id);
  };

  // From an organisation page: /?vraag=… asks its question. A fresh page first asks the server for an answer to
  // resume; there is none, and its "none" must not land on top of this question, so that is stopped first.
  const asked = useRef(false);
  useEffect(() => {
    const q = initialQuestion ?? new URLSearchParams(window.location.search).get("vraag");
    if (!q || asked.current) return;
    asked.current = true;
    rememberConversation(chat.id);
    stop().then(() => sendMessage({ text: q }, { body: { projectId, ...choice } }));
  }, [stop, sendMessage, projectId, initialQuestion, chat.id, choice]);
  const onIndex = useCallback(
    (i: number) => evidence && setEvidence({ messageId: evidence.messageId, key: citations[i].key }),
    [evidence, citations]
  );

  // A new question moves to the top of the screen; its answer writes itself below it.
  const questions = messages.filter((m) => m.role === "user").length;
  useEffect(() => {
    if (questions) lastQuestion.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [questions]);

  const last = messages.at(-1);
  const waiting = status === "submitted" && last?.role === "user";

  return (
    <CitationPreviewProvider docs={docs}>
      <div className={projectId ? "flex h-full min-h-0" : "flex h-dvh"}>
        <div className="flex min-w-0 flex-1 flex-col">
          {!projectId && <header className="@container flex h-16 shrink-0 items-center justify-between gap-4 px-5 sm:px-8">
            <Logo />
            <div className="flex items-center gap-2">
              {!projectId && <Link className="raised rounded-full px-4 py-3" href="/projecten">Projecten</Link>}
              <OrgSearch />
              {/* ponytail: phones only notify through a service worker, so the bell is for desktops */}
              <NotifyBell className="hidden md:inline-flex" />
              <History current={chat.id} onOpen={load} projectId={projectId} />
              <SwitchButton />
              {messages.length > 0 && (
                <CommandButton
                  aria-label="Nieuwe vraag"
                  className="min-w-11 shrink-0 justify-center whitespace-nowrap font-normal @2xl:pl-4"
                  keysClassName="hidden @2xl:flex"
                  onClick={() => load([], generateId())}
                  shortcut="mod+shift+o"
                >
                  <SquarePen aria-hidden="true" className="size-[18px] @2xl:hidden" />
                  <span className="hidden @2xl:inline">Nieuwe vraag</span>
                </CommandButton>
              )}
            </div>
          </header>}

          <ScrollIndex className="flex-1" label="Vragen in dit gesprek" selector="[data-question]">
            <div className="mx-auto h-full w-full max-w-[46rem] px-5 sm:px-8">
              {messages.length === 0 ? (
                projectId ? <div className="flex min-h-72 flex-col justify-center py-12">
                  <p className="text-sm text-muted-foreground">{projectName}</p>
                  <h2 className="mt-3 text-2xl font-semibold">Wat wil je uitzoeken?</h2>
                  <p className="mt-3 max-w-lg text-muted-foreground">Stel een vraag over je projectbronnen of de publieke jaarverslagen. Controleer de onderbouwing via de bronverwijzingen in het antwoord.</p>
                </div> : <Welcome onAsk={ask} />
              ) : (
                <div className="pb-10">
                  {messages.map((m, i) => {
                    const isLastTurn = i >= messages.length - 2;
                    if (m.role === "user") {
                      return (
                        <h2
                          className={cn(
                            "scroll-mt-6 text-balance font-semibold text-[1.3rem] leading-snug",
                            i === 0 ? "pt-6" : "mt-12 border-t pt-10"
                          )}
                          data-question=""
                          key={m.id}
                          ref={i === messages.findLastIndex((x) => x.role === "user") ? lastQuestion : undefined}
                        >
                          {textOf(m)}
                        </h2>
                      );
                    }
                    const streaming = busy && m === last;
                    const steps = stepsOf(m, streaming);
                    const plainText = m.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n\n");
                    const text = streaming ? hidePartialLink(plainText) : plainText;
                    const incomplete = !streaming && missingAnswer(m);
                    // Between tool calls the agent is still at work: never let the list read as finished.
                    if (streaming && steps.length && !steps.some((s) => s.status === "running")) {
                      steps.push({ id: "next", label: text ? "Antwoord schrijven" : "Verder zoeken", status: "running" });
                    }
                    const thinking = streaming && !text && !steps.some((s) => s.status === "running");
                    const rich = richOf(m);
                    return (
                      // The last turn fills the screen, so its question can sit at the top while the answer streams.
                      <section className={cn("mt-5", isLastTurn && "min-h-[calc(100dvh-20rem)]")} key={m.id}>
                        {steps.length > 0 && <AILoadingState className="mb-5" completed={!streaming && !missingAnswer(m)} steps={steps} />}
                        {thinking && <Thinking />}
                        {incomplete && <div className="my-4 rounded-xl border p-4" role="status"><p>{incomplete}</p><button className="mt-3 min-h-11 rounded-full px-4 ring-1 ring-border" disabled={busy} onClick={() => ask("Ga verder met de oorspronkelijke vraag en gebruik de al gevonden bronnen. Geef een antwoord met wat je hebt en benoem wat nog ontbreekt.")}>Ga verder met de gevonden bronnen</button></div>}
                        <AnswerBody done={!streaming && Boolean(text || rich.length)} meta={m.metadata as AnswerMeta | undefined} text={textOf(m)}>
                          {text && (
                            <Answer
                              activeKey={evidence?.messageId === m.id ? evidence.key : null}
                              onCite={(key) => setEvidence({ messageId: m.id, key })}
                              question={messages[i - 1] ? textOf(messages[i - 1]) : ""}
                              text={text}
                            />
                          )}
                          {rich.map((data, j) => (
                            <RichAnswer activeKey={evidence?.messageId === m.id ? evidence.key : null} data={data} key={j}
                              onCite={(key) => setEvidence({ messageId: m.id, key })}
                              question={messages[i - 1] ? textOf(messages[i - 1]) : ""} />
                          ))}
                        </AnswerBody>
                      </section>
                    );
                  })}
                  {waiting && (
                    <section className="mt-5 min-h-[calc(100dvh-20rem)]">
                      <Thinking />
                    </section>
                  )}
                  {error && (
                    <div className="mt-6 rounded-xl px-4 py-3 ring-1 ring-destructive/40" role="alert">
                      <p>Het antwoord kon niet worden opgehaald. {error.message}</p>
                      <button
                        className="mt-2 min-h-11 rounded-full px-4 font-semibold ring-1 ring-border hover:bg-card"
                        onClick={() => regenerate({ body })}
                        type="button"
                      >
                        Probeer opnieuw
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollIndex>

          <div className="shrink-0 px-5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
            <div className="mx-auto max-w-[46rem]">
              <AI_Prompt
                busy={busy}
                examples={messages.length || projectId ? undefined : EXAMPLES}
                footer={<>
                  <AIModelSelector onChange={choose} value={choice} />
                  {context && <AIContextMeter className="ml-auto" limit={CONTEXT_WINDOW} segments={[
                    { id: "prompt", label: "Instructies en gesprek", tokens: context.prompt, color: "bg-muted-foreground/50" },
                    { id: "sources", label: "Gelezen bronnen", tokens: context.sources, color: "bg-(--series-1)" },
                  ]} />}
                </>}
                onStop={halt}
                onSubmit={ask}
                onValueChange={setDraft}
                ref={promptRef}
                value={draft}
              />
              <p className="mt-2 text-center text-[0.85rem] text-muted-foreground">
                Klik op een geel paginanummer om te zien waar het staat.
              </p>
            </div>
          </div>
        </div>

        <Evidence
          drawer={Boolean(projectId)}
          citations={citations}
          docs={docs}
          index={index}
          onClose={() => setEvidence(null)}
          onIndex={onIndex}
          open={Boolean(evidence && citations.length)}
        />
      </div>
    </CitationPreviewProvider>
  );
}

function Thinking() {
  return (
    <AITextLoading
      className="justify-start font-normal text-[1rem] text-muted-foreground dark:text-muted-foreground"
      interval={1800}
      label="Bezig met nadenken"
      texts={["Even nadenken", "De jaarverslagen nalopen", "Cijfers controleren"]}
    />
  );
}
