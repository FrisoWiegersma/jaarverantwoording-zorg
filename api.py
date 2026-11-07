"""HTTP API over the DigiMV index and knowledge base. Run: uv run --env-file .env uvicorn api:app"""

import json
import sqlite3
import threading
from typing import Annotated
from contextlib import asynccontextmanager, closing
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

import digimv


@asynccontextmanager
async def lifespan(app):
    # A copied index can open on older SQLite even when its trigram tokenizer cannot run.
    digimv.search("zorg", limit=1)
    last = digimv.last_sync()
    if not last or datetime.fromisoformat(last) < datetime.now(timezone.utc) - timedelta(hours=24):
        # corrections get re-published; refresh the index in the background, the old one stays readable meanwhile
        threading.Thread(target=digimv.sync, daemon=True).start()
    yield


app = FastAPI(title="DigiMV jaarverantwoording", lifespan=lifespan)


def _doc_or_404(fn, *args):
    try:
        return fn(*args)
    except KeyError as e:
        raise HTTPException(404, str(e.args[0]))
    except (RuntimeError, ValueError) as e:  # OCR / download failure upstream
        raise HTTPException(502, str(e))


@app.get("/health")
def health():
    return {"last_sync": digimv.last_sync()}


@app.get("/search")
def search(q: str, year: int | None = None, type: str | None = None, limit: int = 50):
    return digimv.search(q, year, type, limit)


@app.get("/orgs/{org_id}")
def org(org_id: str):
    hits = [o for o in digimv.search(org_id, limit=1) if o["org_id"] == org_id]
    if not hits:
        raise HTTPException(404, f"organisation {org_id} not in the index")
    return hits[0]


@app.get("/documents/{year}/{doc_id}")
def document(year: int, doc_id: int, pages: str | None = None):
    """Markdown pages (all by default). The first request downloads the document; each page converts on its first read."""
    try:
        digimv.parse_pages(pages, 1)  # syntax only: the page count comes with the document
    except ValueError:
        raise HTTPException(400, "pages must look like 1-5,8 or all")
    r = _doc_or_404(digimv.get_document, year, doc_id, pages)
    sel = digimv.parse_pages(pages, r["page_count"])
    return {**{k: v for k, v in r.items() if k != "pages"},
            "pages": [{"page": n, "source": r["page_sources"][n - 1], "markdown": r["pages"][n - 1]} for n in sel]}


@app.get("/documents/{year}/{doc_id}/meta")
def document_meta(year: int, doc_id: int):
    """Index metadata only (org name, type, ...): never downloads or converts. The chat's /bron page heading."""
    return _doc_or_404(digimv.get_doc, year, doc_id)


@app.get("/documents/{year}/{doc_id}/pdf")
def pdf(year: int, doc_id: int):
    d = _doc_or_404(digimv.get_doc, year, doc_id)
    path = _doc_or_404(digimv.get_pdf, year, doc_id)
    # inline: the chat UI opens it in a tab at #page=N instead of downloading it
    return FileResponse(path, media_type="application/pdf", filename=d["file_name"], content_disposition_type="inline")


@app.get("/documents/{year}/{doc_id}/pages/{page}.png")
def page_png(year: int, doc_id: int, page: int, quote: list[str] = Query([])):
    """Page as a PNG with the quotes highlighted (chat evidence panel).

    X-Mark: top,left,bottom,right of the highlights as page fractions, empty when nothing matched.
    X-Found: all | partial | none.
    """
    path = _doc_or_404(digimv.get_pdf, year, doc_id)
    png, mark, found = _doc_or_404(digimv.render_page, path, page, quote)
    return Response(png, media_type="image/png", headers={
        "X-Mark": ",".join(f"{v:.4f}" for v in mark or ()), "X-Found": found, "Cache-Control": "max-age=3600"})


@app.get("/kb/search")
def kb_search(q: str, org_id: str | None = None, year: int | None = None, doc_id: int | None = None, limit: int = 20):
    return digimv.search_text(q, org_id, year, doc_id, limit)


@app.get("/orgs/{org_id}/figures/{year}")
def figures(org_id: str, year: int, q: str | None = None, limit: int = 200):
    """Figures the organisation filed in its DigiMV questionnaire (2020+), verbatim; legal entity, not group."""
    try:
        return digimv.get_figures(org_id, year, q, limit)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except (RuntimeError, OSError) as e:  # DigiMV unreachable
        raise HTTPException(502, str(e))


@app.get("/orgs/{org_id}/key-figures/{year}")
def key_figures(org_id: str, year: int):
    """Omzet, resultaat, eigen vermogen, totaal activa and staff as filed in DigiMV (2020+): the organisation page."""
    try:
        return digimv.key_figures(org_id, year)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except (RuntimeError, OSError) as e:
        raise HTTPException(502, str(e))


# ---------------------------------------------------------------- saved conversations
# Their own file: a re-seeded digimv.db must not take anyone's conversations with it.

def _chats():
    digimv.DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(digimv.DATA / "chats.db", timeout=30)
    db.execute("CREATE TABLE IF NOT EXISTS chats("
               "user TEXT, id TEXT, title TEXT, updated TEXT, messages TEXT, PRIMARY KEY(user, id))")
    return db


def _user(request: Request):
    # ponytail: trusts Cloudflare Access's header, as the app is only reachable through the Access tunnel (Compose
    # binds to loopback). Verify Cf-Access-Jwt-Assertion if it ever gets another way in. Local dev: one shared list.
    return request.headers.get("cf-access-authenticated-user-email", "")


ChatId = Annotated[str, Path(min_length=1, max_length=100)]


class ChatIn(BaseModel):
    title: str = Field(max_length=300)
    messages: list[dict] = Field(min_length=1, max_length=200)


@app.get("/chats")
def chats(request: Request):
    with closing(_chats()) as db:
        rows = db.execute("SELECT id, title, updated FROM chats WHERE user=? ORDER BY updated DESC LIMIT 100",
                          (_user(request),)).fetchall()
    return [{"id": i, "title": t, "updated": u} for i, t, u in rows]


@app.get("/chats/{chat_id}")
def chat(request: Request, chat_id: ChatId):
    with closing(_chats()) as db:
        row = db.execute("SELECT title, updated, messages FROM chats WHERE user=? AND id=?",
                         (_user(request), chat_id)).fetchone()
    if not row:
        raise HTTPException(404, "conversation not found")
    return {"id": chat_id, "title": row[0], "updated": row[1], "messages": json.loads(row[2])}


@app.put("/chats/{chat_id}")
def save_chat(body: ChatIn, request: Request, chat_id: ChatId):
    messages = json.dumps(body.messages, ensure_ascii=False)
    if len(messages) > 20_000_000:
        raise HTTPException(413, "conversation too large")
    updated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with closing(_chats()) as db, db:
        db.execute("INSERT OR REPLACE INTO chats VALUES (?,?,?,?,?)",
                   (_user(request), chat_id, body.title, updated, messages))
    return {"id": chat_id, "updated": updated}


@app.delete("/chats/{chat_id}", status_code=204)
def delete_chat(request: Request, chat_id: ChatId):
    with closing(_chats()) as db, db:
        db.execute("DELETE FROM chats WHERE user=? AND id=?", (_user(request), chat_id))
