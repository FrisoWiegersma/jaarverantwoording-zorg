"use client";

/**
 * Who is signed in, and signing out. The look follows Watermelon UI's dropdown-menu-8 (a labelled account menu whose
 * Logout icon slides right on hover); the menu itself is the native popover attribute, which already closes on Escape
 * and outside clicks and returns focus, so no dropdown library.
 */

import { LogOut } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type Me = { mode: "builtin" | "cloudflare"; email: string };

const ITEM = "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-medium text-destructive text-sm transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-hidden";

export function AccountMenu({ className }: { className?: string }) {
  const id = useId();
  const [me, setMe] = useState<Me | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then(setMe, () => {});
  }, []);

  // Nobody to show: local development without a login in front.
  if (!me?.email) return null;

  const signOut = async () => {
    setLeaving(true);
    await authClient.signOut().catch(() => {});
    // A full load, not the router: nothing of the signed-in session stays in memory, and Back does not return to it.
    window.location.replace("/login");
  };

  const icon = <LogOut aria-hidden="true" className="size-4 transition-transform duration-200 group-hover:translate-x-1 group-focus-visible:translate-x-1" />;

  return (
    <>
      <button
        aria-label={`Account: ${me.email}`}
        className={cn("raised flex size-11 shrink-0 items-center justify-center rounded-full font-semibold uppercase", className)}
        popoverTarget={id}
        type="button"
      >
        {me.email[0]}
      </button>
      <div
        className="fixed inset-auto top-16 right-5 m-0 w-72 rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-border transition-[opacity,translate,display,overlay] transition-discrete duration-150 starting:open:-translate-y-1 starting:open:opacity-0 not-open:-translate-y-1 not-open:opacity-0 sm:right-8"
        id={id}
        popover="auto"
      >
        <div className="px-3 pt-2 pb-2.5">
          <p className="text-muted-foreground text-xs">{me.mode === "cloudflare" ? "Ingelogd via Cloudflare Access" : "Ingelogd als"}</p>
          <p className="truncate font-semibold text-sm">{me.email}</p>
        </div>
        <div className="h-px bg-border" />
        <div className="pt-1.5">
          {me.mode === "cloudflare" ? (
            <a className={ITEM} href="/cdn-cgi/access/logout">
              {icon}
              Uitloggen
            </a>
          ) : (
            <button className={ITEM} disabled={leaving} onClick={signOut} type="button">
              {icon}
              {leaving ? "Uitloggen…" : "Uitloggen"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
