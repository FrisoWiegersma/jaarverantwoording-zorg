"use client";

import {
  Activity, Award, BarChart3, BookOpen, Briefcase, Building2, Check, Database,
  FileSearch, FileSpreadsheet, Globe, HeartPulse, Landmark, Link2,
  type LucideIcon, MapPin, Scale, ScrollText, ShieldCheck, Stethoscope, Terminal, TrendingUp,
} from "lucide-react";
import Link from "next/link";
import BackgroundPaths from "@/components/kokonutui/background-paths";
import { Mark, MarkerText } from "@/components/kokonutui/marker-text";
import SlideTextButton from "@/components/kokonutui/slide-text-button";
import SmoothTab from "@/components/kokonutui/smooth-tab";
import SwitchButton from "@/components/kokonutui/switch-button";
import { LandingDemo } from "@/components/landing-demo";
import { Logo } from "@/components/logo";
import { SOURCES, type SourceGroup } from "@/lib/sources";
import { cn } from "@/lib/utils";

const PRICING_PLANS = [
  {
    name: "Losse bundel",
    price: "19",
    cadence: "eenmalig",
    subtitle: "100 credits · € 0,19 per credit (ca. 100 vragen)",
    features: [`${SOURCES.length} openbare bronnen`, "Bronverwijzingen per pagina", "Excel-export", "Geen vervaldatum"],
    cta: "Open de chat",
    featured: false,
  },
  {
    name: "Pro",
    price: "49",
    cadence: "/ maand",
    subtitle: "500 credits / mnd · excl. btw",
    features: [`${SOURCES.length} openbare bronnen`, "Projecten & eigen pdf’s", "MCP & API inbegrepen", "Excel-export & bronpagina’s"],
    cta: "Open de chat",
    featured: true,
  },
  {
    name: "Team",
    price: "199",
    cadence: "/ maand",
    subtitle: "5 gebruikers · binnenkort",
    features: ["Alles in Pro", "Gedeelde projectwerkruimtes", "Centrale facturatie", "2.500 credits / mnd"],
    cta: "Open de chat",
    featured: false,
  },
];

