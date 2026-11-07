"""DigiMV jaarverantwoording index, PDF cache and Markdown knowledge base.

Source: the public JSON API behind https://digimv13.desan.nl/archive/search
  GET /api/ArchiveSearch/GetArchiveSearchResult?organization=&town=&year=Y  -> full index for year Y
  GET /api/ArchiveSearch/GetDocument?documentId=ID&year=Y                  -> the PDF

Notes on the data (verified against the live API):
  - externalOrganizationId is usually the KvK number, but not always ("GeenKvK012", "Def_CMH", "POT00020").
  - Locations are sub-organisations; they often reuse their parent's KvK. Key: (year, org_id, parent_id).
  - Document ids restart per year. Key: (year, id).
"""

import argparse
import base64
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

BASE = "https://digimv13.desan.nl/api/ArchiveSearch"
# scanned pages only. Pinned, not "-latest": that alias moved to a thinking model (28 s/page vs 3 s)
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
EXTRACTOR = 2  # bump when extraction changes: cached documents from older versions count as stale
UA = "jaarverantwoording-zorg/0.1"
YEARS = range(2019, date.today().year + 1)  # API returns [] for years outside its archive window
DATA = Path(os.environ.get("DATA_DIR", Path(__file__).parent / "data"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS orgs(
  year INT, org_id TEXT, parent_id TEXT, name TEXT, town TEXT, concern_id TEXT,
  PRIMARY KEY(year, org_id, parent_id));
CREATE TABLE IF NOT EXISTS docs(
  year INT, id INT, org_id TEXT, parent_id TEXT, type TEXT, file_name TEXT, file_size INT,
  published TEXT, description TEXT, location_summary TEXT, desaveu TEXT,
  PRIMARY KEY(year, id));
CREATE INDEX IF NOT EXISTS docs_org ON docs(org_id, year);
CREATE VIRTUAL TABLE IF NOT EXISTS orgs_fts USING fts5(
  name, town, org_id, content='orgs', tokenize='trigram remove_diacritics 1');
CREATE TABLE IF NOT EXISTS sync_log(year INT, synced_at TEXT, orgs INT, docs INT);
CREATE TABLE IF NOT EXISTS kb(
  year INT, doc_id INT, org_id TEXT, published TEXT, pages INT, PRIMARY KEY(year, doc_id));
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  md, year UNINDEXED, doc_id UNINDEXED, page UNINDEXED, org_id UNINDEXED,
  tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS figures_log(
  year INT, org_id TEXT, fetched_at TEXT, name TEXT, finished TEXT, n INT, v INT, PRIMARY KEY(year, org_id));
CREATE VIRTUAL TABLE IF NOT EXISTS figures_fts USING fts5(
  label, var, value UNINDEXED, unit UNINDEXED, year UNINDEXED, org_id UNINDEXED, category_id UNINDEXED,
  rgi UNINDEXED, tokenize='trigram remove_diacritics 1');
"""


def connect(path=None):
    path = str(path or DATA / "digimv.db")
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    if path != ":memory:":
        db.execute("PRAGMA journal_mode=WAL")  # readers (API/MCP) keep working while a sync writes
    db.executescript(SCHEMA)
    return db


def _http(url, data=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def doc_url(year, doc_id):
    return f"{BASE}/GetDocument?" + urllib.parse.urlencode({"documentId": doc_id, "year": year})


# ---------------------------------------------------------------- index sync

def flatten(data):
    """API response for one year -> (org rows, doc rows). Plain lists, no dedup: collisions must fail loudly."""
    orgs, docs = [], []

    def add_docs(entry, parent_id, desaveu=None):
        for d in entry["documents"]:
            docs.append((d["id"], entry["externalOrganizationId"], parent_id, d["type"], d["fileName"],
                         d["fileSize"], d["publishedDate"], d["description"], d["locationSummary"], desaveu))

    for o in data:
        oid = o["externalOrganizationId"]
        orgs.append((oid, "", o["name"], o["town"], o["concernId"]))
        add_docs(o, "")
        for el in o["desaveuElements"]:
            add_docs({**el, "externalOrganizationId": oid}, "", el["title"])
        for loc in o["locations"]:
            orgs.append((loc["externalOrganizationId"], oid, loc["name"], loc["town"], o["concernId"]))
            add_docs(loc, oid)
    return orgs, docs


def load_year(db, year, data):
    """Replace one year in a single transaction. Returns (api_orgs, db_orgs, api_docs, db_docs)."""
    orgs, docs = flatten(data)
    have = db.execute("SELECT count(*) FROM orgs WHERE year=?", (year,)).fetchone()[0]
    if not orgs and have:
        # ponytail: an empty response for a year we hold is treated as an outage, never as "delete everything"
        raise ValueError(f"{year}: API returned no organisations but the index holds {have}; keeping existing data")
    with db:
        db.execute("DELETE FROM orgs WHERE year=?", (year,))
        db.execute("DELETE FROM docs WHERE year=?", (year,))
        db.executemany("INSERT INTO orgs VALUES (?,?,?,?,?,?)", [(year, *r) for r in orgs])
        db.executemany("INSERT INTO docs VALUES (?,?,?,?,?,?,?,?,?,?,?)", [(year, *r) for r in docs])
        db.execute("INSERT INTO orgs_fts(orgs_fts) VALUES('rebuild')")
        n_orgs = db.execute("SELECT count(*) FROM orgs WHERE year=?", (year,)).fetchone()[0]
        n_docs = db.execute("SELECT count(*) FROM docs WHERE year=?", (year,)).fetchone()[0]
        if (n_orgs, n_docs) != (len(orgs), len(docs)):
            raise ValueError(f"{year}: stored {n_orgs} orgs/{n_docs} docs, API had {len(orgs)}/{len(docs)}")
        db.execute("INSERT INTO sync_log VALUES (?,?,?,?)",
                   (year, datetime.now(timezone.utc).isoformat(timespec="seconds"), n_orgs, n_docs))
    return len(orgs), n_orgs, len(docs), n_docs


def sync(years=YEARS, db=None):
    """Fetch the full index per year. Returns True when every year reconciled."""
    db = db or connect()
    ok = True
    print(f"{'year':>4} {'api_orgs':>9} {'db_orgs':>8} {'api_docs':>9} {'db_docs':>8}  status")
    for y in years:
        try:
            url = f"{BASE}/GetArchiveSearchResult?" + urllib.parse.urlencode({"organization": "", "town": "", "year": y})
            data = json.loads(_http(url, headers={"Accept": "application/json"}))
            a_o, d_o, a_d, d_d = load_year(db, y, data)
            print(f"{y:>4} {a_o:>9} {d_o:>8} {a_d:>9} {d_d:>8}  ok")
        except Exception as e:  # report every year, then fail the run
            ok = False
            print(f"{y:>4} {'':>9} {'':>8} {'':>9} {'':>8}  FAILED: {e}")
    return ok


def last_sync(db=None):
    db = db or connect()
    return db.execute("SELECT max(synced_at) FROM sync_log").fetchone()[0]


# ---------------------------------------------------------------- search

def _org_query(q):
    """'woonzorgg  arnh' -> '"woonzorgg" "arnh"': every token is a substring (trigram index), so Dutch
    compounds like 'Woonzorggroep' match 'zorggroep'. Quoting keeps FTS syntax out of user input."""
    # ponytail: tokens under 3 chars can't use a trigram index and are dropped ('De Hoop' -> 'Hoop')
    return " ".join(f'"{t}"' for t in re.findall(r"\w+", q) if len(t) >= 3)


def _text_query(q):
    """'eigen verm' -> '"eigen"* "verm"*': word-prefix match on OCR'd pages (word tokenizer = readable snippets)."""
    # ponytail: no mid-word match here ('lasten' misses 'bedrijfslasten'); trigram pages if agents need it
    return " ".join(f'"{t}"*' for t in re.findall(r"\w+", q))


def _doc_dict(r):
    d = dict(r)
    d["url"] = doc_url(d["year"], d["id"])
    return d


def search(q, year=None, doc_type=None, limit=50, db=None):
    """Organisations matching q (substrings of name/town/org id, or an exact org id), across all years.

    One result per org_id; documents listed per year. doc_type is a case-insensitive prefix, e.g. "jaarrekening".
    """
    db = db or connect()
    q = q.strip()
    type_like = f"{doc_type}%" if doc_type else None
    filters, args = "", []
    if year:
        filters += " AND o.year=?"
        args.append(year)
    if type_like:
        filters += " AND EXISTS (SELECT 1 FROM docs d WHERE d.year=o.year AND d.org_id=o.org_id AND d.type LIKE ?)"
        args.append(type_like)

    if db.execute("SELECT 1 FROM orgs WHERE org_id=?", (q,)).fetchone():
        ids = [r[0] for r in db.execute(f"SELECT DISTINCT o.org_id FROM orgs o WHERE o.org_id=?{filters}", (q, *args))]
    elif match := _org_query(q):
        ids = [r[0] for r in db.execute(
            f"""SELECT o.org_id FROM orgs_fts JOIN orgs o ON o.rowid = orgs_fts.rowid
                WHERE orgs_fts MATCH ?{filters}
                GROUP BY o.org_id ORDER BY min(orgs_fts.rank), max(o.year) DESC, min(o.name) LIMIT ?""",
            (match, *args, limit))]  # trigram bm25 ties a lot; recent filers first
    else:
        return []

    out = []
    for oid in ids:
        rows = db.execute("SELECT * FROM orgs WHERE org_id=? ORDER BY year DESC, parent_id=''  DESC", (oid,)).fetchall()
        dq, dargs = "SELECT * FROM docs WHERE org_id=?", [oid]
        if year:
            dq += " AND year=?"
            dargs.append(year)
        if type_like:
            dq += " AND type LIKE ?"
            dargs.append(type_like)
        out.append({
            "org_id": oid,
            "name": rows[0]["name"],
            "town": rows[0]["town"],
            "former_names": sorted({r["name"] for r in rows} - {rows[0]["name"]}),
            "parents": sorted({r["parent_id"] for r in rows if r["parent_id"] not in ("", oid)}),
            "years": sorted({r["year"] for r in rows}),
            "documents": [_doc_dict(d) for d in db.execute(dq + " ORDER BY year DESC, type, id", dargs)],
        })
    return out


def get_doc(year, doc_id, db=None):
    """Index metadata for one document, joined with its organisation's name."""
    db = db or connect()
    r = db.execute("""SELECT d.*, o.name AS org_name FROM docs d
                      LEFT JOIN orgs o ON o.year=d.year AND o.org_id=d.org_id AND o.parent_id=d.parent_id
                      WHERE d.year=? AND d.id=?""", (year, doc_id)).fetchone()
    if not r:
        raise KeyError(f"document {year}/{doc_id} is not in the index (run: digimv.py sync)")
    return _doc_dict(r)


# ---------------------------------------------------------------- PDF cache

def pdf_path(year, doc_id):
    return DATA / "pdf" / str(year) / f"{doc_id}.pdf"


def _pdf_ok(data, size):
    return data[:5] == b"%PDF-" and len(data) == size


def get_pdf(year, doc_id, db=None):
    """Cached PDF path; downloads it when missing. Verifies magic bytes and the index's fileSize."""
    d = get_doc(year, doc_id, db)
    p = pdf_path(year, doc_id)
    if p.exists() and p.stat().st_size == d["file_size"]:
        return p
    for _ in range(2):
        data = _http(d["url"])
        if _pdf_ok(data, d["file_size"]):
            break
    else:
        raise ValueError(f"{year}/{doc_id}: got {len(data)} bytes starting {data[:5]!r}, "
                         f"index says {d['file_size']} bytes of PDF")
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(p)
    return p


# ---------------------------------------------------------------- OCR + knowledge base

def _safe(s):
    return re.sub(r"[^\w.-]", "_", s)


def md_dir(d):
    return DATA / "md" / _safe(d["org_id"]) / str(d["year"])


SCAN_PROMPT = """This is a scanned page from a Dutch healthcare organisation's annual report \
(jaarverantwoording). Transcribe it to Markdown exactly as printed: every word and number verbatim, \
Dutch number formatting kept (1.234,56 and -/- or brackets for negatives), nothing summarised, translated, \
corrected or added. Tables become Markdown tables with the same rows and columns; empty cells stay empty. \
Headings become Markdown headings. Skip signatures and stamps except for legible printed text in them. \
Output only the Markdown; an empty answer for a blank page."""


def _is_scan(page):
    """The page's content lives in an image: there is an image and almost no *visible* text.

    Visible only, because scanned PDFs often carry an invisible scanner-OCR layer (which pymupdf4llm skips)
    and auditors stamp a short visible line ("Voor identificatiedoeleinden ...") on every scanned page.
    Measured on DigiMV: scans have <= 93 visible chars, designed pages with photos >= 124 (plus a cover).
    """
    import pymupdf

    imgs = page.get_image_info()
    if not imgs:
        return False  # blank or pure text
    visible = sum(1 for sp in page.get_texttrace() if sp["type"] != 3 and sp.get("opacity", 1) > 0
                  for c in sp["chars"] if chr(c[0]).strip())
    cover = max(abs(pymupdf.Rect(i["bbox"]) & page.rect) / abs(page.rect) for i in imgs)
    # ponytail: a photo cover page with a short title also goes to Gemini; costs one page, loses nothing
    return visible < 50 or (visible < 200 and cover >= 0.5)


def _gemini(pdf_bytes):
    """Transcribe a one-page PDF scan with Gemini. Returns (markdown, exact model version)."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set (needed for scanned pages)")
    body = {"contents": [{"parts": [
                {"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(pdf_bytes).decode()}},
                {"text": SCAN_PROMPT}]}],
            "generationConfig": {"temperature": 0}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    for attempt in range(4):
        try:
            raw = _http(url, data=json.dumps(body).encode(), timeout=300,
                        headers={"x-goog-api-key": key, "Content-Type": "application/json"})
            break
        except urllib.error.HTTPError as e:
            msg = e.read()[:400].decode(errors="replace")
            if e.code in (429, 500, 503) and attempt < 3:  # rate limit / overload: back off
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f"Gemini HTTP {e.code}: {msg}") from e
    res = json.loads(raw)
    cand = (res.get("candidates") or [{}])[0]
    if cand.get("finishReason") != "STOP":
        raise ValueError(f"Gemini stopped with {cand.get('finishReason')}")
    md = "".join(p.get("text", "") for p in cand["content"]["parts"]).strip()
    md = re.sub(r"^```(?:markdown)?\n|\n```$", "", md)  # some models fence their answer
    return md.strip(), res.get("modelVersion", GEMINI_MODEL)


def extract_pages(path):
    """PDF -> [{"markdown", "source"}] per page.

    Pages with a text layer are read locally (exact characters, free). Scanned pages go to Gemini one page
    per request, all in parallel: a page takes ~3 s with flash-lite, so a scanned document takes seconds.
    """
    import pymupdf  # heavy imports only when extracting
    import pymupdf4llm

    doc = pymupdf.open(path)
    scans = [i for i, pg in enumerate(doc) if _is_scan(pg)]
    out = [None] * doc.page_count
    texts = [i for i in range(doc.page_count) if i not in set(scans)]
    if texts:
        for c in pymupdf4llm.to_markdown(doc, pages=texts, page_chunks=True, use_ocr=False, show_progress=False):
            out[c["metadata"]["page_number"] - 1] = {"markdown": c["text"].strip(), "source": "text"}

    blobs = []
    for i in scans:  # PyMuPDF isn't thread-safe: build the one-page PDFs here, only HTTP runs in threads
        sub = pymupdf.open()
        sub.insert_pdf(doc, from_page=i, to_page=i)
        blobs.append(sub.tobytes())
    with ThreadPoolExecutor(16) as ex:  # ponytail: fixed fan-out; paid-tier flash-lite allows thousands RPM
        for i, (md, model) in zip(scans, ex.map(_gemini, blobs)):
            out[i] = {"markdown": md, "source": model}

    missing = [i + 1 for i, pg in enumerate(out) if pg is None]
    if missing:
        raise ValueError(f"{path.name}: no output for pages {missing}")
    return out


def build_md(d, pages, sources=None):
    ocr = sorted({s for s in sources or [] if s != "text"})
    fm = {"org": d["org_name"], "org_id": d["org_id"], "year": d["year"], "doc_id": d["id"], "type": d["type"],
          "file_name": d["file_name"], "published": d["published"], "source": d["url"], "pages": len(pages),
          "ocr_pages": [i for i, s in enumerate(sources or [], 1) if s != "text"], "ocr_model": ocr[0] if ocr else None}
    head = "---\n" + "".join(f"{k}: {json.dumps(v, ensure_ascii=False)}\n" for k, v in fm.items()) + "---\n"
    return head + "".join(f"\n<!-- page {i} -->\n{md}\n" for i, md in enumerate(pages, 1))


def index_pages(db, d, pages):
    with db:
        # ponytail: delete filters on UNINDEXED columns = full scan; fine until the KB holds ~1M pages
        db.execute("DELETE FROM pages_fts WHERE year=? AND doc_id=?", (d["year"], d["id"]))
        db.executemany("INSERT INTO pages_fts VALUES (?,?,?,?,?)",
                       [(md, d["year"], d["id"], i, d["org_id"]) for i, md in enumerate(pages, 1)])
        db.execute("INSERT OR REPLACE INTO kb VALUES (?,?,?,?,?)",
                   (d["year"], d["id"], d["org_id"], d["published"], len(pages)))


def get_document(year, doc_id, db=None):
    """Download + extract on first use, cached afterwards. Returns metadata, pages and file paths.

    Cache is fresh when {id}.pages.json has the index's `published` and the current EXTRACTOR version; a
    corrected re-publication triggers a new download, an extractor change only a new extraction.
    """
    db = db or connect()
    d = get_doc(year, doc_id, db)
    out = md_dir(d)
    cache_file, md_file = out / f"{doc_id}.pages.json", out / f"{doc_id}.md"
    cached = json.loads(cache_file.read_text()) if cache_file.exists() else None
    if not cached or cached["published"] != d["published"] or cached.get("extractor") != EXTRACTOR:
        if cached and cached["published"] != d["published"]:  # never reuse the old PDF, even if same size
            pdf_path(year, doc_id).unlink(missing_ok=True)
        cached = {"published": d["published"], "extractor": EXTRACTOR, "doc": d,
                  "pages": extract_pages(get_pdf(year, doc_id, db))}
        out.mkdir(parents=True, exist_ok=True)
        tmp = cache_file.with_suffix(".part")
        tmp.write_text(json.dumps(cached, ensure_ascii=False))
        tmp.replace(cache_file)
        md_file.unlink(missing_ok=True)
    pages = [p["markdown"] for p in cached["pages"]]
    sources = [p["source"] for p in cached["pages"]]
    md_written = not md_file.exists()
    if md_written:
        md_file.write_text(build_md(d, pages, sources))
    kb = db.execute("SELECT published, pages FROM kb WHERE year=? AND doc_id=?", (year, doc_id)).fetchone()
    if not kb or kb[0] != d["published"] or md_written:
        index_pages(db, d, pages)
    return {**d, "pages": pages, "page_sources": sources, "page_count": len(pages),
            "pdf_path": str(pdf_path(year, doc_id)), "md_path": str(md_file)}


def parse_pages(spec, n):
    """'1-3,8' -> [1, 2, 3, 8], clipped to 1..n. Empty / 'all' -> every page."""
    if not spec or spec.strip().lower() == "all":
        return list(range(1, n + 1))
    out = []
    for part in spec.split(","):
        a, _, b = part.strip().partition("-")
        out += range(int(a), int(b or a) + 1)
    return [p for p in dict.fromkeys(out) if 1 <= p <= n]


def search_text(q, org_id=None, year=None, doc_id=None, limit=20, db=None):
    """Full-text search over every OCR'd page in the knowledge base."""
    db = db or connect()
    match = _text_query(q)
    if not match:
        return []
    sql, args = """SELECT p.year, p.doc_id, p.page, p.org_id, d.type, d.file_name, p.md,
                          snippet(pages_fts, 0, '«', '»', ' … ', 24) AS snippet
                   FROM pages_fts p LEFT JOIN docs d ON d.year=p.year AND d.id=p.doc_id
                   WHERE pages_fts MATCH ?""", [match]
    for col, val in (("org_id", org_id), ("year", year), ("doc_id", doc_id)):
        if val is not None:
            sql += f" AND p.{col}=?"
            args.append(val)
    out = []
    for r in db.execute(sql + " ORDER BY rank LIMIT ?", (*args, limit)):
        r = dict(r)
        r["heading"] = page_heading(r.pop("md"))  # which statement a hit is from: consolidated vs segment
        out.append(r)
    return out


def page_heading(md):
    """First Markdown headings of a page, e.g. 'II.2 LUMC-GROEP › Geconsolideerde winst- en verliesrekening'."""
    lines = re.findall(r"^#{1,6} .+$|^\*\*[^*|\n]{6,}\*\*\s*$", md, re.M)  # headings and full-bold title lines
    heads = [re.sub(r"[#*_]+", "", h).strip() for h in lines]
    return " › ".join(dict.fromkeys(h for h in heads if h)).strip()[:200] or None


# ---------------------------------------------------------------- structured figures (DigiMV questionnaire)

FIGURES_FROM = 2020  # the archive serves questionnaires from DigiMV2020 on; older years answer HTTP 500
FIGURES_V = 2  # bump when labels/filtering change: cached org-years from older versions are refetched
ARCHIVE = "https://digimv13.desan.nl/api/Archive/GetArchiveData"


def render_label(text):
    """Questionnaire labels embed JS such as ${isTrue(q.isGroepshoofd) ? ' - enkelvoudig' : ''}. The flags
    aren't public, so show every branch: 'A / B', and an optional part in [brackets]. Never guess a branch."""
    out, i = [], 0
    while (j := text.find("${", i)) >= 0:
        out.append(text[i:j])
        depth, k, quote = 0, j + 1, None
        while k < len(text):  # matching brace, skipping quoted strings
            ch = text[k]
            if quote:
                if ch == "\\":
                    k += 1
                elif ch == quote:
                    quote = None
            elif ch in "'\"":
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        branches = [a if a is not None else b for a, b in
                    re.findall(r"[?:]\s*(?:'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\")", text[j:k])]
        alts = list(dict.fromkeys(b.strip() for b in branches if b.strip()))
        part = " / ".join(alts)
        out.append(f" [{part}]" if part and len(alts) < len(branches) else f" {part}" if part else "")
        i = k + 1
    out.append(text[i:])
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", "".join(out)))).strip()


def figure_rows(data):
    """GetArchiveData response -> [(category_id, rgi, var, label, unit, value)] for every answer the public
    archive shows: isVisible and not reportSettings.archiveHidden (same rule as DigiMV's own archive page).
    Values stay verbatim strings."""
    byid = {n["id"]: n for n in data["nodes"]}
    cat = {c["id"]: (n, c) for n in data["nodes"] for c in n.get("categories") or []}
    rows = []
    for r in data["responses"]:
        if r["value"] in (None, "") or not r["isVisible"]:
            continue
        n, c = cat.get(r["categoryId"], (None, None))
        if n is None:  # an answer without a question: keep it rather than lose data silently
            rows.append((r["categoryId"], "", None, f"(unlabelled field {r['categoryId']})", "", r["value"]))
            continue
        if (n.get("reportSettings") or {}).get("archiveHidden") == "1":
            continue
        chain, p = [], n
        while p and len(chain) < 5:
            t = render_label(p.get("text") or "")
            if t and (not chain or chain[-1] != t):
                chain.append(t)
            p = byid.get(p.get("parentId"))
        label = " › ".join(reversed(chain))
        if c.get("text"):
            label += f": {render_label(c['text'])}"
        rgi = ",".join(str(x) for x in r["repeatingGroupIndexes"] or [])
        if rgi:
            label += f" (#{rgi})"
        fs = n.get("frontendSettings") or {}
        unit = " ".join(x.strip() for x in (fs.get("prefix"), fs.get("suffix")) if x and x.strip())
        rows.append((r["categoryId"], rgi, n["typescriptVariable"], label, unit, r["value"]))
    return rows


def _is_zero(value):
    try:
        return float(value.replace(",", ".")) == 0
    except ValueError:
        return False


def _fetch_figures(db, org_id, year):
    url = f"{ARCHIVE}?" + urllib.parse.urlencode({"externalOrganizationId": org_id, "questionnaireName": f"DigiMV{year}"})
    raw = _http(url, headers={"Accept": "application/json"})
    data = json.loads(raw) if raw.strip() else None  # empty body: no questionnaire for this org/year
    rows = figure_rows(data) if data else []
    keys = [(r[0], r[1]) for r in rows]
    if len(set(keys)) != len(keys):
        raise ValueError(f"{org_id}/{year}: duplicate (category, group index) answers in DigiMV response")
    sc = (data or {}).get("sampleCandidateModel") or {}
    with db:
        # ponytail: delete on UNINDEXED columns = full scan; fine until ~10k org-years are cached
        db.execute("DELETE FROM figures_fts WHERE year=? AND org_id=?", (year, org_id))
        db.executemany("INSERT INTO figures_fts(label, var, value, unit, year, org_id, category_id, rgi) "
                       "VALUES (?,?,?,?,?,?,?,?)",
                       [(lab, var, val, unit, year, org_id, cid, rgi) for cid, rgi, var, lab, unit, val in rows])
        db.execute("INSERT OR REPLACE INTO figures_log VALUES (?,?,?,?,?,?,?)",
                   (year, org_id, datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    sc.get("name"), sc.get("dateFinished"), len(rows), FIGURES_V))


def get_figures(org_id, year, query=None, limit=100, refresh=False, db=None):
    """Every figure an organisation filed in its DigiMV questionnaire for `year` (2020+), cached in SQLite.

    Values are verbatim as filed, for the legal entity itself (enkelvoudig), not the consolidated group.
    `query` keeps fields whose label or variable contains every word (substring, accents ignored),
    e.g. "som der bedrijfsopbrengsten", "totaal activa", "fte". Refetched when the org re-publishes.
    """
    db = db or connect()
    year = int(year)
    if year < FIGURES_FROM:
        raise ValueError(f"structured DigiMV data starts at {FIGURES_FROM}; use the documents for {year}")
    log = db.execute("SELECT * FROM figures_log WHERE year=? AND org_id=?", (year, org_id)).fetchone()
    newest = db.execute("SELECT max(published) FROM docs WHERE year=? AND org_id=?", (year, org_id)).fetchone()[0]
    if refresh or not log or log["v"] != FIGURES_V or (newest and newest > log["fetched_at"]):
        _fetch_figures(db, org_id, year)
        log = db.execute("SELECT * FROM figures_log WHERE year=? AND org_id=?", (year, org_id)).fetchone()
    sql, args = "SELECT label, value, unit, var FROM figures_fts WHERE year=? AND org_id=?", [year, org_id]
    if query:
        match = _org_query(query)
        if not match:
            raise ValueError("query needs at least one word of 3+ characters")
        sql += " AND figures_fts MATCH ?"
        args.append(match)
    rows = [dict(r) for r in db.execute(sql + " ORDER BY rowid", args)]
    rows.sort(key=lambda r: _is_zero(r["value"]))  # stable: filed zeros after real figures, order kept
    return {"org_id": org_id, "year": year, "name": log["name"], "found": bool(log["n"]), "filed": log["finished"],
            "scope": "legal entity (enkelvoudig) as filed in the DigiMV questionnaire; consolidated group "
                     "figures are only in the documents",
            "source": f"{ARCHIVE}?externalOrganizationId={org_id}&questionnaireName=DigiMV{year}",
            "total_fields": log["n"], "matched": len(rows), "figures": rows[:limit]}


# ---------------------------------------------------------------- integrity

def verify(db=None):
    """Check every cached file against the index. Returns a list of problems (empty = clean)."""
    db = db or connect()
    problems = []
    for p in sorted(DATA.glob("**/*.part")):
        problems.append(f"leftover partial file: {p}")
    for p in sorted((DATA / "pdf").glob("*/*.pdf")):
        year, doc_id = int(p.parent.name), int(p.stem)
        r = db.execute("SELECT file_size FROM docs WHERE year=? AND id=?", (year, doc_id)).fetchone()
        if not r:
            problems.append(f"pdf {year}/{doc_id}: not in index any more (withdrawn?)")
        elif not _pdf_ok(p.read_bytes(), r[0]):
            problems.append(f"pdf {year}/{doc_id}: size or header does not match index ({r[0]} bytes)")
    for f in sorted((DATA / "md").glob("*/*/*.pages.json")):
        year, doc_id = int(f.parent.name), int(f.name.split(".")[0])
        cached = json.loads(f.read_text())
        r = db.execute("SELECT published FROM docs WHERE year=? AND id=?", (year, doc_id)).fetchone()
        kb = db.execute("SELECT published, pages FROM kb WHERE year=? AND doc_id=?", (year, doc_id)).fetchone()
        n = len(cached["pages"])
        if not r:
            problems.append(f"md {year}/{doc_id}: not in index any more (withdrawn?)")
        elif r[0] != cached["published"]:
            problems.append(f"md {year}/{doc_id}: stale, re-published {r[0]} (cached {cached['published']})")
        if cached.get("extractor") != EXTRACTOR:
            problems.append(f"md {year}/{doc_id}: extracted by an older extractor, re-run fetch")
        if not f.with_name(f"{doc_id}.md").exists():
            problems.append(f"md {year}/{doc_id}: .md missing")
        if not kb or kb["published"] != cached["published"] or kb["pages"] != n:
            problems.append(f"md {year}/{doc_id}: not (or wrongly) indexed for full-text search")
    return problems


# ---------------------------------------------------------------- CLI

def _fmt_size(n):
    return f"{n / 1e6:.1f} MB" if n >= 1e6 else f"{n / 1e3:.0f} kB"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync", help="download the full index for every year")
    s.add_argument("--year", type=int, action="append", help="only these years (repeatable)")
    s = sub.add_parser("search", help="find organisations")
    s.add_argument("q")
    s.add_argument("--year", type=int)
    s.add_argument("--type", help="document type prefix, e.g. jaarrekening")
    s.add_argument("--limit", type=int, default=20)
    s = sub.add_parser("fetch", help="download + extract documents into the knowledge base")
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--org", help="org id (KvK)")
    g.add_argument("--doc", help="YEAR/ID")
    s.add_argument("--year", type=int)
    s.add_argument("--type", help="document type prefix, e.g. jaarrekening")
    s = sub.add_parser("text", help="full-text search the knowledge base")
    s.add_argument("q")
    s.add_argument("--org")
    s.add_argument("--year", type=int)
    s.add_argument("--limit", type=int, default=20)
    s = sub.add_parser("figures", help="figures an org filed in its DigiMV questionnaire (2020+)")
    s.add_argument("org")
    s.add_argument("year", type=int)
    s.add_argument("q", nargs="?", help="label words, e.g. 'som der bedrijfsopbrengsten'")
    s.add_argument("--limit", type=int, default=50)
    sub.add_parser("verify", help="check cached files against the index")
    a = ap.parse_args(argv)

    if a.cmd == "sync":
        return 0 if sync(a.year or YEARS) else 1

    if a.cmd == "search":
        for o in search(a.q, a.year, a.type, a.limit):
            parent = f"  [location of {', '.join(o['parents'])}]" if o["parents"] else ""
            former = f"  (formerly {'; '.join(o['former_names'])})" if o["former_names"] else ""
            print(f"{o['org_id']}  {o['name']} ({o['town']}){former}  years {','.join(map(str, o['years']))}{parent}")
            for d in o["documents"]:
                print(f"    {d['year']}/{d['id']:<6} {d['type'][:40]:<40} {d['file_name']}  ({_fmt_size(d['file_size'])})")
        return 0

    if a.cmd == "fetch":
        if a.doc:
            y, i = a.doc.split("/")
            targets = [(int(y), int(i))]
        else:
            targets = [(d["year"], d["id"]) for o in search(a.org, a.year, a.type) if o["org_id"] == a.org
                       for d in o["documents"]]
            if not targets:
                print("no matching documents", file=sys.stderr)
                return 1
        failed = 0
        for y, i in targets:
            try:
                r = get_document(y, i)
                print(f"{y}/{i}  {r['page_count']} pages  {r['md_path']}")
            except Exception as e:  # keep going; report at the end
                failed += 1
                print(f"{y}/{i}  FAILED: {e}", file=sys.stderr)
        return 1 if failed else 0

    if a.cmd == "text":
        for r in search_text(a.q, a.org, a.year, limit=a.limit):
            print(f"{r['year']}/{r['doc_id']} p{r['page']}  {r['org_id']}  {r['type']}\n    {r['snippet']}")
        return 0

    if a.cmd == "figures":
        r = get_figures(a.org, a.year, a.q, a.limit)
        print(f"{r['name']} {r['year']}  filed {r['filed']}  {r['matched']} of {r['total_fields']} fields")
        for f in r["figures"]:
            print(f"  {f['value']:>16} {f['unit']:<4} {f['label']}")
        return 0

    if a.cmd == "verify":
        problems = verify()
        print("\n".join(problems) or "cache is clean")
        return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
