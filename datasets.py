"""Open datasets: the national catalogue (data.overheid.nl), the files it points to, and every CBS StatLine table.

Checked against the live services on 2026-11-12:
  Catalogue  CKAN https://data.overheid.nl/data/api/3/action/package_search|package_show: ~18,000 datasets from 25
             catalogues (CBS, CBS DataDerden, DONL with ministries' and agencies' own data, DNB, municipalities).
             Descriptions can be years older or newer than the data, and a resource URL is often a web page.
  Files      CSV, Excel (.xlsx) and JSON read here as rows, also inside a ZIP; old .xls (binary) and 7-Zip are not
             readable without a library. A CSV is streamed from disk (up to 1 GB: NZa's Open DIS files are 37 and
             757 MB), Excel and JSON are read in memory (up to 80 MB).
  Swing      ABF's Open Data Service (OData v4, header apikey) behind Prognosemodel Zorg en Welzijn and
             Waarstaatjegemeente: Indicators, Indicators/{code}/DataCubes, DataCubes(...)/Data, GeoLevels/{level}/
             GeoLevelMembers. A free key per organisation; checked against Swing's public demo on 2026-11-12.
  CBS        https://opendata.cbs.nl (5,986 tables) and https://dataderden.cbs.nl (831, data CBS hosts for others:
             Iv3, youth care and Wmo per municipality, health monitors), both OData v3. Dimension keys are padded
             inconsistently, so they are always read from the table; UntypedDataSet keeps CBS's symbols ('.', 'x',
             '-') that the typed feed turns into null; a query of 10,000 rows or more is refused, not paged."""

import csv
import functools
import io
import itertools
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import zipfile
from datetime import timedelta
from xml.etree import ElementTree as ET

import documents
import sources

CKAN = "https://data.overheid.nl/data/api/3/action"
CATALOGUE_SCOPE = ("data.overheid.nl describes datasets held elsewhere. Its dates are the description's, not the "
                   "data's: check the period inside the file before calling anything current. A resource URL is "
                   "often a web page that links to the file rather than the file itself.")
TABLE_TTL = timedelta(days=1)  # a data file is fetched again after a day
TABLE_MAX = 1 << 30  # a CSV is streamed from disk, so it can be large: NZa's Open DIS activity file is 757 MB
TABLE_SCOPE = ("Rows as they are in the file, values verbatim. Excel dates show as day numbers (45658 = 1 Jan 2025). "
               "row = the row's number in the file as a spreadsheet program shows it (JSON: the record's number), "
               "to cite with the file URL. query matches a word in any cell, so a code can also hit an amount; "
               "filters on a named column is exact.")

CBS_HOSTS = ("https://opendata.cbs.nl", "https://dataderden.cbs.nl")
CBS_CAP = 10_000
CBS_DIMS_V = 1
CBS_SYMBOLS = {".": "unknown, or not applicable", "x": "secret (left out to protect respondents)",
               "-": "nil (none)", "": "cannot occur", "?": "unreliable"}
CBS_SCOPE = ("CBS StatLine, values as CBS publishes them. A period ending in * is provisional and can still change. "
             "value null with a symbol is CBS's own mark (see `symbols`), never 0 unless the symbol says nil. "
             "Check each topic's unit, and the table's own description for definitions.")

SCHEMA = """
CREATE TABLE IF NOT EXISTS cbs_catalog(id TEXT PRIMARY KEY, host TEXT, title TEXT, summary TEXT, period TEXT,
  modified TEXT, frequency TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS cbs_dims(tbl TEXT PRIMARY KEY, modified TEXT, v INT, dims TEXT);
"""


def connect(path=None):
    db = sources.connect(path)
    db.executescript(SCHEMA)
    return db


# ---------------------------------------------------------------- data.overheid.nl catalogue

def _format(r):
    return (r.get("format") or "").rsplit("/", 1)[-1] or None


def _dataset(p, brief):
    res = p.get("resources") or []
    notes = p.get("notes") or ""
    return {"id": p["name"], "title": p.get("title"), "catalogue": (p.get("organization") or {}).get("title"),
            "modified": p.get("modified") or p.get("metadata_modified"), "license": p.get("license_title") or p.get("license_id"),
            "description": notes[:300] + ("…" if brief and len(notes) > 300 else "") if brief else notes,
            "resource_count": len(res), "page": f"https://data.overheid.nl/dataset/{p['name']}",
            "resources": [{"name": r.get("name"), "format": _format(r), "url": r.get("url")} for r in res[:5 if brief else 200]]}


def search_datasets(q, limit=20, start=0):
    """Datasets in the national catalogue by words in title, description or tags."""
    params = urllib.parse.urlencode({"q": q, "rows": min(limit, 50), "start": start})
    try:
        r = sources._json(f"{CKAN}/package_search?{params}")["result"]
    except (OSError, KeyError) as e:
        raise RuntimeError(f"data.overheid.nl search failed: {e}") from e
    hits = [_dataset(p, brief=True) for p in r["results"]]
    return {"query": q, "total": r["count"], "returned": len(hits), "truncated": r["count"] > start + len(hits),
            "results": hits, "source": "https://data.overheid.nl", "scope": CATALOGUE_SCOPE}


def get_dataset(dataset_id):
    """One dataset with its full description and every resource (file or link)."""
    try:
        p = sources._json(f"{CKAN}/package_show?id={urllib.parse.quote(dataset_id)}")["result"]
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise KeyError(f"no dataset {dataset_id} on data.overheid.nl") from e
        raise RuntimeError(f"data.overheid.nl failed: {e}") from e
    return {**_dataset(p, brief=False), "source": "https://data.overheid.nl", "scope": CATALOGUE_SCOPE}


