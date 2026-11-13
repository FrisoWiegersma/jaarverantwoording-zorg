"""HTTP API over the DigiMV index and knowledge base. Run: uv run --env-file .env uvicorn api:app"""

import faulthandler
import json
import signal
import sqlite3
import threading
import traceback
from typing import Annotated
from contextlib import asynccontextmanager, closing
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

import datasets
import digimv
import documents
import projects
import project_files
import sources

# A frozen API logs nothing (uvicorn skips requests whose caller gave up), so on a freeze run
# `docker compose kill -s SIGUSR1 api` and `docker compose logs api` shows where every thread is stuck.
faulthandler.register(signal.SIGUSR1, all_threads=True)


def _refresh(stop):
    """Corrections and new filings get published all the time: re-sync the index once it is a day old, checked
    hourly for as long as the API runs (not only at startup). The old index stays readable meanwhile."""
    while not stop.is_set():
        last = digimv.last_sync()
        if not last or datetime.fromisoformat(last) < datetime.now(timezone.utc) - timedelta(hours=24):
            try:
                digimv.sync()
            except Exception:  # an upstream failure must not end the loop; retried within the hour
                traceback.print_exc()
        stop.wait(3600)


@asynccontextmanager
async def lifespan(app):
    # A copied index can open on older SQLite even when its trigram tokenizer cannot run.
    digimv.search("zorg", limit=1)
    stop = projects.start_worker()
    threading.Thread(target=_refresh, args=(stop,), daemon=True).start()
    yield
    stop.set()


app = FastAPI(title="DigiMV jaarverantwoording", lifespan=lifespan)
app.include_router(projects.router)
app.include_router(project_files.router)


@app.middleware("http")
async def private_boundary(request: Request, call_next):
    import os
    from fastapi.responses import JSONResponse
    private = request.url.path.startswith(("/projects", "/chats"))
    if private and request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        expected = os.environ.get("APP_ORIGIN", "http://localhost:3210").rstrip("/")
        if request.headers.get("sec-fetch-site") == "cross-site" or (origin and origin.rstrip("/") != expected):
            return JSONResponse({"detail": "Ongeldige aanvraagherkomst"}, status_code=403)
    if request.method == "POST" and request.url.path.startswith("/projects/") and request.url.path.endswith("/documents"):
        length = request.headers.get("content-length", "")
        if not length.isdigit():
            return JSONResponse({"detail": "Content-Length vereist voor uploads"}, status_code=411)
        if int(length) > projects.MAX_FILE + 1024 * 1024:
            return JSONResponse({"detail": "Maximaal 25 MB per PDF"}, status_code=413)
    response = await call_next(request)
    if private:
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


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


def _source(fn, *args, **kwargs):
    """The same status codes for every source: bad input 400, not found 404, upstream down or changed 502."""
    try:
        return fn(*args, **kwargs)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except KeyError as e:
        raise HTTPException(404, str(e.args[0]) if e.args else "not found")
    except (RuntimeError, OSError) as e:
        raise HTTPException(502, str(e))


@app.get("/orgs/{org_id}/key-figures")
def key_figures_series(org_id: str, years: str | None = None):
    """Key figures for several years at once: years=2021,2022,2023, or every indexed year from 2020."""
    try:
        wanted = [int(y) for y in years.split(",")] if years else None
    except ValueError:
        raise HTTPException(400, "years must look like 2021,2022")
    return _source(digimv.key_figures_series, org_id, wanted)


@app.get("/register/search")
def register_search(naam: str | None = None, postcode: str | None = None, kvk: str | None = None):
    """Live LRZa search; at most 50 hits plus the total, `truncated` when there are more."""
    return _source(sources.search_register, naam, postcode, kvk)


@app.get("/register/{kvk}")
def register(kvk: str):
    """An organisation's entry in the Landelijk Register Zorgaanbieders (AGB, Wtza, permit, branches)."""
    return _source(sources.register, kvk)


@app.get("/kvk/{kvk}")
def kvk_basics(kvk: str):
    """A BV's or NV's basics in the KVK Handelsregister open data: status, legal form, start date, SBI, postcode region.
    No name or address. KVK allows one request per minute, so an uncached number can wait up to a minute."""
    return _source(sources.kvk_basics, kvk)


@app.get("/lei/search")
def lei_search(q: str, country: str = "NL"):
    """Live LEI search by name (every word must match), with KvK number where registered there."""
    return _source(sources.search_lei, q, country)


