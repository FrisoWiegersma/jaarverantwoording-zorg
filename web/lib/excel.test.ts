// Run: node --test lib/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { type GridCell, parseNumber, toHtml, toRows, toTsv } from "./excel.ts";

test("Dutch numbers", () => {
  assert.deepEqual(parseNumber("€ 108.256"), { num: 108256, fmt: "#,##0" });
  assert.deepEqual(parseNumber("(1.234)"), { num: -1234, fmt: "#,##0" });
  assert.deepEqual(parseNumber("-/- 1.234"), { num: -1234, fmt: "#,##0" });
  assert.deepEqual(parseNumber("−41.414"), { num: -41414, fmt: "#,##0" });
  assert.deepEqual(parseNumber("12,5%"), { num: 0.125, fmt: "0.0%" });
  assert.deepEqual(parseNumber("1.234,56"), { num: 1234.56, fmt: "#,##0.00" });
  assert.deepEqual(parseNumber("2023"), { num: 2023, fmt: "0" });
  assert.deepEqual(parseNumber("108256"), { num: 108256, fmt: "#,##0" });
  for (const text of ["Zorggroep Exact", "", "1.23", "2023/2024", "x € 1.000"]) assert.equal(parseNumber(text), null, text);
});

test("table to Excel rows", () => {
  const chip = (page: number) => ({ label: `p. ${page}`, href: `/bron/2023/84870/${page}`, quote: "Eigen vermogen 108.256" });
  const h = (text: string): GridCell => ({ text, header: true, chips: [] });
  const d = (text: string, chips: GridCell["chips"] = []): GridCell => ({ text, header: false, chips });

  // chips in their own column: that cell becomes the hyperlink
  const own = toRows([[h("Post"), h("2023"), h("Bron")], [d("Eigen vermogen"), d("€ 108.256"), d("", [chip(11)])]], "https://x.nl");
  assert.deepEqual(own[1], [
    { text: "Eigen vermogen" },
    { text: "€ 108.256", num: 108256, fmt: "#,##0" },
    { text: "p. 11", link: "https://x.nl/bron/2023/84870/11?q=Eigen%20vermogen%20108.256" },
  ]);

  // chips next to the figure: number stays a number, link moves to an added Bron column
  const inline = toRows([[h("Post"), h("2023")], [d("Eigen vermogen"), d("108.256", [chip(11)])], [d("Totaal"), d("1")]], "");
  assert.equal(inline[0].at(-1)!.text, "Bron");
  assert.equal(inline[1][1].num, 108256);
  assert.equal(inline[1][2].link, "/bron/2023/84870/11?q=Eigen%20vermogen%20108.256");
  assert.deepEqual(inline[2][2], { text: "" });

  const html = toHtml(own);
  assert.match(html, /<td x:num="108256" style="mso-number-format:'\\#\\,\\#\\#0'">108256<\/td>/);
  assert.match(html, /<a href="https:\/\/x.nl\/bron\/2023\/84870\/11\?q=Eigen%20vermogen%20108.256">p. 11<\/a>/);
  assert.equal(toTsv(own).split("\n")[1], "Eigen vermogen\t108256\tp. 11");
  assert.match(toHtml([[{ text: "<b>&" }]]), /<td>&lt;b&gt;&amp;<\/td>/);
});
