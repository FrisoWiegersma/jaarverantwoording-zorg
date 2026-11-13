# Jaarverslagen zorg chat

Next.js chat with Gemini, DigiMV source evidence, OpenUI financial answers, and Excel export.
Use Node 24, as CI and the Docker image do (Node 26 stalls parallel Gemini calls), and npm. Start the Python API from the repository root:

```sh
uv run --env-file .env uvicorn main:app --app-dir api
```

In this directory, make the root `.env` available as `.env.local` (an untracked symlink works), then:

```sh
npm ci
npm run dev -- --port 3210
```

Open http://localhost:3210 and create an account on the login page: any email (it is not checked) and a password of
at least 10 characters. Accounts and the generated session secret live in `data/`; delete it to start over. With
`AUTH_MODE=cloudflare` there is no login and the app trusts Cloudflare Access's `cf-access-authenticated-user-email`
header, which you can send yourself with curl to act as someone.

Required: `GEMINI_API_KEY`. Optional: `DIGIMV_API` (default `http://127.0.0.1:8000`),
`APP_ORIGIN` (public origin used to validate Excel hyperlinks and sign-in requests; defaults to the request origin). The chat
model and its thinking level are picked in the prompt; `lib/models.ts` lists the choices the API route accepts.

The AI SDK stream carries DigiMV tools and a `present_answer` tool. The latter validates one figure
per row and produces an OpenUI `FinancialAnswer` program. The model chooses a table, cards, or chart.
Each view includes the source table and Excel controls. Charts separate posts and units; bars show
absolute magnitude, with negative values labelled and coloured red. The same rows produce a Markdown
fallback, so a rendering error does not hide the answer. OpenUI runs inside the existing chat with
the existing Gemini connection; no additional API key is required.

Light and dark modes follow the device setting. Conversations are saved on the server per account, and an answer keeps
running if the connection drops.

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

For Docker deployment and rollback, see the repository README.