@app.get("/lei")
def lei(kvk: str | None = None, lei: str | None = None):
    """An LEI record by KvK number or LEI, with its reported direct and ultimate parent and direct children."""
    return _source(sources.lei_record, kvk, lei)


@app.get("/sanctions/search")
def sanctions_search(q: str, kind: str | None = None):
    """Possible matches on the EU financial sanctions list: every word of q in a name or alias."""
    return _source(sources.search_sanctions, q, kind)


@app.get("/iv3/bodies")
def iv3_bodies(q: str, kind: str | None = None, year: int | None = None):
    """Municipalities, joint arrangements, provinces and water boards by name or code."""
    return _source(sources.find_body, q, kind, year)


@app.get("/iv3/value/{table}/{code}/{report}/{taakveld}/{categorie}")
def iv3_value(table: str, code: str, report: str, taakveld: str, categorie: str):
    """One Iv3 cell: the evidence behind a /bron/iv3/ citation."""
    return _source(sources.iv3_value, table, code, report, taakveld, categorie)


@app.get("/iv3/{kind}/{year}/{code}")
def iv3(kind: str, year: int, code: str, taakveld: str | None = None, verslagsoort: str = "Jaarrekening",
        include_zero: bool = False):
    """A body's Iv3 cells (x € 1.000) per policy area and category, with each cell's /bron/iv3/ citation."""
    return _source(sources.iv3, kind, year, code, taakveld, verslagsoort, include_zero)


@app.get("/rulings/search")
def rulings_search(q: str, limit: int = 10, exact: bool = True):
    """Published court rulings that mention a phrase (rechtspraak.nl's own search)."""
    return _source(sources.search_rulings, q, limit, exact)


@app.get("/rulings/{ecli}")
def ruling(ecli: str, part: int = 1):
    """A ruling's metadata, summary and text from the official open data, one part at a time."""
    return _source(sources.get_ruling, ecli, part)


# ---------------------------------------------------------------- public documents and open data
# Under /public, not /docs: that is FastAPI's own API documentation.

@app.get("/public/woo")
def public_woo(q: str, organisatie: str | None = None, documentsoort: str | None = None, since: str | None = None,
               until: str | None = None, limit: int = 20, start: int = 0):
    """Woo documents on open.overheid.nl, with the organisation and document-type facets to narrow on."""
    return _source(documents.search_woo, q, organisatie, documentsoort, since, until, limit, start)


@app.get("/public/publications")
def public_publications(q: str, creator: str | None = None, gazette: str | None = None, since: str | None = None,
                        limit: int = 20, start: int = 1):
    """Official publications (gazettes, parliamentary papers) by full text, each with its PDF."""
    return _source(documents.search_publications, q, creator, gazette, since, limit, start)


@app.get("/public/regulations")
def public_regulations(q: str, creator: str | None = None, limit: int = 20, start: int = 1):
    """Local and regional regulations (CVDR), one record per version, with in_force."""
    return _source(documents.search_regulations, q, creator, limit, start)


@app.get("/public/tenders")
def public_tenders(q: str | None = None, buyer: str | None = None, cpv: str = "85000000", since: str | None = None,
                   limit: int = 20, page: int = 1, place: str | None = None, awarded: bool = False):
    """EU tender and award notices (TED) of Dutch buyers, newest first."""
    return _source(documents.search_tenders, q, buyer, cpv, "NLD", since, limit, page, place, awarded)


@app.get("/public/read")
def public_read(url: str, pages: str = "1-5", refresh: bool = False):
    """Any public document by URL (PDF, Word, HTML, XML), page by page, each page with its citation."""
    return _source(documents.read, url, pages, refresh)


@app.get("/public/documents/{doc_id}")
def public_document(doc_id: str):
    """A cached public document: title, original URL, host, page count. Behind a /bron/doc/ citation."""
    return _source(documents.document_meta, doc_id)


@app.get("/public/documents/{doc_id}/pdf")
def public_pdf(doc_id: str):
    """Our cached copy, inline: the original site may send it as a download, which loses #page=N."""
    path = _source(documents.document_pdf, doc_id)
    name = _source(documents.document_meta, doc_id)["file_name"]
    return FileResponse(path, media_type="application/pdf", filename=name, content_disposition_type="inline")


