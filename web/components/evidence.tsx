"use client";

import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { motion } from "motion/react";
import { type CSSProperties, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import type { Citation } from "@/lib/citations";
import { parseNumber } from "@/lib/excel";
import { cn } from "@/lib/utils";

export type DocMeta = { org: string; type: string };

type Mark = [number, number, number, number];
export type Shot = { kind: "page"; src: string; mark: Mark | null; found: "all" | "partial" | "none" };
export type Filed = { kind: "figure"; org: string; field: { label: string; value: string; unit: string } | null };
type Loaded = Shot | Filed | "error";
type PageCitation = Extract<Citation, { kind: "page" }>;
type FigureCitation = Extract<Citation, { kind: "figure" }>;

const pagePath = (c: PageCitation) => `/digimv/documents/${c.year}/${c.docId}`;

async function fetchShot(c: PageCitation): Promise<Shot> {
  const query = c.quote ? `?quote=${encodeURIComponent(c.quote)}` : "";
  const r = await fetch(`${pagePath(c)}/pages/${c.page}.png${query}`);
  if (!r.ok) throw new Error(String(r.status));
  const mark = r.headers.get("X-Mark")?.split(",").map(Number);
  return {
    kind: "page",
    src: URL.createObjectURL(await r.blob()),
    mark: mark?.length === 4 && mark.every(Number.isFinite) ? (mark as Mark) : null,
    found: (r.headers.get("X-Found") as Shot["found"]) ?? "none",
  };
}

async function fetchFiled(c: FigureCitation): Promise<Filed> {
  const r = await fetch(`/digimv/orgs/${encodeURIComponent(c.orgId)}/figures/${c.year}?q=${encodeURIComponent(c.field)}&limit=50`);
  if (!r.ok) throw new Error(String(r.status));
  const d: { name: string; figures: { var: string; label: string; value: string; unit: string }[] } = await r.json();
  return { kind: "figure", org: d.name, field: d.figures.find((f) => f.var === c.field) ?? null };
}

// ponytail: session-long cache, object URLs never revoked; fine for a few hundred page images
const loaded = new Map<string, Promise<Loaded>>();
function load(c: Citation): Promise<Loaded> {
  let p = loaded.get(c.key);
  if (!p) {
    p = (c.kind === "page" ? fetchShot(c) : fetchFiled(c)).catch((): Loaded => {
      loaded.delete(c.key); // a later look may succeed
      return "error";
    });
    loaded.set(c.key, p);
  }
  return p;
}

export function useLoaded(c: Citation | undefined) {
  const [state, setState] = useState<{ key: string; value: Loaded } | null>(null);
  useEffect(() => {
    if (!c) return;
    let live = true;
    load(c).then((value) => live && setState({ key: c.key, value }));
    return () => {
      live = false;
    };
  }, [c]);
  return c && state?.key === c.key ? state.value : null;
}

// The page shown as a window around the marked passage, a little enlarged, so it reads in place.
// Same math as the strohmgpt sources panel: zoom to ~90% of the window width, keep the page edges inside.
const WINDOW = "20rem";
export function pageWindow(mark: Mark, height = WINDOW): CSSProperties {
  const [top, left, bottom, right] = mark;
  const zoom = Math.min(Math.max(0.9 / (right - left), 1), 1.8);
  const x = Math.min(Math.max(0.5 / zoom - (left + right) / 2, 1 / zoom - 1), 0);
  const y = (top + bottom) / 2;
  return {
    width: `${zoom * 100}%`,
    transform: `translate(${x * 100}%, clamp(calc(${height} - 100%), calc(${height} / 2 - ${y * 100}%), 0px))`,
  };
}

const FOUND_TEXT = {
  all: (p: number) => `Staat letterlijk op pagina ${p}.`,
  partial: () => "Niet alles letterlijk teruggevonden op deze pagina. Kijk zelf even mee.",
  none: () => "Het citaat staat niet letterlijk op deze pagina. Hieronder de hele pagina.",
};

const OK = <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />;
const WARN = <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />;

function Status({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="flex gap-2 text-[0.94rem] leading-snug">
      {children}
    </p>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <p className="font-semibold text-[1.05rem] leading-snug">{title}</p>
      <p className="text-muted-foreground">{sub}</p>
    </div>
  );
}

function PageEvidence({ c, shot, doc }: { c: PageCitation; shot: Shot | "error" | null; doc?: DocMeta }) {
  const pdf = `${pagePath(c)}/pdf#page=${c.page}`;
  return (
    <>
      <Heading sub={`${doc?.type ?? "Document"} ${c.year}, pagina ${c.page}`} title={doc?.org ?? `Document ${c.year}/${c.docId}`} />

      {c.quote && (
        <blockquote className="text-[1.05rem] leading-relaxed">
          <mark className="box-decoration-clone rounded-[4px] bg-marker px-1.5 py-0.5 font-semibold text-marker-ink">
            {c.quote}
          </mark>
        </blockquote>
      )}

      {/* The real page, as printed. A click opens the whole PDF on that page. */}
      <a
        aria-label={`Open pagina ${c.page} in de PDF`}
        className={cn(
          "relative block overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_32px_-18px_rgb(0_0_0/0.45)] ring-1 ring-black/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          shot && shot !== "error" && shot.mark ? "h-[20rem]" : "max-h-[32rem] overflow-y-auto"
        )}
        href={pdf}
        rel="noopener"
        target="_blank"
      >
        {shot && shot !== "error" ? (
          <div className="relative" style={shot.mark ? pageWindow(shot.mark) : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL of a rendered page, nothing to optimise */}
            <img alt={`Pagina ${c.page}`} className="block h-auto w-full" src={shot.src} />
            {shot.mark && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -m-1.5 box-content rounded-md p-1.5 ring-2 ring-marker-edge"
                style={{
                  top: `${shot.mark[0] * 100}%`,
                  left: `${shot.mark[1] * 100}%`,
                  width: `${(shot.mark[3] - shot.mark[1]) * 100}%`,
                  height: `${(shot.mark[2] - shot.mark[0]) * 100}%`,
                }}
              />
            )}
          </div>
        ) : (
          <div className={cn("h-[20rem]", shot === "error" ? "" : "animate-pulse bg-black/[0.04]")} />
        )}
      </a>

      <Status>
        {shot === "error" ? (
          <>
            {WARN}
            De pagina kon niet worden geladen. Open de PDF om zelf te kijken.
          </>
        ) : shot ? (
          <>
            {shot.found === "all" ? OK : WARN}
            {FOUND_TEXT[shot.found](c.page)}
          </>
        ) : (
          <span className="text-muted-foreground">Pagina laden…</span>
        )}
      </Status>

      <a
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-primary px-4 font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        href={pdf}
        rel="noopener"
        target="_blank"
      >
        <ExternalLink aria-hidden="true" className="size-4" />
        Open de PDF op pagina {c.page}
      </a>
    </>
  );
}

