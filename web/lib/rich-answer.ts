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
