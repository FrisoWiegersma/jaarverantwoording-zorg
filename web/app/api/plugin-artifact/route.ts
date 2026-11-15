import { extractPluginArtifacts, mcpToolKey, pluginObjects } from "@/lib/plugins";
import { projectApi } from "@/lib/project-server";

/** Read metadata through the current user's own connection; never fetch a caller-supplied URL. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("designId") ?? "";
  if (!/^D[\w-]{10}$/.test(id)) return Response.json({ error: "Ongeldig ontwerp" }, { status: 400 });
  try {
    const plugins = await projectApi(req, "/plugins");
    const canva = plugins.find((p: { handle: string; enabled: boolean }) => p.handle === "canva" && p.enabled);
    if (!canva) return Response.json({ error: "Canva niet gekoppeld" }, { status: 404 });
    const result = await projectApi(req, `/plugins/${canva.id}/call`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "get-design", arguments: { design_id: id, user_intent: "Toon de titel en voorvertoning van deze presentatie." } }),
    });
    const artifact = extractPluginArtifacts("metadata", mcpToolKey("canva", "get-design"), result)[0];
    if (!artifact) return Response.json({ error: "Geen voorvertoning gevonden" }, { status: 404 });
    if (new URL(req.url).searchParams.has("pages")) {
      const result = await projectApi(req, `/plugins/${canva.id}/call`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get-design-pages", arguments: { design_id: id, user_intent: "Bekijk de slides van deze presentatie naast het gesprek." } }),
      });
      const unique = new Map<number, { url: string; number: number }>();
      for (const page of pluginObjects(result)) {
        const thumbnail = page.thumbnail as { url?: unknown } | undefined;
        const number = page.page_number ?? page.index;
        if (typeof number === "number" && typeof thumbnail?.url === "string" && thumbnail.url.startsWith("https://")) {
          unique.set(number, { number, url: thumbnail.url });
        }
      }
      artifact.pages = Array.from(unique.values()).sort((a, b) => a.number - b.number);
    }
    return Response.json(artifact, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Voorvertoning niet beschikbaar" }, { status: 502 }); }
}