# ---------------------------------------------------------------- reading a data file

def _number(v):
    """Excel stores numbers as text ('16646', '0.1', '1E-3'): a number when it is one, else the text as stored."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    return int(f) if f.is_integer() and "e" not in v.lower() and "." not in v else f


def _col(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref)[0]:
        n = n * 26 + ord(ch) - 64
    return n - 1


def xlsx_rows(body, sheet=None):
    """(sheet name, all sheet names, rows) of an .xlsx, with the standard library only."""
    m = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    z = zipfile.ZipFile(io.BytesIO(body))
    sheets = [(s.get("name"), s.get(rel)) for s in ET.fromstring(z.read("xl/workbook.xml")).iter(f"{m}sheet")]
    targets = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = ["".join(t.text or "" for t in si.iter(f"{m}t"))
                  for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{m}si")]
    names = [s[0] for s in sheets]
    pick = next((s for s in sheets if s[0] == sheet), None) if sheet else sheets[0]
    if not pick:
        raise KeyError(f"no sheet {sheet!r}; the sheets are {names}")
    target = targets[pick[1]]
    path = target.lstrip("/") if target.startswith("/") else "xl/" + target
    rows = []
    for row in ET.fromstring(z.read(path)).iter(f"{m}row"):
        while len(rows) < int(row.get("r") or len(rows) + 1) - 1:  # a sheet leaves empty rows out: keep the numbering
            rows.append([])
        cells, nxt = {}, 0
        for c in row.iter(f"{m}c"):
            i = _col(c.get("r")) if c.get("r") else nxt
            nxt = i + 1
            v, t = c.find(f"{m}v"), c.get("t")
            if t == "s":
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{m}t"))
            elif v is None:
                val = None
            elif t in ("str", "e"):
                val = v.text
            elif t == "b":
                val = v.text == "1"
            else:
                val = _number(v.text)
            cells[i] = val
        rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
    return pick[0], names, rows


ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")  # latin-1 decodes any byte: the last resort


def _dialect(sample):
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        return csv.excel


def csv_rows(body):
    text = None
    for enc in ENCODINGS:
        try:
            text = body.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return list(csv.reader(io.StringIO(text), _dialect(text[:8192])))


def _csv_reader(f):
    """Rows of a CSV read line by line from the text file f, so a file of hundreds of MB never sits in memory.
    The delimiter is sniffed from whole lines at the start (a cut-off line could fool it)."""
    head, size = [], 0
    while size < 8192 and (line := f.readline()):
        head.append(line)
        size += len(line)
    return csv.reader(itertools.chain(head, f), _dialect("".join(head)))


def _scan_csv(open_bin, scan):
    """A CSV scanned as utf-8, else read again as cp1252, else latin-1: a byte that isn't utf-8 can be anywhere."""
    for enc in ENCODINGS:
        with io.TextIOWrapper(open_bin(), encoding=enc, newline="") as f:
            try:
                return scan(_csv_reader(f))
            except UnicodeDecodeError:
                continue


def json_rows(body):
    d = json.loads(body)
    if isinstance(d, dict):
        d = next((d[k] for k in ("value", "data", "results", "records", "features") if isinstance(d.get(k), list)), None)
    if not isinstance(d, list) or not all(isinstance(x, dict) for x in d):
        raise ValueError("this JSON is not a list of records")
    cols = list(dict.fromkeys(k for x in d for k in x))
    return [cols] + [[x.get(k) for k in cols] for x in d]


def _header_row(rows):
    """Government sheets often start with a title and notes: the header is the first of the first 30 rows with as
    many filled cells as the fullest of them. Returned so the caller can see, and override, the choice."""
    filled = [sum(v not in (None, "") for v in r) for r in rows[:30]]
    return filled.index(max(filled)) + 1 if filled and max(filled) else 1


def _columns(header):
    out = []
    for i, h in enumerate(header):
        name = str(h).strip() if h not in (None, "") else f"column {i + 1}"
        while name in out or name == "row":  # 'row' is the row number read_table adds
            name += "'"
        out.append(name)
    return out


def _file(url, refresh=False):
    """A data file by URL, downloaded to the cache (never held in memory) and kept for TABLE_TTL.
    Returns (path, content type, final URL, fetched at)."""
    did = documents.doc_id(url)
    cache = documents.PUB / "tables" / did
    meta = cache.with_suffix(".json")
    with documents._lock(did):  # two chats asking for the same 700 MB file download it once
        if not refresh and meta.exists() and cache.exists() \
                and not sources._older(json.loads(meta.read_text())["fetched_at"], TABLE_TTL):
            m = json.loads(meta.read_text())
            return cache, m["content_type"], m["file_url"], m["fetched_at"]
        cache.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache.with_name(cache.name + ".part")
        try:
            with open(tmp, "wb") as out:
                ctype, final = documents._stream(url, out, TABLE_MAX)
        except BaseException:
            tmp.unlink(missing_ok=True)  # a cut-off download of up to 1 GB is never left behind
            raise
        tmp.replace(cache)
        stamp = sources._iso(sources._now())
        tmp = meta.with_name(meta.name + ".part")
        tmp.write_text(json.dumps({"content_type": ctype, "file_url": final, "fetched_at": stamp}))
        tmp.replace(meta)
        return cache, ctype, final, stamp


