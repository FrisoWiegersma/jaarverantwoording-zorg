import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  hasToolCall,
  isToolUIPart,
  pruneMessages,
  validateUIMessages,
  streamText,
  toUIMessageStream,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { presentAnswer, richAnswerSchema } from "@/lib/rich-answer";
import { record, startAnswer, userOf } from "@/lib/streams";

const API = process.env.DIGIMV_API ?? "http://127.0.0.1:8000";
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

// Same domain notes as mcp_server.py, plus the citation contract the UI parses (lib/citations.ts).
const INSTRUCTIONS = `Je beantwoordt vragen over jaarverantwoordingen van Nederlandse zorgorganisaties (DigiMV-archief, 2019-2025). \
De vrager heeft geen financiële achtergrond. Antwoord in het Nederlands: kort, helder, in gewone taal.

Werkwijze
1. search_organizations om de organisatie (org_id) en haar documenten te vinden. Geen resultaat? Probeer een korter deel van de naam \
of de plaats ("Alrijne" in plaats van "Stichting Alrijne Zorggroep"). Het LUMC heet in het archief "Academisch Ziekenhuis Leiden".
2. Cijfers vanaf 2020 (omzet, resultaat, eigen vermogen, totaal activa, fte, WNT): eerst get_figures(org_id, year, query). Dat zijn de \
cijfers die de organisatie zelf in de DigiMV-vragenlijst invulde, exact en binnen seconden. Bedragen daarin zijn hele euro's; \
'boekjaar' is het gevraagde jaar, 'vorig boekjaar' het jaar ervoor. Staat consolidated op true, dan is het een groep: de velden onder \
'geconsolideerde jaarrekening' (var eindigt op Cons) zijn de cijfers van de hele groep, die onder 'enkelvoudige jaarrekening' alleen \
van de organisatie zelf. Zoek dan bijvoorbeeld "geconsolideerd som der bedrijfsopbrengsten" of "geconsolideerd vermogen" (het eigen \
vermogen van een groep heet groepsvermogen).
3. get_document voor 2019, voor wat niet in de vragenlijst staat en voor de uitleg achter een getal; een paginabereik tegelijk. De \
balans en de winst-en-verliesrekening staan meestal in het eerste derde deel. search_documents vindt de juiste pagina binnen een \
document dat al eens geopend is. Wijkt een cijfer in een document af van de vragenlijst, noem dan beide en zeg welk welk is.
4. Antwoord pas als je het getal zelf in een tooluitkomst hebt gelezen.
5. Bij een vervolgvraag zie je alleen de tooluitkomsten van de vorige vraag; oudere zijn weggelaten, je eigen antwoorden met hun \
bronlinks staan er nog wel. Heb je een ouder getal opnieuw nodig, vraag het dan opnieuw op (get_document met het jaar, doc_id en de \
pagina uit de link, of get_figures): dat gaat direct. Citeer nooit uit je geheugen.

Regels
- Noem nooit een bedrag, aantal of percentage dat je niet letterlijk in een tooluitkomst hebt gelezen. Rekenen mag (bijvoorbeeld \
een verschil), maar citeer dan de getallen waarmee je rekende.
- Zet direct achter elk getal een bronverwijzing, precies in een van deze twee formaten:
  uit een document:    [p. 12](/bron/2023/84870/12 "Eigen vermogen 108.256")
  uit de vragenlijst:  [DigiMV](/bron/vragenlijst/2025/28099814/qSomBedrijfsopbrengsten_0 "Som der bedrijfsopbrengsten 108179322")
  Bij een document is 2023 het jaar van het document, 84870 het doc_id en 12 de pagina; bij de vragenlijst het jaar, de org_id en \
de var van het veld. Tussen de aanhalingstekens staat een kort letterlijk citaat (hooguit 80 tekens): het label en het getal precies \
zoals ze er staan, zonder | of aanhalingstekens.
- Kijk naar de eenheid in de kolomkop (x € 1.000 of hele euro's) en noem die.
- Omzet is de 'Som der bedrijfsopbrengsten' (netto-omzet plus overige bedrijfsopbrengsten). Gebruik bij groepen de \
geconsolideerde cijfers, niet de enkelvoudige of gesegmenteerde.
- Sommige organisaties leveren alles aan als één 'Verzameldocument' in plaats van een 'Jaarrekening'. Filter dus niet te vroeg op type.
- Pagina's met source anders dan "text" zijn met OCR overgenomen: controleer belangrijke getallen tegen de totalen op die pagina.
- Kun je iets niet vinden, zeg dat dan eerlijk en vertel wat je wel vond. Gok nooit.
- Noem de organisatie, de bron (het soort document of de DigiMV-vragenlijst) en het jaar. Schrijf bedragen als € 1.234.567.
- Eindig elk antwoord met cijfers met een Markdown-tabel (die gaat zo naar Excel). Eén rij per getal, met de kolommen \
Organisatie (alleen bij meer dan één), Post, Jaar, Bedrag, Eenheid en Bron. Bedrag precies zoals in de bron (Nederlandse notatie, \
zonder €-teken), Eenheid zoals de bron die geeft ('€' voor de vragenlijst, bijvoorbeeld 'x € 1.000' uit een document), Bron de \
bronverwijzing van precies dat getal. Getalkolommen rechts uitgelijnd (---:). Zet nooit twee getallen in één rij of cel.`;

