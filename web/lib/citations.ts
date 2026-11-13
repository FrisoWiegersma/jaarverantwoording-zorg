// The answer cites as a Markdown link with a title (the quote). Public kinds of source:
//   a PDF page:                [p. 12](/bron/2023/84870/12 "Eigen vermogen 108.256")
//   a DigiMV questionnaire:    [DigiMV](/bron/vragenlijst/2023/82905347/qEigenVermogen_0 "Eigen vermogen 108256")
//   a CBS Iv3 cell:            [CBS Iv3](/bron/iv3/45071NED/GM0546/2025X005/6.712/L3.4.1 "Begeleiding (WMO) 16646")
//   a public PDF's page:       [p. 8](/bron/doc/00f146ee3399cf9b69cb/8 "een budgetafspraak van maximaal € 150.000")
//   a web page or Word part:   [deel 2](/bron/tekst/00f146ee3399cf9b69cb/2 "Het tarief bedraagt € 72,40 per uur")
//   a data file's row:         [rij 12](/bron/rij/7a9fb049096797a2cff4/Blad1/12 "St. Overweeghuis 95000")
//                              (between id and row: the ZIP member and/or Excel sheet, member first, when there is one)
//   a CBS StatLine value:      [CBS](/bron/cbs/86050NED/T001024/GM0546/2024JJ00/WmoClienten_1 "Wmo-cliënten 8575")
//                              (a code per dimension in the table's order, then the topic)
// react-markdown renders them as <a href title>; this file turns the same text into a list to step through.

export type Source =
  | { kind: "page"; year: number; docId: number; page: number }
  | { kind: "project"; projectId: string; documentId: string; page: number }
  | { kind: "figure"; year: number; orgId: string; field: string }
  | { kind: "iv3"; table: string; code: string; report: string; taakveld: string; categorie: string }
  | { kind: "doc"; docId: string; page: number }
  | { kind: "text"; docId: string; page: number }
  | { kind: "row"; tableId: string; parts: string[]; row: number; projectId?: string }
  | { kind: "cbs"; table: string; codes: string[]; topic: string };

export type Citation = Source & { key: string; href: string; quote: string };

