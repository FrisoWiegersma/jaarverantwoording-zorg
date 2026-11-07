"use client";

/**
 * @author: @kokonutui
 * @description: Command Palette with ⌘K, nested pages, fuzzy matching and in-row action progress
 * @version: 2.0.0
 * @date: 2026-10-14
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: the top-level rows come from the caller as you type (`onQueryChange`), as found, and each
 * opens a page of choices filtered by plain text; choosing one hands it to `onSelect` and closes. No fuzzy
 * matching, recents, groups, shortcuts, links or in-row progress. Dutch labels, theme colours. `autoFocus` and
 * `onClose` let the app show it in a dialog.
 */

import { ChevronRight, Search } from "lucide-react";
import { animate, useReducedMotion } from "motion/react";
import {
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "@/lib/utils";

export interface CommandItem {
  id: string;
  label: string;
  /** Muted text after the label. */
  detail?: string;
  icon?: ReactNode;
  /** Opens a page with these rows. */
  children?: CommandItem[];
  /** Placeholder while its page is open. */
  placeholder?: string;
  /** What choosing it means, for `onSelect`. */
  value?: string;
}

type InputSource = "keyboard" | "pointer";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const APPLE_PLATFORM = /mac|iphone|ipad/i;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export function isPaletteCombo(e: globalThis.KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

/** Focus sits in an open modal dialog that does not hold the palette. */
function inOtherModal(focused: Element | null, root: HTMLElement) {
  const modal = focused?.closest('[aria-modal="true"]');
  return Boolean(modal && !modal.contains(root));
}

const noSubscribe = () => () => {};
// The server renders ⌘; the browser corrects it after hydration.
export const useIsMac = () =>
  useSyncExternalStore(
    noSubscribe,
    () => APPLE_PLATFORM.test(navigator.userAgent),
    () => true
  );

export default function ActionSearchBar({
  items,
  onQueryChange,
  onSelect,
  empty,
  shortcut = false,
  label,
  placeholder,
  className,
  autoFocus = false,
  onClose,
}: {
  /** The top-level rows for the current query. */
  items: CommandItem[];
  onQueryChange: (query: string) => void;
  onSelect: (item: CommandItem) => void;
  /** Shown when a page has no rows: a hint, "searching…", or nothing found. */
  empty: ReactNode;
  /** ⌘K / Ctrl K anywhere on the page, not only while hovering or inside the palette. */
  shortcut?: boolean;
  label: string;
  placeholder: string;
  className?: string;
  /** Open with focus in the input, as when the palette is shown in a dialog. */
  autoFocus?: boolean;
  /** After it closes: Escape, a choice, focus leaving it. */
  onClose?: () => void;
}) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const listboxId = `${uid}-listbox`;
  const optionId = (index: number) => `${uid}-option-${index}`;

  const reduce = useReducedMotion();
  const isMac = useIsMac();

  const [open, setOpen] = useState(false);
  const [rootQuery, setRootQuery] = useState("");
  const [pageQuery, setPageQuery] = useState("");
  const [stack, setStack] = useState<CommandItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false);
  const fadeNextOpen = useRef(false);
  const slideNext = useRef<0 | 1 | -1>(0);
  const springUntil = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);

  const page = stack.at(-1);
  const query = page ? pageQuery : rootQuery;
  const rows = page ? (page.children ?? []).filter((item) => fold(item.label).includes(fold(pageQuery.trim()))) : items;
  const highlighted = Math.min(activeIndex, rows.length - 1);
  const activeRow = open ? rows[highlighted] : undefined;

  const openPalette = useCallback(
    (source: InputSource) => {
      if (open) return;
      fadeNextOpen.current = source === "pointer";
      setActiveIndex(0);
      setOpen(true);
    },
    [open]
  );

  const closePalette = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      setRootQuery("");
      setPageQuery("");
      onQueryChange("");
      setStack([]);
      setActiveIndex(0);
      const target = returnFocus.current;
      returnFocus.current = null;
      if (restoreFocus && target?.isConnected) target.focus();
      onClose?.();
    },
    [onQueryChange, onClose]
  );

  /* -- ⌘K -- */

  const hotkeyState = useRef({ open, openPalette, closePalette });
  useEffect(() => {
    hotkeyState.current = { open, openPalette, closePalette };
  });

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const root = rootRef.current;
      // An element hidden by CSS (the header on a phone) has no box and takes no shortcut.
      if (!(isPaletteCombo(e) && root?.offsetParent) || e.defaultPrevented) return;
      const focused = document.activeElement;
      const focusedInside = focused instanceof Node && root.contains(focused);
      if (!(shortcut || focusedInside || hoverRef.current)) return;
      if (inOtherModal(focused, root)) return;
      e.preventDefault();
      e.stopPropagation();
      const state = hotkeyState.current;
      if (state.open) {
        state.closePalette(true);
        return;
      }
      if (focused instanceof HTMLElement && !focusedInside) returnFocus.current = focused;
      inputRef.current?.focus();
      inputRef.current?.select();
      state.openPalette("keyboard");
    };
    // Capture, so the host page's ⌘K does not also fire when this one takes it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shortcut]);

  /* -- motion: fade on pointer open; slide + spring on pointer page change -- */

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!(open && panel && fadeNextOpen.current)) return;
    fadeNextOpen.current = false;
    panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: EASE_OUT });
  }, [open]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!(open && body && content)) return;
    let controls: ReturnType<typeof animate> | undefined;
    const fitHeight = () => {
      const h = `${content.offsetHeight}px`;
      controls?.stop();
      if (!reduce && performance.now() < springUntil.current) {
        controls = animate(body, { height: h }, { type: "spring", bounce: 0, duration: 0.32 });
      } else {
        body.style.height = h;
      }
    };
    fitHeight();
    const ro = new ResizeObserver(fitHeight);
    ro.observe(content);
    return () => {
      ro.disconnect();
      controls?.stop();
    };
  }, [open, reduce]);

  // Runs when the page changes.
  useLayoutEffect(() => {
    const list = listRef.current;
    const dir = slideNext.current;
    slideNext.current = 0;
    if (!list || dir === 0) return;
    list.animate([{ transform: reduce ? "none" : `translateX(${dir * 14}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], {
      duration: 200,
      easing: EASE_OUT,
    });
  }, [stack.length, reduce]);

  // Keep the highlighted row inside the list's scroll box (never the page).
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = document.getElementById(`${uid}-option-${highlighted}`);
    if (!(open && list && row)) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop + 6) list.scrollTop = top - 30;
    else if (bottom > list.scrollTop + list.clientHeight - 6) list.scrollTop = bottom - list.clientHeight + 6;
  }, [open, highlighted, rows.length, uid]);

  /* -- pages -- */

  const pushPage = (item: CommandItem, source: InputSource) => {
    if (source === "pointer") {
      slideNext.current = 1;
      springUntil.current = performance.now() + 150;
    }
    setStack((s) => [...s, item]);
    setPageQuery("");
    setActiveIndex(0);
    setAnnouncement(`${item.label}, ${item.children?.length ?? 0} keuzes`);
  };

  const popPage = (source: InputSource) => {
    const left = stack.at(-1);
    if (!left) return;
    if (source === "pointer") {
      slideNext.current = -1;
      springUntil.current = performance.now() + 150;
    }
    const nextStack = stack.slice(0, -1);
    setStack(nextStack);
    setPageQuery("");
    // Land back on the row that opened the page.
    const back = (nextStack.at(-1)?.children ?? items).findIndex((r) => r.id === left.id);
    setActiveIndex(Math.max(0, back));
    setAnnouncement(nextStack.at(-1)?.label ?? label);
    inputRef.current?.focus();
  };

  const choose = (row: CommandItem, source: InputSource) => {
    if (row.children) {
      pushPage(row, source);
      return;
    }
    closePalette(false);
    onSelect(row);
  };

  /* -- input -- */

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End":
        e.preventDefault();
        if (!open) openPalette("keyboard");
        else if (rows.length > 0) {
          if (e.key === "Home" || e.key === "End") setActiveIndex(e.key === "Home" ? 0 : rows.length - 1);
          else setActiveIndex((Math.max(highlighted, 0) + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (!open) openPalette("keyboard");
        else if (activeRow) choose(activeRow, "keyboard");
        break;
      case "Backspace":
        if (open && query === "" && stack.length > 0) {
          e.preventDefault();
          popPage("keyboard");
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          closePalette(true);
        }
        break;
      default:
        break;
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (page) setPageQuery(e.target.value);
    else {
      setRootQuery(e.target.value);
      onQueryChange(e.target.value);
    }
    setActiveIndex(0);
    openPalette("keyboard");
  };

  const handleInputPointerDown = (e: PointerEvent<HTMLInputElement>) => {
    if (e.button === 0) openPalette("pointer");
  };

  // Close when focus leaves the whole palette (Tab away, click outside); not when another app or tab takes it.
  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (!document.hasFocus()) return;
    if (open && !(next instanceof Node && e.currentTarget.contains(next))) {
      returnFocus.current = null;
      closePalette(false);
    }
  };

  return (
    <div
      className={cn("relative h-[46px] w-full max-w-md", className)}
      onBlur={handleBlur}
      onPointerEnter={(e) => {
        hoverRef.current = e.pointerType === "mouse";
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
      }}
      ref={rootRef}
    >
      <div
        className={cn(
          "@container/palette absolute inset-x-0 top-0 z-30 overflow-hidden rounded-xl border bg-card",
          open ? "shadow-[0_16px_40px_-16px_rgb(0_0_0/0.25)] dark:shadow-[0_16px_40px_-16px_rgb(0_0_0/0.7)]" : "shadow-xs"
        )}
      >
        <div className="flex h-11 items-center gap-2 px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {stack.map((p, i) => (
            <button
              aria-label={`Terug van ${p.label}`}
              className="inline-flex h-6 min-w-0 max-w-[45%] shrink items-center truncate rounded-md bg-muted px-2 font-medium text-xs hover:bg-muted/70"
              key={p.id}
              onClick={() => {
                if (i === stack.length - 1) popPage("pointer");
              }}
              // Keep focus in the input; Backspace is the keyboard path.
              onPointerDown={(e) => e.preventDefault()}
              tabIndex={-1}
              type="button"
            >
              <span className="truncate">{p.label}</span>
            </button>
          ))}
          <label className="sr-only" htmlFor={inputId}>
            {label}
          </label>
          <input
            aria-activedescendant={activeRow ? optionId(highlighted) : undefined}
            aria-autocomplete="list"
            aria-controls={open ? listboxId : undefined}
            aria-expanded={open}
            autoComplete="off"
            autoFocus={autoFocus}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            id={inputId}
            onChange={handleChange}
            onFocus={autoFocus ? () => openPalette("pointer") : undefined}
            onKeyDown={handleKeyDown}
            onPointerDown={handleInputPointerDown}
            placeholder={page ? (page.placeholder ?? page.label) : placeholder}
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="text"
            value={query}
          />
          {!open && (
            <span aria-hidden="true" className="flex shrink-0 gap-0.5">
              <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>K</Kbd>
            </span>
          )}
        </div>

        {open && (
          <div
            // Keep focus in the input while pressing inside the list, so its blur never closes the palette before
            // the click lands.
            onPointerDown={(e) => e.preventDefault()}
            ref={panelRef}
          >
            <div className="border-t" />
            <div className="overflow-hidden" ref={bodyRef}>
              <div ref={contentRef}>
                <div
                  aria-label={page ? page.label : label}
                  className="relative max-h-80 overflow-y-auto overscroll-contain p-1.5"
                  id={listboxId}
                  ref={listRef}
                  role="listbox"
                >
                  {rows.map((row, index) => (
                    <div
                      aria-selected={index === highlighted}
                      className="group/row flex min-h-9 cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm aria-selected:bg-muted"
                      id={optionId(index)}
                      key={row.id}
                      onClick={() => choose(row, "pointer")}
                      onPointerMove={(e) => {
                        if (e.pointerType === "mouse" && index !== highlighted) setActiveIndex(index);
                      }}
                      role="option"
                    >
                      {row.icon && (
                        <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-muted-foreground group-aria-selected/row:text-foreground">
                          {row.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{row.label}</span>
                        {row.detail && <span className="block truncate text-muted-foreground text-xs">{row.detail}</span>}
                        {row.children && <span className="sr-only">, opent een pagina</span>}
                      </span>
                      {row.children && <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
                    </div>
                  ))}
                </div>
                {rows.length === 0 && <p className="px-3 pt-1 pb-5 text-center text-muted-foreground text-sm">{empty}</p>}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="@xs/palette:flex hidden items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                  <span className="mr-1.5">Kiezen</span>
                </span>
                <Kbd>↵</Kbd>
                <span>{activeRow?.value && !activeRow.value.startsWith("/") ? "Invullen" : "Openen"}</span>
              </span>
              <span className="flex items-center gap-1.5">
                {stack.length > 0 && (
                  <>
                    <Kbd>⌫</Kbd>
                    <span className="mr-1.5">Terug</span>
                  </>
                )}
                <Kbd>esc</Kbd>
                <span>Sluiten</span>
              </span>
            </div>
          </div>
        )}
      </div>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
