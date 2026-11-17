"use client";

/**
 * @author: @kokonutui
 * @description: AI MCP Plugin Selector & Manager
 * @version: 1.1.0
 * @date: 2026-11-15
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Built exclusively on the same Kokonut UI popover & list pattern as AI Model Selector (`ai-model-selector.tsx`).
 */

import { ArrowLeft, AtSign, Check, ChevronDown, ExternalLink, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import CommandButton from "@/components/kokonutui/command-button";
import { type Plugin, type PluginPreset, pluginRequest } from "@/lib/plugins";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";


const TRANSPORTS: { id: Plugin["transport"]; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "streamable_http", label: "HTTP" },
  { id: "sse", label: "SSE" },
];

/** Kokonut UI detent track (same sliding pill mechanics as EffortTrack in ai-model-selector.tsx). */
function TransportTrack({
  value,
  onChange,
  labelId,
}: {
  value: Plugin["transport"];
  onChange: (next: Plugin["transport"]) => void;
  labelId: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const count = TRANSPORTS.length;
  const index = Math.max(0, TRANSPORTS.findIndex((t) => t.id === value));

  const indexAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return index;
    return Math.min(count - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * count)));
  };

  return (
    <div
      aria-labelledby={labelId}
      aria-valuemax={count - 1}
      aria-valuemin={0}
      aria-valuenow={index}
      aria-valuetext={TRANSPORTS[index]?.label}
      className="h-9 cursor-pointer touch-none select-none rounded-lg bg-muted p-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={(event) => {
        const moves: Record<string, number> = {
          ArrowLeft: index - 1,
          ArrowDown: index - 1,
          ArrowRight: index + 1,
          ArrowUp: index + 1,
          Home: 0,
          End: count - 1,
        };
        if (event.key in moves) {
          event.preventDefault();
          const next = TRANSPORTS[Math.min(count - 1, Math.max(0, moves[event.key]))];
          if (next) onChange(next.id);
        }
      }}
      onLostPointerCapture={() => setDragging(false)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        const next = TRANSPORTS[indexAt(event.clientX)];
        if (next) onChange(next.id);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        const next = TRANSPORTS[indexAt(event.clientX)];
        if (next && next.id !== value) onChange(next.id);
      }}
      onPointerUp={() => setDragging(false)}
      role="slider"
      tabIndex={0}
    >
      <div className="relative flex h-full" ref={trackRef}>
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 rounded-md bg-card shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-border transition-[translate,width] duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            dragging && "duration-150"
          )}
          style={{ translate: `${index * 100}% 0`, width: `${100 / count}%` }}
        />
        {TRANSPORTS.map((item, i) => (
          <span
            aria-hidden="true"
            className={cn(
              "relative flex flex-1 items-center justify-center text-xs transition-colors duration-150",
              i === index ? "font-semibold text-foreground" : "text-muted-foreground"
            )}
            key={item.id}
          >
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AIPluginSelector({
  plugins,
  presets,
  selected,
  onToggle,
  onChanged,
  open: controlledOpen,
  onOpenChange,
  defaultTab,
  className,
}: {
  plugins: Plugin[];
  presets: PluginPreset[];
  selected: string[];
  onToggle: (handle: string) => void;
  onChanged: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultTab?: "active" | "add";
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setCustomMode(false);
      setQuery("");
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const transportLabelId = useId();

  useEffect(() => {
    if (open && defaultTab === "add") {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, defaultTab]);

  const [query, setQuery] = useState("");
  const [registryResults, setRegistryResults] = useState<PluginPreset[]>([]);
  const [searchingRegistry, setSearchingRegistry] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("https://");
  const [transport, setTransport] = useState<Plugin["transport"]>("auto");
  const [token, setToken] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");


  useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (q.length < 2) {
        setRegistryResults([]);
        setSearchingRegistry(false);
        return;
      }
      setSearchingRegistry(true);
      pluginRequest(`/registry?q=${encodeURIComponent(q)}`)
        .then((items: PluginPreset[]) => {
          if (!cancelled) setRegistryResults(Array.isArray(items) ? items : []);
        })
        .catch(() => {
          if (!cancelled) setRegistryResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingRegistry(false);
        });
    }, q.length < 2 ? 0 : 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; handle?: string } | null;
      if (data?.type !== "mcp-oauth-complete") return;
      setOauthPending(false);
      setError("");
      setNotice(data.handle ? `${data.handle} verbonden` : "Plugin verbonden");
      onChanged();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onChanged]);

  const openOAuthWindow = (path: string) => {
    const width = 520;
    const height = 680;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    window.open(path, "mcp-oauth", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  };

  const startOAuth = (p: Plugin) => {
    setError("");
    setNotice(`Log in bij ${p.name} in het geopende venster…`);
    setCallbackUrl("");
    setOauthPending(true);
    openOAuthWindow(`/digimv/plugins/${encodeURIComponent(p.id)}/oauth/start`);
  };

  // Canva, Asana and Intercom only redirect to 127.0.0.1, which doesn't load outside a local install; the pasted
  // address carries the code and state to the real callback.
  const finishOAuth = (e: React.FormEvent) => {
    e.preventDefault();
    let params: URLSearchParams | null = null;
    try {
      params = new URL(callbackUrl.trim()).searchParams;
    } catch {}
    if (!params?.get("state") || !(params.get("code") || params.get("error"))) {
      setError("Dit adres bevat geen inlogcode. Kopieer de hele adresregel van het inlogvenster.");
      return;
    }
    setError("");
    openOAuthWindow(`/digimv/plugins/oauth/callback?${params.toString()}`);
  };

  const qLower = query.trim().toLowerCase();

  const filteredInstalled = useMemo(() => {
    if (!qLower) return plugins;
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(qLower) ||
        p.handle.toLowerCase().includes(qLower) ||
        p.description.toLowerCase().includes(qLower)
    );
  }, [plugins, qLower]);

  const availableDirectory = useMemo(() => {
    const installedHandles = new Set(plugins.map((p) => p.handle));
    const byId = new Map<string, PluginPreset>();
    for (const p of presets) {
      if (!installedHandles.has(p.handle)) byId.set(p.id, p);
    }
    for (const r of registryResults) {
      if (!installedHandles.has(r.handle) && !byId.has(r.id)) byId.set(r.id, r);
    }
    const list = Array.from(byId.values());
    if (!qLower) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(qLower) ||
        p.handle.toLowerCase().includes(qLower) ||
        p.description.toLowerCase().includes(qLower)
    );
  }, [plugins, presets, registryResults, qLower]);

  const connectPreset = async (preset: PluginPreset) => {
    if (saving) return;
    setSaving(true);
    setBusyId(preset.id);
    setError("");
    setNotice("");
    try {
      const created: Plugin = await pluginRequest("", "POST", {
        handle: preset.handle,
        name: preset.name,
        description: preset.description,
        url: preset.url,
        transport: preset.transport,
        sync: true,
      });
      onChanged();
      if (!selected.includes(created.handle)) onToggle(created.handle);
      if (created.needs_oauth) {
        startOAuth(created);
        return;
      }
      setNotice(created.sync_error ? `${created.name} toegevoegd` : `${created.name} verbonden`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
      setBusyId(null);
    }
  };

  const addCustomPlugin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();
      const created: Plugin = await pluginRequest("", "POST", {
        handle: cleanHandle,
        name: name.trim() || cleanHandle,
        description: description.trim(),
        url: url.trim(),
        transport,
        token: token.trim() || undefined,
        sync: true,
      });
      setToken("");
      setCustomMode(false);
      onChanged();
      if (!selected.includes(created.handle)) onToggle(created.handle);
      if (created.needs_oauth) {
        startOAuth(created);
        return;
      }
      setNotice(`${created.name} verbonden`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const syncPlugin = async (p: Plugin) => {
    setBusyId(p.id);
    setError("");
    setNotice("");
    try {
      const synced: Plugin = await pluginRequest(`/${p.id}/sync`, "POST");
      onChanged();
      setNotice(`${synced.name} vernieuwd (${synced.tools.length} tools)`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const removePlugin = async (p: Plugin) => {
    if (armedDelete !== p.id) {
      setArmedDelete(p.id);
      return;
    }
    setArmedDelete(null);
    setBusyId(p.id);
    setError("");
    try {
      await pluginRequest(`/${p.id}`, "DELETE");
      if (selected.includes(p.handle)) onToggle(p.handle);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = selected.length;
  const triggerLabel =
    activeCount === 1
      ? selected[0]
      : activeCount > 1
        ? `${activeCount} plugins`
        : "Plugins";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild><button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={`MCP-plugins (${triggerLabel}). Openen`}
          className={cn(
            "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            (open || activeCount > 0) && "bg-muted text-foreground"
          )}
          type="button"
        >
          <AtSign aria-hidden="true" className="size-[18px] text-foreground sm:size-3.5" />
          {/* Phones show only the count of active plugins; the label stays in the aria-label. */}
          <span className="hidden font-medium text-foreground sm:inline">{triggerLabel}</span>
          {activeCount > 0 && <span className="font-medium text-foreground tabular-nums sm:hidden">{activeCount}</span>}
          <ChevronDown
            aria-hidden="true"
            className={cn("hidden size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] sm:block", open && "rotate-180")}
          />
        </button></PopoverTrigger>

        <PopoverContent
          align="start" collisionPadding={12} side="top" sideOffset={8}
          className="raised max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(21rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl p-1"
          id={panelId}
        >
              {!customMode ? (
                <>
                  {/* Simple inline filter bar */}
                  <div className="flex items-center gap-2 border-b px-2.5 py-2">
                    <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      aria-label="Zoek een plugin"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Zoek plugin (Canva, Notion, Linear…)"
                      ref={searchRef}
                      value={query}
                    />
                    {searchingRegistry && <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
                  </div>

                  {/* Single unified scrollable list — exact same layout as AIModelSelector */}
                  <div aria-label="Plugins" className="max-h-72 overflow-y-auto py-1">
                    {filteredInstalled.map((p) => {
                      const isSelected = selected.includes(p.handle);
                      const busy = busyId === p.id;
                      return (
                        <div
                          className="flex min-h-11 items-center gap-1 rounded-lg px-2.5 py-1.5 transition-colors duration-150 hover:bg-muted"
                          key={p.id}
                        >
                          <button
                            aria-checked={isSelected}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-hidden"
                            onClick={() => onToggle(p.handle)}
                            role="checkbox"
                            type="button"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-sm">{p.name}</span>
                              <span className="block truncate text-muted-foreground text-xs">
                                {p.tools.length
                                  ? `${p.tools.length} tools gereed`
                                  : p.has_token
                                    ? "Verbonden"
                                    : "Inloggen vereist"}
                              </span>
                            </span>
                            {isSelected && <Check aria-hidden="true" className="size-4 shrink-0" />}
                          </button>

                          {!p.has_token && (
                            <button
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 font-medium text-primary-foreground text-xs hover:opacity-90"
                              onClick={() => startOAuth(p)}
                              type="button"
                            >
                              <span>Inloggen</span>
                              <ExternalLink aria-hidden="true" className="size-3" />
                            </button>
                          )}

                          {!p.builtin && <button
                            aria-label={`Vernieuw ${p.name}`}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
                            disabled={busy}
                            onClick={() => syncPlugin(p)}
                            title="Tools vernieuwen"
                            type="button"
                          >
                            <RefreshCw aria-hidden="true" className={cn("size-3.5", busy && "animate-spin")} />
                          </button>}

                          {!p.builtin && <button
                            aria-label={armedDelete === p.id ? `Verwijder ${p.name} definitief` : `Verwijder ${p.name}`}
                            className={cn(
                              "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 text-xs transition-colors",
                              armedDelete === p.id
                                ? "bg-destructive font-semibold text-white"
                                : "text-muted-foreground hover:bg-card hover:text-foreground"
                            )}
                            disabled={busy}
                            onBlur={() => setArmedDelete((a) => (a === p.id ? null : a))}
                            onClick={() => removePlugin(p)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                            {armedDelete === p.id && "Wis"}
                          </button>}
                        </div>
                      );
                    })}

                    {availableDirectory.length > 0 && (
                      <>
                        {filteredInstalled.length > 0 && <div className="mx-1.5 my-1 border-t" />}
                        <p aria-hidden="true" className="px-2.5 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
                          Beschikbaar
                        </p>
                        {availableDirectory.map((preset) => {
                          const busy = busyId === preset.id;
                          return (
                            <button
                              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-hidden transition-colors duration-150 hover:bg-muted focus-visible:bg-muted"
                              disabled={saving}
                              key={preset.id}
                              onClick={() => connectPreset(preset)}
                              type="button"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium text-sm">{preset.name}</span>
                                <span className="block truncate text-muted-foreground text-xs">{preset.description}</span>
                              </span>
                              <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                                {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Plus aria-hidden="true" className="size-4" />}
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}

                    {filteredInstalled.length === 0 && availableDirectory.length === 0 && (
                      <p className="px-2.5 py-4 text-center text-muted-foreground text-sm">Geen plugins gevonden.</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t px-2.5 py-1.5 text-muted-foreground text-xs">
                    <span>Typ @ in de chat om aan te roepen</span>
                    <button
                      className="font-medium text-foreground hover:underline"
                      onClick={() => {
                        setCustomMode(true);
                        setHandle("");
                        setName("");
                        setDescription("");
                        setUrl("https://");
                        setTransport("auto");
                      }}
                      type="button"
                    >
                      + Eigen URL
                    </button>
                  </div>
                </>
              ) : (
                <form className="space-y-2.5 p-2" onSubmit={addCustomPlugin}>
                  <div className="flex items-center gap-2 pb-1">
                    <button
                      aria-label="Terug"
                      className="inline-flex size-7 items-center justify-center rounded-full hover:bg-muted"
                      onClick={() => setCustomMode(false)}
                      type="button"
                    >
                      <ArrowLeft aria-hidden="true" className="size-4" />
                    </button>
                    <span className="font-medium text-sm">Eigen MCP-server</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="font-medium text-xs">@handle</span>
                      <input
                        className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                        maxLength={30}
                        onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                        placeholder="canva"
                        required
                        value={handle}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-xs">Naam</span>
                      <input
                        className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                        maxLength={80}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Canva"
                        required
                        value={name}
                      />
                    </label>
                  </div>
                  <label className="block space-y-1">
                    <span className="font-medium text-xs">Server URL</span>
                    <input
                      className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      maxLength={2000}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://..."
                      required
                      type="url"
                      value={url}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="font-medium text-xs">API-sleutel (optioneel)</span>
                    <input
                      autoComplete="off"
                      className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      maxLength={4000}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Laat leeg voor browser-login…"
                      type="password"
                      value={token}
                    />
                  </label>
                  <div>
                    <p className="mb-1 font-medium text-xs" id={transportLabelId}>
                      Protocol
                    </p>
                    <TransportTrack labelId={transportLabelId} onChange={setTransport} value={transport} />
                  </div>
                  <div className="flex justify-end pt-1">
                    <CommandButton
                      className="h-9 min-h-9 px-3.5 text-xs"
                      disabled={saving || !handle.trim() || !url.trim()}
                      global={false}
                      keysClassName="hidden sm:flex"
                      shortcut="enter"
                      type="submit"
                    >
                      {saving ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <Plus aria-hidden="true" className="size-3.5" />}
                      <span>Koppelen</span>
                    </CommandButton>
                  </div>
                </form>
              )}

              {(error || notice) && (
                <p
                  className={cn(
                    "mx-1.5 mb-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                    error ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                  )}
                  role="status"
                >
                  {error || notice}
                </p>
              )}

              {oauthPending && (
                <form className="mx-1.5 mb-1.5 space-y-1" onSubmit={finishOAuth}>
                  <label className="block space-y-1">
                    <span className="block text-muted-foreground text-xs">
                      Laadt het inlogvenster na het inloggen niet (127.0.0.1)? Plak het adres van dat venster hier.
                    </span>
                    <input
                      autoComplete="off"
                      className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      maxLength={4000}
                      onChange={(e) => setCallbackUrl(e.target.value)}
                      placeholder="http://127.0.0.1/digimv/plugins/oauth/callback?code=…"
                      required
                      value={callbackUrl}
                    />
                  </label>
                  <div className="flex justify-end">
                    <CommandButton className="h-9 min-h-9 px-3.5 text-xs" global={false} keysClassName="hidden sm:flex" shortcut="enter" type="submit">
                      <Check aria-hidden="true" className="size-3.5" />
                      <span>Inloggen afronden</span>
                    </CommandButton>
                  </div>
                </form>
              )}
        </PopoverContent>
      </div>
    </Popover>
  );
}
