import { z } from "zod";
import { parseHref } from "./citations.ts";
import { parseNumber } from "./excel.ts";

const figureSchema = z.object({
  organization: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  year: z.number().int().min(2019).max(2100),
  amount: z.string().max(60).refine((s) => Number.isFinite(parseNumber(s)?.num), "Use Dutch number notation"),
  unit: z.string().min(1).max(80),
  href: z.string().max(500).refine((s) => parseHref(s) !== null, "Use a DigiMV /bron/ citation"),
  quote: z.string().min(1).max(200),
});

export const richAnswerSchema = z.object({
  summary: z.string().max(12000).describe("Short Dutch explanation, with Markdown source links for any figures mentioned"),
  figures: z.array(figureSchema).min(1).max(200).describe("One row per sourced figure; amounts exactly as filed, in Dutch notation"),
  view: z.enum(["table", "cards", "chart"]).describe("table by default; cards for a few key figures; chart for comparisons or trends"),
});

export type Figure = z.infer<typeof figureSchema>;
export type RichAnswerData = z.infer<typeof richAnswerSchema>;

const cell = (s: string) => s.replace(/[\\|\[\]<>`*_]/g, "\\$&").replace(/[\r\n]/g, " ");

export function figureTable(figures: Figure[]) {
  const multiple = new Set(figures.map((f) => f.organization)).size > 1;
  return `| ${multiple ? "Organisatie | " : ""}Post | Jaar | Bedrag | Eenheid | Bron |\n| ${multiple ? "--- | " : ""}--- | ---: | ---: | --- | --- |\n` +
    figures.map((f) => `| ${multiple ? `${cell(f.organization)} | ` : ""}${cell(f.label)} | ${f.year} | ${cell(f.amount)} | ${cell(f.unit)} | [${f.href.includes("/vragenlijst/") ? "DigiMV" : `p. ${f.href.split("/").at(-1)}`}](${f.href} "${f.quote.replace(/["|\r\n]/g, " ")}") |`).join("\n");
}

/** The model chooses the presentation; OpenUI receives only validated component arguments. */
export function presentAnswer(input: RichAnswerData) {
  const data = richAnswerSchema.parse(input);
  return {
    ...data,
    program: `root = FinancialAnswer(${JSON.stringify(data.summary)}, ${JSON.stringify(data.figures)}, ${JSON.stringify(data.view)})`,
    fallback: `${data.summary}\n\n${figureTable(data.figures)}`,
  };
}

export function chartGroups(figures: Figure[]) {
  const groups = new Map<string, Figure[]>();
  for (const figure of figures) {
    const key = `${figure.label} · ${figure.unit}`;
    const group = groups.get(key) ?? [];
    group.push(figure);
    groups.set(key, group);
  }
  return [...groups];
}

/** A chart group that reads as one line over time: one organisation, at least three distinct years. Sorted by year. */
export function trendSeries(rows: Figure[]) {
  const years = new Set(rows.map((f) => f.year));
  if (new Set(rows.map((f) => f.organization)).size !== 1 || years.size !== rows.length || years.size < 3) return null;
  return [...rows].sort((a, b) => a.year - b.year);
}

/** The question for a comparison over the latest years both filed; a short range keeps the answer quick. */
export function compareQuestion(a: { name: string; years: number[] }, b: { name: string; years: number[] }, what: string) {
  const both = a.years.filter((y) => b.years.includes(y));
  if (!both.length) return `Vergelijk ${what} van ${a.name} en ${b.name} in hun laatste jaarverslagen.`;
  const last = Math.max(...both);
  const first = Math.max(Math.min(...both), last - 3);
  return first < last
    ? `Vergelijk ${what} van ${a.name} en ${b.name} van ${first} tot en met ${last} in een grafiek.`
    : `Vergelijk ${what} van ${a.name} en ${b.name} in ${last}.`;
}

/** A chart group that compares organisations: two to four of them (one line and colour each), one row per organisation
 * per year, two or more years in all. Years ascending, organisations in the answer's order. */
export function compareSeries(rows: Figure[]) {
  const organizations = [...new Set(rows.map((f) => f.organization))];
  const years = [...new Set(rows.map((f) => f.year))].sort((a, b) => a - b);
  if (organizations.length < 2 || organizations.length > 4 || years.length < 2) return null;
  if (new Set(rows.map((f) => `${f.organization}\n${f.year}`)).size !== rows.length) return null;
  return {
    years,
    series: organizations.map((organization) => ({
      organization,
      points: rows.filter((f) => f.organization === organization).sort((a, b) => a.year - b.year),
    })),
  };
}
