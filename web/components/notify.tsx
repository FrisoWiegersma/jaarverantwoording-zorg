"use client";

/** "Antwoord klaar": an answer that finishes while you look at another tab says so in this tab's title, and with a
 * desktop notification once the bell is on. */

import { useSyncExternalStore } from "react";
import BellButton from "@/components/kokonutui/bell-button";

const KEY = "notify";
const READY = "✓ Antwoord klaar · ";
const listeners = new Set<() => void>();

const supported = () => typeof window !== "undefined" && "Notification" in window;
function enabled() {
  if (!supported() || Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function NotifyBell({ className }: { className?: string }) {
  const state = useSyncExternalStore(subscribe, () => (supported() ? (enabled() ? "on" : "off") : "none"), () => "none");
  if (state === "none") return null;
  const change = async (on: boolean) => {
    const allowed = on && (await Notification.requestPermission()) === "granted";
    try {
      localStorage.setItem(KEY, allowed ? "1" : "0");
    } catch {
      // private mode: the bell simply stays off
    }
    for (const l of listeners) l();
  };
  return <BellButton className={className} label="Melding als het antwoord klaar is" on={state === "on"} onChange={change} />;
}

export function announceAnswer(question: string) {
  if (!document.hidden) return;
  if (!document.title.startsWith(READY)) {
    const title = document.title;
    document.title = READY + title;
    document.addEventListener("visibilitychange", () => (document.title = title), { once: true });
  }
  if (!enabled()) return;
  try {
    const n = new Notification("Antwoord klaar", { body: question, tag: "antwoord" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // phones notify only through a service worker; the title still says it
  }
}
