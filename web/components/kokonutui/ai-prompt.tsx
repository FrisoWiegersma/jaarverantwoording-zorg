"use client";

/**
 * @author: @kokonutui
 * @description: AI Prompt Input with @plugin MCP Mentions & Chips
 * @version: 2.1.0
 * @date: 2026-11-15
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Includes Kokonut UI @plugin composer chips, inline @mention command popover (with ActionSearchBar's Kbd keycaps),
 * model/plugin footer slot, and Stop state while generating.
 */

import { ArrowUp, AtSign, FileText, Plug, Plus, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type ReactNode, type Ref, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/kokonutui/action-search-bar";
import TypewriterTitle from "@/components/kokonutui/type-writer";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { findActiveMention, type Plugin } from "@/lib/plugins";
import { projectFileMention, type ProjectDocument } from "@/lib/projects";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

interface AIPromptProps {
  /** The text in the box, held by the page so it can fill it in (a question template). */
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onStop: () => void;
  busy: boolean;
  placeholder?: string;
  /**
   * Questions typed into the empty box one after the other (Kokonut Typewriter), while it is not focused. The
   * placeholder stays for screen readers; phones keep the plain placeholder, the phrases don't fit there.
   */
  examples?: string[];
  /** Controls in the row under the text, left of the send button. */
  footer?: ReactNode;
  /** Connected MCP plugins available for @mention autocomplete and composer chips. */
  plugins?: Plugin[];
  documents?: ProjectDocument[];
  /** Handles of MCP plugins pinned for the current turn. */
  selectedPlugins?: string[];
  /** Toggle a pinned MCP plugin chip. */
  onTogglePlugin?: (handle: string) => void;
  /** Open the Kokonut UI plugin selector on the "Toevoegen" tab when the user chooses to connect a new plugin. */
  onAddPluginRequest?: () => void;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

function SendButton({
  responding,
  canSend,
  onSend,
  onStop,
}: {
  responding: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  // One button with two faces. The faces crossfade with a little blur, so
  // Send turning into Stop reads as the same control changing state.
  const face =
    "absolute inset-0 flex items-center justify-center transition-[opacity,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]";
  return (
    <button
      aria-label={responding ? "Stop het antwoord" : "Verstuur je vraag"}
      className={cn(
        "relative size-11 shrink-0 rounded-full",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        "transition-[background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        responding || canSend
          ? "bg-primary text-primary-foreground hover:bg-primary/85"
          : "bg-muted text-muted-foreground/60"
      )}
      disabled={!(responding || canSend)}
      onClick={responding ? onStop : onSend}
      type="button"
    >
      <span aria-hidden="true" className={cn(face, responding ? "opacity-0 blur-[2px]" : "opacity-100 blur-0")}>
        <ArrowUp className="size-5" strokeWidth={2.25} />
      </span>
      <span aria-hidden="true" className={cn(face, responding ? "opacity-100 blur-0" : "opacity-0 blur-[2px]")}>
        <span className="size-3 rounded-[3px] bg-current" />
      </span>
    </button>
  );
}

type MentionOption =
  | { kind: "plugin"; plugin: Plugin }
  | { kind: "file"; document: ProjectDocument }
  | { kind: "add" };

export default function AI_Prompt({
  value,
  onValueChange: setValue,
  onSubmit,
  onStop,
  busy,
  placeholder = "Stel een vraag (typ @ voor apps en projectbestanden)",
  examples,
  footer,
  plugins = [],
  documents = [],
  selectedPlugins = [],
  onTogglePlugin,
  onAddPluginRequest,
  className,
  ref,
}: AIPromptProps) {
  // The last question sent, for ↑ in an empty box (as in a terminal).
  const lastSentRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => textareaRef.current!, []);
  const textareaId = useId();
  const mentionListId = useId();
  const canSend = value.trim().length > 0 && !busy;
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const typing = Boolean(examples?.length) && !value && !focused && !busy;

  const activeMention = useMemo(() => {
    if (!focused || busy) return null;
    const m = findActiveMention(value, caret);
    if (!m || dismissedAt === m.start) return null;
    return m;
  }, [value, caret, focused, busy, dismissedAt]);

  const mentionOptions = useMemo<MentionOption[]>(() => {
    if (!activeMention) return [];
    const q = activeMention.query;
    const matches = plugins
      .filter(
        (p) =>
          p.enabled &&
          (p.handle.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q))
      )
      .map((plugin): MentionOption => ({ kind: "plugin", plugin }));
    matches.unshift(...documents.filter((d) => !d.archived && d.filename.toLowerCase().includes(q))
      .slice(0, 20).map((document): MentionOption => ({ kind: "file", document })));
    if (onAddPluginRequest) {
      matches.push({ kind: "add" });
    }
    return matches;
  }, [activeMention, plugins, documents, onAddPluginRequest]);

  const highlighted = mentionOptions.length ? Math.min(activeIndex, mentionOptions.length - 1) : 0;

  const applyMentionOption = (opt: MentionOption) => {
    if (!activeMention) return;
    if (opt.kind === "add") {
      // Strip the dangling '@' token if it was just '@'
      const nextText =
        value.slice(0, activeMention.start) + value.slice(activeMention.end);
      setValue(nextText);
      setDismissedAt(activeMention.start);
      onAddPluginRequest?.();
      return;
    }
    const replacement = opt.kind === "file" ? `${projectFileMention(opt.document)} ` : `@${opt.plugin.handle} `;
    const nextText =
      value.slice(0, activeMention.start) +
      replacement +
      value.slice(activeMention.end).replace(/^\s+/, "");
    const nextCaret = activeMention.start + replacement.length;
    setValue(nextText);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
        setCaret(nextCaret);
      }
    });
  };

  const submit = () => {
    if (!canSend) return;
    lastSentRef.current = value;
    onSubmit(value.trim());
    setValue("");
    setCaret(0);
  };

  const stop = () => {
    onStop();
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter during IME composition confirms the candidate; it must not submit.
    if (e.nativeEvent.isComposing) return;

    if (activeMention && mentionOptions.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((highlighted + delta + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const target = mentionOptions[highlighted];
        if (target) applyMentionOption(target);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(activeMention.start);
        return;
      }
    }

    if (e.key === "Backspace" && value === "" && selectedPlugins.length > 0 && onTogglePlugin) {
      e.preventDefault();
      onTogglePlugin(selectedPlugins[selectedPlugins.length - 1]);
      return;
    }

    if (e.key === "ArrowUp" && value === "" && lastSentRef.current) {
      e.preventDefault();
      setValue(lastSentRef.current);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.setSelectionRange(el.value.length, el.value.length);
          setCaret(el.value.length);
        }
      });
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && busy) {
      e.preventDefault();
      stop();
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <Popover open={Boolean(activeMention && mentionOptions.length)} onOpenChange={(open) => {
        if (!open && activeMention) setDismissedAt(activeMention.start);
      }}>
      <PopoverAnchor asChild><div className={cn("relative w-full", className)}>
        <PopoverContent
          align="start" side="top" sideOffset={8} collisionPadding={12}
          className="raised max-h-[var(--radix-popover-content-available-height)] w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl p-1.5"
          id={mentionListId} role="listbox" aria-label="Apps en projectbestanden"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => { if (e.target === textareaRef.current) e.preventDefault(); }}
          onPointerDown={(e) => e.preventDefault()}
        >
              <p className="px-2.5 pt-1 pb-1.5 font-medium text-muted-foreground text-xs">
                Apps en projectbestanden met <Kbd>@</Kbd>
              </p>
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
                {mentionOptions.map((opt, index) => {
                  const isSelected = index === highlighted;
                  if (opt.kind === "add") {
                    return (
                      <div
                        aria-selected={isSelected}
                        className={cn(
                          "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm transition-colors",
                          isSelected ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"
                        )}
                        key="add-plugin"
                        onClick={() => applyMentionOption(opt)}
                        onPointerMove={() => {
                          if (index !== highlighted) setActiveIndex(index);
                        }}
                        role="option"
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-dashed bg-card">
                          <Plus aria-hidden="true" className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-foreground">MCP-plugin koppelen (bijv. Canva)…</span>
                          <span className="block truncate text-muted-foreground text-xs">
                            Verbind een MCP-server om in dit gesprek of project te gebruiken
                          </span>
                        </span>
                      </div>
                    );
                  }
                  const plugin = opt.kind === "file" ? {
                    id: opt.document.id, name: opt.document.filename,
                    description: `Projectbestand · ${opt.document.pages} pagina’s`, tools: [],
                  } : opt.plugin;
                  return (
                    <div
                      aria-selected={isSelected}
                      className={cn(
                        "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm transition-colors",
                        isSelected ? "bg-muted text-foreground" : "hover:bg-muted/60"
                      )}
                      key={plugin.id}
                      onClick={() => applyMentionOption(opt)}
                      onPointerMove={() => {
                        if (index !== highlighted) setActiveIndex(index);
                      }}
                      role="option"
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-md border bg-card">
                        {opt.kind === "file" ? <FileText aria-hidden="true" className="size-3.5" /> : <Plug aria-hidden="true" className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{plugin.name}</span>
                        <span className="block truncate text-muted-foreground text-xs">
                          {plugin.description || `${plugin.tools.length} MCP-tools beschikbaar`}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex items-center justify-between border-t px-2.5 pt-1.5 pb-0.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                  <span className="mr-1">Kiezen</span>
                  <Kbd>↵</Kbd>
                  <span>Invullen</span>
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>esc</Kbd>
                  <span>Sluiten</span>
                </span>
              </div>
        </PopoverContent>

        <div
          className={cn(
            "raised relative flex flex-col gap-1 rounded-[22px] p-2",
            "outline-2 outline-transparent transition-[outline-color] duration-150 has-[textarea:focus-visible]:outline-ring/50"
          )}
        >
          {/* Kokonut UI Active @plugin Composer Chips */}
          <AnimatePresence initial={false}>
            {selectedPlugins.length > 0 && (
              <motion.div
                animate={{ height: "auto", opacity: 1 }}
                className="flex flex-wrap items-center gap-1.5 overflow-hidden px-2 pt-1"
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: EASE_OUT }}
              >
                {selectedPlugins.map((handle) => {
                  return (
                    <motion.button
                      animate={{ opacity: 1, scale: 1 }}
                      aria-label={`Plugin @${handle} verwijderen uit deze vraag`}
                      className="inline-flex h-7 items-center gap-1 rounded-full border bg-card px-2.5 font-medium text-xs transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      exit={{ opacity: 0, scale: 0.92 }}
                      initial={{ opacity: 0, scale: 0.92 }}
                      key={handle}
                      onClick={() => onTogglePlugin?.(handle)}
                      transition={{ duration: 0.14, ease: EASE_OUT }}
                      type="button"
                    >
                      <AtSign aria-hidden="true" className="size-3 text-muted-foreground" />
                      <span>{handle}</span>
                      <X aria-hidden="true" className="ml-0.5 size-3 text-muted-foreground" />
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          <label className="sr-only" htmlFor={textareaId}>
            Je vraag
          </label>
          <div className="relative">
            <Textarea
              aria-autocomplete="list"
              aria-controls={activeMention && mentionOptions.length > 0 ? mentionListId : undefined}
              aria-expanded={Boolean(activeMention && mentionOptions.length > 0)}
              className={cn(
                "min-h-[52px] max-h-[240px] w-full resize-none overflow-y-auto rounded-none border-none bg-transparent px-3 pt-2 pb-1 text-[1.05rem] leading-relaxed shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[1.05rem] dark:bg-transparent",
                typing && "sm:placeholder:text-transparent"
              )}
              id={textareaId}
              onBlur={() => setFocused(false)}
              onChange={(e) => {
                setValue(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setDismissedAt(null);
                setActiveIndex(0);
              }}
              onClick={(e) => setCaret(e.currentTarget.selectionStart ?? value.length)}
              onFocus={(e) => {
                setFocused(true);
                setCaret(e.currentTarget.selectionStart ?? value.length);
              }}
              onKeyDown={handleKeyDown}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? value.length)}
              placeholder={busy ? "Bezig met antwoorden. Esc stopt het antwoord." : placeholder}
              ref={textareaRef}
              rows={1}
              value={value}
            />
            {typing && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-3 top-2 hidden overflow-hidden text-[1.05rem] text-muted-foreground leading-relaxed sm:block"
              >
                <TypewriterTitle
                  as="span"
                  deleteMode="select"
                  pauseBeforeDelete={1800}
                  sequences={examples!.map((text) => ({ text, deleteAfter: true }))}
                  startDelay={600}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-1">{footer}</div>
            <SendButton canSend={canSend} onSend={submit} onStop={stop} responding={busy} />
          </div>
        </div>
      </div></PopoverAnchor>
      </Popover>
    </MotionConfig>
  );
}
