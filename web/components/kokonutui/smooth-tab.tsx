"use client";

/**
 * @author: @dorianbaffier
 * @description: Swipe Tabs
 * @version: 2.0.0
 * @date: 2026-10-14
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: uncontrolled, no demo tabs, app colours. Panels keep their own height (the box follows the
 * one in view, also mid-swipe) and their text stays selectable: only touch swipes, and never from inside an
 * element marked `data-no-swipe` (wide tables, the trend chart), which need the horizontal drag themselves.
 */

import type { LucideIcon } from "lucide-react";
import { type AnimationPlaybackControls, animate, useMotionValue } from "motion/react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export interface SwipeTabItem {
  id: string;
  title: string;
  icon?: LucideIcon;
  content: ReactNode;
}

// Past the first or last tab the panel moves this fraction of the drag.
const RUBBER_BAND = 0.35;
// A release this fast (px per ms) changes tab however short the drag was.
const SWIPE_VELOCITY = 0.11;
// Movement before deciding between a horizontal swipe and a vertical scroll.
const AXIS_LOCK = 6;
// Release velocity is measured over the last stretch of the drag only.
const VELOCITY_WINDOW = 100;
// A panel one full width away sits at this opacity, so the neighbour reads as "next" while it slides in.
const NEIGHBOUR_OPACITY = 0.35;
// Just under critical damping: a firm settle, a hint of overshoot only after a fast flick.
const SPRING = { type: "spring", stiffness: 420, damping: 38 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

interface TabRect {
  left: number;
  width: number;
  top: number;
  height: number;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  startProgress: number;
  axis: "x" | "y" | null;
  width: number;
  samples: { x: number; t: number }[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** The indicator rectangle at a fractional tab position. */
function indicatorRect(rects: TabRect[], progress: number): TabRect | null {
  const last = rects.length - 1;
  if (last < 0) return null;
  const p = clamp(progress, 0, last);
  const i = Math.min(Math.floor(p), Math.max(last - 1, 0));
  const a = rects[i];
  const b = rects[Math.min(i + 1, last)];
  const t = p - i;
  let left = lerp(a.left, b.left, t);
  let width = lerp(a.width, b.width, t);
  // Rubber-banding past an end: the pill presses against the wall and gives on the far side.
  const over = progress < 0 ? -progress : progress - last;
  if (over > 0) {
    const squash = width * Math.min(over, 0.5) * 0.4;
    width -= squash;
    if (progress > last) left += squash;
  }
  return { left, width, top: a.top, height: a.height };
}

/** Rubber-bands a raw position that runs past the first or last tab. */
function rubberBand(raw: number, last: number): number {
  if (raw < 0) return raw * RUBBER_BAND;
  if (raw > last) return last + (raw - last) * RUBBER_BAND;
  return raw;
}

export default function SmoothTab({
  items,
  defaultTabId,
  label,
  className,
}: {
  items: SwipeTabItem[];
  defaultTabId?: string;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
}) {
  const count = items.length;
  const [selected, setSelected] = useState(() => Math.max(items.findIndex((item) => item.id === defaultTabId), 0));
  // Captured once, so React never rewrites the imperatively painted styles.
  const [initial] = useState(selected);

  // Fractional tab position: 0 … count - 1, beyond while rubber-banding. It drives the panel track, the box
  // height, the indicator and the label clip directly, so a drag never re-renders React.
  const progress = useMotionValue(selected);

  const baseId = useId();
  const tablistRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rects = useRef<TabRect[]>([]);
  const heights = useRef<number[]>([]);
  const size = useRef({ width: 0, height: 0 });
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const reducedMotion = useRef(false);

  const paint = useCallback(
    (p: number) => {
      const track = trackRef.current;
      if (track) track.style.transform = `translate3d(${(-p * 100) / count}%, 0, 0)`;
      panelRefs.current.forEach((panel, i) => {
        if (panel) panel.style.opacity = String(1 - Math.min(Math.abs(p - i), 1) * (1 - NEIGHBOUR_OPACITY));
      });
      const c = clamp(p, 0, count - 1);
      const lo = Math.floor(c);
      const viewport = viewportRef.current;
      if (viewport && heights.current.length) {
        viewport.style.height = `${lerp(heights.current[lo] ?? 0, heights.current[Math.min(lo + 1, count - 1)] ?? 0, c - lo)}px`;
      }
      const overlay = overlayRef.current;
      const r = indicatorRect(rects.current, p);
      if (overlay && r) {
        const right = size.current.width - r.left - r.width;
        const bottom = size.current.height - r.top - r.height;
        overlay.style.clipPath = `inset(${r.top}px ${right}px ${bottom}px ${r.left}px round ${r.height / 2}px)`;
      }
    },
    [count]
  );

  // Measure the tabs and panels before paint, and again whenever they resize.
  useLayoutEffect(() => {
    const tablist = tablistRef.current;
    if (!tablist) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const box = tablist.getBoundingClientRect();
      size.current = { width: box.width, height: box.height };
      rects.current = tabRefs.current.slice(0, count).map((tab) => {
        const r = tab?.getBoundingClientRect();
        return r ? { left: r.left - box.left, width: r.width, top: r.top - box.top, height: r.height } : { left: 0, width: 0, top: 0, height: 0 };
      });
      heights.current = panelRefs.current.slice(0, count).map((panel) => panel?.offsetHeight ?? 0);
      paint(progress.get());
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tablist);
    for (const panel of panelRefs.current.slice(0, count)) if (panel) observer.observe(panel);
    document.fonts.ready.then(measure).catch(() => undefined);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [count, paint, progress]);

  useEffect(() => {
    const unsubscribe = progress.on("change", paint);
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedMotion.current = query.matches;
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      unsubscribe();
      query.removeEventListener("change", sync);
      anim.current?.stop();
    };
  }, [paint, progress]);

  /** Moves to a tab. `velocity` is in tabs per second. */
  const select = (index: number, opts: { instant?: boolean; velocity?: number } = {}) => {
    const next = clamp(index, 0, count - 1);
    anim.current?.stop();
    anim.current = null;
    if (opts.instant) progress.jump(next);
    else if (reducedMotion.current) anim.current = animate(progress, next, { duration: 0.15, ease: EASE_OUT });
    else anim.current = animate(progress, next, { ...SPRING, velocity: opts.velocity ?? 0 });
    setSelected(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const keys: Record<string, number> = { ArrowRight: (i + 1) % count, ArrowLeft: (i - 1 + count) % count, Home: 0, End: count - 1 };
    const next = keys[e.key];
    if (next === undefined) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    // A held key repeats faster than any spring settles: jump instead.
    select(next, { instant: e.repeat });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (count < 2 || e.pointerType === "mouse" || (e.target as Element).closest("[data-no-swipe]")) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startProgress: progress.get(),
      axis: null,
      width: e.currentTarget.clientWidth || 1,
      samples: [{ x: e.clientX, t: e.timeStamp }],
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    if (current.axis === null) {
      const dx = e.clientX - current.startX;
      const dy = e.clientY - current.startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
      // Vertical wins ties: the page scroll is what most people are after.
      current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (current.axis === "x") {
        // Catch the panel mid-flight, and keep the swipe alive when the finger leaves the panel.
        anim.current?.stop();
        current.startProgress = progress.get();
        current.startX = e.clientX;
        current.samples = [{ x: e.clientX, t: e.timeStamp }];
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
    if (current.axis !== "x") return;
    current.samples.push({ x: e.clientX, t: e.timeStamp });
    while (current.samples.length > 2 && e.timeStamp - current.samples[0].t > VELOCITY_WINDOW) current.samples.shift();
    progress.set(rubberBand(current.startProgress - (e.clientX - current.startX) / current.width, count - 1));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    drag.current = null;
    if (current.axis !== "x") return;
    // Swallow the tap this release may send, on the next tick at the latest.
    if (!cancelled) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    const first = current.samples[0];
    // px per ms; negative is a swipe towards the next tab.
    const vx = (e.clientX - first.x) / Math.max(e.timeStamp - first.t, 1);
    const p = progress.get();
    let next = Math.round(p);
    if (!cancelled && Math.abs(vx) > SWIPE_VELOCITY) next = vx < 0 ? Math.floor(p) + 1 : Math.ceil(p) - 1;
    // The spring starts at the finger's speed, so the hand-off is seamless.
    select(next, { velocity: (-vx * 1000) / current.width });
  };

  const tabId = (i: number) => `${baseId}-tab-${i}`;
  const panelId = (i: number) => `${baseId}-panel-${i}`;
  const tab = "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 font-semibold text-[0.9rem]";

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div>
        <div aria-label={label} className="relative inline-flex max-w-full rounded-full bg-muted p-1" ref={tablistRef} role="tablist">
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                aria-controls={panelId(i)}
                aria-selected={i === selected}
                className={cn(
                  tab,
                  "relative text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
                  "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                )}
                id={tabId(i)}
                key={item.id}
                onClick={() => select(i)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                tabIndex={i === selected ? 0 : -1}
                type="button"
              >
                {Icon && <Icon aria-hidden="true" className="size-4" />}
                <span className="whitespace-nowrap">{item.title}</span>
              </button>
            );
          })}
          {/* The same labels in the active colour, clipped to the indicator, so each label is exactly right at
              every point of the slide with no colour tween. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex bg-primary p-1"
            ref={overlayRef}
            style={{ clipPath: "inset(0 100% 0 0)" }}
          >
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <span className={cn(tab, "text-primary-foreground")} key={item.id}>
                  {Icon && <Icon className="size-4" />}
                  <span className="whitespace-nowrap">{item.title}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Clipped sideways only, so the raised cards keep their shadows. */}
      <div
        className="-mx-3 touch-pan-y overflow-x-clip"
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onLostPointerCapture={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        ref={viewportRef}
      >
        <div
          className="flex items-start will-change-transform"
          ref={trackRef}
          style={{ width: `${count * 100}%`, transform: `translate3d(${(-initial * 100) / count}%, 0, 0)` }}
        >
          {items.map((item, i) => (
            <div
              aria-labelledby={tabId(i)}
              className="flow-root px-3 focus-visible:outline-hidden"
              id={panelId(i)}
              inert={i !== selected}
              key={item.id}
              ref={(el) => {
                panelRefs.current[i] = el;
              }}
              role="tabpanel"
              style={{ width: `${100 / count}%`, opacity: i === initial ? 1 : NEIGHBOUR_OPACITY }}
            >
              {item.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
