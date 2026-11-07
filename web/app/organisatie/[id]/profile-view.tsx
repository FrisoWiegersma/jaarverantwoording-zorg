"use client";

import { ArrowLeft, CornerDownLeft, FileText } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CitationChip } from "@/components/answer";
import { CitationPreviewProvider } from "@/components/citation-preview";
import { Evidence } from "@/components/evidence";
import MetricCard, { type TrendPoint } from "@/components/kokonutui/metric-card";
import SwitchButton from "@/components/kokonutui/switch-button";
import { Logo } from "@/components/logo";
import { type Org, OrgSearch, templates } from "@/components/org-search";
import { type Citation, citationKey, parseHref } from "@/lib/citations";

type Doc = { year: number; id: number; type: string; file_name: string; published: string | null };
type Field = { label: string; value: string; unit: string; var: string };
type Year = { year: number; consolidated: boolean; figures: Record<string, Field> };

// The questionnaire's structured figures start in 2020; 2019 is only in the reports themselves.
const FIGURES_FROM = 2020;
const METRICS = [
  { key: "omzet", label: "Omzet", unit: "euro" },
  { key: "resultaat", label: "Resultaat", unit: "euro" },
  { key: "eigen_vermogen", label: "Eigen vermogen", unit: "euro" },
  { key: "totaal_activa", label: "Balanstotaal", unit: "euro" },
  { key: "fte", label: "Personeel in fte", unit: "fte" },
  { key: "personen", label: "Medewerkers, gemiddeld", unit: "personen" },
];

const dutch = (value: string) => Number(value).toLocaleString("nl-NL", { maximumFractionDigits: 2 });

/** The cited questionnaire field, as an answer would cite it: the label and the value as filed. */
function citationOf(orgId: string, year: number, f: Field): Citation {
  const href = `/bron/vragenlijst/${year}/${encodeURIComponent(orgId)}/${encodeURIComponent(f.var)}`;
  const label = f.label.split(" › ").at(-2) ?? f.label;
  const quote = `${label.length > 60 ? `${label.slice(0, 59)}…` : label} ${f.value}`;
  return { ...parseHref(href)!, key: citationKey(href, quote), href, quote };
}

export function ProfileView() {
  const { id } = useParams<{ id: string }>();
  // Another organisation is another page: nothing carries over.
  return <Profile id={decodeURIComponent(id)} key={id} />;
}

function Profile({ id }: { id: string }) {
  const router = useRouter();
  const [org, setOrg] = useState<(Org & { former_names: string[]; documents: Doc[] }) | "missing" | "error" | null>(null);
  const [years, setYears] = useState<Record<number, Year | "error">>({});
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/digimv/orgs/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : r.status === 404 ? "missing" : Promise.reject(new Error(String(r.status)))))
      .then(setOrg, () => setOrg("error"));
  }, [id]);

  const filed = useMemo(() => (org && typeof org === "object" ? org.years.filter((y) => y >= FIGURES_FROM) : []), [org]);
  // One request per year, all at once: each fills in as it comes. A first visit fetches each year from DigiMV
  // (10 to 20 seconds); after that it is instant.
  useEffect(() => {
    for (const year of filed) {
      fetch(`/digimv/orgs/${encodeURIComponent(id)}/key-figures/${year}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then(
          (y: Year) => setYears((all) => ({ ...all, [year]: y })),
          () => setYears((all) => ({ ...all, [year]: "error" }))
        );
    }
  }, [id, filed]);

  const name = org && typeof org === "object" ? org.name : null;
  useEffect(() => {
    if (name) document.title = `${name} · Jaarverslagen zorg`;
  }, [name]);

  const ready = Object.values(years).filter((y): y is Year => y !== "error").sort((a, b) => a.year - b.year);
  const failed = Object.values(years).filter((y) => y === "error").length;
  const loading = filed.length - Object.keys(years).length;
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
          <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-5 sm:px-8">
            <Link className="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href="/">
              <Logo />
            </Link>
            <OrgSearch className="hidden md:block" onPick={ask} />
            <SwitchButton />
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

                  <p aria-live="polite" className="mt-6 min-h-6 text-[0.95rem] text-muted-foreground">
                    {loading > 0
                      ? `Kerncijfers ophalen uit DigiMV: ${filed.length - loading} van ${filed.length} jaar. De eerste keer duurt dat even.`
                      : failed > 0
                        ? `${failed} ${failed === 1 ? "jaar kon" : "jaren konden"} niet worden opgehaald. Probeer het later nog eens.`
                        : filed.length
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
                  {filed.length > 0 && org.years.includes(2019) && (
                    <p className="mt-3 text-[0.9rem] text-muted-foreground">2019 staat alleen in de jaarverslagen zelf. Vraag ernaar, dan zoekt de assistent het op.</p>
                  )}

                  <section className="mt-12">
                    <h2 className="font-semibold text-[1.15rem]">Vraag het de jaarverslagen</h2>
                    <ul className="raised mt-4 max-w-[40rem] divide-y divide-border overflow-hidden rounded-2xl">
                      {templates(org).map((t) => (
                        <li key={t.id}>
                          <button
                            className="group flex min-h-14 w-full items-center gap-4 px-5 py-3 text-left leading-snug transition-colors duration-150 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden"
                            onClick={() => t.value && ask(t.value)}
                            type="button"
                          >
                            <span className="flex-1">{t.value}</span>
                            <CornerDownLeft aria-hidden="true" className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="mt-12">
                    <h2 className="font-semibold text-[1.15rem]">Documenten</h2>
                    <ul className="mt-4 grid gap-x-8 sm:grid-cols-2">
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
