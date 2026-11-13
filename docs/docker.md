# Run with Docker

[Back to the README](../README.md)

## Start

The quickest way is the install script, which does the steps below and asks for your key:

```sh
curl -fsSL https://raw.githubusercontent.com/FrisoWiegersma/jaarverantwoording-zorg/main/install.sh | bash
```

Run it again to update. `JVZ_DIR` installs somewhere other than `~/jaarverantwoording-zorg`. To do it by hand, install Docker with the Compose plugin. You also need an API key for at least one AI provider: Gemini, Claude, DeepSeek, OpenAI, or any server that speaks the OpenAI API, such as Ollama. Scanned PDF pages are read by the first of Gemini, Claude or OpenAI that has a key, or by `OCR_MODEL`.

Clone the repository and, from its root:

```sh
cp .env.example .env
```

Edit `.env` and set the key of your provider (see [Configuration](#configuration)). Leave `APP_ORIGIN=http://localhost:3210` for a local installation.

```sh
docker compose up -d --build --wait
```

Open **http://localhost:3210** and create an account. Each person's conversations and projects are their own.

On first start, the API builds the organisation/document index in the background. Container health means the service is running; it does not mean every archive year has finished syncing. Watch the per-year `ok` lines:

```sh
docker compose logs -f api
```

Use Ctrl+C to stop watching logs; the containers keep running. Once signed in, you can also open `http://localhost:3210/digimv/health` to see the latest successful sync timestamp. If a year reports `FAILED`, inspect the error and retry indexing:

```sh
docker compose exec api .venv/bin/python api/digimv.py sync
```

Try this after indexing finishes:

> Toon de omzet van Stichting Basalt van 2021 tot en met 2024 in een grafiek.

PDFs and questionnaire answers are fetched as requested, so the initial sync does not download the full report archive. Chat and OCR call your AI provider and may incur its charges.

## What runs

| Service | Role | Host exposure |
| --- | --- | --- |
| `web` | Next.js chat, evidence views, Excel downloads | `127.0.0.1:3210` |
| `api` | FastAPI retrieval and document processing | Internal Compose network only |
| `digimv-data` volume | SQLite, PDFs, extracted pages | Persistent Docker volume |
| `web-data` volume | Accounts (`auth.db`) and the session secret for the built-in login | Persistent Docker volume |

The API image includes the SQLite tokenizer needed by the index and runs the offline Python self-check during its build. Both services have health checks and restart policies.

## Configuration

| Variable | Default | When to change it |
| --- | --- | --- |
| `GEMINI_API_KEY` | At least one provider | Gemini models in the chat |
| `ANTHROPIC_API_KEY` | | Claude Sonnet, Opus and Haiku 5.5 |
| `DEEPSEEK_API_KEY` | | DeepSeek V4 Pro and Flash |
| `OPENAI_API_KEY` | | OpenAI models: `OPENAI_MODELS` (default `gpt-6.1-sol,gpt-6.1-terra,gpt-6-astra`), optional `OPENAI_BASE_URL` |
| `OPENAI_COMPATIBLE_BASE_URL` | | Any OpenAI-compatible server (Ollama, OpenRouter, Mistral, Groq, vLLM), with `OPENAI_COMPATIBLE_MODELS`, `OPENAI_COMPATIBLE_API_KEY` and a name for the picker in `OPENAI_COMPATIBLE_NAME`. The models must support tool calls. Ollama on the Docker host is `http://host.docker.internal:11434/v1` |
| `OCR_MODEL` | | The model that reads scanned PDF pages, as `provider:model` (`google`, `anthropic`, `openai` or `compatible`), for example `compatible:qwen2.5vl:7b`. Default: Gemini 3.5 Flash Lite, else Claude Haiku 5.5, else OpenAI's gpt-6.1-terra, whichever has a key first. DeepSeek and the compatible server are only used when named here, and the model must read images |
| `APP_ORIGIN` | `http://localhost:3210` | The exact address users open; Excel source links must match it |
| `AUTH_MODE` | `builtin` | `cloudflare` when Cloudflare Access signs people in (see below) |
| `BETTER_AUTH_SECRET` | Made on first start | Set your own (`openssl rand -hex 32`) to manage it with your other secrets |
| `AUTH_ALLOWED_EMAILS` | Empty: anyone may sign up | Addresses or `@domains`, comma-separated, that may create an account |
| `AUTH_ALLOW_SIGNUP` | `true` | `false` closes sign-up once everyone has an account |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Override scanned-page OCR |
| `APP_VERSION` | `latest` | Optional local image tag for a release |

Keep `.env` out of git. The Docker build contexts exclude environment files, so keys are supplied at runtime rather than baked into images.

For remote access, use an authenticated reverse proxy or tunnel on the Docker host. Set `APP_ORIGIN` to the external HTTPS origin, for example `https://reports.example.com`, then recreate both services:

```sh
docker compose up -d web api
```

With the built-in login every page and endpoint except the login and landing page requires an account. The login does not send mail, so email addresses are not verified: `AUTH_ALLOWED_EMAILS` keeps out people who don't know an allowed address, and on a public address you should create the accounts and then set `AUTH_ALLOW_SIGNUP=false`. Projects and conversations belong to the account, not to its email address. The app has no rate limiting. Keep the loopback binding unless a different network arrangement is explicitly configured.

### Sign-in through Cloudflare Access

Set `AUTH_MODE=cloudflare` when Cloudflare Access protects the entire hostname, including `/api/*`, `/digimv/*`, and `/bron/*`. The app then has no login page and trusts the `cf-access-authenticated-user-email` header Cloudflare sets. Only use it behind Cloudflare Access: without it anyone can send that header and act as any user.

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

## Deploy main automatically

`deploy/auto-deploy.sh` deploys a git checkout at `~/jaarverantwoording-zorg` whenever `origin/main` moves and all GitHub checks on the new commit have passed. Each release is tagged with its short commit hash. If the build or health check fails, it rolls back to the previous commit and skips the bad one until a newer commit lands. It keeps the running images plus the four newest older tags. Install the timer once on the Docker host, as the user that owns the checkout:

```sh
cd ~/jaarverantwoording-zorg
systemctl --user link "$PWD/deploy/jaarverantwoording-deploy.service"
systemctl --user enable --now "$PWD/deploy/jaarverantwoording-deploy.timer"
loginctl enable-linger "$USER"   # keep user timers running without a login session
```

On an install from before the built-in login, the script adds `AUTH_MODE=cloudflare` to a `.env` that has no `AUTH_MODE`, because Cloudflare Access was the only way to sign in then and projects belong to those emails. Push to `main` and the new commit is live within about two minutes of the checks passing. Watch or trigger a run with:

```sh
journalctl --user -u jaarverantwoording-deploy -f
systemctl --user start jaarverantwoording-deploy
```

After a failed deploy, the unit shows as failed in `systemctl --user --failed`. To retry the same commit, delete `.git/deploy-failed`. After changing the unit files, run `systemctl --user daemon-reload`.

## Back up the data

Stop both services so the archive contains a consistent database and document cache. The backup is written to your current directory; keep it somewhere private and copy it off the Docker host.

```sh
docker compose stop web api
docker compose run --rm --no-deps -T api .venv/bin/python -c "import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz'); t.add('/app/data',arcname='data'); t.close()" > digimv-backup.tar.gz
docker compose run --rm --no-deps -T web cat /app/data/auth.db > auth-backup.db
docker compose up -d --wait
```

The first archive holds the API's data volume; `auth-backup.db` holds the accounts of the built-in login (skip that line with `AUTH_MODE=cloudflare`). To restore the accounts, put the file back in an empty `web-data` volume with `docker compose run --rm --no-deps -T web sh -c 'cat > /app/data/auth.db' < auth-backup.db`. Neither contains `.env`. Back up the environment file separately using your normal secret-storage process. Do not copy a live SQLite database alone while its WAL is being written.

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
- **A step shows *mislukt*:** every failed tool call is in the error log, with its input and error, also after a redeploy: `docker compose exec web tail -n 20 logs/errors.jsonl`. Filter on the chat ID from the `?gesprek=` URL to find one conversation.
- **Excel source links are missing or use the wrong host:** set `APP_ORIGIN` to the address used in the browser, including its port, and recreate `web`.
- **Tokenizer errors:** rebuild the supplied API image. A host Python installation may link an older SQLite even when its Python version is recent.
- **A PDF takes longer on first read:** the API may be downloading or OCR-processing it; later reads use the cache.
