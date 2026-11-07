"use client";

/**
 * Organisations side by side over the years: one line each on one shared scale, and under it the same figures as a
 * table, a column per organisation. Hover, drag or arrow keys read a year; its row in the table lights up, with the
 * amounts as filed and their sources. Drawn after Kokonut Metric Card, without its single-series extras.
 */

import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { parseNumber } from "@/lib/excel";
import type { Figure } from "@/lib/rich-answer";
import { cn } from "@/lib/utils";

const W = 400;
const H = 160;
const compact = new Intl.NumberFormat("nl-NL", { notation: "compact", maximumFractionDigits: 1 });

/** Round gridlines around the data: a 1, 2, 2.5 or 5 step, about three of them. */
function scale(values: number[]) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const raw = (hi - lo) / 3 || Math.abs(hi) / 3 || 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const min = Math.floor(lo / step) * step;
  const max = Math.max(Math.ceil(hi / step) * step, min + step);
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(t);
  return { min, max, ticks };
}

export interface Series {
  organization: string;
  points: Figure[];
}

export default function CompareChart({ title, unit, years, series, source }: {
  title: string;
  unit: string;
  years: number[];
  series: Series[];
  source: (f: Figure) => ReactNode;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const pressed = useRef(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const value = (f: Figure) => parseNumber(f.amount)!.num;
  const { min, max, ticks } = scale(series.flatMap((s) => s.points.map(value)));
  const last = years.length - 1;
  const xPct = (i: number) => (last ? (i / last) * 100 : 50);
  const yPct = (v: number) => (1 - (v - min) / (max - min)) * 100;
  const color = (i: number) => `var(--series-${i + 1})`;
  // A year an organisation skipped breaks its line rather than bridging it.
  const path = (s: Series) =>
    s.points
      .map((f, j) => {
        const i = years.indexOf(f.year);
        const gap = j === 0 || i - years.indexOf(s.points[j - 1].year) > 1;
        return `${gap ? "M" : "L"}${((xPct(i) / 100) * W).toFixed(2)} ${((yPct(value(f)) / 100) * H).toFixed(2)}`;
      })
      .join("");

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
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (pressed.current || e.pointerType === "mouse") setCursor(indexAt(e.clientX));
  };
  const release = () => {
    pressed.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = cursor ?? last;
    const keys: Record<string, number> = { ArrowLeft: at - 1, ArrowDown: at - 1, ArrowRight: at + 1, ArrowUp: at + 1, Home: 0, End: last };
    if (e.key === "Escape") return setCursor(null);
    if (!(e.key in keys)) return;
    e.preventDefault();
    setCursor(Math.min(Math.max(keys[e.key], 0), last));
  };

  const read = cursor ?? last;
  const at = (s: Series, year: number) => s.points.find((f) => f.year === year);
  const readout = series.map((s) => `${s.organization} ${at(s, years[read])?.amount ?? "geen cijfer"}`).join(", ");

  return (
    <figure className="raised rounded-xl p-4">
      <figcaption className="font-semibold">{title}</figcaption>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Organisaties">
        {series.map((s, i) => (
          <li className="flex items-center gap-2" key={s.organization}>
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ background: color(i) }} />
            {s.organization}
          </li>
        ))}
      </ul>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-3">
        {/* Gridline labels: the shared scale, in the unit of the caption. */}
        <div aria-hidden="true" className="relative w-12 text-right text-muted-foreground text-xs tabular-nums">
          {ticks.map((t) => (
            <span className="absolute right-0 -translate-y-1/2" key={t} style={{ top: `${yPct(t)}%` }}>
              {compact.format(t)}
            </span>
          ))}
        </div>
        <div
          aria-label={`${title} per jaar. Pijltjestoetsen lezen elk jaar.`}
          aria-valuemax={years[last]}
          aria-valuemin={years[0]}
          aria-valuenow={years[read]}
          aria-valuetext={`${years[read]}: ${readout} ${unit}`}
          className="relative mx-1.5 h-40 cursor-crosshair touch-pan-y rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
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
            {ticks.map((t) => (
              <line className="stroke-border" key={t} vectorEffect="non-scaling-stroke" x1={0} x2={W} y1={(yPct(t) / 100) * H} y2={(yPct(t) / 100) * H} />
            ))}
            {cursor !== null && (
              <line className="stroke-foreground/30" vectorEffect="non-scaling-stroke" x1={(xPct(cursor) / 100) * W} x2={(xPct(cursor) / 100) * W} y1={0} y2={H} />
            )}
            {series.map((s, i) => (
              <path d={path(s)} fill="none" key={s.organization} stroke={color(i)} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {series.flatMap((s, i) =>
            s.points.map((f) => {
              const x = years.indexOf(f.year);
              return (
                <div
                  aria-hidden="true"
                  className={cn("pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-[width,height] duration-150", x === cursor ? "size-3" : "size-2")}
                  key={`${s.organization}-${f.year}`}
                  style={{ left: `${xPct(x)}%`, top: `${yPct(value(f))}%`, background: color(i) }}
                />
              );
            })
          )}
        </div>
        <div aria-hidden="true" />
        <div aria-hidden="true" className="mx-1.5 mt-2 flex justify-between text-muted-foreground text-xs tabular-nums">
          {years.map((y, i) => (
            <span className={cn(i === cursor && "font-semibold text-foreground")} key={y}>
              {y}
            </span>
          ))}
        </div>
      </div>

      {/* The same figures side by side: what the lines show, exactly as filed, with their sources. */}
      <div className="mt-4 overflow-x-auto" data-no-swipe="">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 pr-3 font-normal">Jaar</th>
              {series.map((s, i) => (
                <th className="py-1.5 pl-3 text-right font-normal" key={s.organization} scope="col">
                  <span aria-hidden="true" className="mr-1.5 inline-block h-0.5 w-3 rounded-full align-middle" style={{ background: color(i) }} />
                  {s.organization}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y, i) => (
              <tr className={cn("border-b last:border-b-0 transition-colors", i === cursor && "bg-muted/70")} key={y} onPointerEnter={() => setCursor(i)} onPointerLeave={() => setCursor(null)}>
                <th className="py-1.5 pr-3 text-left font-semibold" scope="row">{y}</th>
                {series.map((s) => {
                  const f = at(s, y);
                  return (
                    <td className="whitespace-nowrap py-1.5 pl-3 text-right" key={s.organization}>
                      {f ? <>{f.amount} {source(f)}</> : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
