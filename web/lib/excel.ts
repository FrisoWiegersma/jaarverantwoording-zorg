// An answer's table as Excel cells: real numbers (not text) and a Bron hyperlink per row.
// Shared by the copy button (HTML + TSV on the clipboard) and /api/xlsx (ExcelJS).
import { evidenceUrl } from "./citations.ts";

export type XCell = { text: string; header?: boolean; num?: number; fmt?: string; link?: string };
export type XRow = XCell[];

type Chip = { label: string; href: string; quote?: string };
export type GridCell = { text: string; header: boolean; chips: Chip[] };

const NUM = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;

/** Dutch notation as printed in annual reports -> number + Excel format, or null when it is text. */
export function parseNumber(raw: string): { num: number; fmt: string } | null {
  let s = raw.replace(/[\s €]/g, "");
  let neg = false;
  if (/^\(.+\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  for (const sign of ["-/-", "-", "−", "–"]) {
    if (s.startsWith(sign)) {
      neg = !neg;
      s = s.slice(sign.length);
      break;
    }
  }
  const pct = s.endsWith("%");
  if (pct) s = s.slice(0, -1);
  const m = s.match(NUM);
  if (!m) return null;
  const digits = m[1].replaceAll(".", "");
  const dec = m[2] ?? "";
  const num = (neg ? -1 : 1) * Number(dec ? `${digits}.${dec}` : digits);
  const decimals = dec ? `.${"0".repeat(dec.length)}` : "";
  if (pct) return { num: num / 100, fmt: `0${decimals}%` };
  // "2023" stays 2023, not "2.023"; longer plain numbers (questionnaire values) get thousands separators
  const plain = !m[1].includes(".") && !dec && digits.length <= 4;
  return { num, fmt: plain ? "0" : `#,##0${decimals}` };
}

/** Cells as the browser shows them, citation chips still attached. */
export function readTable(table: HTMLTableElement): GridCell[][] {
  return [...table.rows].map((tr) =>
    [...tr.cells].map((td) => {
      const clone = td.cloneNode(true) as HTMLElement;
      const chips: Chip[] = [];
      for (const chip of clone.querySelectorAll<HTMLElement>("[data-citation]")) {
        chips.push({ label: chip.textContent?.trim() ?? "", href: chip.dataset.href ?? "", quote: chip.dataset.quote });
        chip.remove();
      }
      return { text: (clone.textContent ?? "").replace(/\s+/g, " ").trim(), header: td.tagName === "TH", chips };
    }),
  );
}

/** A cell that only holds chips becomes the link; chips next to a figure move to a trailing Bron column. */
export function toRows(grid: GridCell[][], origin: string): XRow[] {
  const link = (chips: Chip[]): XCell => ({
    text: chips.map((c) => c.label).join(", "),
    link: evidenceUrl(chips[0].href, chips[0].quote, origin), // one hyperlink per Excel cell
  });
  const extra = grid.map((row) => row.flatMap((c) => (c.text && c.chips.length ? c.chips : [])));
  const needsBron = extra.some((chips) => chips.length);
  return grid.map((row, i) => {
    const cells = row.map((c): XCell => {
      if (c.header) return { text: c.text, header: true };
      if (!c.text && c.chips.length) return link(c.chips);
      return { text: c.text, ...parseNumber(c.text) };
    });
    if (!needsBron) return cells;
    if (row.every((c) => c.header)) return [...cells, { text: "Bron", header: true }];
    return [...cells, extra[i].length ? link(extra[i]) : { text: "" }];
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
// Integers go out bare, so any app in any locale reads them right; Excel itself uses x:num.
const plainText = (c: XCell) => (c.num !== undefined && Number.isInteger(c.num) && !c.fmt?.endsWith("%") ? String(c.num) : c.text);

/** HTML for the clipboard: Excel reads x:num as the value and mso-number-format as the format. */
export function toHtml(rows: XRow[]) {
  const cell = (c: XCell) => {
    if (c.header) return `<th>${esc(c.text)}</th>`;
    if (c.link) return `<td><a href="${esc(c.link)}">${esc(c.text)}</a></td>`;
    if (c.num !== undefined) {
      const fmt = c.fmt!.replace(/[#,.]/g, "\\$&");
      return `<td x:num="${c.num}" style="mso-number-format:'${fmt}'">${esc(plainText(c))}</td>`;
    }
    return `<td>${esc(c.text)}</td>`;
  };
  return (
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<head><meta charset="utf-8"></head><body><table>' +
    rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("") +
    "</table></body></html>"
  );
}

export function toTsv(rows: XRow[]) {
  return rows.map((r) => r.map((c) => plainText(c).replace(/[\t\n]/g, " ")).join("\t")).join("\n");
}

export async function copyRows(rows: XRow[]) {
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([toHtml(rows)], { type: "text/html" }),
      "text/plain": new Blob([toTsv(rows)], { type: "text/plain" }),
    }),
  ]);
}
