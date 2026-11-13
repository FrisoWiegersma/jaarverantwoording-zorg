# Projects: context, sources and conversations

Open **Projecten** in the chat header and create a project with a name. Its home contains a prompt and two tabs: **Gesprekken** and **Bronnen**. Add background and custom instructions through **Instructies**. Existing chats outside projects remain available.

The development endpoint `POST /projects/example` creates a private example project with two fictional Markdown knowledge files and one manually composed, cited conversation. It makes no model calls and contains no real healthcare-provider or client data.

## Sources and private processing

Under Bronnen, choose **Bronnen toevoegen**, then upload/drop a PDF or Markdown knowledge file (`.md`), or paste titled text. Markdown files use UTF-8 and are limited to 100,000 characters. A pasted note titled `context.md` is also a Markdown knowledge source. These files are retrieved as evidence, not executed as instructions. PDFs are limited to 25 MB and 200 pages. Invalid and password-protected files are rejected. Revisions become separate documents: citations keep pointing to their original sources. Archive excludes a document from future search while preserving older citations. This release has no destructive project/document deletion.

Text extraction and full-text search run locally. Document processing state is persistent; one background worker resumes interrupted jobs. Scanned pages remain viewable without OCR. Open a source to inspect its original page or text and search across local project sources. Search uses literal word prefixes rather than a vector database.

To keep a file found in chat, open its source citation and choose **Opslaan in project**, select a project, then choose
**Bestand opslaan**. This saves the original PDF or table file (including ZIP/7z archives), up to 25 MB; saving another
row or page from the same file reuses the existing project document. The copy remains downloadable when the public
URL expires. With project permission enabled, later chats can read saved PDFs and query saved tables, including
archive members, filters and sheets. Table answers cite private rows from that saved copy. Local source search
finds saved table filenames and provenance; table contents are queried through the project table reader.

**Projectcontext en bronnen gebruiken met het AI-model** defaults to off. Save the instructions to apply a permission change. While off, the app can inspect and search files locally and research public DigiMV information; project context and previous conversation contents are excluded from model input. Text you type directly as a chat question is sent to the chosen model's provider.

When enabled, project context, relevant source excerpts and scanned pages may be sent to the provider of the model chosen for the question, and scanned pages to Gemini for OCR. Pick a model whose provider may see this material. Calls, OCR retries and model steps recheck permission on the server. Turning permission off stops subsequent requests; it cannot recall data already sent or cancel an HTTP request in flight. The model can retrieve information but cannot edit sources or project settings.

Answers link to filename, physical PDF page and supporting quotation. Open yellow source citations to inspect the evidence. OCR-derived text and unmatched quotations are identified. Text matching proves only that a passage was found, not that the model's interpretation is correct. Reports and advisory decisions stay in the consultant's own workflow. Existing Excel exports remain available for numeric answers.

## Access, deployment and backup

Projects belong to the signed-in person: the built-in login or, with `AUTH_MODE=cloudflare`, Cloudflare Access. Either way the web app passes the owner to the API in the internal `cf-access-authenticated-user-email` header: the email Cloudflare Access verified, or with the built-in login the account's id. The built-in login does not verify email addresses, so it never uses one as the owner; it drops any such header from the browser and sets it from the session. Projects made under one mode are not visible under the other. Without a signed-in person there are no private projects. Each project belongs to one owner; sharing is not supported.

Keep the web service on loopback (behind Access in `cloudflare` mode), the API on the private Compose network, and ensure the gateway replaces caller-supplied identity headers. Public origin access or accepting forged headers invalidates this boundary. Match `APP_ORIGIN` to the exact browser origin on both services (default `http://localhost:3210`); cross-origin private mutations are rejected.

Projects, page text and conversations live in `DATA_DIR/chats.db`. Markdown and pasted-text originals are retained in the database and can be downloaded from their source view. PDF and saved table originals live in `DATA_DIR/private/`. These are private user data, separate from the public DigiMV cache. Back up the whole data volume consistently using the procedure in [docker.md](docker.md); preserve both the database and originals. Treat backups and exported spreadsheets as confidential. Archive is not erasure.

Use one API process: the background document worker assumes a single process. Add cross-process job claiming before scaling API workers. Run `PYTHONPATH=api uv run python tests/test_projects.py` and `tests/test_digimv.py` the same way, then frontend tests, lint, type checks and build. The Webpack fallback also uses the installed Tailwind loader when Turbopack's helper process cannot run in a restricted environment.
