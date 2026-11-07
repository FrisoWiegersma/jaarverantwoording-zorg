"use client";

/** Organisations' key figures straight from the DigiMV questionnaire, without the model: the organisation and
 * comparison pages. */

import { useEffect, useState } from "react";
import { type Citation, citationKey, parseHref } from "@/lib/citations";

export type Doc = { year: number; id: number; type: string; file_name: string; published: string | null };
export type OrgInfo = { org_id: string; name: string; town: string | null; years: number[]; former_names: string[]; documents: Doc[] };
export type Field = { label: string; value: string; unit: string; var: string };
export type Year = { year: number; consolidated: boolean; figures: Record<string, Field> };

// The questionnaire's structured figures start in 2020; 2019 is only in the reports themselves.
export const FIGURES_FROM = 2020;
export const METRICS = [
  { key: "omzet", label: "Omzet", unit: "euro" },
  { key: "resultaat", label: "Resultaat", unit: "euro" },
  { key: "eigen_vermogen", label: "Eigen vermogen", unit: "euro" },
  { key: "totaal_activa", label: "Balanstotaal", unit: "euro" },
  { key: "fte", label: "Personeel in fte", unit: "fte" },
  { key: "personen", label: "Medewerkers, gemiddeld", unit: "personen" },
];

export const dutch = (value: string) => Number(value).toLocaleString("nl-NL", { maximumFractionDigits: 2 });

/** The cited questionnaire field, as an answer would cite it: the label and the value as filed. */
export function citationOf(orgId: string, year: number, f: Field): Citation {
  const href = `/bron/vragenlijst/${year}/${encodeURIComponent(orgId)}/${encodeURIComponent(f.var)}`;
  const label = f.label.split(" › ").at(-2) ?? f.label;
  const quote = `${label.length > 60 ? `${label.slice(0, 59)}…` : label} ${f.value}`;
  return { ...parseHref(href)!, key: citationKey(href, quote), href, quote };
}

export type Loaded = {
  id: string;
  org: OrgInfo | "missing" | "error" | null;
  /** Years filed from 2020, in order, as far as they have come in. */
  ready: Year[];
  loading: number;
  failed: number;
};

/**
 * Each organisation, then one request per year it filed, all at once: each fills in as it comes. A first visit fetches
 * each year from DigiMV (10 to 20 seconds); after that it is instant.
 */
export function useKeyFigures(ids: string[]): Loaded[] {
  const [orgs, setOrgs] = useState<Record<string, OrgInfo | "missing" | "error">>({});
  const [years, setYears] = useState<Record<string, Record<number, Year | "error">>>({});
  const key = ids.join("\n");

  useEffect(() => {
    const ctl = new AbortController();
    const json = (r: Response) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))));
    for (const id of key.split("\n")) {
      const put = (year: number, y: Year | "error") => setYears((all) => ({ ...all, [id]: { ...all[id], [year]: y } }));
      fetch(`/digimv/orgs/${encodeURIComponent(id)}`, { signal: ctl.signal })
        .then((r) => (r.status === 404 ? "missing" : json(r)))
        .then(
          (org: OrgInfo | "missing") => {
            setOrgs((all) => ({ ...all, [id]: org }));
            if (org === "missing") return;
            for (const year of org.years.filter((y) => y >= FIGURES_FROM)) {
              fetch(`/digimv/orgs/${encodeURIComponent(id)}/key-figures/${year}`, { signal: ctl.signal })
                .then(json)
                .then(
                  (y: Year) => put(year, y),
                  () => ctl.signal.aborted || put(year, "error")
                );
            }
          },
          () => ctl.signal.aborted || setOrgs((all) => ({ ...all, [id]: "error" }))
        );
    }
    return () => ctl.abort();
  }, [key]);

  return ids.map((id) => {
    const org = orgs[id] ?? null;
    const got = Object.values(years[id] ?? {});
    const filed = org && typeof org === "object" ? org.years.filter((y) => y >= FIGURES_FROM).length : 0;
    return {
      id,
      org,
      ready: got.filter((y): y is Year => y !== "error").sort((a, b) => a.year - b.year),
      loading: filed - got.length,
      failed: got.filter((y) => y === "error").length,
    };
  });
}
