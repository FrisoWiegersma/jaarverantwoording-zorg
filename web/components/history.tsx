"use client";

/** Earlier conversations, saved by the server after every answer (per Cloudflare login), in a drawer from the left. */

import type { UIMessage } from "ai";
import { History as HistoryIcon, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

type Saved = { id: string; title: string; updated: string };

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => x.toDateString();
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  if (day(d) === day(now)) return `vandaag ${time}`;
  if (day(d) === day(new Date(now.getTime() - 864e5))) return `gisteren ${time}`;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function History({ current, onOpen }: { current?: string; onOpen: (messages: UIMessage[]) => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Saved[] | "error" | null>(null);
  // A delete asks once more, on the same spot: one tap arms it, the second deletes.
  const [armed, setArmed] = useState<string | null>(null);

  const load = () =>
    fetch("/digimv/chats")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setList, () => setList("error"));
  const show = () => {
    setList(null);
    setArmed(null);
    setOpen(true);
    load();
  };
  const pick = async (id: string) => {
    const r = await fetch(`/digimv/chats/${encodeURIComponent(id)}`).catch(() => null);
    if (!r?.ok) return setList("error");
    onOpen((await r.json()).messages);
    setOpen(false);
  };
  const remove = async (id: string) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    if (Array.isArray(list)) setList(list.filter((c) => c.id !== id));
    await fetch(`/digimv/chats/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  return (
    <>
      <button
        aria-label="Eerdere gesprekken"
        className="raised inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-[filter] hover:brightness-[1.04] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={show}
        type="button"
      >
        <HistoryIcon aria-hidden="true" className="size-[18px]" />
      </button>
      <Drawer direction="left" onOpenChange={setOpen} open={open}>
        <DrawerContent className="max-w-[88vw] bg-background sm:w-[24rem]">
          <div className="flex h-16 shrink-0 items-center justify-between pr-2 pl-5">
            <DrawerTitle className="font-semibold text-base">Eerdere gesprekken</DrawerTitle>
            <button
              aria-label="Sluit"
              className="flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <DrawerDescription className="sr-only">Elk antwoord wordt bewaard. Open een gesprek om verder te vragen.</DrawerDescription>
          <div className="flex-1 overflow-y-auto px-3 pb-6">
            {list === null ? (
              <div className="space-y-2 px-2">
                {[0, 1, 2].map((i) => (
                  <div className="h-14 animate-pulse rounded-xl bg-muted" key={i} />
                ))}
              </div>
            ) : list === "error" ? (
              <p className="px-2 text-[0.95rem]" role="alert">
                De gesprekken konden niet worden geladen. Probeer het later nog eens.
              </p>
            ) : list.length === 0 ? (
              <p className="px-2 text-[0.95rem] text-muted-foreground">Nog geen gesprekken. Elk antwoord wordt hier bewaard.</p>
            ) : (
              <ul className="space-y-1">
                {list.map((c) => (
                  <li className={cn("group flex items-center rounded-xl", c.id === current ? "bg-card ring-1 ring-border" : "hover:bg-muted/70")} key={c.id}>
                    <button
                      aria-current={c.id === current || undefined}
                      className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => pick(c.id)}
                      type="button"
                    >
                      <span className="line-clamp-2 text-[0.95rem] leading-snug">{c.title || "Gesprek zonder titel"}</span>
                      <span className="mt-0.5 block text-[0.82rem] text-muted-foreground">{when(c.updated)}</span>
                    </button>
                    <button
                      aria-label={armed === c.id ? `Verwijder definitief: ${c.title}` : `Verwijder: ${c.title}`}
                      className={cn(
                        "mr-1 inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-full px-3 text-[0.85rem] transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                        armed === c.id ? "bg-destructive font-semibold text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      onBlur={() => setArmed((a) => (a === c.id ? null : a))}
                      onClick={() => remove(c.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      {armed === c.id && "Verwijder"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
