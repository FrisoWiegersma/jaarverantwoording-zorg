# Run with Docker

[Back to the README](../README.md)

## Start

Install Docker with the Compose plugin. You also need a Gemini API key for chat and scanned-page OCR.

From the repository root:

```sh
cp .env.example .env
```

Edit `.env` and set `GEMINI_API_KEY`. Leave `APP_ORIGIN=http://localhost:3210` for a local installation.

```sh
docker compose up -d --build --wait
```

Open **http://localhost:3210**.

On first start, the API builds the organisation/document index in the background. Container health means the service is running; it does not mean every archive year has finished syncing. Watch the per-year `ok` lines:

```sh
docker compose logs -f api
```

Use Ctrl+C to stop watching logs; the containers keep running. You can also open `http://localhost:3210/digimv/health` to see the latest successful sync timestamp. If a year reports `FAILED`, inspect the error and retry indexing:

```sh
docker compose exec api .venv/bin/python digimv.py sync
```

Try this after indexing finishes:

> Toon de omzet van Stichting Basalt van 2021 tot en met 2024 in een grafiek.

PDFs and questionnaire answers are fetched as requested, so the initial sync does not download the full report archive. Chat and OCR use the Gemini API and may incur provider charges.

## What runs

| Service | Role | Host exposure |
| --- | --- | --- |
| `web` | Next.js chat, evidence views, Excel downloads | `127.0.0.1:3210` |
| `api` | FastAPI retrieval and document processing | Internal Compose network only |
| `digimv-data` volume | SQLite, PDFs, extracted pages | Persistent Docker volume |

The API image includes the SQLite tokenizer needed by the index and runs the offline Python self-check during its build. Both services have health checks and restart policies.

## Configuration

| Variable | Default | When to change it |
| --- | --- | --- |
| `GEMINI_API_KEY` | Required | Your server-side provider key |
| `APP_ORIGIN` | `http://localhost:3210` | The exact address users open; Excel source links must match it |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Override scanned-page OCR |
| `APP_VERSION` | `latest` | Optional local image tag for a release |

Keep `.env` out of git. The Docker build contexts exclude environment files, so keys are supplied at runtime rather than baked into images.

For remote access, use an authenticated reverse proxy or tunnel on the Docker host. Set `APP_ORIGIN` to the external HTTPS origin, for example `https://reports.example.com`, then recreate both services:

```sh
docker compose up -d web api
```

Protect the entire hostname, including `/api/*`, `/digimv/*`, and `/bron/*`. The app does not implement its own user login or rate limiting. Keep the loopback binding unless a different network arrangement is explicitly configured.

## Stop, inspect, update

```sh
docker compose ps
docker compose logs --tail=50
docker compose stop
```

Start stopped containers with `docker compose up -d --wait`. `docker compose down` removes containers and the network while preserving the data volume. **Do not add `-v` unless you intend to delete the cached data.**

After updating the source checkout:

```sh
docker compose up -d --build --wait
```

For tagged local releases, use the same `APP_VERSION` when building and starting. Keep the previous source revision and images to roll back with `APP_VERSION=<previous-tag> docker compose up -d --no-build --wait`. Preserve the data volume when changing releases.

## Back up the data

Stop both services so the archive contains a consistent database and document cache. The backup is written to your current directory; keep it somewhere private and copy it off the Docker host.

```sh
docker compose stop web api
docker compose run --rm --no-deps -T api .venv/bin/python -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz'); t.add('/app/data',arcname='data'); t.close()" > digimv-backup.tar.gz
docker compose up -d --wait
```

This archive contains the data volume, not `.env`. Back up the environment file separately using your normal secret-storage process. Do not copy a live SQLite database alone while its WAL is being written.

## Restore without overwriting the old volume

These commands restore into a separate Compose project named `zorg-restored`. Use a new project name if that volume already contains data. Only restore an archive you trust.

Stop the original stack to free port 3210, leaving its data volume intact:

```sh
docker compose down
```

Restore into the new, empty volume:

```sh
docker compose -p zorg-restored run --rm --no-deps -T api .venv/bin/python -c "import sys,tarfile; from pathlib import Path; assert not any(Path('/app/data').iterdir()), 'Restore requires an empty data volume'; t=tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz'); t.extractall('/app',filter='data')" < digimv-backup.tar.gz
docker compose -p zorg-restored up -d --wait
```

Use `-p zorg-restored` for subsequent commands on this restored instance. Your original project's volume remains available if you need to switch back.

## Troubleshooting

- **No organisations found immediately after startup:** check the index sync logs and upstream connectivity.
- **A long answer ends without a result:** inspect `chat.finish` in the frontend logs. Research has a bounded budget and should finish with the available evidence or an explicit continuation message.
- **A phone loses its connection:** reopen the same conversation URL or choose it from history. Keepalive/replay protects network disconnects; container restarts still interrupt generation.
- **Chat fails:** check `docker compose logs web`, your key, and model access. Search itself does not require a key.
- **Excel source links are missing or use the wrong host:** set `APP_ORIGIN` to the address used in the browser, including its port, and recreate `web`.
- **Tokenizer errors:** rebuild the supplied API image. A host Python installation may link an older SQLite even when its Python version is recent.
- **A PDF takes longer on first read:** the API may be downloading or OCR-processing it; later reads use the cache.