async function api(path: string, params: Record<string, string | number | null | undefined> = {}) {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `DigiMV API ${res.status}`);
  return body;
}

const tools = {
  present_answer: tool({
    description: "Present the final answer with OpenUI. Call once after reading the sources, for every answer containing figures. Supply the exact sourced figures, a short Dutch summary, and table/cards/chart. Do not repeat the answer afterwards.",
    inputSchema: richAnswerSchema,
    execute: async (data) => presentAnswer(data),
    toModelOutput: ({ output }) => ({ type: "text", value: output.fallback }),
  }),
  search_organizations: tool({
    description:
      "Find organisations by name, town or KvK number (substring match, all years at once). Returns per organisation: " +
      "org_id, name, town, former names, parent org, the years it filed, and its documents (year, id, type, file name, " +
      'published date). doc_type is a prefix filter such as "Jaarrekening", "Bestuursverslag", "Verzameldocument".',
    inputSchema: z.object({
      query: z.string(),
      year: z.number().int().optional(),
      doc_type: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    execute: async ({ query, year, doc_type, limit }) => {
      const orgs: { org_id: string; name: string; town: string; years: number[]; documents: Record<string, unknown>[] }[] =
        await api("/search", { q: query, year, type: doc_type, limit });
      return orgs.map((o) => ({
        ...o,
        documents: o.documents.map(({ year, id, type, file_name, published }) => ({ year, id, type, file_name, published })),
      }));
    },
  }),
  get_figures: tool({
    description:
      "Figures an organisation filed in its DigiMV questionnaire for one year (2020 onwards), verbatim, in seconds. Every " +
      "answered field with its Dutch label path, its value as filed (amounts in whole euros), unit and var (cite the var). " +
      'query keeps fields whose label contains every word, e.g. "som der bedrijfsopbrengsten", "totaal activa", ' +
      '"geconsolideerd vermogen", "fte", "wnt". consolidated=true means a group: the fields under "geconsolideerde ' +
      'jaarrekening" (var ending in Cons) are the group, the others the legal entity alone. found=false: nothing filed that year.',
    inputSchema: z.object({
      org_id: z.string(),
      year: z.number().int(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(60).default(25),
    }),
    execute: async ({ org_id, year, query, limit }) =>
      api(`/orgs/${encodeURIComponent(org_id)}/figures/${year}`, { q: query, limit }),
  }),
  get_document: tool({
    description:
      "Read a document (identified by year AND doc_id; ids restart every year) as Markdown, a page range at a time. " +
      'pages: e.g. "1-5", "12", "3,7-9". The result has page_count, so request further pages as needed. The first call ' +
      "for a document downloads it; each page converts on its first read, about a second a page, so ask for the pages you " +
      "need rather than long ranges. Each page's source says whether its " +
      'text came from the PDF text layer ("text", exact) or from OCR.',
    inputSchema: z.object({ year: z.number().int(), doc_id: z.number().int(), pages: z.string().default("1-5") }),
    execute: async ({ year, doc_id, pages }) => {
      const d = await api(`/documents/${year}/${doc_id}`, { pages });
      const { org_id, org_name, type, file_name, published, page_count } = d;
      return { year, doc_id, org_id, org_name, type, file_name, published, page_count, pages: d.pages };
    },
  }),
  search_documents: tool({
    description:
      "Full-text search (word prefixes) in documents already opened with get_document, with page-level snippets. " +
      'Use it to locate e.g. "eigen vermogen", "personeelskosten" or "WNT" inside a report, then read that page.',
    inputSchema: z.object({
      query: z.string(),
      org_id: z.string().optional(),
      year: z.number().int().optional(),
      doc_id: z.number().int().optional(),
    }),
    execute: async ({ query, org_id, year, doc_id }) => api("/kb/search", { q: query, org_id, year, doc_id, limit: 12 }),
  }),
};

/** The conversation, saved under its first question's id for the person asking (GET /chats in the DigiMV API). */
async function save(messages: UIMessage[], user: string) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return;
  const title = first.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ").slice(0, 200);
  await fetch(new URL(`/chats/${encodeURIComponent(first.id)}`, API), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(user && { "cf-access-authenticated-user-email": user }) },
    body: JSON.stringify({ title, messages }),
  }).catch(() => {}); // ponytail: a conversation that failed to save is only missing from the list
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id: unknown = body?.id;
  let messages: UIMessage[];
  try {
    if (typeof id !== "string" || !id || id.length > 100) throw new Error("id");
    if (!Array.isArray(body?.messages) || !body.messages.length || body.messages.length > 100) throw new Error("messages");
    messages = await validateUIMessages({ messages: body.messages, tools });
    if (messages.at(-1)?.role !== "user" || messages.some((m) => m.role !== "user" && m.role !== "assistant")) throw new Error("role");
  } catch {
    return Response.json({ error: "Ongeldige chatberichten." }, { status: 400 });
  }
  // A call cut off half-way (Stop, a dropped connection) has no result, and the model refuses a history with one.
  messages = messages
    .map((m) => ({ ...m, parts: m.parts.filter((p) => !isToolUIPart(p) || p.state === "output-available" || p.state === "output-error") }))
    .filter((m) => m.parts.length);
  const history = await convertToModelMessages(messages);
  // Only the previous question keeps its tool results (the pages it read): otherwise a long chat resends every page on
  // every step. Older answers and their /bron links stay, and re-reading a page is a cache hit in the API.
  const users = history.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const keep = users.length > 1 ? history.length - users[users.length - 2] : history.length;
  const user = userOf(req);
  // Not the request's signal: a phone that locks mid-answer gets the whole answer when it comes back.
  const answer = startAnswer(id, user);
  const result = streamText({
    model: google(process.env.CHAT_MODEL ?? "gemini-3.8-flash"),
    instructions: INSTRUCTIONS + "\nGebruik present_answer voor je uiteindelijke antwoord met cijfers, in plaats van zelf de eindtabel te schrijven. Kies chart bij een vergelijking of trend, cards bij enkele kerncijfers, anders table. De tool toont altijd de brontabel met Excel-knoppen. Geef elke rij de organisatie, post, het jaar, bedrag in Nederlandse notatie, eenheid, /bron/-link en letterlijk broncitaat. Schrijf na present_answer geen herhaling van de tabel.\nVergelijk je organisaties, geef dan hetzelfde cijfer bij elke organisatie precies dezelfde Post en Eenheid, liefst uit de DigiMV-vragenlijst (hele euro's): dan staan ze in één grafiek naast elkaar.",
    messages: pruneMessages({ messages: history, toolCalls: `before-last-${keep}-messages` }),
    tools,
    stopWhen: [isStepCount(14), hasToolCall("present_answer")],
    abortSignal: answer.stop.signal,
  });
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, originalMessages: messages, generateMessageId: generateId, onEnd: ({ messages }) => save(messages, user) }),
    // Long first reads of a report must not look like a dead connection to a proxy on the way.
    keepAliveMs: 15_000,
    consumeSseStream: ({ stream }) => record(id, answer, stream),
  });
}
