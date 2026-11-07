"use client";

/** ⌘K: find an organisation by name, then pick a question about its latest years to put in the question box. */

import { Building2, MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ActionSearchBar, { type CommandItem } from "@/components/kokonutui/action-search-bar";

type Org = { org_id: string; name: string; town: string | null; years: number[] };
type Status = "hint" | "searching" | "none" | "error" | "done";

/** Questions the agent answers well, over the latest years filed; ranges stay short so answers stay quick. */
function templates({ org_id, name, years }: Org): CommandItem[] {
  const last = Math.max(...years);
  const first = Math.max(Math.min(...years), last - 3);
  const icon = <MessageSquareText className="size-4" />;
  return [
    { id: `${org_id}-omzet`, label: `Omzet ${first}–${last} in een grafiek`, value: `Toon de omzet van ${name} van ${first} tot en met ${last} in een grafiek.` },
    { id: `${org_id}-vermogen`, label: `Eigen vermogen eind ${last}`, value: `Wat was het eigen vermogen van ${name} eind ${last}?` },
    {
      id: `${org_id}-resultaat`,
      label: `Resultaat ${last} vergeleken met ${last - 1}`,
      value: `Hoe groot was het resultaat van ${name} in ${last}, vergeleken met het jaar ervoor?`,
    },
    { id: `${org_id}-personeel`, label: `Personeel ${last}`, value: `Hoeveel personeel had ${name} in ${last}, in fte en in personen?` },
  ].map((t) => ({ ...t, icon }));
}

const toItem = (org: Org): CommandItem => ({
  id: org.org_id,
  label: org.name,
  detail: [org.town, `${Math.min(...org.years)}–${Math.max(...org.years)}`].filter(Boolean).join(" · "),
  icon: <Building2 className="size-4" />,
  placeholder: "Kies een vraag",
  children: templates(org),
});

export function OrgSearch({ onPick, className }: { onPick: (question: string) => void; className?: string }) {
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

  const empty = {
    hint: "Typ minstens twee letters van de naam.",
    searching: "Zoeken…",
    none: `Geen organisatie gevonden voor “${query}”.`,
    error: "Zoeken lukte niet. Probeer het nog eens.",
    done: "Geen vraag die daarop lijkt.",
  }[status];

  return (
    <ActionSearchBar
      className={className}
      empty={empty}
      items={items}
      label="Zoek een zorgorganisatie"
      onQueryChange={search}
      onSelect={(item) => item.value && onPick(item.value)}
      placeholder="Zoek een organisatie…"
      shortcut
    />
  );
}