/** A filed value as the questionnaire means it: whole euros, a percentage, fte. */
export function formatFiled({ value, unit }: { value: string; unit: string }) {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return [value, unit].filter(Boolean).join(" ");
  const n = Number(value).toLocaleString("nl-NL", { maximumFractionDigits: 4 });
  if (unit === "€") return `€ ${n}`;
  if (unit === "%") return `${n}%`;
  return [n, unit].filter(Boolean).join(" ");
}

/** The last number in the quote, compared with the filed value. No number in the quote: nothing to contradict. */
function quoteMatches(quote: string, value: string) {
  const said = quote.match(/-?\d[\d.,]*\d|\d/g)?.at(-1);
  if (!said) return true;
  return parseNumber(said)?.num === Number(value);
}

function FigureEvidence({ c, filed }: { c: FigureCitation; filed: Filed | "error" | null }) {
  const field = filed && filed !== "error" ? filed.field : null;
  const path = field?.label.split(" › ") ?? [];
  return (
    <>
      <Heading sub={`DigiMV-vragenlijst ${c.year}`} title={(filed && filed !== "error" && filed.org) || `Organisatie ${c.orgId}`} />

      {/* The questionnaire field as the organisation filled it in: its place in the form, then the value. */}
      <div className="rounded-xl bg-muted/70 p-4 ring-1 ring-border">
        {field ? (
          <>
            {path.length > 2 && <p className="text-[0.88rem] text-muted-foreground leading-snug">{path.slice(0, -2).join(" › ")}</p>}
            {path.length > 1 && <p className="mt-2 font-semibold leading-snug">{path.at(-2)}</p>}
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-muted-foreground">{path.at(-1)}</span>
              <mark className="rounded-[4px] bg-marker px-1.5 py-0.5 font-semibold text-marker-ink tabular-nums">
                {formatFiled(field)}
              </mark>
            </div>
          </>
        ) : (
          <div className={cn("h-24", !filed && "animate-pulse")} />
        )}
      </div>

      <Status>
        {filed === "error" ? (
          <>
            {WARN}
            De vragenlijst kon niet worden geladen. Probeer het later nog eens.
          </>
        ) : !filed ? (
          <span className="text-muted-foreground">Vragenlijst laden…</span>
        ) : !field ? (
          <>
            {WARN}
            Dit veld staat niet in de DigiMV-vragenlijst {c.year} van deze organisatie.
          </>
        ) : quoteMatches(c.quote, field.value) ? (
          <>
            {OK}
            Zo ingevuld door de organisatie in DigiMV {c.year} (
            {/geconsolideerd/i.test(path[0] ?? "") ? "geconsolideerd, de hele groep" : "enkelvoudig"}).
          </>
        ) : (
          <>
            {WARN}
            Het antwoord noemt “{c.quote}”, maar ingevuld is {formatFiled(field)}.
          </>
        )}
      </Status>
    </>
  );
}

