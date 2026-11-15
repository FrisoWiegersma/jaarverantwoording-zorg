"use client";

import { Download, ExternalLink, Maximize2, Presentation, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from "@/components/ui/carousel";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { mergePluginArtifacts, type PluginArtifact } from "@/lib/plugins";
import { cn } from "@/lib/utils";

export function AIPluginCard({ artifact: initial, active, onOpenSideViewer }: {
  artifact: PluginArtifact;
  active?: boolean;
  onOpenSideViewer: (artifact: PluginArtifact) => void;
}) {
  const [metadata, setMetadata] = useState<PluginArtifact | null>(null);
  useEffect(() => {
    if (!["canva", "presenton"].includes(initial.plugin) || !initial.designId) return;
    const controller = new AbortController();
    fetch(initial.plugin === "presenton" ? `/digimv/presentations/${initial.designId}` : `/api/plugin-artifact?designId=${encodeURIComponent(initial.designId)}`, { signal: controller.signal, cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((value) => { if (value) setMetadata(value); }).catch(() => {});
    return () => controller.abort();
  }, [initial.plugin, initial.designId, initial.thumbnailUrl]);
  const artifact = metadata && metadata.designId === initial.designId ? mergePluginArtifacts([initial, metadata])[0] : initial;
  const preview = Boolean(artifact.embedUrl || artifact.thumbnailUrl);
  return (
    <Card className={cn("my-4 min-w-0", active && "ring-2 ring-foreground")} data-no-copy="">
      {artifact.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- remote plugin preview
        <img alt="" className="aspect-video w-full object-cover" loading="lazy" src={artifact.thumbnailUrl} />
      )}
      <CardHeader>
        <CardTitle className="flex min-w-0 items-start gap-2 break-words [overflow-wrap:anywhere]">
          <Presentation aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {artifact.title}
        </CardTitle>
      </CardHeader>
      <CardFooter className="flex flex-wrap gap-2">
        {preview && <Button className="min-h-11" onClick={() => onOpenSideViewer(artifact)} type="button" variant="secondary">
          <Maximize2 aria-hidden="true" /> Bekijken
        </Button>}
        {artifact.downloadUrl && <Button asChild className="min-h-11">
          <a href={artifact.downloadUrl} rel="noopener noreferrer" target="_blank"><Download aria-hidden="true" />{artifact.format === "pptx" ? "Download PowerPoint" : "Download bestand"}</a>
        </Button>}
        {artifact.plugin !== "presenton" && <Button asChild className="min-h-11 max-w-full whitespace-normal" variant={preview ? "outline" : "default"}>
          <a href={artifact.url} rel="noopener noreferrer" target="_blank">Open in {artifact.pluginName}<ExternalLink aria-hidden="true" /></a>
        </Button>}
      </CardFooter>
    </Card>
  );
}

const WIDE = "(min-width: 1100px)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function PresentationSlides({ artifact, onDetails }: { artifact: PluginArtifact; onDetails: (value: PluginArtifact) => void }) {
  const [details, setDetails] = useState<PluginArtifact | null>(null);
  const [failed, setFailed] = useState(false);
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (artifact.pages?.length || !artifact.designId) return;
    const controller = new AbortController();
    fetch(artifact.plugin === "presenton" ? `/digimv/presentations/${artifact.designId}` : `/api/plugin-artifact?designId=${encodeURIComponent(artifact.designId)}&pages=1`, { signal: controller.signal, cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((value) => { setDetails(value); onDetails(value); }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [artifact.plugin, artifact.designId, artifact.pages, onDetails]);
  useEffect(() => {
    if (!api) return;
    const select = () => setIndex(api.selectedScrollSnap());
    api.on("select", select);
    return () => { api.off("select", select); };
  }, [api]);
  const pages = details?.pages?.length ? details.pages : artifact.pages?.length ? artifact.pages : artifact.thumbnailUrl ? [{ url: artifact.thumbnailUrl, number: 1 }] : [];
  const loading = !details && !artifact.pages?.length && !failed;
  return <div className="flex min-h-0 flex-1 flex-col justify-center overflow-auto bg-muted/20 p-3 sm:p-4">
    {pages.length > 0 && <Carousel aria-label="Presentatieslides" className="w-full" opts={{ loop: false }} setApi={setApi}>
      <CarouselContent>{pages.map((page) => <CarouselItem key={page.number}>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated Canva page previews */}
        <img alt={`Slide ${page.number} van ${pages.length}`} className="aspect-video max-h-[65dvh] w-full rounded-xl border bg-background object-contain" src={page.url} />
      </CarouselItem>)}</CarouselContent>
      <div className="mt-3 flex items-center justify-between gap-3">
        <CarouselPrevious aria-label="Vorige slide" className="static size-11" type="button" />
        <span aria-live="polite" className="text-sm text-muted-foreground">{index + 1} / {pages.length}</span>
        <CarouselNext aria-label="Volgende slide" className="static size-11" type="button" />
      </div>
    </Carousel>}
    {loading && <p className="mt-3 text-center text-sm text-muted-foreground" role="status">Slides laden…</p>}
    {(failed || (!loading && !pages.length)) && <p className="mt-3 text-center text-sm text-muted-foreground">De slides konden niet worden geladen. Download de presentatie of probeer het opnieuw.</p>}
  </div>;
}

function OtherPreview({ artifact }: { artifact: PluginArtifact }) {
  const [loaded, setLoaded] = useState(false);
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-muted/20 p-3 sm:p-4">
    {artifact.embedUrl ? <div className="relative min-h-64 flex-1 overflow-hidden rounded-xl border bg-background">
      {!loaded && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground" role="status">Voorvertoning laden…</p>}
      <iframe allowFullScreen className="absolute inset-0 size-full border-0" onLoad={() => setLoaded(true)} src={artifact.embedUrl} title={artifact.title} />
    </div> : artifact.thumbnailUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- remote plugin preview
      <img alt={artifact.title} className="m-auto max-h-full max-w-full rounded-xl object-contain" src={artifact.thumbnailUrl} />
    ) : <p className="m-auto text-sm text-muted-foreground">Geen voorvertoning beschikbaar. Open het bestand via de knop hierboven.</p>}
  </div>;
}

function Preview({ artifact, onDetails }: { artifact: PluginArtifact; onDetails: (value: PluginArtifact) => void }) {
  return ["canva", "presenton"].includes(artifact.plugin) && artifact.designId ? <PresentationSlides artifact={artifact} onDetails={onDetails} /> : <OtherPreview artifact={artifact} />;
}

export function AIPluginViewer({ artifact: initial, onClose }: { artifact: PluginArtifact | null; onClose: () => void }) {
  const [details, setDetails] = useState<PluginArtifact | null>(null);
  const sameVersion = initial && details && details.designId === initial.designId && (!initial.revision || !details.revision || initial.revision === details.revision);
  const artifact = initial && sameVersion ? mergePluginArtifacts([details, initial])[0] : initial;
  const previewKey = artifact ? `${artifact.id}:${artifact.revision ?? ""}` : "";
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);
  useEffect(() => {
    if (!wide || !artifact) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [wide, artifact, onClose]);
  const controls = artifact && <div className="flex shrink-0 items-center gap-1">
    {artifact.downloadUrl && <Button asChild className="min-h-11" variant="outline">
      <a aria-label="Download PowerPoint" href={artifact.downloadUrl} rel="noopener noreferrer" target="_blank"><Download aria-hidden="true" /><span className="hidden sm:inline">Download</span></a>
    </Button>}
    {artifact.plugin !== "presenton" && <Button asChild className="min-h-11" variant="outline">
      <a aria-label={`Open in ${artifact.pluginName}`} href={artifact.url} rel="noopener noreferrer" target="_blank">
        <span className="hidden sm:inline">Open in {artifact.pluginName}</span><ExternalLink aria-hidden="true" />
      </a>
    </Button>}
    <Button aria-label="Sluit voorvertoning" className="size-11" onClick={onClose} size="icon" type="button" variant="ghost"><X aria-hidden="true" /></Button>
  </div>;
  if (wide) return artifact ? <Card aria-label={`Voorvertoning: ${artifact.title}`} className="my-3 mr-3 w-[min(44rem,45vw)] shrink-0 gap-0 py-0" role="complementary">
    <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-3">
      <h2 className="min-w-0 truncate text-sm font-semibold" title={artifact.title}>{artifact.title}</h2>{controls}
    </div>
    <Preview artifact={artifact} key={previewKey} onDetails={setDetails} />
  </Card> : null;
  return <Drawer open={Boolean(artifact)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DrawerContent className="mx-auto h-[90dvh] max-h-[90dvh] max-w-3xl pb-[env(safe-area-inset-bottom)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <DrawerTitle className="min-w-0 truncate text-sm" title={artifact?.title}>{artifact?.title}</DrawerTitle>{controls}
      </div>
      <DrawerDescription className="sr-only">Voorvertoning van het bestand. Open het in de gekoppelde app om het te bewerken.</DrawerDescription>
      {artifact && <Preview artifact={artifact} key={previewKey} onDetails={setDetails} />}
    </DrawerContent>
  </Drawer>;
}
