"use client";

/**
 * @author: @dorianbaffier
 * @description: Bell Button
 * @version: 1.0.0
 * @date: 2026-10-14
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: the bell alone (no label, no count), controlled, in the app's own surfaces. Turned on, it
 * rings; turned off, it shakes once with the clapper held.
 */

import { type PointerEvent, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// The bell and its clapper are two pendulums on the same pivot. Nothing
// couples them but collisions: the swinging bell catches the clapper with
// its lip, flings it across, and it strikes the other side. Angles in deg,
// time in seconds.
const STEP = 1 / 240;
const BELL_STIFFNESS = 380;
const BELL_DAMPING = 5;
const CLAPPER_STIFFNESS = 150;
const CLAPPER_DAMPING = 4;
// How far the clapper can swing inside the bell before it hits the lip.
const LIP = 13;
const RESTITUTION = 0.45;
// Share of a hit that goes into the bell, which is much heavier.
const RECOIL = 0.18;
// Impacts harder than this ring out (deg/s, relative).
const STRIKE_SPEED = 260;
const RING_KICK = 600;
const NUDGE_KICK = 160;
const MUTE_KICK = 300;
const REST = 0.05;
const PIVOT = { x: 12, y: 2.5 };
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

function haptic(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(ms);
  }
}

export interface BellButtonProps {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  className?: string;
}

