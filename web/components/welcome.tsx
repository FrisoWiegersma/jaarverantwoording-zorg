"use client";

import { CornerDownLeft } from "lucide-react";

// Real questions about documents that are already converted, so a first try answers in seconds.
const SUGGESTIONS = [
  "Wat was het eigen vermogen van Zorggroep Exact eind 2023?",
  "Hoeveel omzet had de Alrijne Zorggroep in 2025?",
  "Hoe groot was het resultaat van Stichting Basalt in 2025, vergeleken met het jaar ervoor?",
];

export function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="flex min-h-full flex-col justify-center py-10">
      <h1 className="text-balance font-light text-[2.35rem] leading-[1.1] tracking-[-0.015em] sm:text-[2.9rem]">
        Vraag het de jaarverslagen.
      </h1>
      <p className="mt-4 max-w-[34rem] text-[1.1rem] text-muted-foreground leading-relaxed">
        Over omzet, eigen vermogen of personeel van een zorgorganisatie, 2019 tot nu. Bij elk bedrag zie je de pagina
        waar het staat.
      </p>

      <ul className="raised mt-10 max-w-[36rem] divide-y divide-border overflow-hidden rounded-2xl">
        {SUGGESTIONS.map((q) => (
          <li key={q}>
            <button
              className="group flex min-h-14 w-full items-center gap-4 px-5 py-3.5 text-left text-[1rem] leading-snug transition-colors duration-150 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden"
              onClick={() => onAsk(q)}
              type="button"
            >
              <span className="flex-1">{q}</span>
              <CornerDownLeft
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
