"""HTTP API over the DigiMV index and knowledge base. Run: uv run --env-file .env uvicorn api:app"""

import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response

import digimv


@asynccontextmanager
async def lifespan(app):
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
    """Markdown pages (all by default). First request for a document downloads + converts it."""
    r = _doc_or_404(digimv.get_document, year, doc_id)
    try:
        sel = digimv.parse_pages(pages, r["page_count"])
    except ValueError:
        raise HTTPException(400, "pages must look like 1-5,8 or all")
    return {**{k: v for k, v in r.items() if k != "pages"},
            "pages": [{"page": n, "source": r["page_sources"][n - 1], "markdown": r["pages"][n - 1]} for n in sel]}


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
