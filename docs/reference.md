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

The frontend also exposes `POST /api/chat`, `POST /api/xlsx`, and standalone evidence pages under `/bron/`. Export hyperlinks use these evidence pages, with the quote carried in the `q` parameter.

## MCP

The stdio server exposes `search_organizations`, `get_figures`, `get_document`, and `search_documents`, backed by the same retrieval functions as the HTTP API.

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

Under `DATA_DIR` (locally `./data`, in Docker `/app/data`):

```text
digimv.db                          SQLite index and full-text tables
pdf/{year}/{id}.pdf                 Original PDFs
md/{org_id}/{year}/{id}.md          Markdown with page markers
md/{org_id}/{year}/{id}.pages.json   Per-page Markdown and extraction source
```

## Checks

```sh
uv run python test_digimv.py
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The Python self-check and JavaScript unit tests run without provider credentials or archive downloads. The image build also runs the Python self-check. Frontend builds download the configured Google font. End-to-end chat checks require a real key and access to DigiMV.
