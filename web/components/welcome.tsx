"use client";

import {
  Activity,
  Award,
  BarChart3,
  BookOpen,
  Briefcase,
  ChevronDown,
  CornerDownLeft,
  Database,
  FileSearch,
  FileSpreadsheet,
  Globe,
  HeartPulse,
  Landmark,
  Link2,
  type LucideIcon,
  MapPin,
  RefreshCw,
  Scale,
  ScrollText,
  ShieldCheck,
  Stethoscope,
  TrendingUp,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useId, useMemo, useState } from "react";
import SmoothTab, { type SwipeTabItem } from "@/components/kokonutui/smooth-tab";
import { QUESTIONS, SOURCES, type SourceGroup } from "@/lib/sources";
import { cn } from "@/lib/utils";

const SOURCE_ICONS: Record<string, LucideIcon> = {
  DigiMV: FileSpreadsheet,
  "Zorgaanbiedersregister (LRZa)": ShieldCheck,
  Zorginzicht: Award,
  "NZa Open DIS": Stethoscope,
  Vektis: MapPin,
  Zorgcijfersdatabank: HeartPulse,
  "CBS Iv3": Landmark,
  "CBS StatLine": BarChart3,
  "RIVM StatLine en VZinfo": Activity,
  "Prognosemodel Zorg en Welzijn": TrendingUp,
  Rechtspraak: Scale,
  "Woo-index": FileSearch,
  "Officiële bekendmakingen": ScrollText,
  "Lokale regelgeving": BookOpen,
  "Europese aanbestedingen": Briefcase,
  "data.overheid.nl": Database,
  "Elke openbare link": Link2,
};

const SOURCE_GROUPS: { id: SourceGroup; title: string; icon: LucideIcon }[] = [
  { id: "zorg", title: "Zorg", icon: HeartPulse },
  { id: "cijfers", title: "Cijfers", icon: BarChart3 },
  { id: "recht", title: "Recht", icon: Scale },
  { id: "open", title: "Open", icon: Globe },
];

export function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  // One question per group; the button shows the next one of each. Starts at 0, so server and client render the same.
  const [turn, setTurn] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const panelId = useId();

  const sourceTabs = useMemo<SwipeTabItem[]>(
    () =>
      SOURCE_GROUPS.map((group) => {
        const items = SOURCES.filter((s) => s.group === group.id);
        return {
          id: group.id,
          title: group.title,
          icon: group.icon,
          content: (
            <dl className="grid gap-1.5 sm:grid-cols-2">
              {items.map((s) => {
                const Icon = SOURCE_ICONS[s.name] ?? Database;
                return (
                  <div
                    className="group/item flex items-start gap-3 rounded-xl p-2.5 transition-colors duration-150 hover:bg-muted/60"
                    key={s.name}
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground transition-colors duration-150 group-hover/item:bg-background group-hover/item:text-foreground">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <dt className="font-medium text-[0.92rem] text-foreground leading-snug">{s.name}</dt>
                      <dd className="mt-0.5 text-[0.84rem] text-muted-foreground leading-snug">{s.what}</dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          ),
        };
      }),
    []
  );

  return (
    <div className="flex min-h-full flex-col justify-center py-10">
      <h1 className="text-balance font-light text-[2.35rem] leading-[1.1] tracking-[-0.015em] sm:text-[2.9rem]">
        Vraag het de openbare bronnen.
      </h1>
      <p className="mt-4 max-w-[34rem] text-[1.1rem] text-muted-foreground leading-relaxed">
        Over zorgorganisaties, gemeenten en regio&apos;s: jaarverslagen, uitgaven, registers, uitspraken en beleidsstukken.
        Bij elk cijfer zie je waar het staat.
      </p>

      <MotionConfig reducedMotion="user">
        <div className="mt-3 max-w-[36rem]">
          <button
            aria-controls={panelId}
            aria-expanded={sourcesOpen}
            className={cn(
              "-ml-3 inline-flex min-h-10 cursor-pointer items-center gap-2.5 rounded-full px-3.5 text-[0.95rem] transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              sourcesOpen
                ? "bg-muted/80 text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
            onClick={() => setSourcesOpen((v) => !v)}
            type="button"
          >
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60 opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span>{SOURCES.length} bronnen verbonden</span>
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 transition-transform duration-200", sourcesOpen && "rotate-180")}
            />
          </button>

          <AnimatePresence initial={false}>
            {sourcesOpen && (
              <motion.div
                animate={{ opacity: 1, height: "auto" }}
                className="-mx-2 overflow-hidden px-2 pb-10 -mb-10"
                exit={{ opacity: 0, height: 0 }}
                id={panelId}
                initial={{ opacity: 0, height: 0 }}
                transition={{ type: "spring", stiffness: 360, damping: 34 }}
              >
                <div className="raised mt-2.5 rounded-2xl p-3.5 sm:p-4">
                  <SmoothTab items={sourceTabs} label="Verbonden bronnen per categorie" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </MotionConfig>

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
