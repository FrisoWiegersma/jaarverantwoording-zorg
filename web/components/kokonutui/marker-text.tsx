"use client";

/**
 * @author: @kokonutui
 * @description: Marker Text
 * @version: 2.0.0
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: highlight and box only, drawn once when `show` turns true (remount to draw again),
 * colours from CSS variables, an optional start delay. With reduced motion the marks are simply there.
 */

import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

type MarkType = "highlight" | "box";
type Pt = [number, number];
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface Entry {
  el: HTMLElement;
  type: MarkType;
  color: string;
}
interface Stroke {
  key: string;
  /** The filled ink shape. */
  shape: string;
  /** The centre line the mask draws along, revealing the shape. */
  pen: string;
  penWidth: number;
  length: number;
  color: string;
  under: boolean;
  delay: number;
  duration: number;
}

// How fast the pen travels, in px per ms; a hand slows down on long strokes, so durations are clamped.
const PEN_SPEED = 0.9;
const HIGHLIGHT_SPEED = 1.15;
const MIN_MS = 260;
const MAX_MS = 820;
const LINE_GAP = 60;
// A pause between one mark and the next: first the quote, then the page.
const GAP = 140;
// The layers are 1px boxes that overflow, so masks need an explicit region.
const MASK_SPAN = 20_000;

/** Deterministic noise, so a resize redraws the same wobble. */
function random(seed: number) {
  let n = seed;
  return () => {
    n += 1;
    const x = Math.sin(n * 12.9898 + seed * 78.233) * 43_758.5453;
    return x - Math.floor(x);
  };
}

