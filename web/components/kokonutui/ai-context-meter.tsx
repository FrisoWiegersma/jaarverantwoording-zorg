"use client";

/**
 * @author: @kokonutui
 * @description: AI Context Meter
 * @version: 1.0.0
 * @date: 2026-10-15
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: real token counts from the last answer instead of the demo, and no compaction (the chat
 * route already drops older pages from follow-up questions). Dutch labels and the app's theme tokens.
 */

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ContextSegment {
  id: string;
  label: string;
  tokens: number;
  /** A Tailwind background class for the segment. */
  color: string;
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** Eases a number toward its target, so counts roll instead of jumping. */
function useTweened(target: number, duration = 450) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const valueRef = useRef(target);

  useEffect(() => {
    // Reduced motion lands on the target in the first frame.
    const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
    fromRef.current = valueRef.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = ms ? Math.min(1, (now - start) / ms) : 1;
      valueRef.current = fromRef.current + (target - fromRef.current) * (1 - (1 - t) ** 3);
      setValue(valueRef.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

const formatTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1).replace(".", ",")} mln`
    : tokens >= 1000
      ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1).replace(".", ",")}k`
      : `${Math.round(tokens)}`;

const percent = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0).replace(".", ",")}%`;

function Ring({ share }: { share: number }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg aria-hidden="true" className="size-4 shrink-0 -rotate-90" fill="none" viewBox="0 0 16 16">
      <circle className="stroke-foreground/15" cx="8" cy="8" r={radius} strokeWidth="2" />
      <circle
        // No CSS transition: `share` is already tweened, and easing it twice made the ring trail the percentage.
        className="stroke-current"
        cx="8"
        cy="8"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, share))}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function Breakdown({ segments, limit }: { segments: ContextSegment[]; limit: number }) {
  const [active, setActive] = useState<string | null>(null);
  const used = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  const free = Math.max(0, limit - used);
  const shownUsed = useTweened(used);

  return (
    <div className="w-[min(20rem,calc(100vw-2.5rem))] p-3">
      <div className="mb-2.5 flex items-baseline justify-between">
        <p className="font-medium text-sm">Context van het laatste antwoord</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {formatTokens(shownUsed)} / {formatTokens(limit)}
        </p>
      </div>

      {/* One bar for the whole window, a segment per source. */}
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" onPointerLeave={() => setActive(null)}>
        {segments.map((segment, index) => (
          <span
            className={cn(
              "h-full transition-[width,opacity] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              index > 0 && segment.tokens > 0 && "ml-px",
              segment.color,
              active && active !== segment.id && "opacity-30"
            )}
            key={segment.id}
            onPointerEnter={() => setActive(segment.id)}
            style={{ width: `${(segment.tokens / limit) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-3 space-y-0.5">
        {segments.map((segment) =>
          segment.tokens > 0 ? (
            <li
              className={cn(
                "flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors duration-150",
                active === segment.id && "bg-muted"
              )}
              key={segment.id}
              onPointerEnter={() => setActive(segment.id)}
              onPointerLeave={() => setActive(null)}
            >
              <span className={cn("size-2 rounded-[3px]", segment.color)} />
              <span>{segment.label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">{formatTokens(segment.tokens)}</span>
              <span className="w-11 text-right text-muted-foreground tabular-nums">{percent(segment.tokens / limit)}</span>
            </li>
          ) : null
        )}
        <li className="flex items-center gap-2 px-1.5 py-1 text-sm">
          <span className="size-2 rounded-[3px] ring-1 ring-border ring-inset" />
          <span className="text-muted-foreground">Vrij</span>
          <span className="ml-auto text-muted-foreground tabular-nums">{formatTokens(free)}</span>
          <span className="w-11 text-right text-muted-foreground tabular-nums">{percent(free / limit)}</span>
        </li>
      </ul>
      <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
        Bij een vervolgvraag vallen de bronnen van oudere vragen weg; het antwoord blijft staan.
      </p>
    </div>
  );
}

export default function AIContextMeter({
  segments,
  limit,
  className,
}: {
  segments: ContextSegment[];
  /** The model's context window, in tokens. */
  limit: number;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const share = segments.reduce((sum, segment) => sum + segment.tokens, 0) / limit;
  const shownShare = useTweened(share);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Closes on Escape or a press outside, like any popover.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Focus inside the panel would be lost with it; hand it back.
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <MotionConfig reducedMotion="user">
      {/* Not `relative`: the panel lines up with the prompt box's right edge, so it fits on a phone. */}
      <div className={className} ref={rootRef}>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={`Context ${percent(share)} gevuld. Toon opbouw`}
          className={cn(
            "flex h-11 items-center gap-1.5 rounded-full px-3 text-sm outline-hidden transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
            open && "bg-muted",
            share >= 0.8 ? "text-destructive" : "text-muted-foreground"
          )}
          onClick={() => setOpen((value) => !value)}
          ref={triggerRef}
          type="button"
        >
          <Ring share={shownShare} />
          <span className="font-medium tabular-nums">{percent(shownShare)}</span>
        </button>
        {/* After the trigger in the DOM, so Tab moves from it into the panel, which still opens above. */}
        <AnimatePresence>
          {open && (
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="raised absolute right-0 bottom-full z-20 mb-2 origin-bottom-right rounded-xl"
              exit={{ opacity: 0, scale: 0.97, y: 4 }}
              id={panelId}
              initial={{ opacity: 0, scale: 0.97, y: 4 }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
            >
              <Breakdown limit={limit} segments={segments} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
