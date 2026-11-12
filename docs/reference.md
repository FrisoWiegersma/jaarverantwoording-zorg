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

Errors from the other sources: 400 for bad input, 404 when the source does not hold it, 502 when the source failed.

The frontend also exposes `POST /api/chat`, `POST /api/xlsx`, and standalone evidence pages under `/bron/`. Export hyperlinks use these evidence pages, with the quote carried in the `q` parameter.

## MCP

The stdio server exposes `search_organizations`, `get_figures`, `get_key_figures`, `get_document`, `search_documents`, `get_register_entry`, `search_register`, `find_government_body`, `get_government_finances`, `search_rulings` and `get_ruling`, backed by the same retrieval functions as the HTTP API. The chat has the same tools.

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

Under `DATA_DIR` (locally `./data`, in Docker `/app/data`):

```text
digimv.db                          SQLite index, full-text tables, and the caches of sources.py
pdf/{year}/{id}.pdf                 Original PDFs
md/{org_id}/{year}/{id}.md          Markdown with page markers
md/{org_id}/{year}/{id}.pages.json   Per-page Markdown and extraction source
```

## Checks

```sh
uv run python test_digimv.py
uv run python test_sources.py
uv run python sources.py check   # live; not in CI
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The Python self-check and JavaScript unit tests run without provider credentials or archive downloads. The image build also runs the Python self-check. Frontend builds download the configured Google font. End-to-end chat checks require a real key and access to DigiMV.
