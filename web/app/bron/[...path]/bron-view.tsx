"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type DocMeta, docKey, SourceView } from "@/components/evidence";
import { type Citation, citationKey, parseHref } from "@/lib/citations";

export function BronView() {
  const href = usePathname();
  const quote = useSearchParams().get("q") ?? "";
  const c = useMemo((): Citation | null => {
    const source = parseHref(href);
    return source && { ...source, key: citationKey(href, quote), href, quote };
  }, [href, quote]);

  // Organisation and document type for a PDF page (title and site for a public one); a questionnaire field names its organisation itself.
  const [docs, setDocs] = useState<Record<string, DocMeta>>({});
  useEffect(() => {
    if (c?.kind === "doc") {
      fetch(`/digimv/public/documents/${c.docId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setDocs({ [docKey(c)]: { org: d.title, type: d.host, url: d.url } }))
        .catch(() => {});
    }
    if (c?.kind !== "page") return;
    fetch(`/digimv/documents/${c.year}/${c.docId}/meta`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDocs({ [docKey(c)]: { org: d.org_name, type: d.type } }))
      .catch(() => {});
  }, [c]);

  if (!c) return <p>Deze bronverwijzing klopt niet. Controleer de link.</p>;
  return <SourceView c={c} docs={docs} />;
}
