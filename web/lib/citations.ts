// The answer cites as a Markdown link with a title (the quote). Two kinds of source:
//   a PDF page:                [p. 12](/bron/2023/84870/12 "Eigen vermogen 108.256")
//   a DigiMV questionnaire:    [DigiMV](/bron/vragenlijst/2023/82905347/qEigenVermogen_0 "Eigen vermogen 108256")
// react-markdown renders them as <a href title>; this file turns the same text into a list to step through.

export type Source =
  | { kind: "page"; year: number; docId: number; page: number }
  | { kind: "project"; projectId: string; documentId: string; page: number }
  | { kind: "figure"; year: number; orgId: string; field: string };

export type Citation = Source & { key: string; href: string; quote: string };

// CommonMark allows "title" and 'title'; react-markdown renders both as chips, so both count here.
const LINK = /\[[^\]\n]*\]\((\/bron\/[^\s)"']+)(?:\s+(?:"([^"\n]*)"|'([^'\n]*)'))?\)/g;

export function citationKey(href: string, quote: string | undefined) {
  return `${href}|${quote ?? ""}`;
}

export function parseHref(href: string): Source | null {
  const privateSource = href.match(/^\/bron\/project\/([a-f0-9]{32})\/([a-f0-9]{32})\/([1-9]\d*)$/);
  if (privateSource) return { kind: "project", projectId: privateSource[1], documentId: privateSource[2], page: +privateSource[3] };
  let m = href.match(/^\/bron\/(\d{4})\/(\d+)\/(\d+)$/);
  if (m) return { kind: "page", year: +m[1], docId: +m[2], page: +m[3] };
  m = href.match(/^\/bron\/vragenlijst\/(\d{4})\/([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  try {
    return { kind: "figure", year: +m[1], orgId: decodeURIComponent(m[2]), field: decodeURIComponent(m[3]) };
  } catch {
    return null; // a malformed escape such as %zz: not a citation, and never a crash during render
  }
}

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
