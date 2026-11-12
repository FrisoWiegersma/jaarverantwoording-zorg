"use client";

import { ChevronDown, CornerDownLeft, RefreshCw } from "lucide-react";
import { useState } from "react";
import { QUESTIONS, SOURCES } from "@/lib/sources";

export function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  // One question per group; the button shows the next one of each. Starts at 0, so server and client render the same.
  const [turn, setTurn] = useState(0);
  return (
    <div className="flex min-h-full flex-col justify-center py-10">
      <h1 className="text-balance font-light text-[2.35rem] leading-[1.1] tracking-[-0.015em] sm:text-[2.9rem]">
        Vraag het de openbare bronnen.
      </h1>
      <p className="mt-4 max-w-[34rem] text-[1.1rem] text-muted-foreground leading-relaxed">
        Over zorgorganisaties, gemeenten en regio&apos;s: jaarverslagen, uitgaven, registers, uitspraken en beleidsstukken.
        Bij elk cijfer zie je waar het staat.
      </p>

      <details className="group/sources mt-3 max-w-[36rem]">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 -ml-3 rounded-full px-3 text-[0.95rem] text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {SOURCES.length} bronnen verbonden
          <ChevronDown aria-hidden="true" className="size-4 transition-transform duration-150 group-open/sources:rotate-180" />
        </summary>
        <dl className="raised mt-2 grid gap-x-6 gap-y-3 rounded-2xl px-5 py-4 text-[0.95rem] sm:grid-cols-2">
          {SOURCES.map((s) => (
            <div key={s.name}>
              <dt className="font-medium">{s.name}</dt>
              <dd className="text-muted-foreground leading-snug">{s.what}</dd>
            </div>
          ))}
        </dl>
      </details>

      <ul className="raised mt-8 max-w-[36rem] divide-y divide-border overflow-hidden rounded-2xl">
        {QUESTIONS.map(({ group, questions }) => {
          const q = questions[turn % questions.length];
          return (
            <li key={group}>
              <button
                className="group flex min-h-14 w-full items-center gap-4 px-5 py-3.5 text-left text-[1rem] leading-snug transition-colors duration-150 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden"
                onClick={() => onAsk(q)}
                type="button"
              >
                <span className="flex-1">
                  <span className="block text-[0.85rem] text-muted-foreground">{group}</span>
                  {q}
                </span>
                <CornerDownLeft
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-2">
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-[0.95rem] text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setTurn((t) => t + 1)}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Andere voorbeelden
        </button>
      </div>
    </div>
  );
}