def _in_memory(size, what):
    if size > documents.MAX_BYTES:
        raise ValueError(f"this {what} is larger than {documents.MAX_BYTES // 2**20} MB, too large to read here; "
                         "look for a CSV version of it")


def _scan(rows, header_row, filters, words, offset, limit, shift, row=None):
    """One pass over rows (a list or a stream): header, the counts, and only the requested page kept. With row, only
    that row (by its number in the file), stopping there: what a /bron/rij/ citation shows; the counts are then partial."""
    rows = iter(rows)
    first = list(itertools.islice(rows, max(30, header_row or 0)))
    h = header_row or _header_row(first)
    if not 1 <= h <= len(first):
        raise ValueError(f"header_row must be between 1 and {len(first)}")
    header = first[h - 1]
    width = max(map(len, first[h - 1:]))
    cols = _columns(header + [None] * (width - len(header)))
    want = {}
    for k, v in (filters or {}).items():
        i = next((i for i, c in enumerate(cols) if c == k), None)
        i = i if i is not None else next((i for i, c in enumerate(cols) if c.casefold() == str(k).strip().casefold()), None)
        if i is None:
            raise KeyError(f"no column {k!r}; the columns are {cols}")
        want[i] = {str(x).strip().casefold() for x in (v if isinstance(v, list) else [v])}
    total = matched = 0
    page = []
    # n is the row's number in the file as a spreadsheet shows it (JSON: the record's number), so a citation finds it
    for n, r in itertools.chain(enumerate(first[h:], h + 1), enumerate(rows, len(first) + 1)):
        if not any(v not in (None, "") for v in r):
            continue
        if row is not None:
            if n - shift < row:
                continue
            if n - shift == row:
                page.append((row, r))
                width = max(width, len(r))
            break
        total += 1
        width = max(width, len(r))
        if not all(i < len(r) and str(r[i]).strip().casefold() in vals for i, vals in want.items()):
            continue
        if words and not all(w in sources._fold(" ".join("" if v is None else str(v) for v in r)) for w in words):
            continue
        matched += 1
        if offset < matched <= offset + limit:
            page.append((n - shift, r))
    # a value right of the last header cell still gets a column, never dropped
    cols = _columns(header + [None] * (width - len(header)))
    return {"header_row": h, "title_rows": [t for r in first[:h - 1] if (t := [v for v in r if v not in (None, "")])][:5],
            "columns": cols, "rows_total": total, "rows_matched": matched, "returned": len(page),
            "truncated": matched > offset + len(page),
            "rows": [{"row": n, **{c: (r[i] if i < len(r) else None) for i, c in enumerate(cols)}} for n, r in page]}


def read_table(url, query=None, limit=50, offset=0, sheet=None, header_row=None, refresh=False, filters=None, member=None):
    """Rows of a CSV, Excel (.xlsx) or JSON file, also inside a ZIP. query keeps rows containing every word (accents
    ignored), e.g. an AGB code, a municipality or 'begeleiding'. filters {column: [values]} keeps rows whose cell in
    that column is one of the values (exact, case ignored): how to match a code without hitting amounts. header_row
    (1-based) overrides the detected header. member picks a file inside a ZIP."""
    path, ctype, final, fetched = _file(url.strip(), refresh)
    fmt, out, sheet, sheets, member, members = _read(path, ctype, query, limit, offset, sheet, header_row, filters, member)
    # id: our cached copy, which a /bron/rij/{id}/.../{row} citation opens (the site's link may expire, as Zorginzicht's do)
    return {"id": path.name, "url": url, "file_url": final, "format": fmt, "sheet": sheet, "sheets": sheets,
            "member": member, "members": members, "fetched_at": fetched, **out, "scope": TABLE_SCOPE}


def _read(path, ctype, query, limit, offset, sheet, header_row, filters, member, row=None):
    """The table in a cached file: (format, scan, sheet, sheets, member, members)."""
    with open(path, "rb") as f:
        head = f.read(2048)
    sheets = members = None
    words = [sources._fold(w) for w in (query or "").split()]
    scan = lambda rows, shift=0: _scan(rows, header_row, filters, words, offset, min(limit, 200), shift, row)
    if head[:4] == b"\xd0\xcf\x11\xe0":
        raise ValueError("an old binary Excel file (.xls), which cannot be read here; look for a .xlsx or .csv version")
    if head[:6] == b"7z\xbc\xaf\x27\x1c":
        raise ValueError("a 7-Zip archive, which cannot be read here; look for a .zip, .xlsx or .csv version")
    if head[:2] == b"PK":
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if "xl/workbook.xml" in names:
                _in_memory(path.stat().st_size, "Excel file")
                fmt, (sheet, sheets, rows) = "xlsx", xlsx_rows(path.read_bytes(), sheet)
                out = scan(rows)
            elif "word/document.xml" in names:
                raise ValueError("a Word document, not a data file: read it with read_document")
            else:
                members = [n for n in names if n.lower().endswith((".csv", ".txt", ".tsv", ".xlsx", ".json"))]
                if member is None and len(members) != 1:
                    raise ValueError(f"a ZIP with {len(members)} data files: pick one with member; they are {members[:50]}")
                m = member = member if member is not None else members[0]
                if m not in names:
                    raise KeyError(f"no file {m!r} in this ZIP; the data files are {members[:50]}")
                if m.lower().endswith((".xlsx", ".json")):
                    _in_memory(z.getinfo(m).file_size, "file")
                    body = z.read(m)
                    if m.lower().endswith(".xlsx"):
                        fmt, (sheet, sheets, rows) = "xlsx", xlsx_rows(body, sheet)
                        out = scan(rows)
                    else:
                        fmt, out = "json", scan(json_rows(body), 1)
                else:
                    fmt, out = "csv", _scan_csv(lambda: z.open(m), scan)
    elif "json" in ctype or head.lstrip()[:1] in (b"[", b"{"):
        _in_memory(path.stat().st_size, "JSON file")
        fmt, out = "json", scan(json_rows(path.read_bytes()), 1)
    elif head[:5] == b"%PDF-":
        raise ValueError("a PDF, not a data file: read it with read_document")
    elif "html" in ctype or head.lstrip()[:15].lower().startswith((b"<!doctype", b"<html")):
        raise ValueError("this URL is a web page, not a data file: read it with read_document to find the file link")
    else:
        fmt, out = "csv", _scan_csv(lambda: open(path, "rb"), scan)
    return fmt, out, sheet, sheets, member, members