function hash(text: string) {
  let h = 7;
  for (const char of text) h = (h * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
  return h;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const polyline = (points: Pt[]) => points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${r1(x)} ${r1(y)}`).join("");

function lengthOf(points: Pt[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

/** A pen stroke as a filled shape whose width changes along the way, which is what makes it read as ink. */
function outline(points: Pt[], widths: number[]) {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const last = points.length - 1;
  for (let i = 0; i <= last; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(last, i + 1)];
    const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
    const half = widths[i] / 2;
    const nx = (-(next[1] - prev[1]) / len) * half;
    const ny = ((next[0] - prev[0]) / len) * half;
    left.push([points[i][0] + nx, points[i][1] + ny]);
    right.push([points[i][0] - nx, points[i][1] - ny]);
  }
  const endCap = r1(widths[last] / 2);
  const startCap = r1(widths[0] / 2);
  const back = right.reverse();
  return `${polyline(left)}A${endCap} ${endCap} 0 0 0 ${r1(back[0][0])} ${r1(back[0][1])}${polyline(back).replace("M", "L")}A${startCap} ${startCap} 0 0 0 ${r1(left[0][0])} ${r1(left[0][1])}Z`;
}

/** Pressure along a stroke: the pen lands, presses, then lifts off. */
function pressure(t: number, base: number) {
  const land = Math.min(1, t / 0.1);
  const lift = Math.min(1, (1 - t) / 0.18);
  return base * (0.45 + 0.55 * Math.sin((land * Math.PI) / 2)) * (0.55 + 0.45 * lift);
}

/** A slow, uneven wave for edges that should look hand drawn. */
function wobble(rand: () => number, amp: number) {
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const f1 = 1 + rand() * 1.5;
  const f2 = 3 + rand() * 3;
  return (t: number) => amp * (0.7 * Math.sin(t * f1 * Math.PI + p1) + 0.3 * Math.sin(t * f2 * Math.PI + p2));
}

function sample(count: number, at: (t: number) => Pt) {
  const points: Pt[] = [];
  for (let i = 0; i <= count; i++) points.push(at(i / count));
  return points;
}

function highlightStroke(line: Rect, rand: () => number, key: string, color: string): Omit<Stroke, "delay" | "duration"> {
  const h = line.bottom - line.top;
  const top = wobble(rand, 0.9);
  const bottom = wobble(rand, 0.9);
  // The chisel tip leaves slanted ends, and the stroke drifts a little off level across the line.
  const chisel = h * 0.2;
  const tilt = (rand() - 0.5) * Math.min(3, h * 0.08);
  const x0 = line.left - 3 - rand() * 2;
  const x1 = line.right + 3 + rand() * 3;
  const y0 = line.top + h * 0.02;
  const y1 = line.bottom - h * 0.02;
  const steps = Math.max(6, Math.round((x1 - x0) / 14));
  const edge = (y: number, wave: (t: number) => number, dx: number) =>
    sample(steps, (t) => [x0 + dx + (x1 - x0) * t, y + wave(t) + tilt * (t - 0.5)]);
  const upper = edge(y0, top, chisel * 0.5);
  const lower = edge(y1, bottom, -chisel * 0.5).reverse();
  const mid = (y0 + y1) / 2;
  const pen: Pt[] = [
    [x0 - chisel, mid],
    [x1 + chisel, mid + tilt * 0.5],
  ];
  return { key, shape: `${polyline(upper)}${polyline(lower).replace("M", "L")}Z`, pen: polyline(pen), penWidth: h * 1.8, length: lengthOf(pen), color, under: true };
}

/** One continuous stroke round four slightly bowed sides, overshooting the first corner at the end. */
function boxStroke(box: Rect, rand: () => number, key: string, color: string): Omit<Stroke, "delay" | "duration"> {
  const width = 2.4;
  const corners: Pt[] = [
    [box.left - 5 - rand() * 2, box.top - 3 + (rand() - 0.5) * 2],
    [box.right + 5 + rand() * 2, box.top - 3 + (rand() - 0.5) * 2],
    [box.right + 5 + (rand() - 0.5) * 2, box.bottom + 3 + rand() * 2],
    [box.left - 5 + (rand() - 0.5) * 2, box.bottom + 3 + rand() * 2],
  ];
  const points: Pt[] = [];
  for (let side = 0; side < 4; side++) {
    const a = corners[side];
    const b = corners[(side + 1) % 4];
    const bow = (rand() - 0.5) * 3;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const steps = Math.max(6, Math.round(len / 8));
    for (let s = side === 0 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      const lift = Math.sin(t * Math.PI) * bow;
      points.push([a[0] + (b[0] - a[0]) * t + nx * lift, a[1] + (b[1] - a[1]) * t + ny * lift]);
    }
  }
  const [first, second] = corners;
  const over = 14 / Math.hypot(second[0] - first[0], second[1] - first[1]);
  points.push([first[0] + (second[0] - first[0]) * over, first[1] + (second[1] - first[1]) * over + 1.5]);
  const widths = points.map((_, i) => pressure(i / (points.length - 1), width));
  return { key, shape: outline(points, widths), pen: polyline(points), penWidth: width * 4, length: lengthOf(points), color, under: false };
}

const MarkerContext = createContext<((id: string, entry: Entry) => () => void) | null>(null);

/** A phrase (highlight, rendered as <mark>) or an element (box) to mark, inside `MarkerText`. */
export function Mark({
  children,
  type = "highlight",
  color = type === "highlight" ? "var(--marker)" : "var(--marker-edge)",
  className,
  style,
}: {
  children?: ReactNode;
  type?: MarkType;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const add = useContext(MarkerContext);
  const ref = useRef<HTMLElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (add && ref.current) return add(id, { el: ref.current, type, color });
  }, [add, id, type, color]);
  const Tag = type === "highlight" ? "mark" : "span";
  return (
    <Tag className={cn("bg-transparent text-inherit", className)} data-mark={type} ref={ref} style={style}>
      {children}
    </Tag>
  );
}

/** Draws its marks in reading order once `show` is true. */
export function MarkerText({
  children,
  show,
  delay = 0,
  className,
  style,
}: {
  children: ReactNode;
  show: boolean;
  /** Milliseconds before the first mark starts. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const entries = useRef(new Map<string, Entry>());
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ready, setReady] = useState(false);
  const maskId = useId().replace(/:/g, "");

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    // Reading order is document order, whatever order the marks mounted in.
    const order = Array.from(root.querySelectorAll("[data-mark]"));
    const ordered = [...entries.current.values()].sort((a, b) => order.indexOf(a.el) - order.indexOf(b.el));
    const next: Stroke[] = [];
    let clock = delay;
    ordered.forEach((entry, index) => {
      const lines = Array.from(entry.el.getClientRects())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top }));
      if (lines.length === 0) return;
      const rand = random(hash(`${entry.el.textContent ?? ""}${index}`));
      const speed = entry.type === "highlight" ? HIGHLIGHT_SPEED : PEN_SPEED;
      const made = lines.map((line, i) =>
        entry.type === "highlight" ? highlightStroke(line, rand, `${index}-${i}`, entry.color) : boxStroke(line, rand, `${index}-${i}`, entry.color)
      );
      made.forEach((stroke, i) => {
        const duration = Math.min(MAX_MS, Math.max(MIN_MS, stroke.length / speed));
        next.push({ ...stroke, delay: clock, duration });
        clock += duration + (i < made.length - 1 ? LINE_GAP : 0);
      });
      clock += GAP;
    });
    setStrokes(next);
  }, [delay]);

  const add = useMemo(
    () => (id: string, entry: Entry) => {
      entries.current.set(id, entry);
      measure();
      return () => {
        entries.current.delete(id);
        measure();
      };
    },
    [measure]
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    // Web fonts can swap in after the first measure and move every line.
    document.fonts?.ready.then(measure);
    return () => resize.disconnect();
  }, [measure]);

  // Draw on the frame after the undrawn state has painted, so the transition always runs.
  useEffect(() => {
    if (!show) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [show]);
  const armed = show && ready;

  const layer = (under: boolean) => (
    <svg aria-hidden="true" className={cn("pointer-events-none absolute top-0 left-0 overflow-visible", under ? "-z-10" : "z-10")} height="1" width="1">
      {strokes
        .filter((s) => s.under === under)
        .map((s) => {
          const id = `${maskId}-${s.key}`;
          return (
            <g key={s.key}>
              <mask height={MASK_SPAN} id={id} maskUnits="userSpaceOnUse" width={MASK_SPAN} x={-MASK_SPAN / 2} y={-MASK_SPAN / 2}>
                <path
                  className="transition-[stroke-dashoffset] ease-[cubic-bezier(0.45,0.05,0.25,1)] motion-reduce:transition-none"
                  d={s.pen}
                  fill="none"
                  stroke="white"
                  strokeDasharray={s.length + 1}
                  strokeDashoffset={armed ? 0 : s.length + 1}
                  strokeLinecap={under ? "butt" : "round"}
                  strokeLinejoin="round"
                  strokeWidth={s.penWidth}
                  style={{ transitionDuration: `${s.duration}ms`, transitionDelay: `${s.delay}ms` }}
                />
              </mask>
              <path d={s.shape} mask={`url(#${id})`} style={{ fill: s.color }} />
            </g>
          );
        })}
    </svg>
  );

  return (
    <MarkerContext.Provider value={add}>
      <div className={cn("relative isolate", className)} data-armed={armed ? "" : undefined} ref={rootRef} style={style}>
        {layer(true)}
        {children}
        {layer(false)}
      </div>
    </MarkerContext.Provider>
  );
}
