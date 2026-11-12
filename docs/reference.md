# CLI, API, and MCP reference

[Back to the README](../README.md) · [Docker setup](docker.md)

## Local development

Use Python 3.12 or later with a SQLite build supporting FTS5's accent-insensitive trigram tokenizer, Node 24 or later, and uv. Docker supplies the supported Python/SQLite environment if the system SQLite is older.

From the repository root:

```sh
cp .env.example .env
# Set GEMINI_API_KEY in .env.
uv sync --frozen
uv run python digimv.py sync
uv run --env-file .env uvicorn api:app
```

In another terminal:

```sh
cd web
ln -s ../.env .env.local
npm ci
npm run dev -- --port 3210
```

The symlink command is for Unix shells; copying the file to `web/.env.local` also works. Keep both files untracked. Local development defaults to the API on `http://127.0.0.1:8000`.

## CLI

```sh
uv run python digimv.py sync
uv run python digimv.py search "woonzorggroep"
uv run python digimv.py search 82905347 --type jaarrekening
uv run --env-file .env python digimv.py fetch --org 82905347 --year 2023
uv run --env-file .env python digimv.py fetch --doc 2023/84870
uv run python digimv.py text "eigen vermogen" --org 82905347
uv run python digimv.py figures 28099814 2025 "som der bedrijfsopbrengsten"
uv run python digimv.py verify
```

The other public sources have their own CLI, with JSON output:

```sh
uv run python sources.py register 28099814
uv run python sources.py register-search --naam basalt
uv run python sources.py bodies "Holland Rijnland"
uv run python sources.py iv3 gemeenten 2025 GM0546 6.7
uv run python sources.py rulings "Stichting Basalt"
uv run python sources.py ruling ECLI:NL:RBAMS:2019:441 --part 2
uv run python sources.py check      # live probe of every source

uv run python documents.py woo "jeugdzorg" --org "Nederlandse Zorgautoriteit"
uv run python documents.py gazettes 'tarief "zorg in natura"' --creator Leiden --gazette gmb
uv run python documents.py regulations jeugdhulp --creator Leiden
uv run python documents.py tenders jeugdhulp --since 2026-01-01
uv run --env-file .env python documents.py read https://zoek.officielebekendmakingen.nl/gmb-2026-312503.pdf --pages 1-3
uv run python documents.py search tarief --url <url read before>
uv run python documents.py check

uv run python datasets.py datasets wachtlijsten
uv run python datasets.py table https://example.org/subsidies.xlsx
uv run python datasets.py cbs "Wmo cliënten"
uv run python datasets.py check
```

`sync` prints a reconciliation table for each year. `fetch` downloads and converts documents on demand. `text` searches extracted pages; it does not search PDFs that have not yet been opened. `verify` checks cached files against the index for size, publication, and extraction-version mismatches.

## HTTP API

Through the frontend, prefix the following routes with `/digimv`. Inside Compose, the API is available to the frontend at `http://api:8000` and has no published host port.

