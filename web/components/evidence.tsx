"use client";

import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";
import { motion } from "motion/react";
import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Mark as Marker, MarkerText } from "@/components/kokonutui/marker-text";
import { type Citation, pathSegment } from "@/lib/citations";
import { parseNumber } from "@/lib/excel";
import { cn } from "@/lib/utils";

/** A document's name for the evidence heading. Public documents (kind doc) also carry the original URL and its site. */
export type DocMeta = { org: string; type: string; url?: string };

type Mark = [number, number, number, number];
export type Shot = { kind: "page"; src: string; mark: Mark | null; found: "all" | "partial" | "none" };
export type Filed = { kind: "figure"; org: string; field: { label: string; value: string; unit: string } | null };
export type PrivatePage = { kind: "project"; filename: string; text: string; source: string; documentKind: string; shot: Shot | null };
export type Iv3Cell = {
  kind: "iv3";
  cell: {
    naam: string; year: number; verslagsoort: string; taakveld: string; taakveld_naam: string; categorie: string;
    categorie_naam: string; soort: string | null; waarde: number | null; eenheid: string; plaatsing: string | null;
  } | null;
};
/** A web page's or Word document's part as text, with where the quote (or each figure and run of words in it) is. */
export type TextPart = { kind: "text"; text: string; title: string; url: string; host: string; found: Shot["found"]; marks: [number, number][] };
export type TableRow = {
  kind: "row";
  data: {
    file_url: string; fetched_at: string; format: string; sheet: string | null; member: string | null; file_name: string;
    title_rows: unknown[][]; columns: string[]; row: Record<string, string | number | null>;
  } | null;
};
export type CbsCell = {
  kind: "cbs";
  cell: {
    id: string; title: string; modified: string | null; page: string; dimensions: { title: string; value: string }[];
    topic: string; group: string; unit: string; value: number | null; symbol: string | null; symbol_meaning: string | null; source: string;
  } | null;
};
type Loaded = Shot | Filed | PrivatePage | Iv3Cell | TextPart | TableRow | CbsCell | "error";
type PageCitation = Extract<Citation, { kind: "page" | "doc" }>;
type FigureCitation = Extract<Citation, { kind: "figure" }>;
type Iv3Citation = Extract<Citation, { kind: "iv3" }>;
type TextCitation = Extract<Citation, { kind: "text" }>;
type RowCitation = Extract<Citation, { kind: "row" }>;
type CbsCitation = Extract<Citation, { kind: "cbs" }>;

type PrivateCitation = Extract<Citation, { kind: "project" }>;
const pagePath = (c: PageCitation | PrivateCitation) => c.kind === "project"
  ? `/digimv/projects/${c.projectId}/documents/${c.documentId}`
  : c.kind === "doc" ? `/digimv/public/documents/${c.docId}` : `/digimv/documents/${c.year}/${c.docId}`;

/** Where the name of a cited document is kept in the chat's document map. */
export const docKey = (c: PageCitation) => (c.kind === "doc" ? `doc/${c.docId}` : `${c.year}/${c.docId}`);