function PricingGrid() {
  return (
    <div
      aria-label="Tarieven, horizontaal scrollen op mobiel"
      className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-4 pt-2 pb-6 [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-ring lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0"
      role="region"
      tabIndex={0}
    >
      {PRICING_PLANS.map((plan) => (
        <div className="w-[min(82vw,21rem)] shrink-0 snap-center lg:w-auto" key={plan.name}>
          <div className={cn("raised flex h-full flex-col rounded-2xl p-5 transition-transform duration-200 motion-safe:hover:-translate-y-1 sm:p-6", plan.featured && "ring-1 ring-foreground/80")}>
            <h3 className="text-base font-semibold">{plan.name}</h3>
            <p className="mt-4 flex items-baseline gap-2 tabular-nums"><span className="text-4xl font-semibold tracking-tight">€ {plan.price}</span><span className="text-sm text-muted-foreground">{plan.cadence}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">{plan.subtitle}</p>
            <ul className="mt-5 space-y-2.5 border-t border-border/60 pt-4 text-sm">
              {plan.features.map((feature) => (
                <li className="flex items-center gap-2.5" key={feature}><Check aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{feature}</li>
              ))}
            </ul>
            <SlideTextButton animateIn={false} className={cn("mt-6 h-11 w-full rounded-xl px-4 text-sm md:min-w-0", plan.featured ? "bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground" : "border-border")} href="/" text={plan.cta} variant={plan.featured ? "default" : "ghost"} />
          </div>
        </div>
      ))}
    </div>
  );
}

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
  "KVK Handelsregister": Building2,
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

export function LandingPage() {
  const sourceTabs = SOURCE_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    icon: group.icon,
    content: (
      <dl className="grid gap-x-8 gap-y-4 pt-3 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCES.filter((source) => source.group === group.id).map((source) => {
          const Icon = SOURCE_ICONS[source.name] ?? Database;
          return (
            <div className="group/item flex min-w-0 items-start gap-3 rounded-xl p-2 transition-colors hover:bg-card/70" key={source.name}>
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground ring-1 ring-border/60"><Icon aria-hidden="true" className="size-4" /></span>
              <div className="min-w-0">
                <dt className="text-sm font-semibold">{source.name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{source.what}</dd>
              </div>
            </div>
          );
        })}
      </dl>
    ),
  }));

  return (
    <div data-landing className="min-h-full bg-background text-foreground selection:bg-marker selection:text-marker-ink [&_section[id]]:scroll-mt-6 [&_a]:focus-visible:outline-ring [&_a]:focus-visible:outline-offset-4">
      <a className="sr-only fixed top-3 left-3 z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only" href="#inhoud">Naar de inhoud</a>
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-8 lg:flex-nowrap lg:py-5">
        <Link aria-label="Jaarverslagen zorg" href="/landing"><Logo /></Link>
        <nav aria-label="Hoofdnavigatie" className="order-last flex w-full gap-1 lg:order-none lg:ml-auto lg:w-auto">
          {[{ href: "#voorbeeld", text: "Zo werkt het" }, { href: "#bronnen", text: "Bronnen" }, { href: "#prijzen", text: "Tarieven" }].map((item) => (
            <SlideTextButton animateIn={false} className="h-10 flex-1 rounded-lg border-0 bg-transparent px-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted/60 hover:text-foreground md:min-w-0 dark:text-muted-foreground dark:hover:bg-muted/60 lg:flex-none" href={item.href} key={item.href} text={item.text} variant="ghost" />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-2">
          <SlideTextButton animateIn={false} className="h-11 rounded-xl px-4 text-sm md:min-w-0" href="/" text="Open de chat" />
          <SwitchButton />
        </div>
      </header>

      <main id="inhoud" tabIndex={-1}>
        <section>
          <BackgroundPaths angle={-8} className="min-h-0 bg-transparent px-4 pt-8 pb-10 text-foreground sm:px-8 sm:pt-12 sm:pb-14 dark:bg-transparent dark:text-foreground" count={12} interactive speed={0.25} spread={0.34}>
            <div className="relative z-10 mx-auto max-w-3xl text-center">
              <MarkerText delay={100} show>
                <h1 className="text-balance text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.08] font-semibold tracking-[-0.04em]">Doorzoek <Mark className="text-marker-ink">openbare zorgdata</Mark> en pdf’s.</h1>
              </MarkerText>
              <p className="mx-auto mt-5 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground">Jaarverslagen, registers en eigen dossiers. Antwoorden met de exacte bronpagina.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <SlideTextButton className="h-11 rounded-xl bg-primary px-6 text-sm text-primary-foreground md:min-w-0 dark:bg-primary dark:text-primary-foreground" href="/" text="Stel een vraag" hoverText="Open de chat" />
                <SlideTextButton className="h-11 rounded-xl border-border bg-card/85 px-6 text-sm backdrop-blur-sm md:min-w-0" href="#voorbeeld" text="Bekijk voorbeeld" variant="ghost" />
              </div>
            </div>
          </BackgroundPaths>
        </section>

        <LandingDemo />

        <section className="mx-auto max-w-6xl border-t border-border px-4 py-8 sm:px-8 sm:py-12" id="prijzen">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">Tarieven</h2>
            <p className="text-xs text-muted-foreground">Voorgesteld · nog niet te koop</p>
          </div>
          <PricingGrid />
          <div className="raised mt-2 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5 sm:p-6">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold"><Terminal aria-hidden="true" className="size-4" />MCP & API (los)</h3>
              <p className="mt-1 text-sm text-muted-foreground">Eigen LLM · {SOURCES.length} bronnen · inbegrepen bij Pro</p>
            </div>
            <p className="tabular-nums"><span className="text-2xl font-semibold tracking-tight">€ 29</span><span className="ml-2 text-sm text-muted-foreground">/ maand · excl. btw</span></p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl border-t border-border px-4 py-8 sm:px-8 sm:py-12" id="bronnen">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight">{SOURCES.length} openbare bronnen</h2>
          <SmoothTab items={sourceTabs} label="Openbare bronnen" />
          <p className="mt-4 text-xs text-muted-foreground">Beschikbare jaren en actualiteit verschillen per bron.</p>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl border-t border-border px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Logo />
          <nav aria-label="Footernavigatie" className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
            <Link className="hover:text-foreground" href="/">Chat</Link>
            <Link className="hover:text-foreground" href="/projecten">Projecten</Link>
            <a className="hover:text-foreground" href="#bronnen">Bronnen</a>
          </nav>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Chatvragen gaan naar Gemini. Projectmateriaal alleen na toestemming. Archiveren wist bestanden niet.</p>
      </footer>
    </div>
  );
}
