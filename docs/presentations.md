# Presentations with Presenton

[Presenton](https://github.com/presenton/presenton) (Apache-2.0) runs as one private Compose service, with its image pinned by digest. It appears alongside the other plugins as `@presenton` and is available by default when no other plugin is explicitly selected. Ask for a PowerPoint, a one-slide infographic, or a change to a previously created slide. Ordinary research questions do not create presentations.

The existing shadcn card, slide carousel and docked viewer display the actual exported slides. Mobile uses the existing drawer. There is no separate public editor, login or Canva quota. The agent can inspect complete slide object trees, edit individual elements or multiple slides through Presenton’s native design agent, add/delete/duplicate/reorder slides, rename the deck, and undo its last twenty edits. Exact object-tree updates support text, geometry, fonts, colours, backgrounds, charts and other renderer-supported elements without generating a new presentation. The native agent also browses Presenton’s reusable blocks, layouts and editable infographic catalog. PPTX and PDF downloads remain on the app's own authenticated origin.

## Setup

The installer creates `PRESENTON_PASSWORD` automatically. For a manual installation or an existing `.env`, append a random password once:

```sh
printf '\nPRESENTON_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env
docker compose up -d --build --wait
```

Keep the password across updates. Presenton bootstraps its internal service account from it. Do not expose Presenton's port: only the application API should reach it. The adapter logs in internally; users keep their existing app accounts. Set `GEMINI_API_KEY`; `PRESENTON_MODEL` defaults to `gemini-3.8-flash`, independently of the chat model. Model-provider usage still costs money. Image generation, community publishing, anonymous tracking and Mem0 are disabled.

Outside Compose, set `PRESENTON_URL` and `PRESENTON_PASSWORD` on the API, and configure the private Presenton instance with `AUTH_USERNAME=integration` and the same `AUTH_PASSWORD`. Never put the internal URL or password into a user-created remote MCP plugin: that separate plugin path continues to reject private addresses.

## Design

New decks use the app's own Presenton templates: five design families, each in a light (`-licht`: reports, print) and a dark (`-donker`: on screen) theme.

| Family | Look | For |
| --- | --- | --- |
| `jaarverslag` (default) | Inter, large key figures, soft cards | annual reports, supervisory boards |
| `consulting` | IBM Plex Sans, action titles, rules and outlines | boards, management, clients |
| `swiss` | Inter Tight, full accent blocks, huge figures | keynotes, strategy sessions |
| `editorial` | Fraunces serif, big quotes, warm paper | narrative analyses, public reports |
| `zorg` | Plus Jakarta Sans, soft rounded shapes | care providers, municipalities |

`presenton/build_templates.py` generates all ten from the same eleven layouts with the same slot names: cover, statement, one large figure, three figures, chart with findings, multi-year trend, comparison, breakdown, table, points and closing slide. Each family has its own cover, statement, hero and closing design plus abstract SVG art in `static/` (one variant per palette, swapped by `style_deck`). The generator also writes `presenton/templates/manifest.json`, which the API reads for template names, colours and fonts. Compose mounts each template folder into the Presenton container, which imports the templates at startup. Edit the generator, run `uv run python presenton/build_templates.py`, and restart Presenton; `tests/test_presenton_templates.py` fails when the committed JSON is out of date or a text slot cannot hold its `max_length`.

The 16 built-in Presenton templates stay available by name. After generation the API applies the deck palette (`palette` or `accent_color`, with brighter accents on dark), highlights one bar per chart, tidies tables and adds a footer with the real `/bron/` links from the supplied content. `general` also gets layout fixes; other built-in templates keep their own colours.

`review_presentation` reports `unsourced_number` for any figure on a slide that is not in the supplied content and is not a sum, difference or percentage of figures in it. It cannot catch invented explanations or wrong labels.

To judge a design change by eye, run `scripts/render_samples.py` in the API container (see its docstring); it renders fictitious sample decks and deletes them again.

## Files and privacy

The adapter stores owner-scoped local presentation IDs, remote task IDs, revisions and up to twenty source snapshots for undo in `DATA_DIR/chats.db`. Original Presenton data lives in `presenton-data`; downloaded exports live in `DATA_DIR/presentations/`. Back up both volumes and `.env`. No engine credentials, internal URLs or remote presentation IDs are sent to the browser. Metadata, thumbnails, PPTX and PDF routes all check the signed-in owner. Presentations created with private project permission are also bound to that project; revoking permission prevents subsequent file and tool access. In-flight provider requests cannot be recalled.

Generation starts once and returns a durable presentation ID. A bounded status tool waits on the existing task and can resume later. Native design edits also return a durable pending operation and use the same polling tool; competing edits are rejected while one runs. Restarted operations are marked uncertain rather than automatically replayed. `list_presentations` retrieves earlier tasks. Downloads appear only after the export bytes have been fetched and checked. Export requests cannot fetch caller-supplied URLs; redirects and paths outside the configured service's export directory are rejected.

## Limits

This integration supports new presentations and agent edits to presentations it created. Existing project PPTX uploads supply text, theme and layout references; they are not imported into Presenton's editor as exact editable replicas. There is no embedded drag-and-drop editor in this release. The tested PPTX export contains editable text, but some charts and designed groups are exported as SVG/images rather than native PowerPoint objects. Agent edits operate on Presenton's structured source and regenerate the affected export. A one-slide infographic uses the same slide engine, rather than adding another design service.

Run `PYTHONPATH=api uv run python tests/test_presentations.py` for ownership, consent, lifecycle and export-boundary checks, and `npm --prefix web test` for artifact merging and bounded async polling.

## Agent tools

| Tool | Control |
| --- | --- |
| `create_presentation` | Generate a new deck or one-slide infographic from supplied facts |
| `review_presentation` | Send actual rendered slide images to the chat model, with warnings for placeholders, small body text, missing visible sources and unsourced figures; check every slide before delivery |
| `get_presentation_async_job` | Wait on an existing generation task |
| `get_presentation` / `list_presentations` | Read the deck or find earlier work |
| `get_slide` | Read one complete slide, including its structured UI tree |
| `edit_slide` | Targeted AI edit of slide content |
| `edit_presentation` | Native Presenton agent with element/component, layout, table/chart, asset and infographic tools; reports whether the stored source actually changed |
| `update_slide` | Exact replacement of one slide’s UI tree, with optional content and speaker notes |
| `manage_slides` | Add, duplicate, delete, reorder and rename, with validated 1-based positions |
| `undo_edit` | Restore the previous source snapshot |
| `export_presentation` | PPTX/PDF export of current work |

Edits are serialized per owner and presentation. A snapshot is saved and old download metadata invalidated before a mutation, so a failed export cannot silently offer the previous version as the edited result. Use `undo_edit` or export again to recover from a partial failure. Direct image updates accept the current deck’s assets, built-in template assets, or validated public HTTPS image addresses.

For a sequence of edits, set `defer_export=true` on intermediate mutations and call `export_presentation` with `format=pptx` once at the end. This finalizes both the PowerPoint and PDF preview without rendering the whole deck after every intermediate change.

Generation favours image-free data layouts, readable body text and visible source labels. A successful export is not a quality verdict: the chat agent must inspect real rendered slides through `review_presentation` and fix concrete problems. Models without image support receive an explicit limitation instead of a claimed visual review. Automated warnings are heuristics; they do not prove the figures or layout are correct.
