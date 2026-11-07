# OpenUI experiment

A separate OpenUI/LangGraph weather agent used to explore generated interfaces and streaming tool calls.
It is kept here as an experiment. It is not the healthcare assistant, has no DigiMV retrieval tools,
and is not included in the root Compose stack or CI workflow.

The healthcare app lives in [`../web/`](../web/README.md), with its own small OpenUI component library.
See the [root README](../README.md) to run that app.

## Run this experiment

Use Node 24 or later, npm, and `GEMINI_API_KEY` in a local environment file. For a fresh checkout:

```sh
cp ../.env.example .env.local
# Set GEMINI_API_KEY in .env.local.
npm ci
npm run dev -- --port 3300
```

The development script generates the OpenUI component specification before starting Next.js.
The current implementation calls Gemini directly using its native LangChain client, runs the
LangGraph tool loop in-process, and renders with OpenUI's chat interface. Its example tool uses
Open-Meteo for weather. The model menu selects from the Gemini models listed in `src/lib/models.tsx`.

Chats live in the browser tab and are not persisted. There is no OpenUI Cloud conversation storage
or frontend-token endpoint in this implementation. Starter scripts for key generation and deployment
remain in `package.json`; they are not needed for the main app.