def _cached_table(did):
    if not re.fullmatch(r"[0-9a-f]{20}", did or ""):  # also keeps a path out of the file name
        raise KeyError(f"no table {did!r}")
    path = documents.PUB / "tables" / did
    meta = path.with_suffix(".json")
    if not (path.exists() and meta.exists()):
        raise KeyError(f"table {did} is not in the cache here; read its URL again")
    return path, json.loads(meta.read_text())


def table_row(did, row, parts=()):
    """One row of a table read before, from our cached copy, as a /bron/rij/ citation shows it: the header and that
    row. parts: the ZIP member and/or Excel sheet the citation names, member first."""
    path, meta = _cached_table(did)
    fmt, out, sheet, _, member, members = _read(path, meta["content_type"], None, 1, 0, parts[-1] if parts else None,
                                                None, None, parts[0] if parts else None, row)
    if not out["rows"]:
        raise KeyError(f"row {row} is not in this table: a blank row, the header, or past the end")
    return {"id": did, "file_url": meta["file_url"], "fetched_at": meta["fetched_at"], "format": fmt, "sheet": sheet,
            "member": member if members is not None else None, "file_name": table_file(did)[1],
            "header_row": out["header_row"], "title_rows": out["title_rows"], "columns": out["columns"], "row": out["rows"][0]}


def table_file(did):
    """Our cached copy of a table and a file name for it: the site's own, or one with the right extension."""
    path, meta = _cached_table(did)
    name = urllib.parse.unquote(urllib.parse.urlsplit(meta["file_url"]).path.rsplit("/", 1)[-1])
    if "." not in name:  # Zorginzicht serves its files as /services/file/get?key=...
        with open(path, "rb") as f:
            head = f.read(2048)
        ext = ("xlsx" if "xl/workbook.xml" in zipfile.ZipFile(path).namelist() else "zip") if head[:2] == b"PK" \
            else "json" if head.lstrip()[:1] in (b"[", b"{") else "csv"
        name = f"{urllib.parse.urlsplit(meta['file_url']).hostname or 'bestand'}-{did[:8]}.{ext}"
    return path, name, meta["content_type"]


# ---------------------------------------------------------------- CBS StatLine (opendata + dataderden)

def cbs_catalog(refresh=False, db=None):
    """Both CBS catalogues, refreshed daily; a failed refresh keeps the list it had."""
    db = db or connect()
    r = db.execute("SELECT fetched_at FROM sources_log WHERE name='cbs_catalog'").fetchone()
    if refresh or not r or sources._older(r[0], timedelta(days=1)):
        try:
            rows = []
            for host in CBS_HOSTS:
                sel = "Identifier,Title,ShortDescription,Period,Modified,Frequency,OutputStatus"
                for t in sources._all(f"{host}/ODataCatalog/Tables?$select={sel}&$format=json"):
                    rows.append((t["Identifier"], host, (t.get("Title") or "").strip(), (t.get("ShortDescription") or "")[:2000],
                                 t.get("Period"), t.get("Modified"), t.get("Frequency"), t.get("OutputStatus")))
            if len({r[0] for r in rows}) != len(rows):
                raise ValueError("a CBS table id is in both catalogues")
            with db:
                db.execute("DELETE FROM cbs_catalog")
                db.executemany("INSERT INTO cbs_catalog VALUES (?,?,?,?,?,?,?,?)", rows)
                db.execute("INSERT OR REPLACE INTO sources_log VALUES ('cbs_catalog', ?)", (sources._iso(sources._now()),))
        except (OSError, KeyError, ValueError):
            if not db.execute("SELECT 1 FROM cbs_catalog LIMIT 1").fetchone():
                raise
    return db


def search_cbs(q, limit=20, db=None):
    """CBS tables whose id, title or summary contains every word (accents ignored); newest first."""
    db = cbs_catalog(db=db)
    words = [sources._fold(w) for w in q.split()]
    hits = [dict(r) for r in db.execute("SELECT * FROM cbs_catalog ORDER BY modified DESC")
            if all(w in sources._fold(f"{r['id']} {r['title']} {r['summary']}") for w in words)]
    out = [{"id": h["id"], "title": h["title"], "period": h["period"], "modified": h["modified"],
            "status": h["status"], "frequency": h["frequency"], "summary": h["summary"].strip()[:300],
            "catalogue": h["host"].split("//")[1]} for h in hits[:limit]]
    return {"query": q, "total": len(hits), "returned": len(out), "truncated": len(hits) > len(out), "results": out,
            "scope": "Table titles and summaries only; describe_cbs_table shows what a table holds."}


