"use client";

/**
 * @author: @dorianbaffier
 * @description: Metric Card
 * @version: 2.0.0
 * @date: 2026-10-17
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: one figure over the years as filed, one point per year. Hover, drag or arrow keys read a
 * year; the amount rolls to it, exactly as filed, with that year's source. No periods, segments, events, ranges
 * or morphing.
 */

import { type KeyboardEvent, type PointerEvent, type ReactNode, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// The chart's drawing box; it stretches to the card's width.
const W = 400;
const H = 120;
const PAD_Y = 12;
const DIGIT = /\d/;
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export interface TrendPoint {
  year: number;
  value: number;
  /** The amount exactly as filed, in Dutch notation. */
  amount: string;
  source: ReactNode;
}

const yOf = (height: number) => PAD_Y + (1 - height) * (H - PAD_Y * 2);

/** Heights 0..1 to an SVG path, smoothed with a Catmull-Rom spline. */
function toPath(heights: number[]) {
  const pts = heights.map((h, i) => [(i / Math.max(1, heights.length - 1)) * W, yOf(h)]);
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/** Each digit rolls on its own wheel; separators sit still. */
function RollingNumber({ value }: { value: string }) {
  const chars = value.split("");
  return (
    <span aria-hidden className="inline-flex tabular-nums">
      {chars.map((char, i) => {
        // Keyed from the right, so units stay put when the length changes.
        const key = chars.length - i;
        if (!DIGIT.test(char)) {
          return <span key={`s${key}`}>{char}</span>;
        }
        return (
          <span className="relative inline-block h-[1em] overflow-hidden leading-none" key={`d${key}`}>
            <span className="invisible">0</span>
            <span
              className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-[380ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
              style={{ transform: `translateY(-${Number(char) * 10}%)` }}
            >
              {DIGITS.map((d) => (
                <span className="block h-[1em] leading-none" key={d}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

const percent = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

export default function MetricCard({ label, unit, points }: { label: string; unit: string; points: TrendPoint[] }) {
  const clipId = `${useId().replace(/:/g, "")}-lit`;
  // The year under the pointer or keyboard cursor; at rest, the latest.
  const [cursor, setCursor] = useState<number | null>(null);
  const pressed = useRef(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const last = points.length - 1;
  const at = cursor ?? last;
  const point = points[at];
  const prev = points[at - 1];
  const delta = prev && prev.value !== 0 ? (point.value - prev.value) / Math.abs(prev.value) : null;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const norm = (v: number) => (hi === lo ? 0.5 : (v - lo) / (hi - lo));
  const line = toPath(values.map(norm));
  const xOf = (i: number) => (last ? (i / last) * W : W / 2);
  const pct = (i: number) => (xOf(i) / W) * 100;

  const indexAt = (clientX: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return last;
    return Math.round(Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * last);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    setCursor(indexAt(e.clientX));
  };
  // Mouse reads on hover; touch only while pressed.
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (pressed.current || e.pointerType === "mouse") setCursor(indexAt(e.clientX));
  };
  const release = () => {
    pressed.current = false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowLeft: at - 1, ArrowDown: at - 1, ArrowRight: at + 1, ArrowUp: at + 1, Home: 0, End: last };
    if (e.key === "Escape") {
      setCursor(null);
      return;
    }
    if (!(e.key in keys)) return;
    e.preventDefault();
    setCursor(Math.min(Math.max(keys[e.key], 0), last));
  };

  return (
    <figure className="raised rounded-xl p-4">
      <figcaption className="font-semibold">{label}</figcaption>
      <p className="mt-2 break-words font-semibold text-3xl tracking-tight">
        <span className="sr-only">
          {point.amount} {unit}
        </span>
        <RollingNumber value={point.amount} /> <span className="font-normal text-base">{unit}</span>
      </p>
      <div className="mt-1 flex min-h-6 flex-wrap items-center gap-x-2 text-sm tabular-nums">
        <span className="font-semibold">{point.year}</span>
        {delta !== null && (
          <span className="text-muted-foreground">
            {delta >= 0 ? "▲" : "▼"} {percent.format(Math.abs(delta * 100))}% t.o.v. {prev.year}
          </span>
        )}
        {point.source}
      </div>

      <div
        aria-label={`${label} per jaar. Pijltjestoetsen lezen elk jaar.`}
        aria-valuemax={points[last].year}
        aria-valuemin={points[0].year}
        aria-valuenow={point.year}
        aria-valuetext={`${point.year}: ${point.amount} ${unit}`}
        className="relative mt-5 h-32 cursor-crosshair touch-pan-y rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
        data-no-swipe=""
        onKeyDown={onKeyDown}
        onLostPointerCapture={release}
        onPointerCancel={release}
        onPointerDown={onPointerDown}
        onPointerLeave={() => !pressed.current && setCursor(null)}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        ref={chartRef}
        role="slider"
        tabIndex={0}
      >
        <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <clipPath id={clipId}>
              <rect height={H + 20} width={xOf(at)} x={0} y={-10} />
            </clipPath>
          </defs>
          <line className="stroke-border" vectorEffect="non-scaling-stroke" x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} />
          {/* The area and the solid line run up to the year being read. */}
          <path className="fill-foreground/[0.05]" clipPath={`url(#${clipId})`} d={`${line}L${W} ${H}L0 ${H}Z`} />
          <path className="fill-none stroke-foreground/25" d={line} strokeLinecap="round" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <path className="fill-none stroke-foreground" clipPath={`url(#${clipId})`} d={line} strokeLinecap="round" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-card transition-[width,height] duration-150",
              i === at ? "size-2.5 bg-foreground ring-4" : "size-1.5 ring-2",
              i !== at && (p.value < 0 ? "bg-destructive" : "bg-foreground/50")
            )}
            key={p.year}
            style={{ left: `${pct(i)}%`, top: `${(yOf(norm(p.value)) / H) * 100}%` }}
          />
        ))}
      </div>
      <div aria-hidden className="mt-2 flex justify-between text-muted-foreground text-xs tabular-nums">
        {points.map((p, i) => (
          <span className={cn(i === at && "font-semibold text-foreground")} key={p.year}>
            {p.year}
          </span>
        ))}
      </div>
    </figure>
  );
}
