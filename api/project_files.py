"""Save public research files as owner-scoped project copies, readable without the upstream URL."""

import json
import re
import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from urllib.parse import quote

import datasets
import digimv
import documents
import projects
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/projects")


@contextmanager
def database():
    with projects.database() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS project_saved_files(
          document_id TEXT PRIMARY KEY REFERENCES project_documents(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source_key TEXT NOT NULL, url TEXT NOT NULL, fetched_at TEXT NOT NULL, media_type TEXT NOT NULL,
          UNIQUE(project_id,source_key))""")
        yield db


class SaveFile(BaseModel):
    href: str = Field(min_length=1, max_length=2000)


def public_file(href):
    """Only known public evidence IDs can select a file; never fetch a caller-supplied URL or path."""
    if m := re.fullmatch(r"/bron/rij/([a-f0-9]{20})(?:/[^/?#]+){0,2}/[1-9]\d*", href):
        path, name, ctype = datasets.table_file(m[1])
        _, meta = datasets._cached_table(m[1])
        return path, name, "table", f"table/{m[1]}", meta["file_url"], meta["fetched_at"], ctype
    if m := re.fullmatch(r"/bron/doc/([a-f0-9]{20})/[1-9]\d*", href):
        meta = documents.document_meta(m[1])
        return (documents.document_pdf(m[1]), meta["title"] + ".pdf", "pdf", f"public/{m[1]}", meta["file_url"], meta["fetched_at"], "application/pdf")
    if m := re.fullmatch(r"/bron/(\d{4})/(\d+)/[1-9]\d*", href):
        year, did = map(int, m.groups())
        meta = digimv.get_doc(year, did)
        return (digimv.get_pdf(year, did), meta["file_name"], "pdf", f"digimv/{year}/{did}", meta["url"], projects.now(), "application/pdf")
    raise ValueError("Kies een PDF of databestand uit de bronnen van het gesprek.")


@router.post("/{pid}/saved-files", status_code=201)
def save_file(pid: str, body: SaveFile, request: Request):
    user = projects.owner(request)
    with database() as db:
        projects.project(db, pid, user)
    try:
        path, name, kind, key, url, fetched, ctype = public_file(body.href)
        if path.stat().st_size > projects.MAX_FILE:
            raise HTTPException(413, "Maximaal 25 MB per projectbestand")
        pages = 1
        if kind == "pdf":
            import pymupdf

            with pymupdf.open(path) as pdf:
                if pdf.needs_pass or not 1 <= pdf.page_count <= 200:
                    raise ValueError("Gebruik een PDF zonder wachtwoord, met maximaal 200 pagina’s.")
                pages = pdf.page_count
    except KeyError as e:
        raise HTTPException(404, "Bronbestand niet beschikbaar. Laat het bestand opnieuw lezen in het gesprek.") from e
    except (ValueError, RuntimeError, OSError) as e:
        raise HTTPException(400, str(e)) from e
    name = name.replace("\\", "/").rsplit("/", 1)[-1][:200]
    did = uuid.uuid4().hex
    target = projects.path_for(did)
    try:
        with database() as db:
            projects.project(db, pid, user)
            existing = db.execute("SELECT document_id FROM project_saved_files WHERE project_id=? AND source_key=?", (pid, key)).fetchone()
            if existing:
                db.execute("UPDATE project_documents SET archived=0 WHERE id=?", (existing[0],))
                return {"id": existing[0], "existing": True}
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            db.execute(
                "INSERT INTO project_documents(id,project_id,filename,kind,pages,status,created) VALUES (?,?,?,?,?,?,?)",
                (did, pid, name, kind, pages, "queued" if kind == "pdf" else "ready", projects.now()),
            )
            db.execute("INSERT INTO project_saved_files VALUES (?,?,?,?,?,?)", (did, pid, key, url, fetched, ctype))
            if kind == "table":
                projects.store_page(
                    db,
                    did,
                    1,
                    f"Databestand: {name}\nBron: {url}\nOpgehaald: {fetched}\n"
                    "De gegevens staan in het opgeslagen bestand. Een archief kan meerdere databestanden bevatten.",
                    "table",
                )
            db.execute("UPDATE projects SET updated=? WHERE id=?", (projects.now(), pid))
    except sqlite3.IntegrityError:
        target.unlink(missing_ok=True)
        with database() as db:
            projects.project(db, pid, user)
            existing = db.execute("SELECT document_id FROM project_saved_files WHERE project_id=? AND source_key=?", (pid, key)).fetchone()
            if not existing:
                raise
            db.execute("UPDATE project_documents SET archived=0 WHERE id=?", (existing[0],))
            return {"id": existing[0], "existing": True}
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return {"id": did, "existing": False}


def saved_file(pid, did, request, for_model=False):
    with database() as db:
        p = projects.project(db, pid, projects.owner(request))
        if for_model and not p["allow_private"]:
            raise HTTPException(403, "Privémateriaal naar Gemini is uitgeschakeld")
        d = dict(projects.document(db, pid, did))
        meta = db.execute("SELECT * FROM project_saved_files WHERE document_id=?", (did,)).fetchone()
        if not meta or (for_model and d["archived"]):
            raise HTTPException(404, "Opgeslagen bestand niet gevonden")
        return d, dict(meta)


@router.get("/{pid}/documents/{did}/file")
def original_file(pid: str, did: str, request: Request):
    d, meta = saved_file(pid, did, request)
    return FileResponse(projects.path_for(did), filename=d["filename"], media_type=meta["media_type"])


def read_table(pid, did, request, query=None, limit=40, offset=0, sheet=None, header_row=None, filters=None, member=None, sort=None, row=None, for_model=False):
    d, meta = saved_file(pid, did, request, for_model)
    if d["kind"] != "table":
        raise HTTPException(400, "Dit is geen databestand")
    try:
        fmt, out, sheet, sheets, member, members = datasets._read(
            projects.path_for(did), meta["media_type"], query, limit, offset, sheet, header_row, filters, member, row, sort
        )
    except KeyError as e:
        raise HTTPException(404, str(e.args[0])) from e
    except (ValueError, RuntimeError, OSError) as e:
        raise HTTPException(400, str(e)) from e
    prefix = f"/bron/project/{pid}/{did}/rij/"
    member = member if members is not None else None
    cite_parts = [x for x in (member, sheet if fmt == "xlsx" else None) if x]
    return {
        "id": did,
        "file_name": d["filename"],
        "file_url": meta["url"],
        "fetched_at": meta["fetched_at"],
        "format": fmt,
        "sheet": sheet,
        "sheets": sheets,
        "member": member,
        "members": members,
        "row_cite": prefix + "".join(quote(x, safe="") + "/" for x in cite_parts),
        **out,
        "scope": datasets.TABLE_SCOPE,
    }


@router.get("/{pid}/documents/{did}/table")
def table(
    pid: str,
    did: str,
    request: Request,
    q: str | None = None,
    offset: int = Query(0, ge=0),
    sheet: str | None = None,
    header_row: int | None = Query(None, ge=1),
    filters: str | None = None,
    member: str | None = None,
    sort: str | None = None,
    for_model: bool = False,
):
    try:
        flt = json.loads(filters) if filters else None
        if flt is not None and not isinstance(flt, dict):
            raise ValueError()
    except ValueError:
        raise HTTPException(400, "filters moet een JSON-object zijn")
    return read_table(pid, did, request, query=q, offset=offset, sheet=sheet, header_row=header_row, filters=flt, member=member, sort=sort, for_model=for_model)


@router.get("/{pid}/documents/{did}/rows/{row}")
def table_row(pid: str, did: str, row: int, request: Request, part: list[str] = Query([])):
    parts = part[:2]
    data = read_table(pid, did, request, limit=1, sheet=parts[-1] if parts else None, member=parts[0] if parts else None, row=row)
    if not data["rows"]:
        raise HTTPException(404, "Rij niet gevonden")
    return {**data, "row": data["rows"][0]}