def _cbs_table(db, table_id):
    r = db.execute("SELECT * FROM cbs_catalog WHERE id=?", (table_id,)).fetchone()
    if not r:
        cbs_catalog(refresh=True, db=db)
        r = db.execute("SELECT * FROM cbs_catalog WHERE id=?", (table_id,)).fetchone()
    if not r:
        raise KeyError(f"no CBS table {table_id}; find one with search_cbs")
    return dict(r)


def _cbs_dims(db, t):
    """A table's properties and every dimension's codes, keys verbatim, cached until the table changes."""
    r = db.execute("SELECT modified, v, dims FROM cbs_dims WHERE tbl=?", (t["id"],)).fetchone()
    if r and r[0] == t["modified"] and r[1] == CBS_DIMS_V:
        return json.loads(r[2])
    base = f"{t['host']}/ODataApi/OData/{t['id']}"
    props = sources._all(f"{base}/DataProperties")
    info = sources._all(f"{base}/TableInfos")[0]
    groups = {p["ID"]: p for p in props}

    def path(p):  # 'Key figures (million euros) › Government revenue': a topic's title alone can repeat
        out = []
        while p.get("ParentID") is not None and p["ParentID"] in groups:
            p = groups[p["ParentID"]]
            out.append((p.get("Title") or "").strip())
        return " › ".join(reversed([o for o in out if o]))

    dims, topics = [], []
    for p in props:
        if p["Type"] in ("Dimension", "GeoDimension", "TimeDimension", "GeoDetail"):
            codes = [{"key": c["Key"], "title": (c.get("Title") or "").strip()} for c in sources._all(f"{base}/{p['Key']}")]
            dims.append({"key": p["Key"], "title": (p.get("Title") or "").strip(), "type": p["Type"], "codes": codes})
        elif p["Type"] == "Topic":
            topics.append({"key": p["Key"], "title": (p.get("Title") or "").strip(), "unit": (p.get("Unit") or "").strip(),
                           "group": path(p), "decimals": p.get("Decimals")})
    d = {"title": (info.get("Title") or "").strip(), "description": (info.get("ShortDescription") or "").strip(),
         "period": info.get("Period"), "modified": info.get("Modified"), "dims": dims, "topics": topics}
    with db:
        db.execute("INSERT OR REPLACE INTO cbs_dims VALUES (?,?,?,?)", (t["id"], t["modified"], CBS_DIMS_V, json.dumps(d)))
    return d


def _cbs_page(t):
    return f"{t['host']}/#/CBS/nl/dataset/{t['id']}/table" if "opendata" in t["host"] else t["host"]


def describe_cbs_table(table_id, dimension=None, query=None, db=None):
    """What a table holds: its topics (with unit) and dimensions. With `dimension`, that dimension's codes,
    filtered on `query` (words in code or title): how to find e.g. a municipality's code in a regional table."""
    db = cbs_catalog(db=db)
    t = _cbs_table(db, table_id)
    d = _cbs_dims(db, t)
    out = {"id": t["id"], "title": d["title"], "period": d["period"], "modified": d["modified"],
           "description": d["description"][:3000], "catalogue": t["host"].split("//")[1],
           "page": _cbs_page(t),
           "topics": [{k: x[k] for k in ("key", "title", "unit", "group")} for x in d["topics"]],
           "dimensions": [{"key": x["key"], "title": x["title"], "type": x["type"], "codes": len(x["codes"]),
                           "first_codes": [f"{c['key'].strip()} = {c['title']}" for c in x["codes"][:12]]} for x in d["dims"]],
           "scope": CBS_SCOPE}
    if dimension:
        dim = next((x for x in d["dims"] if x["key"].lower() == dimension.lower()), None)
        if not dim:
            raise KeyError(f"no dimension {dimension}; the dimensions are {[x['key'] for x in d['dims']]}")
        words = [sources._fold(w) for w in (query or "").split()]
        codes = [c for c in dim["codes"] if all(w in sources._fold(f"{c['key']} {c['title']}") for w in words)]
        out["codes"] = [{"code": c["key"].strip(), "title": c["title"]} for c in codes[:200]]
        out["codes_matched"] = len(codes)
    return out


def _cbs_value(raw):
    s = (raw or "").strip() if isinstance(raw, str) else raw
    if s is None or isinstance(s, (int, float)):
        return s, None
    if re.fullmatch(r"-?\d+(\.\d+)?", s):
        return (float(s) if "." in s else int(s)), None
    return None, s