export default function BellButton({ on: subscribed, onChange, label, className }: BellButtonProps) {
  const bellRef = useRef<SVGGElement>(null);
  const clapperRef = useRef<SVGPathElement>(null);
  const leftWaveRef = useRef<SVGPathElement>(null);
  const rightWaveRef = useRef<SVGPathElement>(null);

  const sim = useRef({
    bell: 0,
    bellSpeed: 0,
    clapper: 0,
    clapperSpeed: 0,
    // Muffled: the clapper is held against the bell and can't strike.
    muffled: false,
    raf: 0,
    last: 0,
    carry: 0,
    lastNudge: 0,
    reduceMotion: false,
  });

  const draw = useCallback(() => {
    const s = sim.current;
    bellRef.current?.setAttribute(
      "transform",
      `rotate(${s.bell.toFixed(2)} ${PIVOT.x} ${PIVOT.y})`
    );
    clapperRef.current?.setAttribute(
      "transform",
      `rotate(${s.clapper.toFixed(2)} ${PIVOT.x} ${PIVOT.y})`
    );
  }, []);

  // Two short arcs flare out on the side that was struck.
  const flare = useCallback((side: 1 | -1, strength: number) => {
    const wave = side > 0 ? rightWaveRef.current : leftWaveRef.current;
    if (!wave?.animate) {
      return;
    }
    const peak = Math.min(1, 0.45 + strength * 0.55);
    wave.animate(
      [
        { opacity: peak, transform: "translateX(0px)" },
        { opacity: 0, transform: `translateX(${side * 3}px)` },
      ],
      { duration: 420, easing: EASE_OUT }
    );
  }, []);

  // Advances both pendulums one step and resolves a clapper hit.
  const step = useCallback(() => {
    const s = sim.current;
    s.bellSpeed +=
      (-s.bell * BELL_STIFFNESS - s.bellSpeed * BELL_DAMPING) * STEP;
    s.bell += s.bellSpeed * STEP;
    if (s.muffled) {
      s.clapper = s.bell;
      s.clapperSpeed = s.bellSpeed;
      return;
    }
    s.clapperSpeed +=
      (-s.clapper * CLAPPER_STIFFNESS - s.clapperSpeed * CLAPPER_DAMPING) *
      STEP;
    s.clapper += s.clapperSpeed * STEP;
    const relative = s.clapper - s.bell;
    if (Math.abs(relative) <= LIP) {
      return;
    }
    const side = relative > 0 ? 1 : -1;
    const impact = (s.clapperSpeed - s.bellSpeed) * side;
    s.clapper = s.bell + side * LIP;
    if (impact <= 0) {
      return;
    }
    s.clapperSpeed -= side * impact * (1 + RESTITUTION);
    s.bellSpeed += side * impact * RECOIL;
    if (impact > STRIKE_SPEED) {
      // The clapper hits the bell's right wall when it swings right.
      flare(side as 1 | -1, impact / 1600);
      haptic(6);
    }
  }, [flare]);

  // The frame loop calls itself through a ref, so the callback never names itself before it exists.
  const tickRef = useRef<(now: number) => void>(() => {});
  const tick = useCallback(
    (now: number) => {
      const s = sim.current;
      s.raf = 0;
      const elapsed = s.last ? Math.min((now - s.last) / 1000, 0.05) : STEP;
      s.last = now;
      s.carry += elapsed;
      while (s.carry >= STEP) {
        step();
        s.carry -= STEP;
      }
      draw();
      const energy =
        Math.abs(s.bell) +
        Math.abs(s.bellSpeed) * 0.02 +
        Math.abs(s.clapper) +
        Math.abs(s.clapperSpeed) * 0.02;
      if (energy < REST) {
        s.bell = 0;
        s.bellSpeed = 0;
        s.clapper = 0;
        s.clapperSpeed = 0;
        s.last = 0;
        draw();
        return;
      }
      s.raf = requestAnimationFrame((t) => tickRef.current(t));
    },
    [draw, step]
  );
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const kick = useCallback(
    (speed: number) => {
      const s = sim.current;
      if (s.reduceMotion) {
        return;
      }
      s.bellSpeed += speed;
      if (!s.raf) {
        s.raf = requestAnimationFrame(tick);
      }
    },
    [tick]
  );

  useEffect(() => {
    const s = sim.current;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    s.reduceMotion = query.matches;
    const onChange = () => {
      s.reduceMotion = query.matches;
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, []);

  const handleClick = () => {
    const next = !subscribed;
    onChange(next);
    const s = sim.current;
    if (next) {
      s.muffled = false;
      // Swing the bell away from the clapper so the first hit rings.
      kick(s.bellSpeed >= 0 ? RING_KICK : -RING_KICK);
      if (s.reduceMotion) {
        flare(1, 0.6);
        flare(-1, 0.6);
      }
      haptic(10);
    } else {
      // Off: a dull shake, the clapper held still against the bell.
      s.muffled = true;
      kick(-MUTE_KICK);
    }
  };

  const handlePointerEnter = (event: PointerEvent) => {
    // A brush past the bell sets it swaying a little. Mouse only: on touch,
    // enter fires right before the tap.
    const s = sim.current;
    if (event.pointerType !== "mouse" || s.muffled) {
      return;
    }
    if (event.timeStamp - s.lastNudge < 700) {
      return;
    }
    s.lastNudge = event.timeStamp;
    kick(s.bellSpeed >= 0 ? NUDGE_KICK : -NUDGE_KICK);
  };

  // Starting unsubscribed means the bell is muted.
  useEffect(() => {
    sim.current.muffled = !subscribed;
  }, [subscribed]);

  return (
    <button
      aria-label={label}
      aria-pressed={subscribed}
      className={cn(
        "inline-flex size-11 shrink-0 select-none items-center justify-center rounded-full transition-[filter,background-color,color] duration-200 ease-out hover:brightness-[1.04] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        subscribed ? "bg-primary text-primary-foreground" : "raised",
        className
      )}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="size-[18px] overflow-visible"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path className="opacity-0" d="M21.5 4.5c1.2 1.6 1.8 3.4 1.8 5.5" ref={rightWaveRef} />
        <path className="opacity-0" d="M2.5 4.5C1.3 6.1.7 7.9.7 10" ref={leftWaveRef} />
        <path d="M10.27 21a2 2 0 0 0 3.46 0" ref={clapperRef} />
        <g ref={bellRef}>
          <path
            className={cn("transition-[fill] duration-200 ease-out", subscribed ? "fill-current" : "fill-transparent")}
            d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"
          />
          {/* The mute slash, drawn across when off. */}
          <path
            className="transition-[stroke-dashoffset] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
            d="M3 3l18 18"
            strokeDasharray="26"
            strokeDashoffset={subscribed ? 26 : 0}
          />
        </g>
      </svg>
    </button>
  );
}
