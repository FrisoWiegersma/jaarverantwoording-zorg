"use client";

import { ArrowLeft, ArrowRightLeft, CornerDownLeft, FileText } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CitationChip } from "@/components/answer";
import { CitationPreviewProvider } from "@/components/citation-preview";
import { Evidence } from "@/components/evidence";
import MetricCard, { type TrendPoint } from "@/components/kokonutui/metric-card";
import SwitchButton from "@/components/kokonutui/switch-button";
import { Logo } from "@/components/logo";
import { CompareWith, type Org, OrgSearch } from "@/components/org-search";
import { citationOf, dutch, METRICS, useKeyFigures } from "@/lib/key-figures";

/** Questions the agent answers well, over the latest years filed; ranges stay short so answers stay quick. */
function questions({ name, years }: Org) {
  const last = Math.max(...years);
  const first = Math.max(Math.min(...years), last - 3);
  return [
    `Toon de omzet van ${name} van ${first} tot en met ${last} in een grafiek.`,
    `Wat was het eigen vermogen van ${name} eind ${last}?`,
    `Hoe groot was het resultaat van ${name} in ${last}, vergeleken met het jaar ervoor?`,
    `Hoeveel personeel had ${name} in ${last}, in fte en in personen?`,
  ];
}

export function ProfileView() {
  const { id } = useParams<{ id: string }>();
  // Another organisation is another page: nothing carries over.
  return <Profile id={decodeURIComponent(id)} key={id} />;
}

function Profile({ id }: { id: string }) {
  const router = useRouter();
  const [{ org, ready, loading, failed }] = useKeyFigures([id]);
  const [shown, setShown] = useState<string | null>(null);
  const filed = ready.length + loading + failed;

  const name = org && typeof org === "object" ? org.name : null;
  useEffect(() => {
    if (name) document.title = `${name} · Jaarverslagen zorg`;
  }, [name]);

  const series = METRICS.map((m) => ({
    ...m,
    points: ready.flatMap((y) => (y.figures[m.key] ? [{ year: y.year, field: y.figures[m.key] }] : [])),
  }));
  const citations = series.flatMap((m) => m.points.map((p) => citationOf(id, p.year, p.field)));
  const index = Math.max(0, citations.findIndex((c) => c.key === shown));
  const group = ready.some((y) => y.consolidated);
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

              {org === "missing" || org === "error" ? (
                <p className="mt-6 text-[1.05rem]" role="alert">
                  {org === "missing" ? "Deze organisatie staat niet in het DigiMV-archief." : "De organisatie kon niet worden geladen. Probeer het later nog eens."}
                </p>
              ) : !org ? (
                <div className="mt-4 h-24 w-2/3 animate-pulse rounded-xl bg-muted" />
              ) : (
                <>
                  <h1 className="mt-2 text-balance font-light text-[2rem] leading-tight tracking-[-0.015em] sm:text-[2.4rem]">{org.name}</h1>
                  <p className="mt-2 text-muted-foreground">
                    {[org.town, `KvK ${org.org_id}`, `jaarverslagen ${Math.min(...org.years)}–${Math.max(...org.years)}`].filter(Boolean).join(" · ")}
                    {org.former_names.length > 0 && <> · eerder {org.former_names.join(", ")}</>}
                  </p>
                  <div className="mt-5">
                    <CompareWith ids={[org.org_id]} label={`Vergelijk ${org.name} met`}>
                      <ArrowRightLeft aria-hidden="true" className="size-[18px]" />
                      Vergelijk met…
                    </CompareWith>
                  </div>

                  <p aria-live="polite" className="mt-6 min-h-6 text-[0.95rem] text-muted-foreground">
                    {loading > 0
                      ? `Kerncijfers ophalen uit DigiMV: ${filed - loading} van ${filed} jaar. De eerste keer duurt dat even.`
                      : failed > 0
                        ? `${failed} ${failed === 1 ? "jaar kon" : "jaren konden"} niet worden opgehaald. Probeer het later nog eens.`
                        : filed
                          ? `Zo ingevuld in de DigiMV-vragenlijst${group ? "; bij een groep de cijfers van de hele groep (geconsolideerd)" : ""}. Klik op DigiMV voor het veld.`
                          : "Deze organisatie heeft geen DigiMV-vragenlijst vanaf 2020. Vraag het de jaarverslagen."}
                  </p>

                  <section aria-label="Kerncijfers" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {series.map((m) =>
                      m.points.length ? (
                        <MetricCard
                          key={m.key}
                          label={m.label}
                          points={m.points.map(({ year, field }): TrendPoint => {
                            const c = citationOf(id, year, field);
                            return {
                              year,
                              value: Number(field.value),
                              amount: dutch(field.value),
                              source: <CitationChip active={shown === c.key} href={c.href} label="DigiMV" onClick={() => setShown(c.key)} quote={c.quote} />,
                            };
                          })}
                          unit={m.unit}
                        />
                      ) : loading > 0 ? (
                        <div aria-hidden="true" className="raised h-[17.5rem] animate-pulse rounded-xl" key={m.key} />
                      ) : null
                    )}
                  </section>
                  {filed > 0 && org.years.includes(2019) && (
                    <p className="mt-3 text-[0.9rem] text-muted-foreground">2019 staat alleen in de jaarverslagen zelf. Vraag ernaar, dan zoekt de assistent het op.</p>
                  )}

                  <section className="mt-12">
                    <h2 className="font-semibold text-[1.15rem]">Vraag het de jaarverslagen</h2>
                    <ul className="raised mt-4 max-w-[40rem] divide-y divide-border overflow-hidden rounded-2xl">
                      {questions(org).map((q) => (
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
                      ))}
                    </ul>
                  </section>

                  <section className="mt-12">
                    <h2 className="font-semibold text-[1.15rem]">Documenten</h2>
                    <ul className="mt-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                      {org.documents.map((d) => (
                        <li className="border-b" key={`${d.year}/${d.id}`}>
                          <a
                            className="flex min-h-12 items-center gap-3 py-2 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                            href={`/digimv/documents/${d.year}/${d.id}/pdf`}
                            rel="noopener"
                            target="_blank"
                          >
                            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{d.type}</span>
                            <span className="shrink-0 text-muted-foreground tabular-nums">{d.year}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
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
