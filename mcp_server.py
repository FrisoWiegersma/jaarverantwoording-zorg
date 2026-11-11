"""MCP server over the DigiMV index and knowledge base. Run: uv run --env-file .env mcp_server.py (stdio)."""

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

import digimv

mcp = MCPServer(
    "digimv",
    instructions=(
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


if __name__ == "__main__":
    # ponytail: stdio only for now; mcp.run("streamable-http") when the homelab chat needs it
    mcp.run()