@app.get("/public/documents/{doc_id}/pages/{page}.png")
def public_page_png(doc_id: str, page: int, quote: list[str] = Query([])):
    """A public PDF's page as a PNG with the quotes highlighted; X-Mark and X-Found as for DigiMV pages."""
    png, mark, found = _source(digimv.render_page, _source(documents.document_pdf, doc_id), page, quote)
    return Response(png, media_type="image/png", headers={
        "X-Mark": ",".join(f"{v:.4f}" for v in mark or ()), "X-Found": found, "Cache-Control": "max-age=3600"})


@app.get("/public/documents/{doc_id}/parts/{page}")
def public_part(doc_id: str, page: int):
    """One page or part of a cached public document as text: what a /bron/tekst/ citation shows."""
    return _source(documents.document_part, doc_id, page)


@app.get("/public/tables/{table_id}/rows/{row}")
def public_table_row(table_id: str, row: int, part: list[str] = Query([])):
    """One row of a table read before, with its header: what a /bron/rij/ citation shows. part: ZIP member and/or sheet."""
    return _source(datasets.table_row, table_id, row, part[:2])


@app.get("/public/tables/{table_id}/file")
def public_table_file(table_id: str):
    """Our cached copy of a table, as a download: the site's own link may have expired."""
    path, name, ctype = _source(datasets.table_file, table_id)
    return FileResponse(path, media_type=(ctype or "").split(";")[0] or "application/octet-stream", filename=name)


@app.get("/public/links")
def public_links(url: str, q: str | None = None, limit: int = 100):
    """The links on a public web page, files first."""
    return _source(documents.links, url, q, limit)


@app.get("/public/search")
def public_search(q: str, url: str | None = None, limit: int = 20):
    """Word search in public documents read before, or in one document."""
    return _source(documents.search_text, q, url, limit)


@app.get("/datasets/search")
def datasets_search(q: str, limit: int = 20, start: int = 0):
    """Datasets in the national catalogue data.overheid.nl."""
    return _source(datasets.search_datasets, q, limit, start)


@app.get("/datasets/table")
def datasets_table(url: str, q: str | None = None, limit: int = 50, offset: int = 0, sheet: str | None = None,
                   header_row: int | None = None, refresh: bool = False, filters: str | None = None,
                   member: str | None = None, sort: str | None = None):
    """Rows of a CSV, Excel (.xlsx) or JSON file by URL, including ZIP/7z members, values verbatim."""
    try:
        flt = json.loads(filters) if filters else None
    except ValueError:
        raise HTTPException(400, 'filters must be JSON, e.g. {"KvkNummer":["61354740"]}')
    if flt is not None and not isinstance(flt, dict):
        raise HTTPException(400, 'filters must be a JSON object, e.g. {"KvkNummer":["61354740"]}')
    return _source(datasets.read_table, url, q, limit, offset, sheet, header_row, refresh, filters=flt, member=member,
                   sort=sort)


@app.get("/datasets/{dataset_id}")
def dataset(dataset_id: str):
    """One catalogue dataset with every resource."""
    return _source(datasets.get_dataset, dataset_id)


@app.get("/cbs/search")
def cbs_search(q: str, limit: int = 20):
    """CBS StatLine tables (opendata and dataderden) by words in id, title or summary."""
    return _source(datasets.search_cbs, q, limit)


@app.get("/cbs/{table_id}/values")
def cbs_values(table_id: str, filters: str | None = None, topics: str | None = None, limit: int = 200):
    """Values from a CBS table. filters is JSON, e.g. {"RegioS":["GM0546"],"Perioden":["2024JJ00"]}; topics=a,b."""
    try:
        flt = json.loads(filters) if filters else None
    except ValueError:
        raise HTTPException(400, 'filters must be JSON, e.g. {"RegioS":["GM0546"]}')
    if flt is not None and not isinstance(flt, dict):
        raise HTTPException(400, 'filters must be a JSON object, e.g. {"RegioS":["GM0546"]}')
    return _source(datasets.get_cbs, table_id, flt, topics.split(",") if topics else None, limit)


@app.get("/cbs/{table_id}/cell/{path:path}")
def cbs_cell(table_id: str, path: str):
    """One CBS value: a code per dimension in the table's order, then the topic. What a /bron/cbs/ citation shows."""
    *codes, topic = path.split("/")
    if not codes:
        raise HTTPException(400, "give a code per dimension, then the topic")
    return _source(datasets.cbs_cell, table_id, codes, topic)


