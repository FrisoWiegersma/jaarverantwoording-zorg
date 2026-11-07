"use client";

import { Check, ClipboardCopy, Download } from "lucide-react";
import { memo, type ReactNode, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { citationKey, parseHref } from "@/lib/citations";
import { copyRows, readTable, toRows } from "@/lib/excel";
import { cn } from "@/lib/utils";

/** "p. 10" or "DigiMV" in marker yellow: the same yellow the panel shows where it says so. Styled after Kokonut AI Citations. */
export function CitationChip({
  href,
  label,
  quote,
  active,
  onClick,
}: {
  href: string;
  label: string;
  quote?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label === "DigiMV" ? "Bekijk de bron in de DigiMV-vragenlijst" : `Bekijk de bron, pagina ${label.slice(3)}`}
      aria-pressed={active}
      className={cn(
        "mx-0.5 inline-flex h-6 translate-y-[-1px] items-center rounded-[5px] bg-marker px-1.5 align-middle font-semibold text-[0.78rem] text-marker-ink tabular-nums",
        "transition-[box-shadow] duration-150 hover:shadow-[inset_0_-2px_0_var(--marker-edge)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-foreground ring-offset-1 ring-offset-background"
      )}
      data-citation=""
      data-href={href}
      data-quote={quote}
      onClick={onClick}
      // ponytail: native tooltip for the quote; the panel is the real preview
      title={quote ? `“${quote}”` : undefined}
      type="button"
    >
      {label}
    </button>
  );
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "") || "tabel";

/** A table with the two ways into Excel: paste into your own sheet, or a ready file. */
function TableCard({ question, children }: { question: string; children: ReactNode }) {
  const table = useRef<HTMLTableElement>(null);
  const [done, setDone] = useState<"copy" | "download" | "error" | null>(null);
  const rows = () => toRows(readTable(table.current!), window.location.origin);
  const flash = (what: typeof done) => {
    setDone(what);
    setTimeout(() => setDone(null), 2000);
  };

  const copy = () => copyRows(rows()).then(() => flash("copy"), () => flash("error"));
  const download = async () => {
    try {
      const res = await fetch("/api/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, rows: rows() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `jaarverslagen-${slug(question)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      flash("download");
    } catch {
      flash("error");
    }
  };

  const button =
    "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.9rem] font-semibold transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="raised my-5 overflow-hidden rounded-xl">
      <div aria-label="Cijfertabel" className="overflow-x-auto px-4 pt-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" role="region" tabIndex={0}>
        <table ref={table}>{children}</table>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
        <button className={button} onClick={copy} type="button">
          {done === "copy" ? <Check aria-hidden="true" className="size-4" /> : <ClipboardCopy aria-hidden="true" className="size-4" />}
          Kopieer voor Excel
        </button>
        <button className={button} onClick={download} type="button">
          {done === "download" ? <Check aria-hidden="true" className="size-4" /> : <Download aria-hidden="true" className="size-4" />}
          Download als Excel
        </button>
        <p aria-live="polite" className="px-2 text-[0.88rem] text-muted-foreground">
          {done === "copy" && "Gekopieerd, plak het in Excel."}
          {done === "download" && "Gedownload."}
          {done === "error" && "Dat lukte niet. Probeer het nog eens."}
        </p>
      </div>
    </div>
  );
}

export const Answer = memo(function Answer({
  text,
  question,
  activeKey,
  onCite,
}: {
  text: string;
  question: string;
  activeKey: string | null;
  onCite: (key: string) => void;
}) {
  return (
    <div className="answer text-[1.0625rem] leading-[1.7]">
      <ReactMarkdown
        components={{
          a: ({ href = "", title, children }) => {
            const target = parseHref(href);
            if (!target) {
              return (
                <a href={href} rel="noopener noreferrer" target="_blank">
                  {children}
                </a>
              );
            }
            const key = citationKey(href, title);
            return (
              <CitationChip
                active={key === activeKey}
                href={href}
                label={target.kind === "page" ? `p. ${target.page}` : "DigiMV"}
                onClick={() => onCite(key)}
                quote={title}
              />
            );
          },
          table: ({ children }) => <TableCard question={question}>{children}</TableCard>,
        }}
        remarkPlugins={[remarkGfm]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
