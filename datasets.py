"""Open datasets: the national catalogue (data.overheid.nl), the files it points to, and every CBS StatLine table.

Checked against the live services on 2026-11-12:
  Catalogue  CKAN https://data.overheid.nl/data/api/3/action/package_search|package_show: ~18,000 datasets from 25
             catalogues (CBS, CBS DataDerden, DONL with ministries' and agencies' own data, DNB, municipalities).
             Descriptions can be years older or newer than the data, and a resource URL is often a web page.
  Files      CSV, Excel (.xlsx) and JSON read here as rows; old .xls (binary) is not readable without a library.
  CBS        https://opendata.cbs.nl (5,986 tables) and https://dataderden.cbs.nl (831, data CBS hosts for others:
             Iv3, youth care and Wmo per municipality, health monitors), both OData v3. Dimension keys are padded
             inconsistently, so they are always read from the table; UntypedDataSet keeps CBS's symbols ('.', 'x',
             '-') that the typed feed turns into null; a query of 10,000 rows or more is refused, not paged."""

import csv
import io
import json
import re
import sys
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
TABLE_SCOPE = ("Rows as they are in the file, values verbatim. Excel dates show as day numbers (45658 = 1 Jan 2025). "
               "row = the row's number in the file as a spreadsheet program shows it (JSON: the record's number), "
               "to cite with the file URL.")

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


def csv_rows(body):
    text = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):  # latin-1 decodes any byte: the last resort
        try:
            text = body.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return list(csv.reader(io.StringIO(text), dialect))


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
    """A data file by URL, cached for TABLE_TTL. Returns (body, content type, final URL, fetched at)."""
    cache = documents.PUB / "tables" / documents.doc_id(url)
    meta = cache.with_suffix(".json")
    if not refresh and meta.exists() and not sources._older(json.loads(meta.read_text())["fetched_at"], TABLE_TTL):
        m = json.loads(meta.read_text())
        return cache.read_bytes(), m["content_type"], m["file_url"], m["fetched_at"]
    body, ctype, final = documents.fetch(url)
    cache.parent.mkdir(parents=True, exist_ok=True)
    stamp = sources._iso(sources._now())
    for path, data in ((cache, body), (meta, json.dumps({"content_type": ctype, "file_url": final, "fetched_at": stamp}).encode())):
        tmp = path.with_name(path.name + ".part")
        tmp.write_bytes(data)
        tmp.replace(path)
    return body, ctype, final, stamp


def read_table(url, query=None, limit=50, offset=0, sheet=None, header_row=None, refresh=False):
    """Rows of a CSV, Excel (.xlsx) or JSON file. query keeps rows containing every word (accents ignored), e.g.
    an AGB code, a municipality or 'begeleiding'. header_row (1-based) overrides the detected header."""
    body, ctype, final, fetched = _file(url.strip(), refresh)
    sheets = None
    if body[:4] == b"\xd0\xcf\x11\xe0":
        raise ValueError("an old binary Excel file (.xls), which cannot be read here; look for a .xlsx or .csv version")
    if body[:2] == b"PK" and "xl/workbook.xml" in zipfile.ZipFile(io.BytesIO(body)).namelist():
        fmt, (sheet, sheets, rows) = "xlsx", xlsx_rows(body, sheet)
    elif "json" in ctype or body.lstrip()[:1] in (b"[", b"{"):
        fmt, rows = "json", json_rows(body)
    elif body[:5] == b"%PDF-":
        raise ValueError("a PDF, not a data file: read it with read_document")
    elif "html" in ctype or body.lstrip()[:15].lower().startswith((b"<!doctype", b"<html")):
        raise ValueError("this URL is a web page, not a data file: read it with read_document to find the file link")
    else:
        fmt, rows = "csv", csv_rows(body)
    h = header_row or _header_row(rows)
    if not 1 <= h <= len(rows):
        raise ValueError(f"header_row must be between 1 and {len(rows)}")
    # a value right of the last header cell still gets a column, never dropped
    width = max(map(len, rows[h - 1:]))
    cols = _columns(rows[h - 1] + [None] * (width - len(rows[h - 1])))
    # n is the row's number in the file as a spreadsheet shows it (JSON: the record's number), so a citation finds it
    data = [(n - (fmt == "json"), r) for n, r in enumerate(rows[h:], h + 1) if any(v not in (None, "") for v in r)]
    words = [sources._fold(w) for w in (query or "").split()]
    matched = [(n, r) for n, r in data
               if all(w in sources._fold(" ".join("" if v is None else str(v) for v in r)) for w in words)]
    page = matched[offset:offset + min(limit, 200)]
    return {"url": url, "file_url": final, "format": fmt, "sheet": sheet, "sheets": sheets, "fetched_at": fetched,
            "header_row": h, "title_rows": [t for r in rows[:h - 1] if (t := [v for v in r if v not in (None, "")])][:5],
            "columns": cols, "rows_total": len(data), "rows_matched": len(matched), "returned": len(page),
            "truncated": len(matched) > offset + len(page),
            "rows": [{"row": n, **{c: (r[i] if i < len(r) else None) for i, c in enumerate(cols)}} for n, r in page],
            "scope": TABLE_SCOPE}


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


def describe_cbs_table(table_id, dimension=None, query=None, db=None):
    """What a table holds: its topics (with unit) and dimensions. With `dimension`, that dimension's codes,
    filtered on `query` (words in code or title): how to find e.g. a municipality's code in a regional table."""
    db = cbs_catalog(db=db)
    t = _cbs_table(db, table_id)
    d = _cbs_dims(db, t)
    out = {"id": t["id"], "title": d["title"], "period": d["period"], "modified": d["modified"],
           "description": d["description"][:3000], "catalogue": t["host"].split("//")[1],
           "page": f"{t['host']}/#/CBS/nl/dataset/{t['id']}/table" if "opendata" in t["host"] else t["host"],
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


# ---------------------------------------------------------------- CLI

def check():
    probes = {
        "catalogue": lambda: search_datasets("wachtlijsten")["total"] > 0,
        "dataset": lambda: get_dataset("48170-government-finance-statistics--key-figures")["resource_count"] > 0,
        "cbs search": lambda: any(h["id"] == "85968ENG" for h in search_cbs("government finance statistics key figures")["results"]),
        "cbs values": lambda: get_cbs("85968ENG", {"Periods": ["2025JJ00"]}, ["GovernmentRevenue_1"])["rows"][0]["GovernmentRevenue_1"] > 0,
        "cbs dataderden": lambda: describe_cbs_table(search_cbs("Wmo-cliënten maatwerkvoorziening")["results"][0]["id"])["dimensions"],
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
    sub.add_parser("cbs").add_argument("q")
    s = sub.add_parser("cbs-table"); s.add_argument("id"); s.add_argument("--dimension"); s.add_argument("--query")
    s = sub.add_parser("cbs-get"); s.add_argument("id"); s.add_argument("--filters", default="{}", help='JSON, e.g. {"Perioden": ["2024JJ00"]}')
    s.add_argument("--topics", nargs="*")
    sub.add_parser("check")
    a = p.parse_args(argv)
    if a.cmd == "check":
        sys.exit(0 if check() else 1)
    r = {"datasets": lambda: search_datasets(a.q), "dataset": lambda: get_dataset(a.id),
         "table": lambda: read_table(a.url, a.query, sheet=a.sheet), "cbs": lambda: search_cbs(a.q),
         "cbs-table": lambda: describe_cbs_table(a.id, a.dimension, a.query),
         "cbs-get": lambda: get_cbs(a.id, json.loads(a.filters), a.topics)}[a.cmd]()
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
