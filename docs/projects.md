# Projects: context, sources and conversations

Open **Projecten** in the chat header and create a project with a name. Its home contains a prompt and two tabs: **Gesprekken** and **Bronnen**. Add background and custom instructions through **Instructies**. Existing chats outside projects remain available.

The development endpoint `POST /projects/example` creates a private example project with two fictional Markdown knowledge files and one manually composed, cited conversation. It makes no model calls and contains no real healthcare-provider or client data.

## Sources and private processing

Under Bronnen, choose **Bronnen toevoegen**, then upload/drop a PDF or Markdown knowledge file (`.md`), or paste titled text. Markdown files use UTF-8 and are limited to 100,000 characters. A pasted note titled `context.md` is also a Markdown knowledge source. These files are retrieved as evidence, not executed as instructions. PDFs are limited to 25 MB and 200 pages. Invalid and password-protected files are rejected. Revisions become separate documents: citations keep pointing to their original sources. Archive excludes a document from future search while preserving older citations. This release has no destructive project/document deletion.

Text extraction and full-text search run locally. Document processing state is persistent; one background worker resumes interrupted jobs. Scanned pages remain viewable without OCR. Open a source to inspect its original page or text and search across local project sources. Search uses literal word prefixes rather than a vector database.

**Projectcontext en bronnen gebruiken met Gemini** defaults to off. Save the instructions to apply a permission change. While off, the app can inspect and search files locally and research public DigiMV information; project context and previous conversation contents are excluded from model input. Text you type directly as a chat question is sent to Gemini.

When enabled, project context, relevant source excerpts and scanned pages may be sent to the configured Gemini service. Calls, OCR retries and model steps recheck permission on the server. Turning permission off stops subsequent requests; it cannot recall data already sent or cancel an HTTP request in flight. The model can retrieve information but cannot edit sources or project settings.

Answers link to filename, physical PDF page and supporting quotation. Open yellow source citations to inspect the evidence. OCR-derived text and unmatched quotations are identified. Text matching proves only that a passage was found, not that the model's interpretation is correct. Reports and advisory decisions stay in the consultant's own workflow. Existing Excel exports remain available for numeric answers.

## Access, deployment and backup

Projects require a non-empty `cf-access-authenticated-user-email` from the trusted Cloudflare Access gateway. Anonymous local sessions can use public chat but cannot create/read private projects. Each project belongs to one owner; sharing is not supported.

Keep the web service on loopback behind Access, the API on the private Compose network, and ensure the gateway replaces caller-supplied identity headers. Public origin access or accepting forged headers invalidates this boundary. Match `APP_ORIGIN` to the exact browser origin on both services (default `http://localhost:3210`); cross-origin private mutations are rejected.

Projects, page text and conversations live in `DATA_DIR/chats.db`. Markdown and pasted-text originals are retained in the database and can be downloaded from their source view. PDF originals live in `DATA_DIR/private/`. These are private user data, separate from the public DigiMV cache. Back up the whole data volume consistently using the procedure in [docker.md](docker.md); preserve both the database and originals. Treat backups and exported spreadsheets as confidential. Archive is not erasure.

Use one API process: the background document worker assumes a single process. Add cross-process job claiming before scaling API workers. Run `.venv/bin/python test_projects.py` and `.venv/bin/python test_digimv.py`, then frontend tests, lint, type checks and build. The Webpack fallback also uses the installed Tailwind loader when Turbopack's helper process cannot run in a restricted environment.
