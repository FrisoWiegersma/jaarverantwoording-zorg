# Jaarverslagen zorg chat

Next.js chat with Gemini, DigiMV source evidence, OpenUI financial answers, and Excel export.
Use Node 24 or later and npm. Start the Python API from the repository root:

```sh
uv run --env-file .env uvicorn api:app
```

In this directory, make the root `.env` available as `.env.local` (an untracked symlink works), then:

```sh
npm ci
npm run dev -- --port 3210
```

Required: `GEMINI_API_KEY`. Optional: `CHAT_MODEL`, `DIGIMV_API` (default `http://127.0.0.1:8000`),
`APP_ORIGIN` (public origin used to validate Excel hyperlinks; defaults to the request origin).

The AI SDK stream carries DigiMV tools and a `present_answer` tool. The latter validates one figure
per row and produces an OpenUI `FinancialAnswer` program. The model chooses a table, cards, or chart.
Each view includes the source table and Excel controls. Charts separate posts and units; bars show
absolute magnitude, with negative values labelled and coloured red. The same rows produce a Markdown
fallback, so a rendering error does not hide the answer. OpenUI runs inside the existing chat with
the existing Gemini connection; no additional API key is required.

Light and dark modes follow the device setting. Chats live in the browser tab and are not saved.

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

For Docker deployment and rollback, see the repository README.
