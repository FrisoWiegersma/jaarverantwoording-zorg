"use client";

/**
 * @author: @kokonutui
 * @description: AI Prompt Input
 * @version: 2.0.0
 * @date: 2026-10-15
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 *
 * Trimmed for this app: no attachments or slash commands, and the model menu comes in as `footer` (the
 * kokonutui model selector and context meter). The reply state comes from the chat (`busy`) instead of the
 * submit promise, so suggestions sent from outside the box show Stop too.
 */

import { ArrowUp } from "lucide-react";
import { type ReactNode, type Ref, useId, useImperativeHandle, useRef, useState } from "react";
import TypewriterTitle from "@/components/kokonutui/type-writer";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

export default function AI_Prompt({
  value,
  onValueChange: setValue,
  onSubmit,
  onStop,
  busy,
  placeholder = "Stel een vraag over een jaarverslag",
  examples,
  footer,
  className,
  ref,
}: AIPromptProps) {
  // The last question sent, for ↑ in an empty box (as in a terminal).
  const lastSentRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => textareaRef.current!, []);
  const textareaId = useId();
  const canSend = value.trim().length > 0 && !busy;
  const [focused, setFocused] = useState(false);
  const typing = Boolean(examples?.length) && !value && !focused && !busy;

  const submit = () => {
    if (!canSend) return;
    lastSentRef.current = value;
    onSubmit(value.trim());
    setValue("");
  };

  const stop = () => {
    onStop();
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter during IME composition confirms the candidate; it must not submit.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowUp" && value === "" && lastSentRef.current) {
      e.preventDefault();
      setValue(lastSentRef.current);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        el?.setSelectionRange(el.value.length, el.value.length);
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
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "raised relative flex flex-col gap-1 rounded-[22px] p-2",
          "outline-2 outline-transparent transition-[outline-color] duration-150 has-[textarea:focus-visible]:outline-ring/50"
        )}
      >
        <label className="sr-only" htmlFor={textareaId}>
          Je vraag
        </label>
        <div className="relative">
          <Textarea
            className={cn(
              "min-h-[52px] max-h-[240px] w-full resize-none overflow-y-auto rounded-none border-none bg-transparent px-3 pt-2 pb-1 text-[1.05rem] leading-relaxed shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[1.05rem] dark:bg-transparent",
              typing && "sm:placeholder:text-transparent"
            )}
            id={textareaId}
            onBlur={() => setFocused(false)}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder={busy ? "Bezig met antwoorden. Esc stopt het antwoord." : placeholder}
            ref={textareaRef}
            rows={1}
            value={value}
          />
          {typing && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-2 hidden overflow-hidden text-[1.05rem] text-muted-foreground leading-relaxed sm:block">
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
    </div>
  );
}
