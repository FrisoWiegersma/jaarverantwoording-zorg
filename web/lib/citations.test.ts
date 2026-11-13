// Run: node --test lib/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { cbsCite, evidenceUrl, hidePartialLink, parseCitations, parseHref, pathSegment, rowCite } from "./citations.ts";

test("citations", () => {
  const text =
    'Eigen vermogen € 108.256 [p. 10](/bron/2023/84870/10 "Eigen vermogen 108.256"), in 2022 € 41.414 ' +
    '[p. 10](/bron/2023/84870/10 "41.414"). Nog eens [p. 10](/bron/2023/84870/10 "Eigen vermogen 108.256") en ' +
    "zonder citaat [p. 3](/bron/2025/99466/3). Ingevuld: " +
    '[DigiMV](/bron/vragenlijst/2023/82905347/jeu09700MicroJeu09700Micro "Eigen vermogen 108256"). ' +
    "Gewone link [DigiMV](https://digimv.nl).";
  const c = parseCitations(text);
  assert.deepEqual(
    c.map((x) => (x.kind === "page" ? [x.year, x.docId, x.page, x.quote] : x.kind === "figure" ? [x.year, x.orgId, x.field, x.quote] : x.kind === "project" ? [x.projectId, x.documentId, x.page, x.quote] : x.kind === "iv3" ? [x.table, x.code, x.quote] : x.kind === "doc" ? [x.docId, x.page, x.quote] : [x.kind])),
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


test("iv3 cell links keep the verbatim keys and refuse anything else", () => {
  const href = "/bron/iv3/45071NED/GM0546/2025X005/6.712/L3.4.1";
  assert.deepEqual(parseHref(href), {
    kind: "iv3", table: "45071NED", code: "GM0546", report: "2025X005", taakveld: "6.712", categorie: "L3.4.1",
  });
  assert.equal(parseCitations(`[CBS Iv3](${href} "16.646")`)[0].quote, "16.646");
  for (const bad of [href + "/x", href.replace("6.712", "%zz"), "/bron/iv3/45071ned/GM0546/2025X005/6.712/L3.4.1", "/bron/iv3/45071NED/GM0546"])
    assert.equal(parseHref(bad), null);
});

test("public PDF pages cite our cached copy by its 20-hex id", () => {
  const href = "/bron/doc/00f146ee3399cf9b69cb/8";
  assert.deepEqual(parseHref(href), { kind: "doc", docId: "00f146ee3399cf9b69cb", page: 8 });
  const [c] = parseCitations(`een budgetplafond [p. 8](${href} "maximaal € 150.000")`);
  assert.equal(c.quote, "maximaal € 150.000");
  for (const bad of [href + "/x", href.replace("/8", "/0"), "/bron/doc/00F146EE3399CF9B69CB/8", "/bron/doc/../8", "/bron/doc/00f146ee3399cf9b69c/8"])
    assert.equal(parseHref(bad), null);
});

test("web and Word parts, data file rows and CBS StatLine values cite in-app too", () => {
  const id = "7a9fb049096797a2cff4";
  assert.deepEqual(parseHref(`/bron/tekst/${id}/2`), { kind: "text", docId: id, page: 2 });
  assert.deepEqual(parseHref(`/bron/rij/${id}/12`), { kind: "row", tableId: id, parts: [], row: 12 });
  // a sheet named "2024" is still a sheet; the row is always the last segment
  assert.deepEqual(parseHref(`/bron/rij/${id}/2024/12`), { kind: "row", tableId: id, parts: ["2024"], row: 12 });
  const sheet = "MSZ VJ2024 (def)";
  const href = `/bron/rij/${id}/${pathSegment("data/a.zip.xlsx")}/${pathSegment(sheet)}/964`;
  assert.ok(!/[ ()]/.test(href), href);
  assert.deepEqual(parseHref(href), { kind: "row", tableId: id, parts: ["data/a.zip.xlsx", sheet], row: 964 });
  assert.equal(parseCitations(`[rij 964](${href} "775")`)[0].kind, "row", "a ) in a sheet name never ends the link");
  const cbs = "/bron/cbs/86050NED/T001024/GM0546/2024JJ00/WmoClienten_1";
  assert.deepEqual(parseHref(cbs), { kind: "cbs", table: "86050NED", codes: ["T001024", "GM0546", "2024JJ00"], topic: "WmoClienten_1" });
  assert.deepEqual(parseCitations(`8.575 [CBS](${cbs} "Wmo-cliënten 8575")`).map((c) => [c.kind, c.quote]), [["cbs", "Wmo-cliënten 8575"]]);
  for (const bad of [`/bron/rij/${id}/0`, `/bron/rij/${id}/a/b/c/12`, `/bron/rij/${id}`, `/bron/rij/${id}/x/%zz/1`, `/bron/tekst/${id}/0`,
    "/bron/cbs/86050NED/WmoClienten_1", "/bron/cbs/86050NED/%zz/x"])
    assert.equal(parseHref(bad), null, bad);
});

test("the tools hand out cites that parse back to the same row or value", () => {
  const id = "7a9fb049096797a2cff4";
  assert.equal(rowCite({ id, member: null, format: "csv", sheet: null }), `/bron/rij/${id}/`);
  const xlsx = rowCite({ id, member: null, format: "xlsx", sheet: "MSZ VJ2024" }) + "964";
  assert.deepEqual(parseHref(xlsx), { kind: "row", tableId: id, parts: ["MSZ VJ2024"], row: 964 });
  const zip = rowCite({ id, member: "data/k.csv", format: "csv", sheet: null }) + "3";
  assert.deepEqual(parseHref(zip), { kind: "row", tableId: id, parts: ["data/k.csv"], row: 3 });
  const member = "Nalevering Kraam & Co (2022).XLSX";
  const sevenZip = rowCite({ id, member, format: "xlsx", sheet: "Blad1" }) + "2";
  assert.deepEqual(parseHref(sevenZip), { kind: "row", tableId: id, parts: [member, "Blad1"], row: 2 });
  assert.equal(parseCitations(`[rij 2](${sevenZip} "0011")`)[0].kind, "row");
  const row = { TypeMaatwerkvoorziening: "T001024 = Totaal", RegioS: "GM0546 = Leiden", Perioden: "2024JJ00 = 2024", WmoClienten_1: 8575 };
  const cite = cbsCite("86050NED", row, { WmoClienten_1: "Wmo-cliënten (aantal)" });
  assert.equal(cite, "/bron/cbs/86050NED/T001024/GM0546/2024JJ00");
  assert.deepEqual(parseHref(`${cite}/WmoClienten_1`), { kind: "cbs", table: "86050NED", codes: ["T001024", "GM0546", "2024JJ00"], topic: "WmoClienten_1" });
});
