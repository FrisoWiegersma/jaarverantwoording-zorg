"use client";

/** Find an organisation by name and open its page: a button in the header, ⌘K anywhere, the search in a dialog. */

import { Building2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ActionSearchBar, { type CommandItem, isPaletteCombo, Kbd, useIsMac } from "@/components/kokonutui/action-search-bar";

export type Org = { org_id: string; name: string; town: string | null; years: number[] };
type Status = "hint" | "searching" | "none" | "error" | "done";

const toItem = (org: Org): CommandItem => ({
  id: org.org_id,
  label: org.name,
  detail: [org.town, `${Math.min(...org.years)}–${Math.max(...org.years)}`].filter(Boolean).join(" · "),
  icon: <Building2 className="size-4" />,
  value: `/organisatie/${encodeURIComponent(org.org_id)}`,
});

export function OrgSearch() {
  const router = useRouter();
  const isMac = useIsMac();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CommandItem[]>([]);
  const [status, setStatus] = useState<Status>("hint");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<AbortController>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      pending.current?.abort();
    },
    []
  );

  const search = useCallback((q: string) => {
    clearTimeout(timer.current);
    pending.current?.abort();
    const term = q.trim();
    setQuery(term);
    if (term.length < 2) {
      setItems([]);
      setStatus("hint");
      return;
    }
    setStatus("searching");
    timer.current = setTimeout(async () => {
      const ctl = new AbortController();
      pending.current = ctl;
      try {
        const r = await fetch(`/digimv/search?q=${encodeURIComponent(term)}&limit=8`, { signal: ctl.signal });
        if (!r.ok) throw new Error(String(r.status));
        const orgs: Org[] = (await r.json()).filter((o: Org) => o.years.length > 0);
        setItems(orgs.map(toItem));
        setStatus(orgs.length ? "done" : "none");
      } catch {
        if (ctl.signal.aborted) return;
        setItems([]);
        setStatus("error");
      }
    }, 150);
  }, []);

  const close = useCallback(() => {
    search("");
    setOpen(false);
    // Escape or a tap beside it leaves focus nowhere: back to the button.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) trigger.current?.focus({ preventScroll: true });
    });
  }, [search]);

  // ⌘K / Ctrl K anywhere opens it; while open, the palette's own ⌘K closes it.
  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteCombo(e) || e.defaultPrevented || document.activeElement?.closest('[aria-modal="true"]')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const empty = {
    hint: "Typ minstens twee letters van de naam.",
    searching: "Zoeken…",
    none: `Geen organisatie gevonden voor “${query}”.`,
    error: "Zoeken lukte niet. Probeer het nog eens.",
    done: "",
  }[status];

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="raised inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-full transition-[filter] hover:brightness-[1.04] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring lg:w-auto lg:pr-2.5 lg:pl-4"
        onClick={() => setOpen(true)}
        ref={trigger}
        type="button"
      >
        <Search aria-hidden="true" className="size-[18px] shrink-0" />
        <span className="sr-only lg:not-sr-only lg:whitespace-nowrap">Zoek organisatie</span>
        <span aria-hidden="true" className="ml-1 hidden gap-0.5 lg:flex">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      {open && (
        <div aria-label="Zoek een zorgorganisatie" aria-modal="true" className="fixed inset-0 z-50" role="dialog">
          {/* A tap beside the search closes it; phones do not always blur the input for that. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/30 transition-opacity duration-150 starting:opacity-0 dark:bg-black/50"
            onPointerDown={close}
          />
          <div className="relative mx-auto w-full max-w-xl px-4 pt-3 sm:pt-[14vh]">
            <ActionSearchBar
              autoFocus
              className="max-w-none"
              empty={empty}
              items={items}
              label="Zoek een zorgorganisatie"
              onClose={close}
              onQueryChange={search}
              onSelect={({ value }) => value && router.push(value)}
              placeholder="Naam van de organisatie…"
            />
          </div>
        </div>
      )}
    </>
  );
}
