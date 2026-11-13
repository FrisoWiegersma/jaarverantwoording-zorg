"use client";

/**
 * One preview card for every citation chip, after Kokonut AI Citations (@kokonutui, MIT): it opens after a
 * short hover, and glides from chip to chip without fading out while the reader moves along the answer. It
 * shows the passage as printed, so a click on the chip is a confirmation rather than a leap. Mouse hover and
 * keyboard focus only: on touch, a tap opens the evidence panel directly.
 */

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { type CbsCell, cellCited, PrivateSource, type PrivatePage, type DocMeta, docKey, type Filed, formatCbs, formatFiled, formatIv3, type Iv3Cell, pageWindow, type Shot, type TableRow, type TextPart, checkOf, useLoaded } from "@/components/evidence";
import type { Citation } from "@/lib/citations";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const CARD_WIDTH = 320;
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 90;
// A preview closed less than this long ago reopens at once.
const WARM_MS = 400;
// Space under the header: a chip closer to the top than this opens its card below.
const TOP_ROOM = 72;
const CROP = "7rem";

interface Preview {
  c: Citation;
  x: number;
  y: number;
  /** Opens under the chip when there is no room above it on screen. */
  below: boolean;
}

interface PreviewApi {
  show: (chip: HTMLElement, c: Citation, immediate?: boolean) => void;
  hide: (immediate?: boolean) => void;
  /** The key of the citation being previewed, for the chip's aria-describedby. */
  openKey: string | null;
  id: string;
}

const PreviewContext = createContext<PreviewApi>({ show: () => {}, hide: () => {}, openKey: null, id: "" });
export const useCitationPreview = () => useContext(PreviewContext);

export function CitationPreviewProvider({ docs, children }: { docs: Record<string, DocMeta>; children: ReactNode }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warm, setWarm] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClosed = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardHeight = useRef(200);
  const id = useId();

  const clear = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const show = useCallback(
    (chip: HTMLElement, c: Citation, immediate = false) => {
      clear();
      const rect = chip.getBoundingClientRect();
      const width = Math.min(CARD_WIDTH, window.innerWidth - 16);
      const below = rect.top < cardHeight.current + TOP_ROOM;
      const next: Preview = {
        c,
        x: Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8),
        y: below ? rect.bottom + 8 : rect.top - 8,
        below,
      };
      if (immediate || preview || Date.now() - lastClosed.current < WARM_MS) {
        setWarm(preview !== null);
        setPreview(next);
        return;
      }
      openTimer.current = setTimeout(() => {
        setWarm(false);
        setPreview(next);
      }, OPEN_DELAY_MS);
    },
    [preview, clear]
  );

  const hide = useCallback(
    (immediate = false) => {
      clear();
      const close = () => {
        lastClosed.current = Date.now();
        setPreview(null);
      };
      if (immediate) close();
      else closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
    },
    [clear]
  );

  useEffect(() => clear, [clear]);

  // Remember how tall the open preview is, to decide the next one's side.
  useLayoutEffect(() => {
    if (preview && cardRef.current) cardHeight.current = cardRef.current.offsetHeight;
  });

  // Escape or any scroll closes it: the card is placed against the chip as it was.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide(true);
    const onScroll = () => hide(true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [preview, hide]);

  return (
    <PreviewContext.Provider value={{ show, hide, openKey: preview?.c.key ?? null, id }}>
      {children}
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {preview && (
            <motion.div
              animate={{ opacity: 1, scale: 1, x: preview.x, y: preview.y }}
              className="pointer-events-none fixed top-0 left-0 z-50"
              exit={{ opacity: 0, scale: 0.97 }}
              id={id}
              initial={{ opacity: 0, scale: 0.97, x: preview.x, y: preview.y }}
              role="tooltip"
              style={{ transformOrigin: "50% 0%", width: Math.min(CARD_WIDTH, window.innerWidth - 16) }}
              transition={{
                opacity: { duration: 0.14, ease: EASE_OUT },
                scale: { duration: 0.14, ease: EASE_OUT },
                x: warm ? { duration: 0.22, ease: EASE_OUT } : { duration: 0 },
                y: warm ? { duration: 0.22, ease: EASE_OUT } : { duration: 0 },
              }}
            >
              <div className={preview.below ? "" : "-translate-y-full"} ref={cardRef}>
                <div className="raised rounded-xl p-3">
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.div
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, filter: "blur(2px)" }}
                      initial={{ opacity: 0, filter: "blur(2px)" }}
                      key={preview.c.key}
                      transition={{ duration: 0.16, ease: EASE_OUT }}
                    >
                      <PreviewBody c={preview.c} doc={preview.c.kind === "page" || preview.c.kind === "doc" ? docs[docKey(preview.c)] : undefined} />
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </PreviewContext.Provider>
  );
}