@app.get("/cbs/{table_id}")
def cbs_table(table_id: str, dimension: str | None = None, q: str | None = None):
    """What a CBS table holds; with dimension, that dimension's codes matching q."""
    return _source(datasets.describe_cbs_table, table_id, dimension, q)


@app.get("/swing/{site}/search")
def swing_search(site: str, q: str, limit: int = 20):
    """Indicators on a Swing site (prognosemodelzw, waarstaatjegemeente) by words in code, name or description."""
    return _source(datasets.search_swing, site, q, limit)


@app.get("/swing/{site}/{indicator}")
def swing_values(site: str, indicator: str, geo_level: str | None = None, period: str | None = None,
                 q: str | None = None, dimension_levels: str = "", limit: int = 500):
    """Values for an indicator on a Swing site per area and period; or area levels and periods when omitted."""
    return _source(datasets.get_swing, site, indicator, geo_level, period, q, dimension_levels, limit)


# ---------------------------------------------------------------- saved conversations
# Their own file: a re-seeded digimv.db must not take anyone's conversations with it.

def _chats():
    # Initialise the shared private schema before the legacy chat connection opens.
    with projects.database():
        pass
    return sqlite3.connect(digimv.DATA / "chats.db", timeout=30)


def _user(request: Request):
    # ponytail: trusts Cloudflare Access's header, as the app is only reachable through the Access tunnel (Compose
    # binds to loopback). Verify Cf-Access-Jwt-Assertion if it ever gets another way in. Local dev: one shared list.
    return request.headers.get("cf-access-authenticated-user-email", "")


ChatId = Annotated[str, Path(min_length=1, max_length=100)]


class ChatIn(BaseModel):
    title: str = Field(max_length=300)
    messages: list[dict] = Field(min_length=1, max_length=200)
    project_id: str | None = None


@app.get("/chats")
def chats(request: Request, project_id: str | None = None):
    if project_id:
        with projects.database() as db:
            projects.project(db, project_id, projects.owner(request))
    with closing(_chats()) as db:
        rows = db.execute("SELECT id, title, updated FROM chats WHERE user=? AND project_id IS ? ORDER BY updated DESC LIMIT 100",
                          (_user(request), project_id)).fetchall()
    return [{"id": i, "title": t, "updated": u} for i, t, u in rows]


@app.get("/chats/{chat_id}")
def chat(request: Request, chat_id: ChatId):
    with closing(_chats()) as db:
        row = db.execute("SELECT title, updated, messages, project_id FROM chats WHERE user=? AND id=?",
                         (_user(request), chat_id)).fetchone()
    if not row:
        raise HTTPException(404, "conversation not found")
    if row[3]:
        with projects.database() as db:
            projects.project(db, row[3], projects.owner(request))
    return {"id": chat_id, "title": row[0], "updated": row[1], "messages": json.loads(row[2]), "project_id": row[3]}


@app.put("/chats/{chat_id}")
def save_chat(body: ChatIn, request: Request, chat_id: ChatId):
    if body.project_id:
        with projects.database() as db:
            projects.project(db, body.project_id, projects.owner(request))
    messages = json.dumps(body.messages, ensure_ascii=False)
    if len(messages) > 20_000_000:
        raise HTTPException(413, "conversation too large")
    updated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with closing(_chats()) as db, db:
        old = db.execute("SELECT project_id FROM chats WHERE user=? AND id=?", (_user(request), chat_id)).fetchone()
        if old and old[0] != body.project_id:
            raise HTTPException(409, "Dit gesprek hoort bij een andere werkruimte")
        db.execute("INSERT OR REPLACE INTO chats(user,id,title,updated,messages,project_id) VALUES (?,?,?,?,?,?)",
                   (_user(request), chat_id, body.title, updated, messages, body.project_id))
        if body.project_id:
            db.execute("UPDATE projects SET updated=? WHERE id=? AND owner=?", (updated, body.project_id, _user(request)))
    return {"id": chat_id, "updated": updated}


@app.delete("/chats/{chat_id}", status_code=204)
def delete_chat(request: Request, chat_id: ChatId):
    with closing(_chats()) as db, db:
        db.execute("DELETE FROM chats WHERE user=? AND id=?", (_user(request), chat_id))