def get_cbs(table_id, filters=None, topics=None, limit=200, db=None):
    """Values from a CBS table. filters: {dimension key: [codes or titles]}, e.g. {"RegioS": ["GM0546"], "Perioden":
    ["2024JJ00"]}; a dimension left out means all its codes. topics: topic keys; none means all. Refused when the
    selection would be 10,000 rows or more (CBS refuses those): narrow the filters."""
    db = cbs_catalog(db=db)
    t = _cbs_table(db, table_id)
    d = _cbs_dims(db, t)
    by_key = {x["key"].lower(): x for x in d["dims"]}
    chosen = {}
    for k, wanted in (filters or {}).items():
        dim = by_key.get(k.lower())
        if not dim:
            raise KeyError(f"no dimension {k}; the dimensions are {[x['key'] for x in d['dims']]}")
        keys = []
        for w in (wanted if isinstance(wanted, list) else [wanted]):
            f = sources._fold(str(w).strip())
            hit = [c for c in dim["codes"] if sources._fold(c["key"].strip()) == f] or \
                  [c for c in dim["codes"] if sources._fold(c["title"]) == f]
            if not hit:
                raise KeyError(f"{dim['key']} has no code {w!r}; look it up with describe_cbs_table(table, '{dim['key']}', query)")
            keys += [c["key"] for c in hit]
        chosen[dim["key"]] = list(dict.fromkeys(keys))
    rows_expected = 1
    for x in d["dims"]:
        rows_expected *= len(chosen.get(x["key"], x["codes"]))
    if rows_expected >= CBS_CAP:
        raise ValueError(f"that selection is {rows_expected:,} rows; CBS refuses 10,000 or more: filter more dimensions")
    tops = d["topics"]
    if topics:
        want = {x.lower() for x in topics}
        tops = [x for x in d["topics"] if x["key"].lower() in want]
        missing = want - {x["key"].lower() for x in tops}
        if missing:
            raise KeyError(f"no topic {sorted(missing)}; the topics are listed by describe_cbs_table")
    flt = " and ".join("(" + " or ".join(f"{k} eq '{v.replace(chr(39), chr(39) * 2)}'" for v in keys) + ")"
                       for k, keys in chosen.items())
    sel = ",".join([x["key"] for x in d["dims"]] + [x["key"] for x in tops])
    q = urllib.parse.urlencode({k: v for k, v in (("$filter", flt), ("$select", sel), ("$format", "json")) if v},
                               quote_via=urllib.parse.quote)
    url = f"{t['host']}/ODataApi/OData/{t['id']}/UntypedDataSet?{q}"
    try:
        raw = sources._all(url)
    except OSError as e:
        raise RuntimeError(f"CBS failed: {e}") from e
    titles = {x["key"]: {c["key"]: c["title"] for c in x["codes"]} for x in d["dims"]}
    rows, symbols = [], set()
    for r in raw:
        row = {x["key"]: f"{r[x['key']].strip()} = {titles[x['key']].get(r[x['key']], '?')}" for x in d["dims"]}
        for x in tops:
            v, sym = _cbs_value(r.get(x["key"]))
            row[x["key"]] = v if sym is None else {"value": None, "symbol": sym}
            if sym is not None:
                symbols.add(sym)
        rows.append(row)
    return {"id": t["id"], "title": d["title"], "modified": d["modified"], "rows_total": len(rows),
            "returned": min(len(rows), limit), "truncated": len(rows) > limit, "rows": rows[:limit],
            "topics": {x["key"]: f"{x['title']} ({x['unit']})" if x["unit"] else x["title"] for x in tops},
            "symbols": {s: CBS_SYMBOLS.get(s, "see the table's description") for s in sorted(symbols)},
            "source": url, "scope": CBS_SCOPE}