// CommonMark allows "title" and 'title'; react-markdown renders both as chips, so both count here.
const LINK = /\[[^\]\n]*\]\((\/bron\/[^\s)"']+)(?:\s+(?:"([^"\n]*)"|'([^'\n]*)'))?\)/g;

export function citationKey(href: string, quote: string | undefined) {
  return `${href}|${quote ?? ""}`;
}

export function parseHref(href: string): Source | null {
  const privateSource = href.match(/^\/bron\/project\/([a-f0-9]{32})\/([a-f0-9]{32})\/([1-9]\d*)$/);
  if (privateSource) return { kind: "project", projectId: privateSource[1], documentId: privateSource[2], page: +privateSource[3] };
  const publicDoc = href.match(/^\/bron\/doc\/([0-9a-f]{20})\/([1-9]\d*)$/);
  if (publicDoc) return { kind: "doc", docId: publicDoc[1], page: +publicDoc[2] };
  const publicText = href.match(/^\/bron\/tekst\/([0-9a-f]{20})\/([1-9]\d*)$/);
  if (publicText) return { kind: "text", docId: publicText[1], page: +publicText[2] };
  let m = href.match(/^\/bron\/(\d{4})\/(\d+)\/(\d+)$/);
  if (m) return { kind: "page", year: +m[1], docId: +m[2], page: +m[3] };
  try {
    m = href.match(/^\/bron\/project\/([a-f0-9]{32})\/([a-f0-9]{32})\/rij((?:\/[^/\s]+){0,2})\/([1-9]\d*)$/);
    if (m) return { kind: "row", projectId: m[1], tableId: m[2], parts: m[3].split("/").slice(1).map(decodeURIComponent), row: +m[4] };
    m = href.match(/^\/bron\/vragenlijst\/(\d{4})\/([^/\s]+)\/([^/\s]+)$/);
    if (m) return { kind: "figure", year: +m[1], orgId: decodeURIComponent(m[2]), field: decodeURIComponent(m[3]) };
    m = href.match(/^\/bron\/iv3\/([A-Z0-9]+)\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)$/);
    if (m) {
      const [table, code, report, taakveld, categorie] = m.slice(1).map(decodeURIComponent);
      return { kind: "iv3", table, code, report, taakveld, categorie };
    }
    m = href.match(/^\/bron\/rij\/([0-9a-f]{20})((?:\/[^/\s]+){0,2})\/([1-9]\d*)$/);
    if (m) return { kind: "row", tableId: m[1], parts: m[2].split("/").slice(1).map(decodeURIComponent), row: +m[3] };
    m = href.match(/^\/bron\/cbs\/([A-Za-z0-9]{4,12})((?:\/[^/\s]+)+)\/([^/\s]+)$/);
    if (m) return { kind: "cbs", table: m[1], codes: m[2].split("/").slice(1).map(decodeURIComponent), topic: decodeURIComponent(m[3]) };
  } catch {
    // a malformed escape such as %zz: not a citation, and never a crash during render
  }
  return null;
}

/** The chip text for a source: what kind of evidence a click opens. */
export function citationLabel(s: Source) {
  return s.kind === "figure" ? "DigiMV" : s.kind === "iv3" ? "CBS Iv3" : s.kind === "cbs" ? "CBS" : s.kind === "project"
    ? "Projectbron" : s.kind === "row" ? `rij ${s.row}` : s.kind === "text" ? `deel ${s.page}` : `p. ${s.page}`;
}

/** What a click on the chip opens, for a screen reader. */
export function citationAction(s: Source | null) {
  return !s ? "Bekijk de bron" : s.kind === "project" ? "Bekijk de projectbron" : s.kind === "figure" ? "Bekijk de bron in de DigiMV-vragenlijst"
    : s.kind === "iv3" ? "Bekijk de cel in de CBS Iv3-gegevens" : s.kind === "cbs" ? "Bekijk de waarde in de CBS-tabel"
    : s.kind === "row" ? `Bekijk rij ${s.row} van het databestand` : s.kind === "text" ? `Bekijk de bron, deel ${s.page}` : `Bekijk de bron, pagina ${s.page}`;
}

/** A path segment that survives Markdown: encodeURIComponent leaves ( ) ' ! * alone, and ) would end the link. */
export const pathSegment = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

/** Citations in the order the answer makes them, each once. */
export function parseCitations(text: string): Citation[] {
  const seen = new Map<string, Citation>();
  for (const [, href, dq, sq] of text.matchAll(LINK)) {
    const quote = dq ?? sq ?? "";
    const source = parseHref(href);
    const key = citationKey(href, quote);
    if (source && !seen.has(key)) seen.set(key, { ...source, key, href, quote });
  }
  return [...seen.values()];
}

/** The standalone evidence page for one citation: what a Bron link in Excel opens. */
export function evidenceUrl(href: string, quote: string | undefined, origin: string) {
  return `${origin}${href}${quote ? `?q=${encodeURIComponent(quote)}` : ""}`;
}

/** Export only evidence links on the app's configured public origin. */
export function safeEvidenceLink(link: unknown, origin: string) {
  if (typeof link !== "string") return null;
  try {
    const url = new URL(link, origin);
    return /^https?:$/.test(url.protocol) && url.origin === new URL(origin).origin && !url.username && !url.password && parseHref(url.pathname)
      ? url.href : null;
  } catch {
    return null;
  }
}

/** While streaming, hide a citation that is still being written, so "[p. 1](/bron/20" never flashes on screen. */
export function hidePartialLink(text: string) {
  return text.replace(/\[[^\]\n]*(\]\([^)\n]*)?$/, "");
}

/** The in-app citation of a data file's row (read_table), minus the row number: our cached copy, then the ZIP member
 * and/or the Excel sheet. */
export function rowCite({ id, member, format, sheet }: { id: string; member: string | null; format: string; sheet: string | null }) {
  return `/bron/rij/${[id, ...[member, format === "xlsx" ? sheet : null].filter((p): p is string => !!p).map(pathSegment)].join("/")}/`;
}

/** The in-app citation of a CBS row (get_cbs), minus the topic: the table, then each dimension's code in the table's
 * order. A row has "CODE = title" per dimension first, then a value per topic. */
export function cbsCite(table: string, row: Record<string, unknown>, topics: Record<string, string>) {
  const codes = Object.keys(row).filter((k) => !(k in topics)).map((k) => pathSegment(String(row[k]).split(" = ")[0]));
  return `/bron/cbs/${table}/${codes.join("/")}`;
}
