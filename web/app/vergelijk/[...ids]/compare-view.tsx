"use client";

import { ArrowLeft, CornerDownLeft, Plus, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CitationChip } from "@/components/answer";
import { CitationPreviewProvider } from "@/components/citation-preview";
import CompareChart from "@/components/compare-chart";
import { Evidence } from "@/components/evidence";
import SwitchButton from "@/components/kokonutui/switch-button";
import { Logo } from "@/components/logo";
import { CompareWith, comparePath, OrgSearch } from "@/components/org-search";
import { type Citation, citationKey } from "@/lib/citations";
import { citationOf, dutch, METRICS, type OrgInfo, useKeyFigures } from "@/lib/key-figures";
import { compareQuestion, compareSeries, type Figure } from "@/lib/rich-answer";

// At most four: the chart has four colours that stay apart, also for colour-blind readers.
const MAX = 4;

const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} en ${names.at(-1)}` : (names[0] ?? ""));

export function CompareView() {
  const { ids } = useParams<{ ids: string[] }>();
  const unique = [...new Set(ids.map(decodeURIComponent))].slice(0, MAX);
  // Another set of organisations is another page: nothing carries over.
  return <Compare ids={unique} key={unique.join("/")} />;
}

function Compare({ ids }: { ids: string[] }) {
  const router = useRouter();
  const loaded = useKeyFigures(ids);
  const [shown, setShown] = useState<string | null>(null);

  const orgs = loaded.map((l) => (l.org && typeof l.org === "object" ? l.org : null));
  const known = orgs.filter((o): o is OrgInfo => o !== null);
  const missing = loaded.filter((l) => l.org === "missing" || l.org === "error").length;
  const title = known.length === ids.length ? list(known.map((o) => o.name)) : null;
  useEffect(() => {
    if (title) document.title = `${title} · Jaarverslagen zorg`;
  }, [title]);

  // Per figure the rows an answer would give, one organisation after another: what each chart and its table show.
  const cites = new Map<string, Citation>();
  const charts = METRICS.map((m) => {
    const rows: Figure[] = loaded.flatMap(({ id, ready }, i) => {
      const org = orgs[i];
      if (!org) return [];
      return ready.flatMap((y) => {
        const field = y.figures[m.key];
        if (!field) return [];
        const c = citationOf(id, y.year, field);
        cites.set(c.key, c);
        return [{ organization: org.name, label: m.label, year: y.year, amount: dutch(field.value), unit: m.unit, href: c.href, quote: c.quote }];
      });
    });
    const compare = compareSeries(rows);
    // ponytail: two organisations with the same name would share a line; DigiMV names are unique enough in practice
    const slot = (name: string) => orgs.findIndex((o) => o?.name === name);
    return { ...m, rows, compare: compare && { ...compare, series: compare.series.map((s) => ({ ...s, slot: slot(s.organization) })) } };
  });
  const shownCharts = charts.filter((c) => c.compare);
  // The evidence panel steps through the sources in the order the charts show them.
  const citations = shownCharts.flatMap((c) => c.compare!.series.flatMap((s) => s.points.map((f) => cites.get(citationKey(f.href, f.quote))!)));
  const index = Math.max(0, citations.findIndex((c) => c.key === shown));

  const loading = loaded.reduce((n, l) => n + l.loading, 0);
  const failed = loaded.reduce((n, l) => n + l.failed, 0);
  const groups = known.filter((o, i) => loaded[i].ready.some((y) => y.consolidated)).map((o) => o.name);
  const skipped = charts.filter((c) => !c.compare && c.rows.length).map((c) => c.label.toLowerCase());
  const remove = (id: string) => {
    const rest = ids.filter((x) => x !== id);
    router.push(rest.length > 1 ? comparePath(rest) : `/organisatie/${encodeURIComponent(rest[0])}`);
  };
  const ask = (question: string) => router.push(`/?vraag=${encodeURIComponent(question)}`);

  return (
    <CitationPreviewProvider docs={{}}>
      <div className="flex h-dvh">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="@container flex h-16 shrink-0 items-center justify-between gap-4 px-5 sm:px-8">
            <Link className="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href="/">
              <Logo />
            </Link>
            <div className="flex items-center gap-2">
              <OrgSearch />
              <SwitchButton />
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[62rem] px-5 pt-4 pb-16 sm:px-8">
              <Link className="inline-flex min-h-11 items-center gap-1.5 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href="/">
                <ArrowLeft aria-hidden="true" className="size-4" /> Naar de vragen
              </Link>

              <h1 className="mt-2 text-balance font-light text-[2rem] leading-tight tracking-[-0.015em] sm:text-[2.4rem]">
                {title ?? (missing ? "Vergelijken" : <span className="inline-block h-10 w-2/3 animate-pulse rounded-lg bg-muted align-middle" />)}
              </h1>

              {/* The organisations, each in its colour: open its page, take it out, or add one. */}
              <ul aria-label="Organisaties in de vergelijking" className="mt-5 flex flex-wrap items-center gap-2">
                {ids.map((id, i) => (
                  <li className="raised inline-flex min-h-11 items-center gap-2 rounded-full pr-1 pl-4" key={id}>
                    <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ background: `var(--series-${i + 1})` }} />
                    <Link className="rounded-sm py-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href={`/organisatie/${encodeURIComponent(id)}`}>
                      {orgs[i]?.name ?? (loaded[i].org === null ? "…" : `KvK ${id}`)}
                    </Link>
                    <button
                      aria-label={`Haal ${orgs[i]?.name ?? id} uit de vergelijking`}
                      className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => remove(id)}
                      type="button"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                ))}
                {ids.length < MAX && (
                  <li>
                    <CompareWith className="text-muted-foreground hover:text-foreground" ids={ids} label="Voeg een organisatie toe aan de vergelijking">
                      <Plus aria-hidden="true" className="size-[18px]" />
                      Toevoegen
                    </CompareWith>
                  </li>
                )}
              </ul>

              <p aria-live="polite" className="mt-6 min-h-6 text-[0.95rem] text-muted-foreground">
                {ids.length < 2
                  ? "Voeg een organisatie toe om te vergelijken."
                  : missing
                    ? "Niet elke organisatie kon worden geladen. Haal haar weg of probeer het later nog eens."
                    : loading > 0
                      ? "Kerncijfers ophalen uit DigiMV. De eerste keer duurt dat even."
                      : failed > 0
                        ? `${failed} ${failed === 1 ? "jaar kon" : "jaren konden"} niet worden opgehaald. Probeer het later nog eens.`
                        : `Zo ingevuld in de DigiMV-vragenlijst${groups.length ? `; bij ${list(groups)} de cijfers van de hele groep (geconsolideerd)` : ""}. Klik op DigiMV voor het veld.`}
              </p>

              <section aria-label="Kerncijfers naast elkaar" className={ids.length <= 2 ? "mt-4 grid gap-4 xl:grid-cols-2" : "mt-4 grid gap-4"}>
                {shownCharts.map((c) => (
                  <CompareChart
                    key={c.key}
                    source={(f) => {
                      const key = citationKey(f.href, f.quote);
                      return <CitationChip active={shown === key} href={f.href} label="DigiMV" onClick={() => setShown(key)} quote={f.quote} />;
                    }}
                    title={c.unit === "euro" ? `${c.label} · €` : c.label}
                    unit={c.unit}
                    {...c.compare!}
                  />
                ))}
                {loading > 0 && shownCharts.length === 0 && [0, 1].map((i) => <div aria-hidden="true" className="raised h-[24rem] animate-pulse rounded-xl" key={i} />)}
              </section>
              {loading === 0 && skipped.length > 0 && (
                <p className="mt-3 text-[0.9rem] text-muted-foreground">Te weinig ingevuld om te vergelijken: {list(skipped)}. De jaarverslagen zelf weten soms meer.</p>
              )}

              {known.length > 1 && known.length === ids.length && (
                <section className="mt-12">
                  <h2 className="font-semibold text-[1.15rem]">Vraag het de jaarverslagen</h2>
                  <ul className="raised mt-4 max-w-[40rem] divide-y divide-border overflow-hidden rounded-2xl">
                    {["de omzet", "het resultaat", "het eigen vermogen"].map((what) => {
                      const q = compareQuestion(known, what);
                      return (
                        <li key={q}>
                          <button
                            className="group flex min-h-14 w-full items-center gap-4 px-5 py-3 text-left leading-snug transition-colors duration-150 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden"
                            onClick={() => ask(q)}
                            type="button"
                          >
                            <span className="flex-1">{q}</span>
                            <CornerDownLeft aria-hidden="true" className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          </main>
        </div>

        <Evidence
          citations={citations}
          docs={{}}
          index={index}
          onClose={() => setShown(null)}
          onIndex={(i) => setShown(citations[i].key)}
          open={shown !== null && citations.length > 0}
        />
      </div>
    </CitationPreviewProvider>
  );
}