def cbs_cell(table_id, codes, topic):
    """One CBS value as a /bron/cbs/{table}/{code per dimension, in the table's order}/{topic} citation names it,
    read from CBS again: what the evidence panel shows next to the answer."""
    return _cbs_cell(table_id, tuple(codes), topic, int(time.time() // 3600))


@functools.lru_cache(maxsize=2048)  # ponytail: per process, an hour per cell; the panel loads every chip of an answer at once
def _cbs_cell(table_id, codes, topic, _hour):
    db = cbs_catalog()
    t = _cbs_table(db, table_id)
    d = _cbs_dims(db, t)
    if len(codes) != len(d["dims"]):
        raise KeyError(f"{t['id']} has {len(d['dims'])} dimensions {[x['key'] for x in d['dims']]}; the citation names {len(codes)}")
    r = get_cbs(t["id"], {x["key"]: [c] for x, c in zip(d["dims"], codes)}, [topic], db=db)
    if not r["rows"]:
        raise KeyError(f"CBS has no row for {list(codes)} in {t['id']}")
    row, top = r["rows"][0], next(x for x in d["topics"] if x["key"].lower() == topic.lower())
    v = row[top["key"]]
    sym = v["symbol"] if isinstance(v, dict) else None
    return {"id": t["id"], "title": d["title"], "modified": d["modified"], "page": _cbs_page(t),
            "dimensions": [{"title": x["title"], "value": row[x["key"]]} for x in d["dims"]],
            "topic": top["title"], "group": top["group"], "unit": top["unit"],
            "value": None if sym else v, "symbol": sym, "symbol_meaning": r["symbols"].get(sym) if sym else None,
            "source": r["source"]}


# ---------------------------------------------------------------- Swing Open Data Service (ABF)

# Swing sites with an OData v4 Open Data Service. Each needs a free key per organisation, sent as the header
# `apikey`; a site without a key in the environment is reported as not connected, never guessed around.
SWING = {
    "prognosemodelzw": ("https://prognosemodelzw.nl/ods/odata", "PMZW_API_KEY", "https://prognosemodelzw.nl/contact"),
    "waarstaatjegemeente": ("https://www.waarstaatjegemeente.nl/ods/odata", "WSJG_API_KEY",
                            "https://www.waarstaatjegemeente.nl/contact"),
}
SWING_CAP = 500
SWING_SCOPE = ("Values as the Swing site publishes them, per indicator, area level and period. value null is a value "
               "the site doesn't have, never 0; value_type other than Regular is the site's own mark. Check the "
               "indicator's unit and source; forecast periods are forecasts.")
SWING_SCHEMA = """
CREATE TABLE IF NOT EXISTS swing_indicators(site TEXT, code TEXT, name TEXT, description TEXT, unit TEXT, source TEXT,
  start TEXT, end TEXT, modified TEXT, PRIMARY KEY(site, code));
"""


def _swing(site):
    if site not in SWING:
        raise KeyError(f"no Swing site {site!r}; the sites are {sorted(SWING)}")
    base, env, contact = SWING[site]
    key = os.environ.get(env, "").strip()
    if not key:
        raise RuntimeError(f"{site} is not connected: it needs an API key (free, per organisation), requested at "
                           f"{contact}, set as {env}")
    return base, key


def _swing_all(base, key, path):
    """Every record of a Swing collection, following @odata.nextLink. The key is only ever sent to the site itself."""
    url, out = f"{base}/{path}", []
    host = urllib.parse.urlsplit(base).hostname
    while url:
        if urllib.parse.urlsplit(url).hostname != host:
            raise RuntimeError(f"Swing sent a next page on another host: {url}")
        try:
            d = sources._json(url, headers={"apikey": key}, timeout=120)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise RuntimeError(f"{host} refused the API key (HTTP {e.code})") from e
            if e.code == 404:
                raise KeyError(f"{host} has no {path}") from e
            raise
        out += d.get("value", [])
        url = d.get("@odata.nextLink")
    return out


def _swing_q(v):
    return urllib.parse.quote(str(v).replace("'", "''"), safe="")


def _swing_indicators(site, refresh=False, db=None):
    base, key = _swing(site)  # first: without a key the site is off, even with a filled cache
    db = db or connect()
    db.executescript(SWING_SCHEMA)
    r = db.execute("SELECT fetched_at FROM sources_log WHERE name=?", (f"swing:{site}",)).fetchone()
    if refresh or not r or sources._older(r[0], timedelta(days=1)):
        try:
            rows = [(site, i["Code"], (i.get("Name") or "").strip(), (i.get("Description") or "")[:3000], i.get("Unit"),
                     i.get("Source"), i.get("StartPeriodCode"), i.get("EndPeriodCode"), i.get("DataModificationDate"))
                    for i in _swing_all(base, key, "Indicators")]
            with db:
                db.execute("DELETE FROM swing_indicators WHERE site=?", (site,))
                db.executemany("INSERT INTO swing_indicators VALUES (?,?,?,?,?,?,?,?,?)", rows)
                db.execute("INSERT OR REPLACE INTO sources_log VALUES (?, ?)", (f"swing:{site}", sources._iso(sources._now())))
        except (OSError, KeyError, ValueError):
            if not db.execute("SELECT 1 FROM swing_indicators WHERE site=? LIMIT 1", (site,)).fetchone():
                raise
    return db


def search_swing(site, q, limit=20, db=None):
    """A Swing site's indicators whose code, name or description contains every word (accents ignored)."""
    db = _swing_indicators(site, db=db)
    words = [sources._fold(w) for w in q.split()]
    hits = [dict(r) for r in db.execute("SELECT * FROM swing_indicators WHERE site=? ORDER BY name", (site,))
            if all(w in sources._fold(f"{r['code']} {r['name']} {r['description']}") for w in words)]
    out = [{"code": h["code"], "name": h["name"], "unit": h["unit"], "source": h["source"],
            "periods": f"{h['start']}–{h['end']}", "description": h["description"][:300]} for h in hits[:limit]]
    return {"site": site, "query": q, "total": len(hits), "returned": len(out), "truncated": len(hits) > len(out),
            "results": out, "scope": "Indicator names and descriptions; get_swing lists what each one has."}


def get_swing(site, indicator, geo_level=None, period=None, geo_query=None, dimension_levels="", limit=SWING_CAP, db=None):
    """Without geo_level and period: which area levels, periods and breakdowns the indicator has. With them: its
    values per area, each area named; geo_query keeps areas whose name or code has every word."""
    db = _swing_indicators(site, db=db)
    base, key = _swing(site)
    meta = db.execute("SELECT * FROM swing_indicators WHERE site=? AND code=?", (site, indicator)).fetchone()
    if not meta:
        raise KeyError(f"no indicator {indicator!r} on {site}; find one with search_swing")
    info = {"site": site, "indicator": indicator, "name": meta["name"], "unit": meta["unit"], "source": meta["source"],
            "description": meta["description"][:1000]}
    cubes = _swing_all(base, key, f"Indicators/{_swing_q(indicator)}/DataCubes")
    if not geo_level or not period:
        combos = {}
        for c in cubes:
            k = (c["GeoLevel"], c.get("DimensionLevels") or "", c.get("DimensionLevelNames") or "")
            combos.setdefault(k, []).append(c["Period"])
        return {**info, "combinations": [{"geo_level": g, "dimension_levels": dl, "dimensions": dn, "periods": p}
                                         for (g, dl, dn), p in sorted(combos.items())], "scope": SWING_SCOPE}
    if not any(c["GeoLevel"] == geo_level and c["Period"] == period and (c.get("DimensionLevels") or "") == dimension_levels
               for c in cubes):
        raise KeyError(f"{indicator} has no data for geo_level={geo_level!r}, period={period!r}, "
                       f"dimension_levels={dimension_levels!r}; call get_swing without them to see what it has")
    path = (f"DataCubes(Dimensionlevels='{_swing_q(dimension_levels)}',GeoLevel='{_swing_q(geo_level)}',"
            f"Indicator='{_swing_q(indicator)}',Period='{_swing_q(period)}')/Data")
    data = _swing_all(base, key, path)
    areas = {m["Code"]: m.get("Name") for m in _swing_all(base, key, f"GeoLevels/{_swing_q(geo_level)}/GeoLevelMembers")}
    dims = {}
    for lvl in filter(None, dimension_levels.split(",")):
        dims.update({m["Code"]: m.get("Name") for m in _swing_all(base, key, f"DimensionLevels/{_swing_q(lvl)}/DimensionLevelMembers")})
    # a word matches the start of a word in the code or name: 'assen' is Assen, not Wassenaar
    words = [re.compile(rf"(?<![a-z0-9]){re.escape(sources._fold(w))}") for w in (geo_query or "").split()]
    rows = []
    for v in data:
        area = f"{v['GeoItem']} = {areas.get(v['GeoItem'], '?')}"
        if not all(w.search(sources._fold(area)) for w in words):
            continue
        row = {"area": area, "period": v["Period"], "value": v.get("Value"), "value_type": v.get("ValueType")}
        if v.get("DimensionLevelMembers"):
            row["breakdown"] = ", ".join(f"{m} = {dims.get(m, '?')}" for m in v["DimensionLevelMembers"].split(","))
        rows.append(row)
    return {**info, "geo_level": geo_level, "period": period, "rows_total": len(rows), "returned": min(len(rows), limit),
            "truncated": len(rows) > limit, "rows": rows[:limit], "source_url": f"{base}/{path}",
            "site_url": base.rsplit("/ods/", 1)[0], "scope": SWING_SCOPE}


# ---------------------------------------------------------------- CLI

def check():
    probes = {
        "catalogue": lambda: search_datasets("wachtlijsten")["total"] > 0,
        "dataset": lambda: get_dataset("48170-government-finance-statistics--key-figures")["resource_count"] > 0,
        "cbs search": lambda: any(h["id"] == "85968ENG" for h in search_cbs("government finance statistics key figures")["results"]),
        "cbs values": lambda: get_cbs("85968ENG", {"Periods": ["2025JJ00"]}, ["GovernmentRevenue_1"])["rows"][0]["GovernmentRevenue_1"] > 0,
        "cbs dataderden": lambda: describe_cbs_table(search_cbs("Wmo-cliënten maatwerkvoorziening")["results"][0]["id"])["dimensions"],
        "rivm statline": lambda: any(h["id"] == "50137NED" for h in search_cbs("kosten van ziekten")["results"]),
        "open dis": lambda: read_table("https://opendisdata.nza.nl/download/csv/06_REF_SPC.csv", filters={"SPECIALISME_CD": ["0303"]})["rows_matched"] > 0,
        "open dis moved host": lambda: read_table("http://www.opendisdata.nl/download/csv/06_REF_SPC.csv", limit=1)["rows_total"] > 0,
        "zorginzicht kvk": lambda: read_table(next(x["url"] for x in documents.links(
            "https://www.zorginzicht.nl/algemeen/open-data-wijkverpleging", "Wijkverpleging verslagjaar 2024 Excel")["links"]),
            filters={"KvkNummer": ["61354740"]})["rows_matched"] > 0,
        **{f"swing {s}": (lambda s=s: search_swing(s, "zorg")["total"] > 0) for s in SWING if os.environ.get(SWING[s][1])},
    }
    ok = True
    for name, probe in probes.items():
        try:
            good = bool(probe())
        except Exception as e:
            good, name = False, f"{name}: {e}"
        ok &= good
        print(f"{'ok  ' if good else 'FAIL'} {name}")
    return ok


def main(argv=None):
    import argparse
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("datasets").add_argument("q")
    sub.add_parser("dataset").add_argument("id")
    s = sub.add_parser("table"); s.add_argument("url"); s.add_argument("--query"); s.add_argument("--sheet")
    s.add_argument("--filters", default="{}", help='JSON, e.g. {"KvkNummer": ["61354740"]}'); s.add_argument("--member")
    s = sub.add_parser("swing"); s.add_argument("site", choices=sorted(SWING)); s.add_argument("q")
    s = sub.add_parser("swing-get"); s.add_argument("site", choices=sorted(SWING)); s.add_argument("indicator")
    s.add_argument("--geo-level"); s.add_argument("--period"); s.add_argument("--geo-query"); s.add_argument("--dimension-levels", default="")
    sub.add_parser("cbs").add_argument("q")
    s = sub.add_parser("cbs-table"); s.add_argument("id"); s.add_argument("--dimension"); s.add_argument("--query")
    s = sub.add_parser("cbs-get"); s.add_argument("id"); s.add_argument("--filters", default="{}", help='JSON, e.g. {"Perioden": ["2024JJ00"]}')
    s.add_argument("--topics", nargs="*")
    sub.add_parser("check")
    a = p.parse_args(argv)
    if a.cmd == "check":
        sys.exit(0 if check() else 1)
    r = {"datasets": lambda: search_datasets(a.q), "dataset": lambda: get_dataset(a.id),
         "table": lambda: read_table(a.url, a.query, sheet=a.sheet, filters=json.loads(a.filters), member=a.member),
         "swing": lambda: search_swing(a.site, a.q),
         "swing-get": lambda: get_swing(a.site, a.indicator, a.geo_level, a.period, a.geo_query, a.dimension_levels),
         "cbs": lambda: search_cbs(a.q),
         "cbs-table": lambda: describe_cbs_table(a.id, a.dimension, a.query),
         "cbs-get": lambda: get_cbs(a.id, json.loads(a.filters), a.topics)}[a.cmd]()
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