async function fetchShot(c: PageCitation | PrivateCitation): Promise<Shot> {
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

/** One cell of a body's Iv3 report as CBS publishes it; a cell that is not in the table loads as null. */
async function fetchIv3(c: Iv3Citation): Promise<Iv3Cell> {
  const path = [c.table, c.code, c.report, c.taakveld, c.categorie].map(encodeURIComponent).join("/");
  const r = await fetch(`/digimv/iv3/value/${path}`);
  if (r.status === 404) return { kind: "iv3", cell: null };
  if (!r.ok) throw new Error(String(r.status));
  return { kind: "iv3", cell: await r.json() };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the quote is in a text, as the PDF check does it (digimv.render_page): the whole quote, or else each figure and
 * run of three or more other characters in it. A figure the answer quoted but that isn't there makes it "partial". */
export function locate(text: string, quote: string): Pick<TextPart, "found" | "marks"> {
  if (!quote.trim()) return { found: "all", marks: [] };
  const find = (p: string): [number, number] | null => {
    const m = new RegExp(escapeRe(squash(p)).replace(/ /g, "\\s+"), "i").exec(text);
    return m ? [m.index, m.index + m[0].length] : null;
  };
  const whole = find(quote);
  if (whole) return { found: "all", marks: [whole] };
  const parts = (quote.match(/-?\d[\d.,]*\d|\d|[^\d]{3,}/g) ?? []).map((p) => p.replace(/^[\s,.:;()€]+|[\s,.:;()€]+$/g, "")).filter(Boolean);
  const marks = parts.map(find).filter((m): m is [number, number] => m !== null).sort((a, b) => a[0] - b[0])
    .filter((m, i, all) => i === 0 || m[0] >= all[i - 1][1]);
  const hits = parts.filter((p) => find(p)).length;
  return { found: parts.length && hits === parts.length ? "all" : hits ? "partial" : "none", marks };
}

async function fetchText(c: TextCitation): Promise<TextPart> {
  const r = await fetch(`/digimv/public/documents/${c.docId}/parts/${c.page}`);
  if (!r.ok) throw new Error(String(r.status));
  const d: { text: string; title: string; url: string; host: string } = await r.json();
  return { kind: "text", text: d.text, title: d.title, url: d.url, host: d.host, ...locate(d.text, c.quote) };
}

/** The row from our cached copy of the file; a row that isn't there (or a file no longer cached) loads as null. */
async function fetchRow(c: RowCitation): Promise<TableRow> {
  const parts = c.parts.map((p) => `part=${encodeURIComponent(p)}`).join("&");
  const r = await fetch(`/digimv/public/tables/${c.tableId}/rows/${c.row}${parts ? `?${parts}` : ""}`);
  if (r.status === 404) return { kind: "row", data: null };
  if (!r.ok) throw new Error(String(r.status));
  return { kind: "row", data: await r.json() };
}

/** The value as CBS publishes it now; a cell that is not in the table loads as null. */
async function fetchCbs(c: CbsCitation): Promise<CbsCell> {
  const r = await fetch(`/digimv/cbs/${c.table}/cell/${[...c.codes, c.topic].map(pathSegment).join("/")}`);
  if (r.status === 404) return { kind: "cbs", cell: null };
  if (!r.ok) throw new Error(String(r.status));
  return { kind: "cbs", cell: await r.json() };
}

// ponytail: session-long cache, object URLs never revoked; fine for a few hundred page images
const loaded = new Map<string, Promise<Loaded>>();
async function fetchPrivate(c: PrivateCitation): Promise<PrivatePage> {
  const r = await fetch(`${pagePath(c)}/pages/${c.page}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Privébron niet beschikbaar");
  const d = await r.json();
  return { kind: "project", filename: d.filename, text: d.text, source: d.source, documentKind: d.kind,
    shot: d.kind === "pdf" ? await fetchShot(c) : null };
}

function load(c: Citation): Promise<Loaded> {
  // Private material is never retained in the shared session cache.
  if (c.kind === "project") return fetchPrivate(c).catch(() => "error" as const);
  let p = loaded.get(c.key);
  if (!p) {
    const get: Promise<Loaded> = c.kind === "page" || c.kind === "doc" ? fetchShot(c) : c.kind === "iv3" ? fetchIv3(c)
      : c.kind === "text" ? fetchText(c) : c.kind === "row" ? fetchRow(c) : c.kind === "cbs" ? fetchCbs(c) : fetchFiled(c);
    p = get.catch((): Loaded => {
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
    let privateUrl: string | undefined;
    load(c).then((value) => {
      if (value !== "error" && value.kind === "project") privateUrl = value.shot?.src;
      if (live) setState({ key: c.key, value });
      else if (privateUrl) URL.revokeObjectURL(privateUrl);
    });
    return () => {
      live = false;
      if (privateUrl) URL.revokeObjectURL(privateUrl);
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
      <p className="break-words font-semibold text-[1.05rem] leading-snug [overflow-wrap:anywhere]">{title}</p>
      <p className="text-muted-foreground">{sub}</p>
    </div>
  );
}

function PageEvidence({ c, shot, doc }: { c: PageCitation; shot: Shot | "error" | null; doc?: DocMeta }) {
  const pdf = `${pagePath(c)}/pdf#page=${c.page}`;
  // The box is drawn once the page image has a size to draw it on.
  const [shown, setShown] = useState<string | null>(null);
  return (
    <>
      {c.kind === "doc" ? (
        <div>
          <Heading sub={`${doc?.type ?? "Openbaar document"}, pagina ${c.page}`} title={doc?.org ?? "Openbaar document"} />
          {doc?.url && (
            <a className="text-[0.9rem] text-muted-foreground underline underline-offset-2 [overflow-wrap:anywhere] hover:text-foreground" href={doc.url} rel="noopener noreferrer" target="_blank">
              Origineel op {doc.type}
            </a>
          )}
        </div>
      ) : (
        <Heading sub={`${doc?.type ?? "Document"} ${c.year}, pagina ${c.page}`} title={doc?.org ?? `Document ${c.year}/${c.docId}`} />
      )}

      {c.quote && (
        <MarkerText key={c.key} show>
          <blockquote className="text-[1.05rem] leading-relaxed">
            {/* The ink darkens as the marker passes, so the text reads on the page before and on yellow after. */}
            <Marker className="font-semibold transition-colors delay-150 duration-500 motion-reduce:transition-none [[data-armed]_&]:text-marker-ink">
              {c.quote}
            </Marker>
          </blockquote>
        </MarkerText>
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
          <MarkerText delay={c.quote ? 350 : 0} key={shot.src} show={shown === shot.src} style={shot.mark ? pageWindow(shot.mark) : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL of a rendered page, nothing to optimise */}
            <img alt={`Pagina ${c.page}`} className="block h-auto w-full" onLoad={() => setShown(shot.src)} src={shot.src} />
            {shot.mark && (
              <Marker
                className="pointer-events-none absolute"
                style={{
                  top: `${shot.mark[0] * 100}%`,
                  left: `${shot.mark[1] * 100}%`,
                  width: `${(shot.mark[3] - shot.mark[1]) * 100}%`,
                  height: `${(shot.mark[2] - shot.mark[0]) * 100}%`,
                }}
                type="box"
              />
            )}
          </MarkerText>
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

const lastNumber = (quote: string) => quote.match(/-?\d[\d.,]*\d|\d/g)?.at(-1);

/** "8.575" (Dutch) or "92.00" (as a file or CBS has it) against a source value, either way round. */
function sameNumber(said: string, value: string) {
  if (said === value.trim()) return true;
  const ours = [parseNumber(said)?.num, Number(said)].filter((n): n is number => n !== undefined && Number.isFinite(n));
  return [Number(value), parseNumber(value)?.num].some((n) => n !== undefined && Number.isFinite(n) && ours.includes(n));
}

/** The last number in the quote, compared with the source value. No number in the quote: nothing to contradict. */
function quoteMatches(quote: string, value: string) {
  const said = lastNumber(quote);
  return !said || sameNumber(said, value);
}

/** Whether a cell of a cited row is what the quote cites: a number is the quote's last number, a text is in the quote. */
export function cellCited(quote: string, v: unknown) {
  const s = String(v ?? "").trim();
  if (!quote || !s) return false;
  if (/^-?\d+([.,]\d+)?$/.test(s)) {
    const said = lastNumber(quote);
    return !!said && sameNumber(said, s);
  }
  return s.length >= 3 && squash(quote).toLowerCase().includes(squash(s).toLowerCase());
}

const rowCells = (d: NonNullable<TableRow["data"]>) => Object.entries(d.row).filter(([k, v]) => k !== "row" && v !== null && v !== "");

/** The quote's last number is in the row: a number cell equal to it, or a text cell ("€ 95.000") that has it. */
function numberInRow(d: NonNullable<TableRow["data"]>, quote: string) {
  const said = lastNumber(quote);
  return !said || rowCells(d).some(([, v]) => {
    const s = String(v).trim();
    return /^-?\d+([.,]\d+)?$/.test(s) ? sameNumber(said, s) : s.includes(said);
  });
}

/** Whether the source says something else than the answer: a quote not (all) on its page, or a filed value that
 * differs from the number quoted. Null while it loads, or when the source could not be loaded. */
export function useCheck(c: Citation | undefined) {
  const value = useLoaded(c);
  if (!c?.quote || !value || value === "error") return null;
  if (value.kind === "project") return !value.text.replace(/\s+/g, " ").includes(c.quote.replace(/\s+/g, " "));
  if (value.kind === "page" || value.kind === "text") return value.found !== "all";
  if (value.kind === "iv3") return value.cell?.waarde == null || !quoteMatches(c.quote, String(value.cell.waarde));
  if (value.kind === "cbs") return value.cell?.value == null || !quoteMatches(c.quote, String(value.cell.value));
  if (value.kind === "row") return !value.data || !numberInRow(value.data, c.quote);
  return !value.field || !quoteMatches(c.quote, value.field.value);
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

/** 16646 with "x € 1.000" -> "16.646 (x € 1.000)": Iv3 amounts are thousands of euros, never whole euros. */
export function formatIv3({ waarde, eenheid }: { waarde: number | null; eenheid: string }) {
  return waarde == null ? "niet aangeleverd" : `${waarde.toLocaleString("nl-NL", { maximumFractionDigits: 4 })} (${eenheid})`;
}

function Iv3Evidence({ c, value }: { c: Iv3Citation; value: Iv3Cell | "error" | null }) {
  const cell = value && value !== "error" ? value.cell : null;
  return (
    <>
      <Heading sub={`CBS Iv3 · ${cell ? `${cell.verslagsoort} ${cell.year}` : c.table}`} title={cell?.naam ?? c.code} />

      {/* The cell as the body reported it: policy area, then the category and its amount. */}
      <div className="rounded-xl bg-muted/70 p-4 ring-1 ring-border">
        {cell ? (
          <>
            <p className="text-[0.88rem] text-muted-foreground leading-snug">Taakveld {cell.taakveld}</p>
            <p className="mt-1 font-semibold leading-snug">{cell.taakveld_naam}</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-muted-foreground">{cell.soort ? `${cell.soort}: ` : ""}{cell.categorie_naam} ({cell.categorie})</span>
              <mark className="rounded-[4px] bg-marker px-1.5 py-0.5 font-semibold text-marker-ink tabular-nums">{formatIv3(cell)}</mark>
            </div>
          </>
        ) : (
          <div className={cn("h-24", !value && "animate-pulse")} />
        )}
      </div>

      <Status>
        {value === "error" ? (
          <>
            {WARN}
            De CBS-gegevens konden niet worden geladen. Probeer het later nog eens.
          </>
        ) : !value ? (
          <span className="text-muted-foreground">CBS-gegevens laden…</span>
        ) : !cell ? (
          <>
            {WARN}
            Deze cel staat niet in CBS-tabel {c.table}.
          </>
        ) : cell.waarde == null ? (
          <>
            {WARN}
            {cell.naam} heeft deze cel niet aangeleverd bij het CBS; dat is iets anders dan 0.
          </>
        ) : quoteMatches(c.quote, String(cell.waarde)) ? (
          <>
            {OK}
            Zo gerapporteerd door {cell.naam} aan het CBS ({cell.plaatsing}, tabel {c.table}); onbewerkte cijfers, niet door het CBS gecontroleerd.
          </>
        ) : (
          <>
            {WARN}
            Het antwoord noemt “{c.quote}”, maar gerapporteerd is {formatIv3(cell)}.
          </>
        )}
      </Status>
    </>
  );
}

function Quote({ c }: { c: Citation }) {
  if (!c.quote) return null;
  return (
    <MarkerText key={c.key} show>
      <blockquote className="text-[1.05rem] leading-relaxed">
        <Marker className="font-semibold transition-colors delay-150 duration-500 motion-reduce:transition-none [[data-armed]_&]:text-marker-ink">
          {c.quote}
        </Marker>
      </blockquote>
    </MarkerText>
  );
}

function ButtonLink({ href, children, download }: { href: string; children: ReactNode; download?: boolean }) {
  return (
    <a
      className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-primary px-4 font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      download={download || undefined}
      href={href}
      rel="noopener noreferrer"
      target={download ? undefined : "_blank"}
    >
      {download ? <Download aria-hidden="true" className="size-4" /> : <ExternalLink aria-hidden="true" className="size-4" />}
      {children}
    </a>
  );
}

const fetchedOn = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

/** A part of a web page or Word document: our copy's text, the quote marked where it stands. */
function TextEvidence({ c, part }: { c: TextCitation; part: TextPart | "error" | null }) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLElement>(null);
  const ok = part && part !== "error" ? part : null;
  // The box scrolls to the first mark; scrollIntoView would also scroll the panel and the page around it.
  useEffect(() => {
    if (box.current && first.current) box.current.scrollTop = first.current.offsetTop - box.current.clientHeight / 2;
  }, [ok]);
  const pieces: ReactNode[] = [];
  if (ok) {
    let at = 0;
    ok.marks.forEach(([from, to], i) => {
      pieces.push(ok.text.slice(at, from));
      pieces.push(
        <mark className="rounded-[3px] bg-marker px-0.5 font-semibold text-marker-ink" key={from} ref={i === 0 ? first : undefined}>
          {ok.text.slice(from, to)}
        </mark>
      );
      at = to;
    });
    pieces.push(ok.text.slice(at));
  }
  return (
    <>
      <div>
        <Heading sub={`${ok?.host ?? "Openbare bron"}, deel ${c.page}`} title={ok?.title ?? "Openbare bron"} />
        {ok?.url && (
          <a className="text-[0.9rem] text-muted-foreground underline underline-offset-2 [overflow-wrap:anywhere] hover:text-foreground" href={ok.url} rel="noopener noreferrer" target="_blank">
            Origineel op {ok.host}
          </a>
        )}
      </div>
      <Quote c={c} />
      {/* The part as we read it; a web page can change after that, so this is what the answer was based on. */}
      <div className="relative max-h-[24rem] overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/70 p-4 text-[0.94rem] leading-relaxed ring-1 ring-border [overflow-wrap:anywhere]" ref={box}>
        {ok ? pieces : <div className={cn("h-24", !part && "animate-pulse")} />}
      </div>
      <Status>
        {part === "error" ? (
          <>{WARN}Dit deel kon niet worden geladen. Open het origineel om zelf te kijken.</>
        ) : !ok ? (
          <span className="text-muted-foreground">Tekst laden…</span>
        ) : ok.found === "all" ? (
          <>{OK}Staat letterlijk in deel {c.page}.</>
        ) : ok.found === "partial" ? (
          <>{WARN}Niet alles letterlijk teruggevonden in dit deel. Kijk zelf even mee.</>
        ) : (
          <>{WARN}Het citaat staat niet letterlijk in dit deel. Hierboven het hele deel.</>
        )}
      </Status>
    </>
  );
}

/** One row of a data file (CSV, Excel, JSON) from our copy: every filled cell under its column, the cited ones marked. */
function RowEvidence({ c, value }: { c: RowCitation; value: TableRow | "error" | null }) {
  const d = value && value !== "error" ? value.data : null;
  const cells = d ? rowCells(d) : [];
  const cited = cells.filter(([, v]) => cellCited(c.quote, v));
  const where = [d?.member, d?.sheet && `blad ${d.sheet}`].filter(Boolean).join(" · ");
  // A row can have 30 columns: the box scrolls to the cited number (else the first marked cell), as the text view does.
  const box = useRef<HTMLDivElement>(null);
  const target = (cited.find(([, v]) => /\d/.test(String(v))) ?? cited[0])?.[0];
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>("[data-target]");
    if (box.current && el) box.current.scrollTop = el.offsetTop - box.current.clientHeight / 2;
  }, [d, target]);
  return (
    <>
      <div>
        <Heading sub={`Databestand, rij ${c.row}${where ? ` · ${where}` : ""}`} title={d?.file_name ?? "Databestand"} />
        {d?.title_rows[0] && <p className="text-[0.9rem] text-muted-foreground">{d.title_rows[0].join(" ")}</p>}
      </div>
      <Quote c={c} />
      <div className="relative max-h-[24rem] overflow-y-auto rounded-xl bg-muted/70 p-4 ring-1 ring-border" ref={box}>
        {d ? (
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1.5 text-[0.94rem] leading-snug">
            {cells.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-muted-foreground [overflow-wrap:anywhere]">{k}</dt>
                <dd className="tabular-nums [overflow-wrap:anywhere]">
                  {cited.some(([ck]) => ck === k) ? (
                    <mark className="rounded-[4px] bg-marker px-1.5 py-0.5 font-semibold text-marker-ink" data-target={k === target || undefined}>{String(v)}</mark>
                  ) : (
                    String(v)
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <div className={cn("h-24", !value && "animate-pulse")} />
        )}
      </div>
      <Status>
        {value === "error" ? (
          <>{WARN}Het bestand kon niet worden geladen. Probeer het later nog eens.</>
        ) : !value ? (
          <span className="text-muted-foreground">Rij laden…</span>
        ) : !d ? (
          <>{WARN}Rij {c.row} staat niet (meer) in onze kopie van dit bestand. Laat het opnieuw lezen.</>
        ) : !numberInRow(d, c.quote) ? (
          <>{WARN}Het antwoord noemt “{c.quote}”, maar dat getal staat niet in deze rij.</>
        ) : (
          <>{OK}Zo staat het in rij {c.row} van het bestand, opgehaald op {fetchedOn(d.fetched_at)}.</>
        )}
      </Status>
      {d && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ButtonLink download href={`/digimv/public/tables/${c.tableId}/file`}>Download het bestand</ButtonLink>
          <a className="text-[0.9rem] text-muted-foreground underline underline-offset-2 hover:text-foreground" href={d.file_url} rel="noopener noreferrer" target="_blank">
            Origineel op de site
          </a>
        </div>
      )}
    </>
  );
}

/** 8575 "aantal" -> "8.575 aantal"; a value CBS withholds says so, never 0. */
export function formatCbs(cell: NonNullable<CbsCell["cell"]>) {
  if (cell.value == null) return `geen waarde (${cell.symbol ?? "leeg"})`;
  return [cell.value.toLocaleString("nl-NL", { maximumFractionDigits: 4 }), cell.unit].filter(Boolean).join(" ");
}

const label = (v: string) => {
  const [code, ...rest] = v.split(" = ");
  return rest.length ? `${rest.join(" = ")} (${code})` : v;
};

/** One StatLine value: what it is per dimension, then the topic and the value as CBS publishes it now. */
function CbsEvidence({ c, value }: { c: CbsCitation; value: CbsCell | "error" | null }) {
  const cell = value && value !== "error" ? value.cell : null;
  return (
    <>
      <Heading sub={`CBS StatLine, tabel ${c.table}`} title={cell?.title ?? `CBS-tabel ${c.table}`} />
      <Quote c={c} />
      <div className="rounded-xl bg-muted/70 p-4 ring-1 ring-border">
        {cell ? (
          <>
            {cell.dimensions.map((d) => (
              <p className="text-[0.88rem] text-muted-foreground leading-snug" key={d.title}>
                {d.title}: {label(d.value)}
              </p>
            ))}
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="font-semibold leading-snug">{cell.group ? `${cell.group} › ` : ""}{cell.topic}</span>
              <mark className="rounded-[4px] bg-marker px-1.5 py-0.5 font-semibold text-marker-ink tabular-nums">{formatCbs(cell)}</mark>
            </div>
          </>
        ) : (
          <div className={cn("h-24", !value && "animate-pulse")} />
        )}
      </div>
      <Status>
        {value === "error" ? (
          <>{WARN}De CBS-gegevens konden niet worden geladen. Probeer het later nog eens.</>
        ) : !value ? (
          <span className="text-muted-foreground">CBS-gegevens laden…</span>
        ) : !cell ? (
          <>{WARN}Deze waarde staat niet in CBS-tabel {c.table}.</>
        ) : cell.value == null ? (
          <>{WARN}Het CBS publiceert hier geen waarde ({cell.symbol}{cell.symbol_meaning ? `: ${cell.symbol_meaning}` : ""}); dat is iets anders dan 0.</>
        ) : quoteMatches(c.quote, String(cell.value)) ? (
          <>{OK}Zo gepubliceerd door het CBS in tabel {cell.id}{cell.modified ? `, bijgewerkt op ${fetchedOn(cell.modified)}` : ""}.</>
        ) : (
          <>{WARN}Het antwoord noemt “{c.quote}”, maar het CBS publiceert {formatCbs(cell)}.</>
        )}
      </Status>
      {cell && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ButtonLink href={cell.page}>Open de tabel bij het CBS</ButtonLink>
          <a className="text-[0.9rem] text-muted-foreground underline underline-offset-2 hover:text-foreground" href={cell.source} rel="noopener noreferrer" target="_blank">
            Ruwe gegevens
          </a>
        </div>
      )}
    </>
  );
}

/** One citation's evidence, as the panel and the standalone /bron page show it. */
export function SourceView({ c, docs }: { c: Citation; docs: Record<string, DocMeta> }) {
  const value = useLoaded(c);
  return (
    <div className="flex flex-col gap-5">
      {c.kind === "project" ? (
        <PrivateSource c={c} value={value as PrivatePage | "error" | null} />
      ) : c.kind === "page" || c.kind === "doc" ? (
        <PageEvidence c={c} doc={docs[docKey(c)]} shot={value as Shot | "error" | null} />
      ) : c.kind === "iv3" ? (
        <Iv3Evidence c={c} value={value as Iv3Cell | "error" | null} />
      ) : c.kind === "text" ? (
        <TextEvidence c={c} part={value as TextPart | "error" | null} />
      ) : c.kind === "row" ? (
        <RowEvidence c={c} value={value as TableRow | "error" | null} />
      ) : c.kind === "cbs" ? (
        <CbsEvidence c={c} value={value as CbsCell | "error" | null} />
      ) : (
        <FigureEvidence c={c} filed={value as Filed | "error" | null} />
      )}
    </div>
  );
}


export function PrivateSource({ c, value, compact = false }: { c: PrivateCitation; value: PrivatePage | "error" | null; compact?: boolean }) {
  if (!value) return <p>Privébron laden…</p>;
  if (value === "error") return <p role="alert">Privébron niet beschikbaar. Controleer je aanmelding.</p>;
  const matched = value.text.replace(/\s+/g, " ").includes(c.quote.replace(/\s+/g, " "));
  return <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
    <Heading title={value.filename} sub={`Privébron · ${value.documentKind === "pdf" ? "pagina" : "sectie"} ${c.page} · ${value.source === "text" || value.source === "note" || value.source === "markdown" ? "tekst" : value.source === "needs_ocr" || value.source === "pending" ? "OCR niet beschikbaar" : "OCR — controleer de tekst"}`} />
    {c.quote && <blockquote className="rounded-lg bg-marker p-3 text-marker-ink">{c.quote}</blockquote>}
    {c.quote && <p className="text-sm text-muted-foreground">{matched ? "Citaat teruggevonden in de brontekst. Controleer de betekenis zelf." : "Citaat niet letterlijk teruggevonden. Controleer de originele pagina."}</p>}
    {!compact && value.shot && <>
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated rendered PDF page */}
      <img alt={`Pagina ${c.page} van ${value.filename}`} className="w-full rounded-lg" src={value.shot.src} />
    </>}
    {!compact && value.text && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-4 font-sans text-sm">{value.text}</pre>}
    {!compact && value.documentKind !== "pdf" && <a className="underline" href={`${pagePath(c)}/original`}>Download {value.documentKind === "markdown" ? "kennisbestand (.md)" : "tekstbron"}</a>}
    {!compact && value.documentKind === "pdf" && <a className="underline" href={`${pagePath(c)}/pdf#page=${c.page}`} target="_blank" rel="noopener">Open originele PDF op pagina {c.page}</a>}
  </div>;
}

function EvidenceBody({ citations, index, onIndex, docs }: Omit<EvidenceProps, "open" | "onClose">) {
  const c = citations[index];
  const next = citations[index + 1];
  useEffect(() => {
    if (next && next.kind !== "project") load(next); // private pages are loaded only by their mounted view
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
  drawer?: boolean;
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
  const wide = useWide() && !props.drawer;

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
        <DrawerDescription className="sr-only">De pagina, het veld, de rij of de CBS-waarde waar dit getal staat.</DrawerDescription>
        <div className="overflow-y-auto px-5 pt-3 pb-8">
          <EvidenceBody {...props} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
