"use client";

import { createContext, useContext, useState } from "react";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { Answer, CitationChip } from "@/components/answer";
import { citationKey } from "@/lib/citations";
import { parseNumber } from "@/lib/excel";
import { chartGroups, figureTable, richAnswerSchema, type Figure, type presentAnswer } from "@/lib/rich-answer";

const EvidenceContext = createContext<{ question: string; activeKey: string | null; onCite: (key: string) => void }>({ question: "", activeKey: null, onCite: () => {} });

function Source({ figure: f }: { figure: Figure }) {
  const { activeKey, onCite } = useContext(EvidenceContext);
  const key = citationKey(f.href, f.quote);
  return <CitationChip active={key === activeKey} href={f.href} label={f.href.includes("/vragenlijst/") ? "DigiMV" : `p. ${f.href.split("/").at(-1)}`} onClick={() => onCite(key)} quote={f.quote} />;
}

function FinancialAnswer({ summary, figures, view }: typeof richAnswerSchema._output) {
  const context = useContext(EvidenceContext);
  return (
    <div className="min-w-0">
      <Answer {...context} text={summary} />
      {view === "cards" && (
        <div className="my-5 grid gap-3 sm:grid-cols-2">
          {figures.map((f, i) => (
            <div className="raised min-w-0 rounded-xl p-4" key={i}>
              <p className="text-sm text-muted-foreground">{f.organization} · {f.year}</p>
              <p className="mt-1 font-semibold">{f.label}</p>
              <p className="my-2 break-words text-2xl font-semibold tabular-nums">{f.amount} <span className="text-base font-normal">{f.unit}</span></p>
              <Source figure={f} />
            </div>
          ))}
        </div>
      )}
      {view === "chart" && (
        <div className="my-5 space-y-5" aria-label="Vergelijking van de cijfers">
          {chartGroups(figures).map(([title, rows]) => {
            const max = Math.max(...rows.map((f) => Math.abs(parseNumber(f.amount)!.num)), 1);
            return (
              <figure className="raised rounded-xl p-4" key={title}>
                <figcaption className="mb-4 font-semibold">{title}</figcaption>
                {rows.some((f) => parseNumber(f.amount)!.num < 0) && <p className="mb-3 text-sm text-muted-foreground">Balklengte toont de absolute waarde. Negatieve bedragen zijn rood.</p>}
                <div className="space-y-4">
                  {rows.map((f, i) => (
                    <div key={i}>
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                        <span>{f.organization} · {f.year}</span>
                        <span className="font-semibold tabular-nums">{f.amount} {f.unit} <Source figure={f} /></span>
                      </div>
                      <div className="h-2 rounded-full bg-muted" aria-hidden="true">
                        <div className={`h-full rounded-full ${parseNumber(f.amount)!.num < 0 ? "bg-destructive" : "bg-foreground/70"}`} style={{ width: `${Math.abs(parseNumber(f.amount)!.num) / max * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </figure>
            );
          })}
        </div>
      )}
      <Answer {...context} text={figureTable(figures)} />
    </div>
  );
}

const library = createLibrary({
  components: [defineComponent({
    name: "FinancialAnswer",
    description: "Sourced financial figures as a table, cards, or comparison chart, always with an Excel table",
    props: richAnswerSchema,
    component: ({ props }) => <FinancialAnswer {...props} />,
  })],
  root: "FinancialAnswer",
});

export function RichAnswer({ data, ...context }: {
  data: ReturnType<typeof presentAnswer>;
  question: string;
  activeKey: string | null;
  onCite: (key: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <EvidenceContext.Provider value={context}>
      {failed ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground" role="status">De interactieve weergave kon niet worden geladen. Hieronder staan de cijfers als tabel.</p>
          <Answer {...context} text={data.fallback} />
        </>
      ) : <Renderer library={library} onError={(errors) => { if (errors.length) setFailed(true); }} response={data.program} />}
    </EvidenceContext.Provider>
  );
}
