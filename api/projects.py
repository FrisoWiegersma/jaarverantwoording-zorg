"""Owner-scoped consultant workspaces. Private content never enters the public index."""

import json
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime

import digimv
from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/projects")
MAX_FILE = 25 * 1024 * 1024


def now():
    return datetime.now(UTC).isoformat(timespec="seconds")


@contextmanager
def database():
    digimv.DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(digimv.DATA / "chats.db", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS projects(
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
      context TEXT NOT NULL, allow_private INT NOT NULL DEFAULT 0, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_documents(
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), filename TEXT NOT NULL,
      kind TEXT NOT NULL, pages INT NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
      archived INT NOT NULL DEFAULT 0, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_pages(
      document_id TEXT NOT NULL REFERENCES project_documents(id), page INT NOT NULL,
      text TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(document_id,page));
    CREATE VIRTUAL TABLE IF NOT EXISTS project_pages_fts USING fts5(
      text, document_id UNINDEXED, page UNINDEXED, tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS chats(
      user TEXT, id TEXT, title TEXT, updated TEXT, messages TEXT, PRIMARY KEY(user,id));
    """)
    if "project_id" not in {r[1] for r in db.execute("PRAGMA table_info(chats)")}:
        db.execute("ALTER TABLE chats ADD COLUMN project_id TEXT")
        db.commit()
    try:
        with db:
            yield db
    finally:
        db.close()


def owner(request):
    user = request.headers.get("cf-access-authenticated-user-email", "").strip()
    if not user:
        raise HTTPException(401, "Meld je aan om privéprojecten te gebruiken.")
    return user


def project(db, pid, user):
    row = db.execute("SELECT * FROM projects WHERE id=? AND owner=?", (pid, user)).fetchone()
    if not row:
        raise HTTPException(404, "Project niet gevonden")
    return row


def document(db, pid, did):
    row = db.execute("SELECT * FROM project_documents WHERE id=? AND project_id=?", (did, pid)).fetchone()
    if not row:
        raise HTTPException(404, "Document niet gevonden")
    return row


def path_for(did, kind="pdf"):
    # Only generated UUIDs reach the filesystem, never filenames or request paths.
    if not re.fullmatch(r"[a-f0-9]{32}", did):
        raise HTTPException(404, "Document niet gevonden")
    return digimv.DATA / "private" / f"{did}.{kind}"


def unpack(row):
    d = dict(row)
    d["allow_private"] = bool(d["allow_private"])
    return d


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    context: str = Field(default="", max_length=20000)
    allow_private: bool = False


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100000)


@router.get("")
def list_projects(request: Request):
    user = owner(request)
    with database() as db:
        return [
            dict(r)
            for r in db.execute(
                """SELECT p.id, p.name, p.updated,
                      (SELECT count(*) FROM project_documents d WHERE d.project_id=p.id AND d.archived=0) AS doc_count,
                      (SELECT count(*) FROM chats c WHERE c.project_id=p.id AND c.user=p.owner) AS chat_count
               FROM projects p WHERE p.owner=? ORDER BY p.updated DESC""",
                (user,),
            )
        ]


@router.post("", status_code=201)
def create_project(body: ProjectIn, request: Request):
    pid = uuid.uuid4().hex
    with database() as db:
        db.execute("INSERT INTO projects VALUES (?,?,?,?,?,?)", (pid, owner(request), body.name, body.context, body.allow_private, now()))
        return unpack(project(db, pid, owner(request)))


@router.get("/{pid}")
def get_project(pid: str, request: Request):
    with database() as db:
        return unpack(project(db, pid, owner(request)))


@router.put("/{pid}")
def update_project(pid: str, body: ProjectIn, request: Request):
    with database() as db:
        project(db, pid, owner(request))
        db.execute("UPDATE projects SET name=?,context=?,allow_private=?,updated=? WHERE id=?", (body.name, body.context, body.allow_private, now(), pid))
        if body.allow_private:
            db.execute("UPDATE project_documents SET status='queued' WHERE project_id=? AND status='needs_ocr'", (pid,))
        return unpack(project(db, pid, owner(request)))


@router.delete("/{pid}")
def delete_project(pid: str, request: Request):
    user = owner(request)
    doc_ids: list[str] = []
    with database() as db:
        project(db, pid, user)
        doc_ids = [r[0] for r in db.execute("SELECT id FROM project_documents WHERE project_id=?", (pid,))]
        for did in doc_ids:
            db.execute("DELETE FROM project_pages_fts WHERE document_id=?", (did,))
            db.execute("DELETE FROM project_pages WHERE document_id=?", (did,))
        db.execute("DELETE FROM project_documents WHERE project_id=?", (pid,))
        db.execute("DELETE FROM chats WHERE user=? AND project_id=?", (user, pid))
        db.execute("DELETE FROM projects WHERE id=? AND owner=?", (pid, user))
    for did in doc_ids:
        path_for(did).unlink(missing_ok=True)
    return {"ok": True}


@router.get("/{pid}/documents")
def documents(pid: str, request: Request, for_model: bool = False):
    with database() as db:
        p = project(db, pid, owner(request))
        if for_model and not p["allow_private"]:
            raise HTTPException(403, "Privémateriaal naar het AI-model is uitgeschakeld")
        return [
            dict(r)
            for r in db.execute(
                """SELECT d.*, (SELECT count(*) FROM project_pages p WHERE p.document_id=d.id) AS processed
                    FROM project_documents d WHERE project_id=? AND (?=0 OR archived=0) ORDER BY created DESC""",
                (pid, for_model),
            )
        ]


@router.post("/{pid}/documents", status_code=201)
async def upload(pid: str, request: Request, file: UploadFile = File(...)):
    with database() as db:
        project(db, pid, owner(request))
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > MAX_FILE:
            raise HTTPException(413, "Maximaal 25 MB per bestand")
    filename = (file.filename or "Document.pdf").replace("\\", "/").split("/")[-1][:200]
    if filename.lower().endswith(".md"):
        try:
            text = bytes(data).decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(400, "Gebruik een UTF-8 Markdown-bestand")
        if not text.strip() or len(text) > 100000 or "\x00" in text:
            raise HTTPException(400, "Gebruik Markdown-tekst met maximaal 100.000 tekens")
        return add_note(pid, NoteIn(title=filename, text=text), request)
    import pymupdf

    try:
        with pymupdf.open(stream=bytes(data), filetype="pdf") as pdf:
            if not bytes(data[:1024]).lstrip().startswith(b"%PDF-") or pdf.needs_pass or not 1 <= pdf.page_count <= 200:
                raise ValueError()
            pages = pdf.page_count
    except Exception:
        raise HTTPException(400, "Gebruik een geldige PDF zonder wachtwoord, met maximaal 200 pagina’s.")
    did = uuid.uuid4().hex
    target = path_for(did)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    try:
        with database() as db:
            db.execute(
                "INSERT INTO project_documents(id,project_id,filename,kind,pages,status,created) VALUES (?,?,?,?,?,'queued',?)",
                (did, pid, filename, "pdf", pages, now()),
            )
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return {"id": did}


@router.post("/{pid}/notes", status_code=201)
def add_note(pid: str, body: NoteIn, request: Request):
    did = uuid.uuid4().hex
    kind = "markdown" if body.title.lower().endswith(".md") else "note"
    with database() as db:
        project(db, pid, owner(request))
        db.execute(
            "INSERT INTO project_documents(id,project_id,filename,kind,pages,status,created) VALUES (?,?,?,?,1,'ready',?)", (did, pid, body.title, kind, now())
        )
        store_page(db, did, 1, body.text, kind)
    return {"id": did}


def store_page(db, did, page, text, source):
    db.execute("INSERT OR REPLACE INTO project_pages VALUES (?,?,?,?)", (did, page, text, source))
    db.execute("DELETE FROM project_pages_fts WHERE document_id=? AND page=?", (did, page))
    db.execute("INSERT INTO project_pages_fts VALUES (?,?,?)", (text, did, page))


@router.post("/{pid}/documents/{did}/retry")
def retry(pid: str, did: str, request: Request):
    with database() as db:
        project(db, pid, owner(request))
        d = document(db, pid, did)
        if d["kind"] == "pdf" and d["status"] not in ("queued", "processing"):
            db.execute("UPDATE project_documents SET status='queued',error='' WHERE id=?", (did,))
    return {"ok": True}


@router.post("/{pid}/documents/{did}/archive")
def archive(pid: str, did: str, request: Request):
    with database() as db:
        project(db, pid, owner(request))
        document(db, pid, did)
        db.execute("UPDATE project_documents SET archived=1 WHERE id=?", (did,))
    return {"ok": True}


@router.post("/{pid}/documents/{did}/unarchive")
def unarchive(pid: str, did: str, request: Request):
    with database() as db:
        project(db, pid, owner(request))
        document(db, pid, did)
        db.execute("UPDATE project_documents SET archived=0 WHERE id=?", (did,))
    return {"ok": True}


@router.delete("/{pid}/documents/{did}")
def delete_document(pid: str, did: str, request: Request):
    with database() as db:
        project(db, pid, owner(request))
        document(db, pid, did)
        db.execute("DELETE FROM project_pages_fts WHERE document_id=?", (did,))
        db.execute("DELETE FROM project_pages WHERE document_id=?", (did,))
        db.execute("DELETE FROM project_documents WHERE id=? AND project_id=?", (did, pid))
    path_for(did).unlink(missing_ok=True)
    return {"ok": True}


@router.get("/{pid}/documents/{did}/pages/{page:int}")
def read_page(pid: str, did: str, page: int, request: Request, for_model: bool = False):
    with database() as db:
        p = project(db, pid, owner(request))
        if for_model and not p["allow_private"]:
            raise HTTPException(403, "Privémateriaal naar het AI-model is uitgeschakeld")
        d = document(db, pid, did)
        row = db.execute("SELECT * FROM project_pages WHERE document_id=? AND page=?", (did, page)).fetchone()
        if not 1 <= page <= d["pages"]:
            raise HTTPException(404, "Pagina niet gevonden")
        return {
            "document_id": did,
            "filename": d["filename"],
            "kind": d["kind"],
            "page": page,
            "page_count": d["pages"],
            "text": row["text"] if row else "",
            "source": row["source"] if row else "pending",
            "href": f"/bron/project/{pid}/{did}/{page}",
        }


@router.get("/{pid}/documents/{did}/pdf")
def original(pid: str, did: str, request: Request):
    with database() as db:
        project(db, pid, owner(request))
        d = document(db, pid, did)
        if d["kind"] != "pdf":
            raise HTTPException(404)
        return FileResponse(path_for(did), media_type="application/pdf", filename=d["filename"], content_disposition_type="inline")


@router.get("/{pid}/documents/{did}/pages/{page}.png")
def page_image(pid: str, did: str, page: int, request: Request, quote: list[str] = Query([])):
    with database() as db:
        project(db, pid, owner(request))
        d = document(db, pid, did)
        if d["kind"] != "pdf" or not 1 <= page <= d["pages"]:
            raise HTTPException(404)
    png, mark, found = digimv.render_page(path_for(did), page, quote)
    return Response(png, media_type="image/png", headers={"X-Mark": ",".join(str(v) for v in mark or []), "X-Found": found})


@router.get("/{pid}/search")
def search(pid: str, request: Request, q: str = Query(max_length=500), for_model: bool = False):
    with database() as db:
        p = project(db, pid, owner(request))
        if for_model and not p["allow_private"]:
            raise HTTPException(403, "Privémateriaal naar het AI-model is uitgeschakeld")
        match = digimv._text_query(q)
        if not match:
            return []
        rows = db.execute(
            """SELECT f.document_id,f.page,d.filename,p.source,snippet(project_pages_fts,0,'','', ' … ',48) AS excerpt
          FROM project_pages_fts f JOIN project_documents d ON d.id=f.document_id
          JOIN project_pages p ON p.document_id=f.document_id AND p.page=f.page
          WHERE project_pages_fts MATCH ? AND d.project_id=? AND d.archived=0 ORDER BY rank LIMIT 12""",
            (match, pid),
        ).fetchall()
        return [{**dict(r), "href": f"/bron/project/{pid}/{r['document_id']}/{r['page']}"} for r in rows]


def require_consent(pid):
    with database() as db:
        if not db.execute("SELECT allow_private FROM projects WHERE id=?", (pid,)).fetchone()[0]:
            raise PermissionError("Privémateriaal naar het AI-model is uitgeschakeld")


def process_document(did):
    import pymupdf

    with database() as db:
        d = dict(db.execute("SELECT * FROM project_documents WHERE id=?", (did,)).fetchone())
        db.execute("UPDATE project_documents SET status='processing',error='' WHERE id=?", (did,))
    needs_ocr = False
    with pymupdf.open(path_for(did)) as pdf:
        for i, page in enumerate(pdf, 1):
            with database() as db:
                existing = db.execute("SELECT source FROM project_pages WHERE document_id=? AND page=?", (did, i)).fetchone()
                if existing and existing[0] != "needs_ocr":
                    continue
                allowed = db.execute("SELECT allow_private FROM projects WHERE id=?", (d["project_id"],)).fetchone()[0]
            scanned = digimv._is_scan(page)
            if scanned and not allowed:
                text, source = "", "needs_ocr"
                needs_ocr = True
            elif scanned:
                sub = pymupdf.open()
                sub.insert_pdf(pdf, from_page=i - 1, to_page=i - 1)
                # Recheck consent immediately before each external call, not once per job.
                with database() as db:
                    if not db.execute("SELECT allow_private FROM projects WHERE id=?", (d["project_id"],)).fetchone()[0]:
                        needs_ocr = True
                        continue
                text, source = digimv.ocr(sub.tobytes(), before_request=lambda: require_consent(d["project_id"]))
                sub.close()
            else:
                text, source = page.get_text(sort=True).strip(), "text"
            with database() as db:
                store_page(db, did, i, text, source)
    with database() as db:
        db.execute("UPDATE project_documents SET status=? WHERE id=?", ("needs_ocr" if needs_ocr else "ready", did))


def worker(stop):
    with database() as db:
        db.execute("UPDATE project_documents SET status='queued' WHERE status='processing'")
    while not stop.is_set():
        with database() as db:
            row = db.execute("SELECT id FROM project_documents WHERE status='queued' AND archived=0 ORDER BY created LIMIT 1").fetchone()
        if not row:
            stop.wait(1)
            continue
        try:
            process_document(row[0])
        except PermissionError:
            with database() as db:
                db.execute("UPDATE project_documents SET status='needs_ocr' WHERE id=?", (row[0],))
        except Exception:
            with database() as db:
                db.execute(
                    "UPDATE project_documents SET status='error',error=? WHERE id=?",
                    ("Verwerking mislukt. Controleer de PDF en OCR-configuratie en probeer opnieuw.", row[0]),
                )


def start_worker():
    stop = threading.Event()
    thread = threading.Thread(target=worker, args=(stop,), daemon=True)
    thread.start()
    return stop


@router.get("/{pid}/model-context")
def model_context(pid: str, request: Request):
    with database() as db:
        p = project(db, pid, owner(request))
        if not p["allow_private"]:
            raise HTTPException(403, "Privémateriaal naar het AI-model is uitgeschakeld")
        return {"context": p["context"]}


@router.post("/example", status_code=201)
def example(request: Request):
    """Explicitly requested fictional example, owned by the person creating it."""
    p = create_project(
        ProjectIn(
            name="Voorbeeld · Personeelskosten Testzorg",
            context="Dit project bevat uitsluitend fictieve voorbeeldgegevens. Onderzoek de ontwikkeling van de personeelskosten. Benoem de bron, het jaar en de eenheid; maak onderscheid tussen feiten en mogelijke verklaringen. Geef geen advies zonder dat ik daarom vraag.",
        ),
        request,
    )
    pid = p["id"]
    financial = add_note(
        pid,
        NoteIn(
            title="financiele-cijfers.md",
            text="Fictieve voorbeeldgegevens, geen echte zorgaanbieder.\n2024: omzet EUR 2.000.000; personeelskosten EUR 1.100.000.\n2025: omzet EUR 2.200.000; personeelskosten EUR 1.320.000.\nAlle bedragen zijn hele euro’s. De cijfers betreffen dezelfde enkelvoudige organisatie.",
        ),
        request,
    )["id"]
    interview = add_note(
        pid,
        NoteIn(
            title="gespreksnotitie.md",
            text="Fictief interview, 12 februari 2026.\nDe directie meldt dat in 2025 meer externe medewerkers zijn ingezet.\nDeze notitie bevat geen uitsplitsing van de personeelskosten. De financiële impact van externe inhuur is hiermee niet vastgesteld.",
        ),
        request,
    )["id"]
    first = uuid.uuid4().hex
    answer = f"""De personeelskosten stegen van € 1.100.000 in 2024 naar € 1.320.000 in 2025: een stijging van € 220.000, oftewel 20%. [p. 1](/bron/project/{pid}/{financial}/1 "2025: omzet EUR 2.200.000; personeelskosten EUR 1.320.000.")

De omzet steeg met 10%. Het aandeel personeelskosten in de omzet nam daardoor toe van 55% naar 60%. Dit zijn berekeningen op basis van de fictieve cijfers. [p. 1](/bron/project/{pid}/{financial}/1 "2024: omzet EUR 2.000.000; personeelskosten EUR 1.100.000.")

De directie noemt meer externe inzet. Dat is een mogelijke verklaring, maar de notitie kwantificeert de invloed daarvan niet. [p. 1](/bron/project/{pid}/{interview}/1 "De directie meldt dat in 2025 meer externe medewerkers zijn ingezet.")

**Nog uit te zoeken:** de uitsplitsing tussen eigen personeel en externe inhuur. Dit voorbeeld is handmatig samengesteld om het gebruik van bronverwijzingen te tonen; het is geen modelanalyse van een echte organisatie."""
    messages = [
        {"id": first, "role": "user", "parts": [{"type": "text", "text": "Wat valt op aan de personeelskosten en wat weten we over de oorzaak?"}]},
        {"id": uuid.uuid4().hex, "role": "assistant", "parts": [{"type": "text", "text": answer}]},
    ]
    with database() as db:
        db.execute(
            "INSERT INTO chats(user,id,title,updated,messages,project_id) VALUES (?,?,?,?,?,?)",
            (owner(request), first, "Voorbeeldanalyse · personeelskosten", now(), json.dumps(messages), pid),
        )
    return p


@router.get("/{pid}/documents/{did}/original")
def download_source(pid: str, did: str, request: Request):
    from urllib.parse import quote

    with database() as db:
        project(db, pid, owner(request))
        d = document(db, pid, did)
        if d["kind"] == "pdf":
            return FileResponse(path_for(did), media_type="application/pdf", filename=d["filename"])
        text = db.execute("SELECT text FROM project_pages WHERE document_id=? AND page=1", (did,)).fetchone()[0]
        name = d["filename"] if d["kind"] == "markdown" else d["filename"] + ".txt"
        return Response(
            text,
            media_type="text/markdown" if d["kind"] == "markdown" else "text/plain",
            headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(name)},
        )