| Route | Purpose |
| --- | --- |
| `GET /health` | Last successful index sync timestamp |
| `GET /search?q=...` | Organisation lookup; optional `year`, `type`, and `limit` |
| `GET /orgs/{org_id}` | Organisation metadata and documents |
| `GET /orgs/{org_id}/figures/{year}?q=...` | Filed questionnaire fields, optionally filtered by label/variable |
| `GET /documents/{year}/{id}?pages=1-5` | Extracted Markdown pages; downloads/converts on first read |
| `GET /documents/{year}/{id}/meta` | Index metadata without conversion |
| `GET /documents/{year}/{id}/pdf` | Original PDF |
| `GET /documents/{year}/{id}/pages/{page}.png?quote=...` | PDF page with quote highlighting; `X-Mark` and `X-Found` headers |
| `GET /kb/search?q=...` | Search extracted pages |
| `GET /orgs/{org_id}/key-figures?years=2022,2023` | Key figures for several years; default every indexed year from 2020 |
| `GET /register/{kvk}` | LRZa entry: legal form, AGB codes, Wtza notification and permit, branches |
| `GET /register/search?naam=...` | LRZa search by `naam` or `postcode`; at most 50 hits plus the total |
| `GET /iv3/bodies?q=...` | Municipalities, joint arrangements, provinces and water boards in CBS Iv3; optional `kind` |
| `GET /iv3/{kind}/{year}/{code}?taakveld=...` | A body's Iv3 cells; optional `verslagsoort` (default `Jaarrekening`) |
| `GET /iv3/value/{table}/{code}/{report}/{taakveld}/{categorie}` | One Iv3 cell, behind a `/bron/iv3/` citation |
| `GET /rulings/search?q=...` | Court rulings mentioning an exact phrase |
| `GET /rulings/{ecli}?part=1` | A ruling's metadata, summary and text in parts of about 8,000 characters |
| `GET /public/woo?q=...` | Woo documents (open.overheid.nl); optional `organisatie`, `documentsoort`, `since`, `until` (YYYY-MM-DD) |
| `GET /public/publications?q=...` | Gazettes and parliamentary papers with their PDF; optional `creator`, `gazette`, `since` |
| `GET /public/regulations?q=...` | Local and regional regulations (CVDR) with `in_force`; optional `creator` |
| `GET /public/tenders?q=...` | EU tenders and awards of Dutch buyers (TED); optional `buyer`, `cpv` (default 85000000), `since` |
| `GET /public/read?url=...&pages=1-5` | Any public PDF, Word, HTML or XML document, each page with its `cite` URL and `href`, its `/bron/doc/` (PDF) or `/bron/tekst/` (other kinds) citation |
| `GET /public/documents/{id}` | Title, site, original URL and page count of a public document read before, behind a `/bron/doc/` citation |
| `GET /public/documents/{id}/pdf` | Our cached copy of that PDF, shown inline |
| `GET /public/documents/{id}/pages/{page}.png?quote=...` | One page as an image, with the quote marked (`X-Mark`, `X-Found`) |
| `GET /public/documents/{id}/parts/{page}` | One page or part as text, behind a `/bron/tekst/` citation |
| `GET /public/links?url=...` | The links on a public page, files first; optional `q` |
| `GET /public/search?q=...` | Word search in public documents read before; optional `url` for one document |
| `GET /datasets/search?q=...` | Datasets in data.overheid.nl |
| `GET /datasets/{id}` | One dataset with every resource |
| `GET /datasets/table?url=...` | Rows of a CSV, XLSX or JSON file (also in a ZIP); optional `q`, `filters`, `offset`, `sheet`, `member`, `header_row`; `id` is our cached copy |
| `GET /public/tables/{id}/rows/{row}?part=...` | One row of that copy with its header, behind a `/bron/rij/` citation; `part` is the ZIP member and/or sheet |
| `GET /public/tables/{id}/file` | Our cached copy of the file, as a download |
| `GET /cbs/search?q=...` | CBS StatLine tables (opendata and dataderden) |
| `GET /cbs/{table}` | A table's topics and dimensions; `dimension` and `q` list one dimension's codes |
| `GET /cbs/{table}/values?filters={...}` | Values; `filters` is JSON (`{"RegioS":["GM0546"]}`), `topics=a,b` |
| `GET /cbs/{table}/cell/{code}/.../{topic}` | One value, a code per dimension in the table's order, behind a `/bron/cbs/` citation |

Errors from the other sources: 400 for bad input, 404 when the source does not hold it, 502 when the source failed.

The frontend also exposes `POST /api/chat`, `POST /api/xlsx`, and standalone evidence pages under `/bron/`. Export hyperlinks use these evidence pages, with the quote carried in the `q` parameter.

## MCP

The stdio server exposes `search_organizations`, `get_figures`, `get_key_figures`, `get_document`, `search_documents`, `get_register_entry`, `search_register`, `find_government_body`, `get_government_finances`, `search_rulings`, `get_ruling`, `search_woo`, `search_publications`, `search_regulations`, `search_tenders`, `read_document`, `list_links`, `search_public_documents`, `search_datasets`, `get_dataset`, `read_table`, `search_cbs`, `describe_cbs_table` and `get_cbs`, backed by the same retrieval functions as the HTTP API. The chat has the same tools.

Run it directly:

```sh
uv run --env-file .env mcp_server.py
```

For a Claude Code client, from the repository root:

```sh
claude mcp add digimv -- uv run --env-file "$PWD/.env" --directory "$PWD" mcp_server.py
```

## Data conventions

