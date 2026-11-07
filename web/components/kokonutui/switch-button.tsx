"use client";

/**
 * @author: @dorianbaffier
 * @description: Switch Button
 * @version: 2.0.0
 * @date: 2026-10-16
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: icon only, one size, styled as the app's raised controls. It toggles `.dark` on <html>
 * and saves the choice for the script in layout.tsx. The new theme spreads from the button as a circle (View
 * Transitions API); without that API, or with reduced motion, it switches instantly.
 */

import { useId, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
const EASE_REVEAL = "cubic-bezier(0.4, 0, 0.2, 1)";
const REVEAL_ATTR = "data-theme-reveal";
const REVEAL_STYLE_ID = "kokonut-theme-reveal";
const REVEAL_CSS = `html[${REVEAL_ATTR}]::view-transition-old(root),html[${REVEAL_ATTR}]::view-transition-new(root){animation:none;mix-blend-mode:normal}`;

const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const RAYS = RAY_ANGLES.map((deg) => {
  const rad = (deg * Math.PI) / 180;
  const at = (r: number) => ({
    x: Number((12 + r * Math.cos(rad)).toFixed(2)),
    y: Number((12 + r * Math.sin(rad)).toFixed(2)),
  });
  return { deg, from: at(7.5), to: at(10) };
});

// Each part's light look is its base class and its dark look a `dark:` class, so the server render (theme
// unknown) matches the client. Clicking animates from the old computed values to the new ones with WAAPI.
const ANIMATED_PROPS = ["opacity", "scale", "translate", "filter"] as const;

type Snapshot = Map<Element, Keyframe>;

function snapshot(elements: Element[]): Snapshot {
  const map: Snapshot = new Map();
  for (const el of elements) {
    const style = getComputedStyle(el);
    const frame: Keyframe = { offset: 0 };
    for (const prop of ANIMATED_PROPS) {
      frame[prop] = style.getPropertyValue(prop);
    }
    map.set(el, frame);
    for (const animation of el.getAnimations()) {
      animation.cancel();
    }
  }
  return map;
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ensureRevealStyle() {
  if (document.getElementById(REVEAL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = REVEAL_STYLE_ID;
  style.textContent = REVEAL_CSS;
  document.head.appendChild(style);
}

function timing(el: Element, toDark: boolean): KeyframeAnimationOptions {
  const { part, index = "0" } = (el as HTMLElement | SVGElement).dataset;
  const i = Number(index);
  switch (part) {
    case "ray":
      // Rays retract one after another; on the way back they wait for the bite to clear first.
      return { delay: toDark ? i * 18 : 140 + i * 22, duration: 260, easing: EASE_OUT };
    case "bite":
      return { delay: toDark ? 60 : 0, duration: 380, easing: EASE_IN_OUT };
    case "disc":
      return { delay: toDark ? 40 : 0, duration: 380, easing: EASE_OUT };
    default:
      return { duration: 240, easing: EASE_OUT };
  }
}

function morph(from: Snapshot, toDark: boolean) {
  if (prefersReducedMotion()) return;
  for (const [el, frame] of from) {
    el.animate([frame, {}], { ...timing(el, toDark), fill: "backwards" });
  }
}

let revealRunning = false;

function revealFrom(button: HTMLElement, apply: () => void) {
  const doc = document as Document & { activeViewTransition?: unknown };
  if (typeof doc.startViewTransition !== "function" || prefersReducedMotion() || revealRunning || doc.activeViewTransition) {
    apply();
    return;
  }

  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const root = document.documentElement;

  ensureRevealStyle();
  root.setAttribute(REVEAL_ATTR, "");
  revealRunning = true;

  let transition: ViewTransition;
  try {
    transition = doc.startViewTransition(() => flushSync(apply));
  } catch {
    root.removeAttribute(REVEAL_ATTR);
    revealRunning = false;
    apply();
    return;
  }

  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 500, easing: EASE_REVEAL, pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {
      // Skipped or aborted (e.g. a page navigation started a transition).
    });

  transition.finished
    .catch(() => {
      // The theme is already applied by the time a transition can fail.
    })
    .finally(() => {
      root.removeAttribute(REVEAL_ATTR);
      revealRunning = false;
    });
}

// The applied theme, for aria-pressed. Null on the server, so the first client render matches it.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

export default function SwitchButton({ className }: { className?: string }) {
  const maskId = `${useId()}-moon`;
  const iconRef = useRef<SVGSVGElement>(null);
  const dark = useSyncExternalStore(subscribe, isDark, () => null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const next = root.classList.contains("dark") ? "light" : "dark";
    const apply = () => {
      const before = snapshot([...(iconRef.current?.querySelectorAll("[data-part]") ?? [])]);
      root.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("theme", next);
      } catch {
        // Private mode: the choice holds until reload.
      }
      morph(before, next === "dark");
    };
    revealFrom(e.currentTarget, apply);
  };

  return (
    <button
      aria-label="Donker thema"
      aria-pressed={dark ?? undefined}
      className={cn(
        "raised relative inline-flex size-11 shrink-0 items-center justify-center rounded-full",
        "transition-[filter] hover:brightness-[1.04] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      onClick={handleClick}
      type="button"
    >
      <svg aria-hidden="true" className="pointer-events-none shrink-0 overflow-visible" fill="none" height={18} ref={iconRef} viewBox="0 0 24 24" width={18}>
        <mask id={maskId}>
          <rect fill="white" height="32" width="32" x="-4" y="-4" />
          <circle
            className="translate-x-[10px] -translate-y-[10px] dark:translate-x-0 dark:translate-y-0"
            cx="17"
            cy="7"
            data-part="bite"
            fill="black"
            r="7.5"
          />
        </mask>
        <g mask={`url(#${maskId})`}>
          <circle className="origin-[12px_12px] [transform-box:view-box] dark:scale-[1.8]" cx="12" cy="12" data-part="disc" fill="currentColor" r="4.75" />
        </g>
        <g stroke="currentColor" strokeLinecap="round" strokeWidth="2">
          {RAYS.map((ray, index) => (
            <line
              className="origin-[12px_12px] [transform-box:view-box] dark:scale-50 dark:opacity-0"
              data-index={index}
              data-part="ray"
              key={ray.deg}
              x1={ray.from.x}
              x2={ray.to.x}
              y1={ray.from.y}
              y2={ray.to.y}
            />
          ))}
        </g>
      </svg>
    </button>
  );
}
