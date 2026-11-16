"use client";

import {
  BarChart3,
  FileText,
  LockKeyhole,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Search,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useState } from "react";
import { pageWindow } from "@/components/evidence";
import { Mark, MarkerText } from "@/components/kokonutui/marker-text";
import SmoothTab from "@/components/kokonutui/smooth-tab";
import { COMPARISON_EXAMPLE, INVESTMENT_CASE } from "@/lib/landing-demo";
import { cn } from "@/lib/utils";

type MarkRect = [number, number, number, number]; // [top, left, bottom, right] in 0..1

interface EvidenceSource {
  id: string;
  chipLabel: string;
  org: string;
  docTitle: string;
  quote: string;
  statusText: string;
  kind: "pdf" | "digimv";
  page?: number;
  image?: string;
  mark?: MarkRect;
  digimvField?: { code: string; label: string; value: string; scope: string };
}

const EVIDENCE_SOURCES: EvidenceSource[] = [
  {
    id: "digimv-gecons",
    chipLabel: "DigiMV",
    org: "Academisch Ziekenhuis Leiden",
    docTitle: "DigiMV-vragenlijst 2025 · Vraag R401",
    quote: "Som der bedrijfsopbrengsten € 1.286.254.000",
    statusText: "Rechtstreeks uit de ingediende DigiMV-vragenlijst.",
    kind: "digimv",
    digimvField: {
      code: "R401",
      label: "Som der bedrijfsopbrengsten (geconsolideerd)",
      value: "€ 1.286.254.000",
      scope: "Geconsolideerd · Boekjaar 2025",
    },
  },
  {
    id: "p9-som",
    chipLabel: "p. 9",
    org: "Academisch Ziekenhuis Leiden",
    docTitle: "Jaarrekening 2025, pagina 9",
    quote: "Som der bedrijfsopbrengsten 1.286.254",
    statusText: "Staat letterlijk op pagina 9.",
    kind: "pdf",
    page: 9,
    image: "/demo/lumc-p9.png",
    mark: [0.321, 0.112, 0.341, 0.782],
  },
  {
    id: "p9-netto",
    chipLabel: "p. 9",
    org: "Academisch Ziekenhuis Leiden",
    docTitle: "Jaarrekening 2025, pagina 9",
    quote: "Netto omzet 1.091.086",
    statusText: "Staat letterlijk op pagina 9.",
    kind: "pdf",
    page: 9,
    image: "/demo/lumc-p9.png",
    mark: [0.270, 0.112, 0.290, 0.782],
  },
  {
    id: "p48-netto",
    chipLabel: "p. 48",
    org: "Academisch Ziekenhuis Leiden",
    docTitle: "Jaarrekening 2025, pagina 48",
    quote: "Netto omzet 1.089.241",
    statusText: "Staat letterlijk op pagina 48.",
    kind: "pdf",
    page: 48,
    image: "/demo/lumc-p48.png",
    mark: [0.287, 0.112, 0.308, 0.794],
  },
];

const RESEARCH_STEPS = [
  "Zoek organisatie 'LUMC' → Academisch Ziekenhuis Leiden",
  "DigiMV 2025 kerncijfers opgehaald (geconsolideerd & enkelvoudig)",
  "Jaarrekening 2025 (84 p.) doorzocht op 'netto omzet'",
  "Pagina 9 gelezen: geconsolideerde winst-en-verliesrekening",
  "Pagina 48 gelezen: enkelvoudige winst-en-verliesrekening",
  "Bedragen vergeleken en exacte regels gemarkeerd",
];