function PreviewBody({ c, doc }: { c: Citation; doc?: DocMeta }) {
  const value = useLoaded(c);
  const check = checkOf(c, value);
  const paged = c.kind === "page" || c.kind === "doc";
  const shot = paged && value && value !== "error" ? (value as Shot) : null;
  const filed = c.kind === "figure" && value && value !== "error" ? (value as Filed) : null;
  const cell = c.kind === "iv3" && value && value !== "error" ? (value as Iv3Cell).cell : null;
  const text = c.kind === "text" && value && value !== "error" ? (value as TextPart) : null;
  const row = c.kind === "row" && value && value !== "error" ? (value as TableRow).data : null;
  const cbs = c.kind === "cbs" && value && value !== "error" ? (value as CbsCell).cell : null;
  if (c.kind === "project") return <PrivateSource c={c} value={value as PrivatePage | "error" | null} compact />;
  const title = paged ? doc?.org ?? (c.kind === "doc" ? "Openbaar document" : undefined) : c.kind === "iv3" ? cell?.naam ?? c.code
    : c.kind === "text" ? text?.title : c.kind === "row" ? row?.file_name ?? "Databestand" : c.kind === "cbs" ? cbs?.title : filed?.org;
  const sub = c.kind === "doc" ? `${doc?.type ?? "Openbaar document"} · pagina ${c.page}`
    : c.kind === "page" ? `${doc?.type ?? "Document"} ${c.year} · pagina ${c.page}`
    : c.kind === "text" ? `${text?.host ?? "Openbare bron"} · deel ${c.page}`
    : c.kind === "row" ? `Databestand · rij ${c.row}${row?.sheet ? ` · blad ${row.sheet}` : ""}`
    : c.kind === "cbs" ? `CBS StatLine · tabel ${c.table}`
    : c.kind === "iv3" ? `CBS Iv3${cell ? ` · ${cell.verslagsoort} ${cell.year}` : ""}` : `DigiMV-vragenlijst ${c.year}`;
  const near = text?.marks[0] && text.text.slice(Math.max(0, text.marks[0][0] - 90), text.marks[0][1] + 90).replace(/\s+/g, " ");
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="min-w-0">
        {title && <p className="truncate font-semibold">{title}</p>}
        <p className="truncate text-muted-foreground">{sub}</p>
      </div>

      {paged && value !== "error" && (
        <div className="relative h-28 overflow-hidden rounded-lg bg-white ring-1 ring-black/10">
          {shot ? (
            <div className="relative" style={shot.mark ? pageWindow(shot.mark, CROP) : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element -- blob URL of a rendered page, nothing to optimise */}
              <img alt="" className="block h-auto w-full" src={shot.src} />
              {shot.mark && (
                <span
                  className="absolute -m-1 box-content rounded-sm p-1 ring-2 ring-marker-edge"
                  style={{
                    top: `${shot.mark[0] * 100}%`,
                    left: `${shot.mark[1] * 100}%`,
                    width: `${(shot.mark[3] - shot.mark[1]) * 100}%`,
                    height: `${(shot.mark[2] - shot.mark[0]) * 100}%`,
                  }}
                />
              )}
            </div>
          ) : (
            <div className="h-full animate-pulse bg-black/[0.04]" />
          )}
        </div>
      )}

      {cell && (
        <p className="flex items-baseline justify-between gap-3">
          <span className="truncate text-muted-foreground">{cell.taakveld_naam} · {cell.categorie_naam}</span>
          <span className="shrink-0 font-semibold tabular-nums">{formatIv3(cell)}</span>
        </p>
      )}

      {near && <p className="line-clamp-3 text-muted-foreground leading-snug">…{near}…</p>}

      {row &&
        Object.entries(row.row)
          .filter(([k, v]) => k !== "row" && cellCited(c.quote, v))
          .slice(0, 3)
          .map(([k, v]) => (
            <p className="flex items-baseline justify-between gap-3" key={k}>
              <span className="truncate text-muted-foreground">{k}</span>
              <span className="shrink-0 font-semibold tabular-nums">{String(v)}</span>
            </p>
          ))}

      {cbs && (
        <p className="flex items-baseline justify-between gap-3">
          <span className="truncate text-muted-foreground">{cbs.topic}</span>
          <span className="shrink-0 font-semibold tabular-nums">{formatCbs(cbs)}</span>
        </p>
      )}

      {filed?.field && (
        <p className="flex items-baseline justify-between gap-3">
          <span className="truncate text-muted-foreground">{filed.field.label.split(" › ").at(-2) ?? filed.field.label}</span>
          <span className="shrink-0 font-semibold tabular-nums">{formatFiled(filed.field)}</span>
        </p>
      )}

      {c.quote && (
        <p className="line-clamp-3 leading-snug">
          <mark className="box-decoration-clone rounded-[3px] bg-marker px-1 font-semibold text-marker-ink">{c.quote}</mark>
        </p>
      )}

      {check && (
        <p className="font-semibold text-amber-800 leading-snug dark:text-amber-300">
          {paged
            ? "Controleer: niet alles staat letterlijk op deze pagina."
            : c.kind === "text"
              ? "Controleer: niet alles staat letterlijk in dit deel."
            : c.kind === "row"
              ? row ? "Controleer: dat getal staat niet in deze rij." : "Controleer: deze rij staat niet in het bestand."
            : c.kind === "cbs"
              ? cbs ? `Controleer: het CBS publiceert ${formatCbs(cbs)}.` : "Controleer: deze waarde staat niet in de CBS-tabel."
            : c.kind === "iv3"
              ? cell ? `Controleer: gerapporteerd is ${formatIv3(cell)}.` : "Controleer: deze cel staat niet in de CBS-tabel."
              : filed?.field
              ? `Controleer: ingevuld is ${formatFiled(filed.field)}.`
              : "Controleer: dit veld staat niet in de vragenlijst."}
        </p>
      )}

      <p className="text-[0.8rem] text-muted-foreground">
        {value === "error" ? "Kon de bron niet laden. Klik om het opnieuw te proberen." : paged ? "Klik voor de hele pagina."
          : c.kind === "text" ? "Klik voor het hele deel." : c.kind === "row" ? "Klik voor de hele rij."
          : c.kind === "iv3" || c.kind === "cbs" ? "Klik voor de cel in de CBS-gegevens." : "Klik voor het veld in de vragenlijst."}
      </p>
    </div>
  );
}
