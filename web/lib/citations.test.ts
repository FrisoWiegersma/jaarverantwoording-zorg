// Run: node --test lib/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceUrl, hidePartialLink, parseCitations, parseHref } from "./citations.ts";

test("citations", () => {
  const text =
    'Eigen vermogen € 108.256 [p. 10](/bron/2023/84870/10 "Eigen vermogen 108.256"), in 2022 € 41.414 ' +
    '[p. 10](/bron/2023/84870/10 "41.414"). Nog eens [p. 10](/bron/2023/84870/10 "Eigen vermogen 108.256") en ' +
    "zonder citaat [p. 3](/bron/2025/99466/3). Ingevuld: " +
    '[DigiMV](/bron/vragenlijst/2023/82905347/jeu09700MicroJeu09700Micro "Eigen vermogen 108256"). ' +
    "Gewone link [DigiMV](https://digimv.nl).";
  const c = parseCitations(text);
  assert.deepEqual(
    c.map((x) => (x.kind === "page" ? [x.year, x.docId, x.page, x.quote] : x.kind === "figure" ? [x.year, x.orgId, x.field, x.quote] : [x.projectId, x.documentId, x.page, x.quote])),
    [
      [2023, 84870, 10, "Eigen vermogen 108.256"],
      [2023, 84870, 10, "41.414"],
      [2025, 99466, 3, ""],
      [2023, "82905347", "jeu09700MicroJeu09700Micro", "Eigen vermogen 108256"],
    ],
  );
  assert.equal(hidePartialLink("Het is € 5 [p. 1](/bron/20"), "Het is € 5 ");
  assert.equal(hidePartialLink("Het is € 5 [p. 1"), "Het is € 5 ");
  assert.equal(hidePartialLink("Klaar [p. 1](/bron/2023/1/1)."), "Klaar [p. 1](/bron/2023/1/1).");
  assert.deepEqual(parseHref("/bron/2023/84870/10"), { kind: "page", year: 2023, docId: 84870, page: 10 });
  assert.deepEqual(parseHref("/bron/vragenlijst/2024/GeenKvK012/qX_0"), {
    kind: "figure",
    year: 2024,
    orgId: "GeenKvK012",
    field: "qX_0",
  });
  assert.equal(parseHref("/elders"), null);
  assert.equal(parseHref("/bron/vragenlijst/2023/123/q%zz"), null);
  assert.deepEqual(
    parseCitations("[p. 12](/bron/2023/84870/12 'Eigen vermogen 108.256')").map((x) => x.quote),
    ["Eigen vermogen 108.256"],
  );
  assert.equal(
    evidenceUrl("/bron/2023/84870/10", "Eigen vermogen 108.256", "https://x.nl"),
    "https://x.nl/bron/2023/84870/10?q=Eigen%20vermogen%20108.256",
  );
});


test("private project citation links are strict and retain their quoted evidence", () => {
  const pid = "a".repeat(32), did = "b".repeat(32);
  const href = `/bron/project/${pid}/${did}/8`;
  assert.deepEqual(parseHref(href), { kind: "project", projectId: pid, documentId: did, page: 8 });
  assert.equal(parseCitations(`[p. 8](${href} "Omzet 123")`)[0].quote, "Omzet 123");
  for (const bad of [href + "/extra", href.replace("/8", "/0"), href.replace(did, ".."), href + "?x=1"]) assert.equal(parseHref(bad), null);
});
