"use client";

import { ClipboardCopy, Download } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { memo, type ReactNode, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCitationPreview } from "@/components/citation-preview";
import { citationKey, parseHref } from "@/lib/citations";
import { copyRows, readTable, toRows } from "@/lib/excel";
import { cn } from "@/lib/utils";

/** "p. 10" or "DigiMV" in marker yellow: the same yellow the panel shows where it says so. Styled after Kokonut AI
 * Citations; hover or keyboard focus previews the passage, a click opens it in the panel. */
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
  const preview = useCitationPreview();
  const source = parseHref(href);
  const key = citationKey(href, quote);
  const citation = source && { ...source, key, href, quote: quote ?? "" };
  return (
    <button
      aria-describedby={preview.openKey === key ? preview.id : undefined}
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
      onBlur={() => preview.hide(true)}
      onClick={() => {
        preview.hide(true);
        onClick();
      }}
      // Keyboard focus previews at once; a mouse click's focus doesn't, the click opens the panel.
      onFocus={(e) => citation && e.currentTarget.matches(":focus-visible") && preview.show(e.currentTarget, citation, true)}
      onPointerEnter={(e) => citation && e.pointerType === "mouse" && preview.show(e.currentTarget, citation)}
      onPointerLeave={(e) => e.pointerType === "mouse" && preview.hide()}
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

// Spinner and drawn check from Kokonut Particle Button (@dorianbaffier, MIT). Trimmed for this app: the icons
// only, without the particle burst, the shake or the label morph, so the buttons keep their width.
function Spinner() {
  return (
    <svg aria-hidden="true" className="size-4 animate-spin [animation-duration:700ms]" fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" opacity="0.25" r="6" stroke="currentColor" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function DrawnCheck() {
  const still = useReducedMotion();
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
      <motion.path
        animate={{ pathLength: 1 }}
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        initial={still ? false : { pathLength: 0 }}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        transition={{ duration: 0.3, delay: 0.08, ease: [0.23, 1, 0.32, 1] }}
      />
    </svg>
  );
}

/** A table with the two ways into Excel: paste into your own sheet, or a ready file. */
function TableCard({ question, children }: { question: string; children: ReactNode }) {
  const table = useRef<HTMLTableElement>(null);
  const [done, setDone] = useState<"copy" | "pending" | "download" | "error" | null>(null);
  const rows = () => toRows(readTable(table.current!), window.location.origin);
  const flash = (what: typeof done) => {
    setDone(what);
    setTimeout(() => setDone(null), 2000);
  };

  const copy = () => copyRows(rows()).then(() => flash("copy"), () => flash("error"));
  const download = async () => {
    if (done === "pending") return;
    setDone("pending");
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
      <div aria-label="Cijfertabel" className="overflow-x-auto px-4 pt-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" data-no-swipe="" role="region" tabIndex={0}>
        <table ref={table}>{children}</table>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
        <button className={button} onClick={copy} type="button">
          {done === "copy" ? <DrawnCheck /> : <ClipboardCopy aria-hidden="true" className="size-4" />}
          Kopieer voor Excel
        </button>
        <button aria-busy={done === "pending" || undefined} className={button} onClick={download} type="button">
          {done === "pending" ? <Spinner /> : done === "download" ? <DrawnCheck /> : <Download aria-hidden="true" className="size-4" />}
          Download als Excel
        </button>
        <p aria-live="polite" className="px-2 text-[0.88rem] text-muted-foreground">
          {done === "copy" && "Gekopieerd, plak het in Excel."}
          {done === "pending" && "Excel maken…"}
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
