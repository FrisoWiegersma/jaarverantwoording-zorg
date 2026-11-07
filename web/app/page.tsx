"use client";

import { useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { SquarePen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Answer } from "@/components/answer";
import { CitationPreviewProvider } from "@/components/citation-preview";
import { RichAnswer } from "@/components/rich-answer";
import type { presentAnswer } from "@/lib/rich-answer";
import { type DocMeta, Evidence } from "@/components/evidence";
import { History } from "@/components/history";
import AILoadingState, { type AgentStep } from "@/components/kokonutui/ai-loading";
import AI_Prompt from "@/components/kokonutui/ai-prompt";
import AITextLoading from "@/components/kokonutui/ai-text-loading";
import ScrollIndex from "@/components/kokonutui/scroll-index";
import SwitchButton from "@/components/kokonutui/switch-button";
import { Logo } from "@/components/logo";
import { announceAnswer, NotifyBell } from "@/components/notify";
import { OrgSearch } from "@/components/org-search";
import { Welcome } from "@/components/welcome";
import { hidePartialLink, parseCitations } from "@/lib/citations";
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

/** Organisation name and document type per year/doc_id, from what the tools already returned. */
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
    }
  }
  return docs;
}

export default function Page() {
  // resume: a dropped connection (a phone that locked) picks the answer up again when the page is back in view.
  const chat = useChat({
    resume: true,
    onFinish: ({ messages, isAbort, isError }) => {
      const question = messages.findLast((m) => m.role === "user");
      if (question && !isAbort && !isError) announceAnswer(textOf(question));
    },
  });
  // The chat's id is drawn at random on first read: only read it when it is needed, never while rendering.
  const { messages, sendMessage, status, stop, error, regenerate, setMessages } = chat;
  const [evidence, setEvidence] = useState<{ messageId: string; key: string } | null>(null);
  const busy = status === "submitted" || status === "streaming";
  const lastQuestion = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const docs = useMemo(() => docsOf(messages), [messages]);

  const shownMessage = evidence ? messages.find((m) => m.id === evidence.messageId) : undefined;
  const shownText = shownMessage ? textOf(shownMessage) : "";
  const citations = useMemo(() => parseCitations(shownText), [shownText]);
  const index = Math.max(0, citations.findIndex((c) => c.key === evidence?.key));

  const ask = (text: string) => sendMessage({ text });
  // The answer runs on even when the connection drops, so Stop tells the server too.
  const halt = () => {
    stop();
    fetch(`/api/chat/${encodeURIComponent(chat.id)}/stream`, { method: "DELETE" }).catch(() => {});
  };
  const load = (saved: UIMessage[]) => {
    if (busy) halt();
    setMessages(saved);
    setEvidence(null);
  };

  // From an organisation page: /?vraag=… asks its question. A fresh page first asks the server for an answer to
  // resume; there is none, and its "none" must not land on top of this question, so that is stopped first.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("vraag");
    if (!q) return;
    window.history.replaceState(null, "", "/");
    stop().then(() => sendMessage({ text: q }));
  }, [stop, sendMessage]);
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
      <div className="flex h-dvh">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-5 sm:px-8">
            <Logo />
            <div className="flex items-center gap-2">
              <OrgSearch />
              {/* ponytail: phones only notify through a service worker, so the bell is for desktops */}
              <NotifyBell className="hidden md:inline-flex" />
              <History current={messages[0]?.id} onOpen={load} />
              <SwitchButton />
              {messages.length > 0 && (
                <button
                  aria-label="Nieuwe vraag"
                  className="raised inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 transition-[filter] hover:brightness-[1.04] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
                  onClick={() => load([])}
                  type="button"
                >
                  <SquarePen aria-hidden="true" className="size-[18px] sm:hidden" />
                  <span className="hidden sm:inline">Nieuwe vraag</span>
                </button>
              )}
            </div>
          </header>

          <ScrollIndex className="flex-1" label="Vragen in dit gesprek" selector="[data-question]">
            <div className="mx-auto h-full w-full max-w-[46rem] px-5 sm:px-8">
              {messages.length === 0 ? (
                <Welcome onAsk={ask} />
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
                    // Between tool calls the agent is still at work: never let the list read as finished.
                    if (streaming && steps.length && !steps.some((s) => s.status === "running")) {
                      steps.push({ id: "next", label: text ? "Antwoord schrijven" : "Verder zoeken", status: "running" });
                    }
                    const thinking = streaming && !text && !steps.some((s) => s.status === "running");
                    return (
                      // The last turn fills the screen, so its question can sit at the top while the answer streams.
                      <section className={cn("mt-5", isLastTurn && "min-h-[calc(100dvh-20rem)]")} key={m.id}>
                        {steps.length > 0 && <AILoadingState className="mb-5" steps={steps} />}
                        {thinking && <Thinking />}
                        {text && (
                          <Answer
                            activeKey={evidence?.messageId === m.id ? evidence.key : null}
                            onCite={(key) => setEvidence({ messageId: m.id, key })}
                            question={messages[i - 1] ? textOf(messages[i - 1]) : ""}
                            text={text}
                          />
                        )}
                        {richOf(m).map((data, j) => (
                          <RichAnswer activeKey={evidence?.messageId === m.id ? evidence.key : null} data={data} key={j}
                            onCite={(key) => setEvidence({ messageId: m.id, key })}
                            question={messages[i - 1] ? textOf(messages[i - 1]) : ""} />
                        ))}
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
                        onClick={() => regenerate()}
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
              <AI_Prompt busy={busy} onStop={halt} onSubmit={ask} onValueChange={setDraft} ref={promptRef} value={draft} />
              <p className="mt-2 text-center text-[0.85rem] text-muted-foreground">
                Klik op een geel paginanummer om te zien waar het staat.
              </p>
            </div>
          </div>
        </div>

        <Evidence
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
