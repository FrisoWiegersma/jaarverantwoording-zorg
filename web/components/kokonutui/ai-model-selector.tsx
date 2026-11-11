"use client";

/**
 * @author: @kokonutui
 * @description: AI Model Selector
 * @version: 1.0.0
 * @date: 2026-10-15
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: controlled only, models from lib/models.ts, Dutch labels and the app's theme tokens.
 * The trigger sits in the prompt footer, so the surrounding bar of the original is gone.
 */

import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { type EffortLevel, MODELS, type ModelOption, type ModelSelection } from "@/lib/models";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const effortIndex = (model: ModelOption, effort: string) =>
  Math.max(0, model.efforts.findIndex((level) => level.id === effort));

/**
 * The effort to keep when switching models: the same level if the new model
 * has it, otherwise the one at the same relative height on its track.
 */
function carryEffort(from: ModelOption, to: ModelOption, effort: string) {
  if (to.efforts.some((level) => level.id === effort)) return effort as ModelSelection["effort"];
  const share = from.efforts.length > 1 ? effortIndex(from, effort) / (from.efforts.length - 1) : 0;
  return to.efforts[Math.round(share * (to.efforts.length - 1))]?.id ?? to.defaultEffort;
}

/** Rising bars that fill to the current effort, like a signal meter. */
function EffortGlyph({ count, level }: { count: number; level: number }) {
  return (
    <span aria-hidden="true" className="flex h-3 items-end gap-[2px]">
      {Array.from({ length: count }, (_, i) => (
        <span
          className={cn(
            "w-[3px] rounded-[1px] transition-colors duration-200",
            i <= level ? "bg-foreground/80" : "bg-foreground/20"
          )}
          key={i}
          style={{ height: `${((i + 1) / count) * 100}%` }}
        />
      ))}
    </span>
  );
}

/**
 * A detent track: drag the thumb, click a stop or use the arrow keys. The
 * thumb snaps from stop to stop while dragging, so every position is valid.
 */
function EffortTrack({
  levels,
  value,
  onChange,
  labelId,
}: {
  levels: EffortLevel[];
  value: number;
  onChange: (index: number) => void;
  labelId: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const count = levels.length;

  const indexAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return value;
    return Math.min(count - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * count)));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowLeft: value - 1,
      ArrowDown: value - 1,
      ArrowRight: value + 1,
      ArrowUp: value + 1,
      Home: 0,
      End: count - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      onChange(Math.min(count - 1, Math.max(0, moves[event.key])));
    }
  };

  return (
    <div
      aria-labelledby={labelId}
      aria-valuemax={count - 1}
      aria-valuemin={0}
      aria-valuenow={value}
      aria-valuetext={levels[value]?.label}
      className="h-11 cursor-pointer touch-none select-none rounded-lg bg-muted p-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={onKeyDown}
      onLostPointerCapture={() => setDragging(false)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onChange(indexAt(event.clientX));
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        const next = indexAt(event.clientX);
        if (next !== value) onChange(next);
      }}
      onPointerUp={() => setDragging(false)}
      role="slider"
      tabIndex={0}
    >
      <div className="relative flex h-full" ref={trackRef}>
        {/* The thumb glides between stops, and resizes when a model has more or fewer levels. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 rounded-md bg-card shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-border transition-[translate,width] duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            dragging && "duration-150"
          )}
          // Moved with translate, which skips layout, rather than left.
          style={{ translate: `${value * 100}% 0`, width: `${100 / count}%` }}
        />
        {levels.map((level, index) => (
          <span
            aria-hidden="true"
            className={cn(
              "relative flex flex-1 items-center justify-center text-sm transition-colors duration-150",
              index === value ? "font-semibold text-foreground" : "text-muted-foreground"
            )}
            key={level.id}
          >
            {level.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AIModelSelector({
  value,
  onChange,
  className,
}: {
  value: ModelSelection;
  onChange: (value: ModelSelection) => void;
  className?: string;
}) {
  const model = MODELS.find((item) => item.id === value.model) ?? MODELS[0];
  const level = effortIndex(model, value.effort);
  const effort = model.efforts[level];

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelId = useId();
  const effortLabelId = useId();

  const pickModel = (next: ModelOption) => onChange({ model: next.id, effort: carryEffort(model, next, value.effort) });

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only pull focus back when it was in the panel; Escape pressed elsewhere just closes it.
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

  // Up and Down move through the models, like a radio group.
  const onOptionKey = (event: React.KeyboardEvent, index: number) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + MODELS.length) % MODELS.length;
    optionRefs.current[next]?.focus();
    pickModel(MODELS[next]);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("relative", className)} ref={rootRef}>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={`Model: ${model.name}, nadenken ${effort?.label.toLowerCase()}. Wijzigen`}
          className={cn(
            "flex h-11 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            open && "bg-muted text-foreground"
          )}
          onClick={() => setOpen((current) => !current)}
          ref={triggerRef}
          type="button"
        >
          <span className="font-medium text-foreground">{model.name}</span>
          <span className="flex items-center gap-1.5">
            <EffortGlyph count={model.efforts.length} level={level} />
            <span className="hidden sm:inline">{effort?.label}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]", open && "rotate-180")}
          />
        </button>
        {/* After the trigger in the DOM, so Tab moves from it into the panel, which still opens above. */}
        <AnimatePresence>
          {open && (
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="raised absolute bottom-full left-0 z-20 mb-2 w-[min(20rem,calc(100vw-2.5rem))] origin-bottom-left rounded-xl p-1"
              exit={{ opacity: 0, scale: 0.97, y: 4 }}
              id={panelId}
              initial={{ opacity: 0, scale: 0.97, y: 4 }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
            >
              <div aria-label="Model" role="radiogroup">
                {MODELS.map((option, index) => {
                  const selected = option.id === model.id;
                  return (
                    <button
                      aria-checked={selected}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-hidden transition-colors duration-150 hover:bg-muted focus-visible:bg-muted"
                      key={option.id}
                      onClick={() => pickModel(option)}
                      onKeyDown={(event) => onOptionKey(event, index)}
                      ref={(node) => {
                        optionRefs.current[index] = node;
                      }}
                      role="radio"
                      tabIndex={selected ? 0 : -1}
                      type="button"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{option.name}</span>
                        <span className="block truncate text-sm text-muted-foreground">{option.description}</span>
                      </span>
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {selected && <Check aria-hidden="true" className="size-4" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mx-1.5 my-1 border-t" />

              <div className="px-1.5 pt-1.5 pb-2">
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="font-medium text-sm" id={effortLabelId}>Nadenken</p>
                  <p className="text-xs text-muted-foreground [@media(hover:none)]:hidden">← → om te schuiven</p>
                </div>
                <EffortTrack
                  labelId={effortLabelId}
                  levels={model.efforts}
                  onChange={(index) => onChange({ model: model.id, effort: model.efforts[index].id })}
                  value={level}
                />
                {/* Fixed height so the panel doesn't jump as hints change. */}
                <div className="relative mt-2 h-10">
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.p
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      className="absolute inset-x-0 top-0 text-sm text-muted-foreground leading-5"
                      exit={{ opacity: 0, filter: "blur(2px)" }}
                      initial={{ opacity: 0, filter: "blur(2px)" }}
                      key={`${model.id}-${effort?.id}`}
                      transition={{ duration: 0.15, ease: EASE_OUT }}
                    >
                      {effort?.hint}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
