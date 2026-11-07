import assert from "node:assert/strict";
import { test } from "node:test";
import { createParser } from "@openuidev/lang-core";
import { z } from "zod";
import { chartGroups, presentAnswer, richAnswerSchema, type Figure } from "./rich-answer.ts";
import { parseCitations, safeEvidenceLink } from "./citations.ts";
import { parseNumber } from "./excel.ts";

const figure: Figure = { organization: "Basalt", label: "Omzet", year: 2023, amount: "89.422.224", unit: "€", href: "/bron/vragenlijst/2023/28099814/qOmzet", quote: "Omzet 89422224" };

test("OpenUI arguments round-trip, with source links and Dutch numbers preserved", () => {
  const input = { summary: 'De omzet van "Basalt".\nEen tweede regel.', figures: [figure], view: "chart" as const };
  const data = presentAnswer(input);
  const parser = createParser({ $defs: { FinancialAnswer: { ...z.toJSONSchema(richAnswerSchema), type: "object" } } }, "FinancialAnswer");
  const parsed = parser.parse(data.program);
  assert.equal(parsed.meta.errors.length, 0, JSON.stringify(parsed.meta.errors));
  assert.ok(parsed.root);
  assert.deepEqual(parsed.root.props, input);
  assert.equal(parseCitations(data.fallback)[0].href, figure.href);
  assert.equal(parseNumber(figure.amount)?.num, 89422224);
  assert.match(data.fallback, /\| Omzet \| 2023 \| 89.422.224/);
  assert.doesNotMatch(data.fallback, /Organisatie \|/);
  const comparison = presentAnswer({ ...input, figures: [figure, { ...figure, organization: "Alrijne" }] });
  assert.match(comparison.fallback, /Organisatie \|/);
  assert.match(comparison.fallback, /\| Alrijne \| Omzet/);
});

test("reject invalid amounts and external sources; group charts by post and unit", () => {
  for (const patch of [{ amount: "1.23" }, { href: "https://evil.test/bron/2023/1/1" }]) {
    assert.equal(richAnswerSchema.safeParse({ summary: "", figures: [{ ...figure, ...patch }], view: "table" }).success, false);
  }
  assert.equal(chartGroups([figure, { ...figure, unit: "x € 1.000" }, { ...figure, label: "Resultaat" }]).length, 3);
});

test("Excel links must point to a real evidence path on the public app origin", () => {
  const origin = "https://zorg.example";
  assert.equal(safeEvidenceLink(`${origin}${figure.href}?q=omzet`, origin), `${origin}${figure.href}?q=omzet`);
  for (const link of ["https://evil.test/bron/2023/1/1", "javascript:alert(1)", "/bron/not-a-source", "https://user@zorg.example/bron/2023/1/1"]) {
    assert.equal(safeEvidenceLink(link, origin), null);
  }
});
