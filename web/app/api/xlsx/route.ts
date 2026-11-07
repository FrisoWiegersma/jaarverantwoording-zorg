// An answer's table as a real .xlsx: numbers as numbers with their format, Bron as a hyperlink,
// and the question plus where the figures came from underneath. Rows come from lib/excel.ts toRows().
import ExcelJS from "exceljs";
import { z } from "zod";
import { safeEvidenceLink } from "@/lib/citations";

const FMT = /^[#0,.%]{1,16}$/;
const tableSchema = z.object({
  question: z.string().max(12000).optional(),
  rows: z.array(z.array(z.object({
    text: z.string().max(2000),
    header: z.boolean().optional(),
    num: z.number().finite().optional(),
    fmt: z.string().max(16).optional(),
    link: z.string().max(2000).optional(),
  })).min(1).max(50)).min(1).max(2000),
});

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Table too large" }, { status: 413 });
  const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
  const parsed = tableSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "rows must be a non-empty table" }, { status: 400 });
  }
  const { rows, question = "" } = parsed.data;
  const origin = process.env.APP_ORIGIN ?? new URL(req.url).origin;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Jaarverslagen zorg";
  const headed = rows[0].every((c) => c?.header);
  const ws = wb.addWorksheet("Jaarverslagen", { views: headed ? [{ state: "frozen", ySplit: 1 }] : [] });
  const widths: number[] = [];

  for (const r of rows) {
    const row = ws.addRow([]);
    r.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const text = String(c?.text ?? "").slice(0, 2000);
      const link = safeEvidenceLink(c?.link, origin);
      if (!c?.header && typeof c?.num === "number" && Number.isFinite(c.num)) {
        cell.value = c.num;
        if (typeof c.fmt === "string" && FMT.test(c.fmt)) cell.numFmt = c.fmt;
        cell.alignment = { horizontal: "right" };
      } else if (link) {
        cell.value = { text, hyperlink: link, tooltip: "Bekijk waar dit getal staat" };
        cell.font = { color: { argb: "FF1D4ED8" }, underline: true };
      } else {
        cell.value = text; // strings stay strings: "=..." is never a formula
      }
      if (c?.header) {
        cell.font = { bold: true };
        cell.border = { bottom: { style: "thin" } };
      }
      widths[i] = Math.max(widths[i] ?? 0, text.length);
    });
  }
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 8), 60);
  });

  const date = new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
  ws.addRow([]);
  for (const line of [question, `Bron: DigiMV-archief, opgehaald op ${date} via Jaarverslagen zorg`].filter(Boolean)) {
    ws.addRow([line]).getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
  }

  const file = await wb.xlsx.writeBuffer();
  return new Response(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="jaarverslagen.xlsx"',
    },
  });
}
