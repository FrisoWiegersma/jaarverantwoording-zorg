# jaarverantwoording-zorg

Search the DigiMV archive of Dutch healthcare annual reports (2019–2025) properly. Pull any document as
Markdown, and build a knowledge base an agent can search.

Source: the public JSON API behind <https://digimv13.desan.nl/archive/search> (no auth):

| Call | Returns |
|---|---|
| `GET /api/ArchiveSearch/GetArchiveSearchResult?organization=&town=&year=2023` | full index for one year |
| `GET /api/ArchiveSearch/GetDocument?documentId=84870&year=2023` | the PDF |

Data notes:
- `org_id` is usually the KvK number, but not always (`GeenKvK012`, `Def_CMH`).
- Locations are sub-organisations and often reuse their parent's KvK.
- Document ids restart each year, so a document is always `(year, id)`.
- 2024/2025 list ~12k organisations each that have no documents.

## Use

```sh
uv run python digimv.py sync                      # index all years (~25 s, ~25 MB), prints a reconciliation table
uv run python digimv.py search "woonzorggroep"    # substring match on name/town/KvK, all years at once
uv run python digimv.py search 82905347 --type jaarrekening
uv run --env-file .env python digimv.py fetch --org 82905347 --year 2023   # download + convert -> Markdown
uv run --env-file .env python digimv.py fetch --doc 2023/84870
uv run python digimv.py text "eigen vermogen" --org 82905347               # full-text over OCR'd pages
uv run python digimv.py figures 28099814 2025 "som der bedrijfsopbrengsten"  # structured figures as filed (2020+)
uv run python digimv.py verify                    # cached PDFs/Markdown vs index (sizes, stale re-publications)
uv run python test_digimv.py                      # offline self-check
```

Conversion is mostly free. Pages with a text layer (about 90% of DigiMV documents) are read locally with `pymupdf4llm`:
exact characters, Markdown tables, ~0.5 s/page on CPU. Scanned pages go to Gemini (`GEMINI_API_KEY` in `.env`,
a paid key; pinned `gemini-3.5-flash-lite`, override with `GEMINI_MODEL`), one page per request, 16 in parallel:
a 42-page scan takes ~10 s. Flash-lite matched gemini-3.8-flash on all 764 numbers of a 42-page scan; the
`-latest` alias is avoided because it moved to a thinking model (28 s/page). A page counts as scanned when it
has an image and almost no *visible* text: invisible scanner-OCR layers and auditor stamps don't count.
Each page records its `source`, and the frontmatter lists `ocr_pages`. Documents are fetched on demand only:
the full corpus is 79k PDFs and 119 GB.

**Structured figures** (`get_figures`): every filing also contains the DigiMV questionnaire, with 600 to
1,200 answered fields per org-year (P&L, balance sheet, fte, WNT, production). The source is
`/api/Archive/GetArchiveData?externalOrganizationId=…&questionnaireName=DigiMV{year}`, available for 2020 and later.
- It is fetched on first request (~3 s) and stored in SQLite (`figures_fts`), searchable by label.
- Values are kept verbatim. Visibility follows DigiMV's own archive page (`isVisible`, not `archiveHidden`).
- Label templates show every branch ("Som der bedrijfsopbrengsten / Som der bedrijfsbaten") and never a guessed one.
- Answers without a question are kept, not dropped.
- **Groups** file two sets: the fields under "geconsolideerde jaarrekening" (variable ending in `Cons`) are the
  group totals, the "enkelvoudige jaarrekening" fields the legal entity alone. Everyone else leaves the consolidated
  fields at 0; `consolidated` in the result says which case it is. Checked against the PDFs: LUMC and HMC 2025
  match both their consolidated and their enkelvoudige statements, Basalt and Alrijne their single set.
- Field names change between years, so search by label, not by variable name.

**API**: `uv run --env-file .env uvicorn api:app` → `/search?q=`, `/orgs/{org_id}`, `/documents/{year}/{id}?pages=1-5`,
`/documents/{year}/{id}/pdf`, `/kb/search?q=`, `/orgs/{org_id}/figures/{year}?q=`, `/health`. Re-syncs the index on startup if it is older than 24 h.

**Chat** (`web/`, Next.js + Kokonut UI, Gemini via `GEMINI_API_KEY`; `web/.env` is a symlink to `../.env`): run the API, then
`cd web && npm run dev -- --port 3210`. Every figure links to `/documents/{year}/{id}/pages/{page}.png?quote=`, which renders
the PDF page with the quote highlighted (`X-Mark` = its box, `X-Found` = all | partial | none). `CHAT_MODEL` overrides `gemini-3.8-flash`.
Questionnaire figures cite `/bron/vragenlijst/{year}/{org_id}/{var}`. Every answer with figures ends in a table (one figure per row)
with **Kopieer voor Excel** (HTML with `x:num`, so numbers paste as numbers) and **Download als Excel** (`POST /api/xlsx`, ExcelJS).
Each Bron cell links to `/bron/…?q=<quote>`, a standalone page with the same evidence as the side panel.

OpenUI renders financial answers inside the existing chat: tables, summary cards, and comparison charts.
All three keep the same source table and Excel buttons. The separate `openui-agent/` directory is an
experimental weather agent, committed for reference and not deployed with the healthcare app.

**MCP** (stdio): `claude mcp add digimv -- uv run --env-file "$PWD/.env" --directory "$PWD" mcp_server.py`.
Tools: `search_organizations`, `get_figures`, `get_document` (the first call per document downloads + converts it),
`search_documents` (each hit includes its page heading, so consolidated and segment statements can be told apart).

## Data layout (`DATA_DIR`, default `./data`)

```
digimv.db                         index + full-text tables (SQLite, WAL)
pdf/{year}/{id}.pdf               original PDFs, size-checked against the index
md/{org_id}/{year}/{id}.md        Markdown with YAML frontmatter and <!-- page N --> markers (the knowledge base)
md/{org_id}/{year}/{id}.pages.json  per-page Markdown + source, so the .md can be rebuilt without re-running OCR
```

## Homelab deployment

Compose runs the Python API internally and publishes Next.js on `127.0.0.1:3210`. The host's
Cloudflare tunnel routes `https://jaarverantwoording-zorg.frisowiegersma.com` to `http://localhost:3210`,
protected by Cloudflare Access. Both services have health checks and restart automatically.
SQLite, PDFs and extracted pages live in the `digimv-data` Docker volume. Keep this volume on updates.

Host: `ssh frisowiegersma@100.114.142.121` (Tailscale `homelabfriso`).
Directory: `/home/frisowiegersma/jaarverantwoording-zorg`. Keep `.env` untracked and mode 600, with
`GEMINI_API_KEY` and optionally `CHAT_MODEL` / `GEMINI_MODEL`; credentials never enter the images.

Deploy a committed revision, using its short hash as `APP_VERSION`:

```sh
APP_VERSION=<commit> docker compose build
APP_VERSION=<commit> docker compose up -d --wait
docker compose ps
docker compose logs --tail=50
```

Keep the previous images and source revision. To roll back, restore that source revision and run
`APP_VERSION=<previous-commit> docker compose up -d --no-build --wait`. Never use `down -v`.
Before replacing an existing data volume, back it up with the API stopped. For a live SQLite copy,
use SQLite's backup API rather than copying the database without its WAL.
