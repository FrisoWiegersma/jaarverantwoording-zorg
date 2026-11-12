"""MCP server over the DigiMV index and knowledge base, the care-provider register (LRZa), CBS Iv3 government
accounts and court rulings. Run: uv run --env-file .env mcp_server.py (stdio)."""

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

import digimv
import sources


def _call(fn, *args):
    """Every failure reaches the agent as its message; the SDK hides other exceptions."""
    try:
        return fn(*args)
    except KeyError as e:
        raise ToolError(str(e.args[0]) if e.args else "not found") from e
    except (ValueError, RuntimeError, OSError) as e:
        raise ToolError(str(e)) from e


mcp = MCPServer(
    "digimv",
    instructions=(
        "Research tools for advisors and consultants on Dutch healthcare providers and the governments that fund "
        "them. Sources: DigiMV annual reports of care providers (search_organizations, get_figures, "
        "get_key_figures, get_document, search_documents); the care-provider register LRZa (get_register_entry, "
        "search_register: legal form, AGB codes, Wtza notification and permit, branches); the accounts of "
        "municipalities, joint arrangements, provinces and water boards as reported to CBS (find_government_body, "
        "get_government_finances, x € 1.000); and published court rulings (search_rulings, get_ruling). A DigiMV "
        "org_id of 8 digits is the KvK number the register uses. Every result says its source and scope: cite it, "
        "and report what a source does not hold instead of filling it in.\n"
        "Dutch healthcare annual reports (DigiMV jaarverantwoording, 2019-2025). Workflow: search_organizations "
        "to find the org (org_id) and its documents. For figures (omzet, resultaat, eigen vermogen, activa, fte, "
        "WNT, ...) call get_figures(org_id, year, query) first: the values the organisation filed itself, exact, "
        "in seconds, 2020 onwards. consolidated=true means a group: the fields under 'geconsolideerde jaarrekening' "
        "(var ending in Cons) are the group totals, the 'enkelvoudige jaarrekening' ones the legal entity alone; "
        "query e.g. 'geconsolideerd som der bedrijfsopbrengsten' or 'geconsolideerd vermogen' (a group's equity is "
        "'Groepsvermogen'). For 2019, figures the questionnaire doesn't have, or the story behind a number, use "
        "get_document(year, doc_id) and search_documents. When a document and the questionnaire differ, report "
        "both and say which is which. Cite the source: figure label + year, or year/doc_id + page.\n"
        "Reading Dutch healthcare accounts: total revenue ('omzet') is 'Som der bedrijfsopbrengsten' (= 'Netto "
        "omzet' + 'Overige bedrijfsopbrengsten'). Groups report several statements: use the 'geconsolideerde "
        "winst- en verliesrekening', not 'enkelvoudige' (parent only) or 'gesegmenteerde' (per segment) ones, "
        "and search for that heading rather than the revenue line itself. Always check the unit in the column "
        "header ('x € 1.000' vs whole euros). Some organisations file everything as one 'Verzameldocument' "
        "instead of a 'Jaarrekening', so don't filter on doc_type too early."
    ),
)


@mcp.tool()
def search_organizations(query: str, year: int | None = None, doc_type: str | None = None, limit: int = 10) -> list[dict]:
    """Find organisations by name, town or KvK number (substring match, all years at once).

    Returns per organisation: org_id (usually the KvK number), name, town, former names, parent org, the years it
    filed, and its documents (year, id, type, file name, size, published date). doc_type is a prefix filter such as
    "Jaarrekening", "Bestuursverslag", "Accountantsverklaring". Free and instant.
    """
    return digimv.search(query, year, doc_type, limit)


@mcp.tool()
def get_figures(org_id: str, year: int, query: str | None = None, limit: int = 50) -> dict:
    """Figures an organisation filed in its DigiMV questionnaire for one year (2020 onwards), verbatim.

    Every answered field with its Dutch label path, e.g. "Winst- en verliesrekening › Som der bedrijfsopbrengsten
    › Bedrag in euro's boekjaar" (boekjaar = this year, vorig boekjaar = prior year), its value as filed and its
    unit (€, %, fte; amounts are whole euros). Groups (consolidated=true) file two sets: 'geconsolideerde
    jaarrekening' fields (var ending in Cons) for the group, 'enkelvoudige jaarrekening' for the legal entity alone.
    query keeps fields whose label contains every word (substring, accents ignored), e.g.
    "som der bedrijfsopbrengsten", "totaal activa", "eigen vermogen", "aantal fte", "wnt". Non-zero values come
    first. First call per org/year takes ~3 s, then cached. found=false means no questionnaire for that year.
    """
    try:
        return digimv.get_figures(org_id, year, query, limit)
    except (ValueError, RuntimeError, OSError) as e:
        raise ToolError(str(e)) from e


@mcp.tool()
def get_document(year: int, doc_id: int, pages: str = "1-5") -> dict:
    """Read a document (identified by year AND doc_id; ids restart every year) as Markdown, a page range at a time.

    pages: e.g. "1-5", "12", "3,7-9" or "all". The result has page_count, so request further pages as needed;
    a jaarrekening is typically 15-60 pages, the balance sheet and income statement usually in the first third.
    The first call for a document downloads it and OCRs scanned pages through paid Gemini (~10 s and a fraction
    of a cent per page), so don't open documents speculatively. Text-layer pages convert locally on their first
    read, about a second a page: ask for the pages you need. Later calls are cached. Each page's `source` says whether its text came from the PDF's own text layer ("text",
    exact) or from OCR (model name); for OCR pages double-check key figures against totals on the same page.
    """
    try:  # ToolError reaches the agent with its message; other exceptions are hidden by the SDK
        r = digimv.get_document(year, doc_id, pages)
        sel = digimv.parse_pages(pages, r["page_count"])
    except KeyError as e:
        raise ToolError(e.args[0]) from e
    except (RuntimeError, ValueError, OSError) as e:
        raise ToolError(str(e)) from e
    meta = {k: r[k] for k in ("year", "id", "org_id", "org_name", "type", "file_name", "published", "url",
                              "page_count", "pdf_path", "md_path")}
    return {**meta, "pages": [{"page": n, "source": r["page_sources"][n - 1], "markdown": r["pages"][n - 1]}
                              for n in sel]}