/** One citation's evidence, as the panel and the standalone /bron page show it. */
export function SourceView({ c, docs }: { c: Citation; docs: Record<string, DocMeta> }) {
  const value = useLoaded(c);
  return (
    <div className="flex flex-col gap-5">
      {c.kind === "page" ? (
        <PageEvidence c={c} doc={docs[`${c.year}/${c.docId}`]} shot={value as Shot | "error" | null} />
      ) : (
        <FigureEvidence c={c} filed={value as Filed | "error" | null} />
      )}
    </div>
  );
}

function EvidenceBody({ citations, index, onIndex, docs }: Omit<EvidenceProps, "open" | "onClose">) {
  const c = citations[index];
  const next = citations[index + 1];
  useEffect(() => {
    if (next) load(next); // stepping on is instant
  }, [next]);
  if (!c) return null;

  return (
    <div className="flex flex-col gap-5">
      <SourceView c={c} docs={docs} />
      {citations.length > 1 && (
        <nav aria-label="Bronnen van dit antwoord" className="flex items-center justify-between gap-2 border-t pt-4">
          <StepButton disabled={index === 0} onClick={() => onIndex(index - 1)}>
            <ChevronLeft aria-hidden="true" className="size-4" /> Vorige
          </StepButton>
          <p className="text-muted-foreground tabular-nums">
            Bron {index + 1} van {citations.length}
          </p>
          <StepButton disabled={index === citations.length - 1} onClick={() => onIndex(index + 1)}>
            Volgende <ChevronRight aria-hidden="true" className="size-4" />
          </StepButton>
        </nav>
      )}
    </div>
  );
}

function StepButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center gap-1 rounded-full px-3 transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "invisible"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

const WIDE = "(min-width: 1100px)";
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true
  );
}

interface EvidenceProps {
  open: boolean;
  citations: Citation[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  docs: Record<string, DocMeta>;
}

/** Where an answer's figures come from: docked on a wide screen, a drawer from the bottom on a phone. */
export function Evidence(props: EvidenceProps) {
  const { open, citations, index, onIndex, onClose } = props;
  const wide = useWide();

  // ← → step through the answer's sources, unless the person is typing.
  useEffect(() => {
    if (!open || citations.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable='true']")) return;
      const to = { ArrowLeft: index - 1, ArrowRight: index + 1 }[e.key];
      if (to === undefined || to < 0 || to >= citations.length) return;
      e.preventDefault();
      onIndex(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, citations.length, index, onIndex]);

  if (wide) {
    if (!open) return null;
    return (
      <motion.aside
        animate={{ opacity: 1, x: 0 }}
        aria-label="Waar het staat"
        className="raised my-3 mr-3 flex w-[27rem] shrink-0 flex-col overflow-hidden rounded-2xl"
        initial={{ opacity: 0, x: 24 }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-5">
          <h2 className="font-semibold">Waar het staat</h2>
          <button
            aria-label="Sluit"
            className="flex size-11 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-6">
          <EvidenceBody {...props} />
        </div>
      </motion.aside>
    );
  }

  return (
    <Drawer onOpenChange={(o) => !o && onClose()} open={open}>
      <DrawerContent className="max-h-[92dvh]">
        <div className="flex shrink-0 items-center justify-between pr-2 pl-5">
          <DrawerTitle className="font-semibold">Waar het staat</DrawerTitle>
          <button aria-label="Sluit" className="flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={onClose} type="button">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <DrawerDescription className="sr-only">De pagina uit het jaarverslag of het veld uit de DigiMV-vragenlijst waar dit getal staat.</DrawerDescription>
        <div className="overflow-y-auto px-5 pt-3 pb-8">
          <EvidenceBody {...props} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
