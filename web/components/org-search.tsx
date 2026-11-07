"use client";

/**
 * Find an organisation by name, in a dialog over the page: in the header (⌘K) to open its page, and to add one to a
 * comparison.
 */

import { Building2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import ActionSearchBar, { type CommandItem, isPaletteCombo, Kbd, useIsMac } from "@/components/kokonutui/action-search-bar";
import { cn } from "@/lib/utils";

export type Org = { org_id: string; name: string; town: string | null; years: number[] };
type Status = "hint" | "searching" | "none" | "error" | "done";

const span = (years: number[]) => `${Math.min(...years)}–${Math.max(...years)}`;
const base = (org: Org): CommandItem => ({
  id: org.org_id,
  label: org.name,
  detail: [org.town, span(org.years)].filter(Boolean).join(" · "),
  icon: <Building2 className="size-4" />,
});

function OrgDialog({ label, placeholder, chooseLabel, exclude, item, onSelect, onClose }: {
  label: string;
  placeholder: string;
  chooseLabel: string;
  exclude?: string[];
  item: (org: Org) => CommandItem;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CommandItem[]>([]);
  const [status, setStatus] = useState<Status>("hint");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<AbortController>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      pending.current?.abort();
    },
    []
  );

  const search = useCallback(
    (q: string) => {
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
          const orgs: Org[] = (await r.json()).filter((o: Org) => o.years.length > 0 && !exclude?.includes(o.org_id));
          setItems(orgs.map(item));
          setStatus(orgs.length ? "done" : "none");
        } catch {
          if (ctl.signal.aborted) return;
          setItems([]);
          setStatus("error");
        }
      }, 150);
    },
    [exclude, item]
  );

  const empty = {
    hint: "Typ minstens twee letters van de naam.",
    searching: "Zoeken…",
    none: `Geen organisatie gevonden voor “${query}”.`,
    error: "Zoeken lukte niet. Probeer het nog eens.",
    done: "",
  }[status];

  return (
    <div aria-label={label} aria-modal="true" className="fixed inset-0 z-50" role="dialog">
      {/* A tap beside the search closes it; phones do not always blur the input for that. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/30 transition-opacity duration-150 starting:opacity-0 dark:bg-black/50" onPointerDown={onClose} />
      <div className="relative mx-auto w-full max-w-xl px-4 pt-3 sm:pt-[14vh]">
        <ActionSearchBar
          autoFocus
          chooseLabel={chooseLabel}
          className="max-w-none"
          empty={empty}
          items={items}
          label={label}
          onClose={onClose}
          onQueryChange={search}
          onSelect={({ value }) => value && onSelect(value)}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

/** Opens a dialog from a button, and puts focus back on the button when it closes without going anywhere. */
function useDialog() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) trigger.current?.focus({ preventScroll: true });
    });
  }, []);
  return { open, setOpen, trigger, close };
}

const toPage = (org: Org): CommandItem => ({ ...base(org), value: `/organisatie/${encodeURIComponent(org.org_id)}` });

export function OrgSearch() {
  const router = useRouter();
  const isMac = useIsMac();
  const { open, setOpen, trigger, close } = useDialog();

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
  }, [open, setOpen]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="raised inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-full transition-[filter] hover:brightness-[1.04] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring @3xl:w-auto @3xl:pr-2.5 @3xl:pl-4"
        onClick={() => setOpen(true)}
        ref={trigger}
        type="button"
      >
        <Search aria-hidden="true" className="size-[18px] shrink-0" />
        <span className="sr-only @3xl:not-sr-only @3xl:whitespace-nowrap">Zoek organisatie</span>
        <span aria-hidden="true" className="ml-1 hidden gap-0.5 @3xl:flex">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      {open && (
        <OrgDialog
          chooseLabel="Openen"
          item={toPage}
          label="Zoek een zorgorganisatie"
          onClose={close}
          onSelect={(path) => router.push(path)}
          placeholder="Naam van de organisatie…"
        />
      )}
    </>
  );
}

/** The comparison page for these organisations, in this order. */
export const comparePath = (ids: string[]) => `/vergelijk/${ids.map(encodeURIComponent).join("/")}`;

/** A button that asks for one more organisation and opens the comparison with it: "Vergelijk met…", "Toevoegen". */
export function CompareWith({ ids, label, children, className }: { ids: string[]; label: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  const { open, setOpen, trigger, close } = useDialog();
  const item = useCallback((other: Org): CommandItem => ({ ...base(other), value: comparePath([...ids, other.org_id]) }), [ids]);
  return (
    <>
      <button
        aria-haspopup="dialog"
        className={cn(
          "raised inline-flex min-h-11 items-center gap-2 rounded-full px-4 transition-[filter] hover:brightness-[1.04] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
        onClick={() => setOpen(true)}
        ref={trigger}
        type="button"
      >
        {children}
      </button>
      {open && (
        <OrgDialog
          chooseLabel="Vergelijken"
          exclude={ids}
          item={item}
          label={label}
          onClose={close}
          onSelect={(path) => router.push(path)}
          placeholder="Naam van de organisatie…"
        />
      )}
    </>
  );
}