@mcp.tool()
def search_documents(query: str, org_id: str | None = None, year: int | None = None, doc_id: int | None = None,
                     limit: int = 20) -> list[dict]:
    """Full-text search (word prefixes) in documents already converted to Markdown, with page-level snippets.

    With year and org_id (or doc_id) it searches that organisation's documents of that year, opening them first if
    needed; without, only documents opened before. Use it to locate e.g. "eigen vermogen", "personeelskosten" or
    "WNT" inside a report, then read that page with get_document.
    Each hit has the page `heading`, e.g. "Geconsolideerde winst- en verliesrekening over 2025 (x 1.000)":
    use it to tell consolidated, enkelvoudige and gesegmenteerde statements apart before quoting a number.
    """
    return digimv.search_text(query, org_id, year, doc_id, limit)


@mcp.tool()
def get_key_figures(org_id: str, years: list[int] | None = None) -> list[dict]:
    """Revenue (omzet), result, equity, total assets, fte and staff as filed in DigiMV, for several years at once.

    years: e.g. [2021, 2022, 2023]; empty means every indexed year from 2020. Per year the filed row (label, value,
    unit, var) for each figure that was filed; a group (consolidated=true) gets its group totals. A figure missing
    from a year was not filed (a genuine 0 also shows as missing): check it with get_figures before saying it is 0.
    """
    return _call(digimv.key_figures_series, org_id, years)


@mcp.tool()
def get_register_entry(kvk: str) -> dict:
    """An organisation's entry in the Landelijk Register Zorgaanbieders (LRZa), by 8-digit KvK number.

    Legal form, address, registration dates, SBI codes, AGB codes, Wtza notification, Wtza admission permit
    (toelatingsvergunning), branches (vestigingen) with their own AGB codes, Wzd/Wvggz locations and links to its
    accountability documents. Quote the permit text as given: 'nee' for an organisation from before 2025 can fall
    under transition rules. found=false: not in the register, which does not prove it provides no care. Cite `source`.
    """
    return _call(sources.register, kvk)


@mcp.tool()
def search_register(naam: str | None = None, postcode: str | None = None) -> dict:
    """Search the LRZa by (part of a) name or by postcode (2543 or 2543 SW). Returns at most 50 hits and the total;
    truncated=true means there are more, so narrow the search before saying who is or is not registered."""
    return _call(sources.search_register, naam, postcode)


@mcp.tool()
def find_government_body(query: str, kind: str | None = None) -> dict:
    """Find a municipality, joint arrangement (gemeenschappelijke regeling, e.g. a youth-care region or GGD),
    province or water board in the CBS Iv3 data by (part of a) name or code (GM0546, GR0842, PV28, WS12).

    kind: gemeenten | gemeenschappelijke-regelingen | provincies | waterschappen. Each hit lists the years it is in.
    """
    return _call(sources.find_body, query, kind)


@mcp.tool()
def get_government_finances(kind: str, year: int, code: str, taakveld: str | None = None,
                            verslagsoort: str = "Jaarrekening") -> dict:
    """A government body's own Iv3 report to CBS: amounts (x € 1.000) per policy area (taakveld) and category.

    taakveld narrows to a code prefix or words: "6.7" (Wmo and youth care in kind), "6.712" (Wmo begeleiding),
    "jeugdhulp". verslagsoort: Jaarrekening (default), Begroting, 1e-4e kwartaal. Each cell has soort Lasten
    (charges) or Baten (income): report them separately, never add them up. totals_computed sums a policy area's
    cells per soort on policy areas (not on balance posts, where they are mutations); null means no cell of that soort
    has a value. *_empty counts the cells without one.
    Category L4.3.3 is a transfer to a joint arrangement: youth care is often bought by the region, so look up that
    joint arrangement too. delivered=false: the body did not report this. empty_cells had nothing entered, mostly
    because the combination does not apply: not 0 and not missing data. Water boards report no split by function.
    Cite each amount with its href (/bron/iv3/...).
    """
    return _call(sources.iv3, kind, year, code, taakveld, verslagsoort)


@mcp.tool()
def search_rulings(query: str, limit: int = 10) -> dict:
    """Published Dutch court rulings that mention an exact phrase, such as an organisation's name. A mention does not
    make an organisation a party: read the ruling (get_ruling) before saying what it was about. truncated=true means
    more rulings match than were returned."""
    return _call(sources.search_rulings, query, limit)


@mcp.tool()
def get_ruling(ecli: str, part: int = 1) -> dict:
    """Read a court ruling by ECLI (e.g. ECLI:NL:CBB:2024:41) from the official open data: court, dates, case
    number, area of law, summary (inhoudsindicatie) and the text, one part of ~8,000 characters at a time (`parts`
    says how many). Natural persons are pseudonymised. Cite the deeplink in `source`."""
    return _call(sources.get_ruling, ecli, part)


if __name__ == "__main__":
    # ponytail: stdio only for now; mcp.run("streamable-http") when the homelab chat needs it
    mcp.run()