function CiteChip({
  sourceId,
  activeId,
  onSelect,
}: {
  sourceId: string;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const source = EVIDENCE_SOURCES.find((s) => s.id === sourceId);
  if (!source) return null;
  const active = activeId === sourceId;

  return (
    <button
      className={cn(
        "mx-0.5 inline-flex cursor-pointer items-center rounded-md bg-[var(--marker)] px-1.5 py-0.5 font-medium text-[0.82rem] text-[var(--marker-ink)] leading-none transition-shadow",
        active
          ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
          : "hover:ring-1 hover:ring-[var(--marker-edge)]"
      )}
      aria-label={`${source.docTitle}: ${source.quote}`}
      aria-pressed={active}
      onClick={() => onSelect(sourceId)}
      type="button"
    >
      {source.chipLabel}
    </button>
  );
}

function ChatAndPdfPanel() {
  // Default to "Netto omzet 1.091.086" on page 9, matching the real app screenshot
  const [activeId, setActiveId] = useState<string>("p9-netto");
  const [stepsOpen, setStepsOpen] = useState(false);

  const activeIndex = Math.max(
    EVIDENCE_SOURCES.findIndex((s) => s.id === activeId),
    0
  );
  const current = EVIDENCE_SOURCES[activeIndex] ?? EVIDENCE_SOURCES[0];

  const goPrev = () => {
    const prev = (activeIndex - 1 + EVIDENCE_SOURCES.length) % EVIDENCE_SOURCES.length;
    setActiveId(EVIDENCE_SOURCES[prev].id);
  };

  const goNext = () => {
    const next = (activeIndex + 1) % EVIDENCE_SOURCES.length;
    setActiveId(EVIDENCE_SOURCES[next].id);
  };

  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-2 lg:gap-10">
      {/* Left: Real chat answer layout */}
      <div className="min-w-0">
        <h3 className="font-semibold text-xl tracking-tight sm:text-2xl">
          Wat was de omzet van het LUMC in 2025?
        </h3>

        <div className="mt-4" data-no-swipe>
          <button
            className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
            aria-expanded={stepsOpen}
            aria-controls="demo-onderzoeksstappen"
            onClick={() => setStepsOpen((v) => !v)}
            type="button"
          >
            <span className="font-medium">Nagezocht</span>
            <span>({RESEARCH_STEPS.length} stappen)</span>
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 transition-transform duration-200", stepsOpen && "rotate-180")}
            />
          </button>

          {stepsOpen && (
            <ol id="demo-onderzoeksstappen" className="mt-2.5 space-y-1 border-border border-l-2 pl-3.5 text-muted-foreground text-xs">
              {RESEARCH_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </div>

        <div className="mt-7 text-sm leading-relaxed sm:text-base" data-no-swipe>
          <p className="text-muted-foreground">Som der bedrijfsopbrengsten · geconsolideerd</p>
          <p className="mt-2 text-[clamp(1.7rem,3.5vw,3rem)] leading-tight font-semibold tracking-[-0.045em] tabular-nums">€ 1.286.254.000</p>
          <p className="mt-4 text-muted-foreground">
            DigiMV <CiteChip activeId={activeId} onSelect={setActiveId} sourceId="digimv-gecons" />
            {" "}· Jaarrekening <CiteChip activeId={activeId} onSelect={setActiveId} sourceId="p9-som" />.
          </p>
          <div className="mt-6 border-t border-border pt-5">
            <p>De netto omzet is <strong className="font-semibold">€ 1.091.086.000</strong>{" "}
              <CiteChip activeId={activeId} onSelect={setActiveId} sourceId="p9-netto" />.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">Enkelvoudig bedraagt de netto omzet € 1.089.241.000{" "}
              <CiteChip activeId={activeId} onSelect={setActiveId} sourceId="p48-netto" />.
              Jaarrekeningbedragen × 1.000 euro.
            </p>
          </div>
        </div>

        <p className="mt-6 text-muted-foreground text-xs">
          Klik op een geel paginanummer om te zien waar het staat.
        </p>
      </div>

      {/* Right: "Waar het staat" evidence card, matching evidence.tsx */}
      <aside aria-label="Bron bij het voorbeeldantwoord" className="flex min-w-0 flex-col justify-between rounded-2xl border border-border bg-background p-4 sm:p-6" data-no-swipe>
        <div>
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold text-[0.95rem]">Waar het staat</h4>
            <span aria-live="polite" className="text-muted-foreground text-xs tabular-nums">
              Bron {activeIndex + 1} van {EVIDENCE_SOURCES.length}
            </span>
          </div>

          <div className="mt-3">
            <p className="font-semibold text-[1.02rem] leading-snug">{current.org}</p>
            <p className="text-muted-foreground text-sm">{current.docTitle}</p>
          </div>

          <div className="mt-3">
            <MarkerText key={current.id} show>
              <Mark className="font-semibold text-[0.95rem] text-[var(--marker-ink)]">{current.quote}</Mark>
            </MarkerText>
          </div>

          <div className="mt-4">
            {current.kind === "pdf" && current.image && current.mark ? (
              <div className="relative h-[17rem] overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_32px_-18px_rgb(0_0_0/0.45)] ring-1 ring-black/10 sm:h-[19rem]">
                <MarkerText
                  className="transition-transform duration-500 ease-out motion-reduce:transition-none"
                  delay={250}
                  key={current.id}
                  show
                  style={pageWindow(current.mark, "17rem")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={`${current.org} — ${current.docTitle}`}
                    className="block h-auto w-full select-none"
                    src={current.image}
                  />
                  <Mark
                    className="pointer-events-none absolute"
                    style={{
                      top: `${current.mark[0] * 100}%`,
                      left: `${current.mark[1] * 100}%`,
                      width: `${(current.mark[3] - current.mark[1]) * 100}%`,
                      height: `${(current.mark[2] - current.mark[0]) * 100}%`,
                    }}
                    type="box"
                  />
                </MarkerText>
              </div>
            ) : (
              current.digimvField && (
                <div className="rounded-xl border border-border/80 bg-muted/35 p-4">
                  <p className="text-muted-foreground text-xs">{current.digimvField.scope}</p>
                  <p className="mt-1 font-medium text-sm">
                    {current.digimvField.code} · {current.digimvField.label}
                  </p>
                  <p className="mt-2 font-semibold text-2xl tabular-nums">{current.digimvField.value}</p>
                </div>
              )
            )}
          </div>

          <p className="mt-3.5 flex items-center gap-2 text-sm">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <span>{current.statusText}</span>
          </p>


        </div>

        <div className="mt-5 flex items-center justify-between border-border/70 border-t pt-3.5 text-sm">
          <button
            className="inline-flex min-h-11 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={goPrev}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Vorige
          </button>
          <span className="text-muted-foreground text-xs tabular-nums">
            Bron {activeIndex + 1} van {EVIDENCE_SOURCES.length}
          </span>
          <button
            className="inline-flex min-h-11 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={goNext}
            type="button"
          >
            Volgende
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      </aside>
    </div>
  );
}

const oneDecimal = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const millions = (amount: number) => new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 }).format(amount / 1_000_000);

function ComparePanel() {
  const [selected, setSelected] = useState(1);
  const [source, setSource] = useState<number | null>(null);
  const metric = COMPARISON_EXAMPLE.metrics[selected];
  const difference = Math.abs(metric.values[0] - metric.values[1]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="raised min-w-0 overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4 sm:px-7">
          <h3 className="text-sm font-semibold">Twee zorgorganisaties vergeleken</h3>
          <span className="text-xs text-muted-foreground">{COMPARISON_EXAMPLE.year} · fictieve cijfers</span>
        </div>
        <div className="px-4 pt-5 pb-4 sm:px-7 sm:pt-6">
          <div className="grid grid-cols-2 gap-4 pb-3 sm:ml-32 sm:gap-8">
            {COMPARISON_EXAMPLE.organizations.map((name, i) => (
              <div className="min-w-0" key={name}>
                <p className="text-sm font-semibold sm:text-base">{name}</p>
                <button aria-expanded={source === i} className="mt-1 inline-flex min-h-8 items-center text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setSource(source === i ? null : i)} type="button">Jaarrekening · p. {metric.page}</button>
              </div>
            ))}
          </div>
          <div className="divide-y divide-border">
            {COMPARISON_EXAMPLE.metrics.map((row, index) => (
              <button
                aria-pressed={selected === index}
                className={cn("grid w-full grid-cols-2 items-center gap-x-4 gap-y-3 rounded-lg px-0 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[6rem_1fr_1fr] sm:gap-x-8 sm:py-5", selected === index ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                key={row.id}
                onClick={() => setSelected(index)}
                type="button"
              >
                <span className="col-span-2 text-xs font-medium sm:col-span-1 sm:text-sm">{row.label}</span>
                {row.values.map((value, i) => (
                  <span className="min-w-0" key={i}>
                    <span className="block text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{row.prefix}{oneDecimal.format(value)}<span className="ml-0.5 text-xs font-normal tracking-normal sm:text-sm">{row.suffix}</span></span>
                    <span aria-hidden="true" className="mt-3 block h-1 overflow-hidden rounded-full bg-muted">
                      <motion.span animate={{ width: `${value / Math.max(...row.values) * 100}%`, opacity: selected === index ? 1 : 0.3 }} className={cn("block h-full rounded-full", i === 0 ? "bg-[var(--series-1)]" : "bg-[var(--series-2)]")} initial={false} transition={{ duration: 0.2 }} />
                    </span>
                  </span>
                ))}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-border bg-background/50 px-5 py-4 sm:px-7">
          <AnimatePresence initial={false} mode="wait">
            <motion.p animate={{ opacity: 1, y: 0 }} className="text-sm font-medium" exit={{ opacity: 0 }} initial={{ opacity: 0, y: 3 }} key={metric.id} transition={{ duration: 0.12 }}>
              <span className="font-semibold tabular-nums">{metric.prefix}{oneDecimal.format(difference)}</span>{metric.difference}<span className="font-normal text-muted-foreground"> bij Noord</span>
            </motion.p>
          </AnimatePresence>
          {source !== null && <p aria-live="polite" className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">{COMPARISON_EXAMPLE.organizations[source]} · Jaarrekening {COMPARISON_EXAMPLE.year}, pagina {metric.page}: {metric.label.toLowerCase()} {metric.prefix}{oneDecimal.format(metric.values[source])}{metric.suffix}.</p>}
        </div>
      </div>
    </MotionConfig>
  );
}

const PROJECT_DOCUMENTS = [
  { label: "Investeringskader", meta: "Privé · § 3", value: `${INVESTMENT_CASE.limitPercent}%`, title: "Investeringsbeleid · huisvesting", excerpt: `Een huisvestingsinvestering mag maximaal ${INVESTMENT_CASE.limitPercent}% van het eigen vermogen bedragen.` },
  { label: "Jaarrekening 2025", meta: "Openbaar · p. 12", value: `€ ${millions(INVESTMENT_CASE.equity)} mln`, title: "Balans per 31 december 2025", excerpt: `Het eigen vermogen bedraagt € ${millions(INVESTMENT_CASE.equity)} miljoen.` },
  { label: "Conceptbegroting", meta: "Privé · p. 8", value: `€ ${millions(INVESTMENT_CASE.budget)} mln`, title: "Investeringsbegroting 2026", excerpt: `Voor de vernieuwing van de huisvesting is € ${millions(INVESTMENT_CASE.budget)} miljoen begroot.` },
];

function ProjectsPanel() {
  const [selected, setSelected] = useState(0);
  const document = PROJECT_DOCUMENTS[selected];
  const citation = (index: number, label: string) => (
    <button aria-pressed={selected === index} className={cn("inline-flex min-h-8 items-center rounded-md bg-marker px-2 text-xs font-medium text-marker-ink focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2", selected === index && "ring-1 ring-marker-edge")} onClick={() => setSelected(index)} type="button">{label}</button>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="raised min-w-0 overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4 sm:px-7">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><FolderOpen aria-hidden="true" className="size-4 shrink-0" />Huisvesting Regio West</h3>
          <span className="text-xs text-muted-foreground">Fictief voorbeeld</span>
        </div>
        <div className="grid min-w-0 lg:grid-cols-[1.1fr_1fr]">
          <div className="min-w-0 px-5 py-6 sm:p-7">
            <p className="max-w-md text-base font-medium leading-relaxed">Past de investering binnen ons eigen kader?</p>
            <p className="mt-6 text-[clamp(2.4rem,4vw,3.5rem)] leading-none font-semibold tracking-[-0.04em] tabular-nums">€ {millions(INVESTMENT_CASE.overrun)} mln</p>
            <p className="mt-3 text-base text-muted-foreground">boven jullie investeringsplafond</p>
            <dl className="mt-7 divide-y divide-border border-y border-border text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 py-3"><dt>Begrote investering</dt><dd className="font-semibold tabular-nums">€ {millions(INVESTMENT_CASE.budget)} mln</dd></div>
              <div className="flex flex-wrap items-center justify-between gap-2 py-3"><dt>Toegestaan volgens jullie kader</dt><dd className="font-semibold tabular-nums">€ {millions(INVESTMENT_CASE.limit)} mln</dd></div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{INVESTMENT_CASE.limitPercent}% × € {millions(INVESTMENT_CASE.equity)} mln eigen vermogen = € {millions(INVESTMENT_CASE.limit)} mln.</p>
            <div className="mt-4 flex flex-wrap gap-2" data-no-swipe>
              {citation(0, "Kader § 3")}{citation(1, "Jaarrekening p. 12")}{citation(2, "Begroting p. 8")}
            </div>
          </div>
          <aside className="min-w-0 border-t border-border bg-background/40 px-5 py-4 sm:px-7 lg:border-t-0 lg:border-l" aria-label="Onderbouwing investeringscheck">
            <div className="divide-y divide-border" data-no-swipe>
              {PROJECT_DOCUMENTS.map((source, i) => (
                <button aria-pressed={selected === i} className={cn("flex min-h-14 w-full items-center gap-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring", selected === i ? "text-foreground" : "text-muted-foreground hover:text-foreground")} key={source.label} onClick={() => setSelected(i)} type="button">
                  {i === 1 ? <FileText aria-hidden="true" className="size-4 shrink-0" /> : <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />}
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{source.label}</span><span className="text-xs text-muted-foreground">{source.meta}</span></span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{source.value}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-4" aria-label="Bronpassage">
              <AnimatePresence initial={false} mode="wait">
                <motion.div animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} initial={{ opacity: 0, y: 3 }} key={document.label} transition={{ duration: 0.14 }}>
                  <h4 className="text-xs font-semibold text-muted-foreground">{document.title}</h4>
                  <MarkerText className="mt-3 text-sm leading-relaxed" key={document.label} show><p><Mark className="text-marker-ink">{document.excerpt}</Mark></p></MarkerText>
                </motion.div>
              </AnimatePresence>
            </div>
          </aside>
        </div>
      </div>
    </MotionConfig>
  );
}

export function LandingDemo() {
  return (
    <section className="mx-auto min-w-0 max-w-6xl px-4 pb-8 sm:px-8 sm:pb-12" id="voorbeeld" aria-labelledby="voorbeeld-titel">
      <h2 className="sr-only" id="voorbeeld-titel">Productvoorbeeld</h2>
      <SmoothTab
        items={[
          { id: "antwoord", title: "Antwoord", icon: Search, content: <div className="raised rounded-2xl p-4 sm:p-6"><ChatAndPdfPanel /></div> },
          { id: "vergelijken", title: "Vergelijken", icon: BarChart3, content: <ComparePanel /> },
          { id: "projecten", title: "Projecten", icon: FolderOpen, content: <ProjectsPanel /> },
        ]}
        label="Productvoorbeeld"
      />
    </section>
  );
}