- Organisation IDs are often KvK numbers, but may also be strings such as `GeenKvK012`.
- Sub-organisations can reuse a parent's KvK. The index retains organisation/year/parent relationships.
- Document IDs restart per year. Always use `(year, document_id)` together.
- An indexed organisation may have no documents.
- Questionnaire fields are available from 2020 onwards. Labels can contain multiple template branches; the app preserves them rather than choosing a branch without evidence.
- Groups may file consolidated and single-entity accounts. `consolidated` in a tool result describes whether group fields were populated; it is not a replacement for reading the labels.
- An 8-digit DigiMV organisation ID is the KvK number the LRZa uses.
- LRZa: `toelatingsvergunning` is shown as the portal shows it. "Nee" for a provider registered before 2025 can mean transitional law, not a missing permit. A missing entry (`found: false`) does not prove the organisation provides no care. Entries are cached for 7 days, misses for 1 day.
- CBS Iv3 amounts are x € 1.000, as the body reported them. Charges (`Lasten`) and income (`Baten`) are separate categories and are never added together. The 2nd publication (`plaatsing`) is used when it exists. A cell without a value is not 0: CBS's table has every combination of area and category, and many don't apply. `delivered: false` means the whole report is empty. `totals_computed` sums a policy area's charges and income separately; `null` means no cell had a value. On balance-sheet posts, the categories are mutations and `Standen` are the opening and closing positions. Water boards report no split by function. Dimension keys are padded inconsistently, so they are always read from the table, never built by hand; a query above 10,000 rows is refused, so reports are fetched in chunks that are reconciled against their counts.
- Rulings: search is the website's own JSON (undocumented); text comes from the official open-data API. A mention does not make an organisation a party. Natural persons are pseudonymised, and not every ruling is published.
- Iv3 citations look like `/bron/iv3/{table}/{code}/{report}/{taakveld}/{categorie}`. Register entries and rulings are cited with their source URL.
- A page of a public PDF is cited as `/bron/doc/{id}/{page}`, where `id` is our cache key from `read_document`; the evidence panel shows our cached copy, since some sites (Menzis) only offer the file as a download. A part of a web page, Word or XML document is `/bron/tekst/{id}/{part}` (shown as text, the quote marked). A row of a data file is `/bron/rij/{id}/{member?}/{sheet?}/{row}`: `id` is our cached copy from `read_table` (the site's link may expire, as Zorginzicht's do), `row` the number a spreadsheet shows. A CBS StatLine value is `/bron/cbs/{table}/{code per dimension}/{topic}`, read from CBS again when shown. Prognosemodel values are cited with `source_url`; `present_answer` accepts only `/bron/` links, so the chat gives those as text.
- Search semantics differ per portal. Woo matches word forms, not phrases. Gazettes need every word, and `"quoted words"` as that phrase. CVDR needs every word and has no phrase search. CBS table search is substring on id, title and summary.
- Reading a URL: only public addresses, checked again after every redirect; a site's `robots.txt` is honoured, including `Crawl-delay` (RFC 9309: 4xx means no rules, 5xx means try later). KOOP's own file hosts (open.overheid.nl, repository.overheid.nl) are exempt: their APIs hand out those URLs.
- CBS: a value CBS left out is `{"value": null, "symbol": "x"}`, explained in `symbols`; a selection of 10,000 rows or more is refused.

Under `DATA_DIR` (locally `./data`, in Docker `/app/data`):

```text
digimv.db                          SQLite index, full-text tables, and the caches of sources.py
pdf/{year}/{id}.pdf                 Original PDFs
md/{org_id}/{year}/{id}.md          Markdown with page markers
md/{org_id}/{year}/{id}.pages.json   Per-page Markdown and extraction source
pub/{id}.pdf, pub/{id}.pages.json   Public documents read by URL (id = hash of the URL)
pub/tables/{id}                      Data files read with read_table, refreshed after a day
```

## Checks

```sh
uv run python test_digimv.py
uv run python test_sources.py
uv run python test_documents.py
uv run python sources.py check     # live; not in CI
uv run python documents.py check   # live
uv run python datasets.py check    # live
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The Python self-check and JavaScript unit tests run without provider credentials or archive downloads. The image build also runs the Python self-check. Frontend builds download the configured Google font. End-to-end chat checks require a real key and access to DigiMV.
