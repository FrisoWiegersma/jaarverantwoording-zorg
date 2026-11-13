"""Public documents behind government portals: found through each portal's own API, read like DigiMV's reports.

Finders, checked against the live services on 2026-11-12:
  Woo        GET https://open.overheid.nl/overheid/openbaarmakingen/api/v0/zoek ?zoektekst= &aantalResultaten=10|20|50
             &start= &organisatie= &documentsoort= &publicatiedatumVan/Tot= -> {totaal, resultaten, filters}. A hit's
             pid serves the file; for a gazette document it redirects to the HTML page, whose PDF sits beside it.
             zoektekst matches word forms, not phrases ("Basalt" finds "basaltzuilen").
  Gazettes   SRU 2.0 https://repository.overheid.nl/sru, CQL: Gemeenteblad, Provinciaal blad, Waterschapsblad, Blad
             gemeenschappelijke regeling, Staatscourant, Kamerstukken, Handelingen and answers to MPs' questions, each
             with a PDF. A quoted phrase matches as a phrase. sortKeys is ignored: results come by relevance.
  CVDR       SRU 1.2 https://zoekservice.overheid.nl/sru/Search?x-connection=cvdr: every municipality's, province's,
             water board's and joint arrangement's regulations, with the dates they took and lost effect; text as XML.
  TED        POST https://api.ted.europa.eu/v3/notices/search, expert query (FT~ full text, a CPV code matches its
             subcodes, SORT BY): EU tenders and awards above the threshold, a PDF per language.
Reading: any public http(s) URL, never a private address (checked again after every redirect). PDF through digimv's
text-layer/OCR pipeline, page by page; Word, HTML and XML as text in parts. Cached under DATA/pub per URL, searchable
per page. A citation is the file's URL with #page=N, so it opens on that page."""

import hashlib
import html
import io
import ipaddress
import json
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import zipfile
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

import digimv
import sources

PUB = digimv.DATA / "pub"
PUB_V = 3  # bump when reading PDFs changes: cached PDFs from older versions are read (and OCR'd) again
TEXT_V = 4  # the same for HTML, XML and Word; 4: HTML table rows on one line
_v = lambda kind: PUB_V if kind == "pdf" else TEXT_V
MAX_BYTES = 80 * 1024 * 1024
PART = 6000  # characters per part of a text document (Word, HTML, XML)
SCAN_PROMPT = digimv.SCAN_PROMPT.replace("a Dutch healthcare organisation's annual report (jaarverantwoording)",
                                         "a Dutch public-sector document")
assert SCAN_PROMPT != digimv.SCAN_PROMPT, "digimv.SCAN_PROMPT changed: update the public-document prompt"

WOO = "https://open.overheid.nl/overheid/openbaarmakingen/api/v0"
OB_SRU = "https://repository.overheid.nl/sru"
CVDR_SRU = "https://zoekservice.overheid.nl/sru/Search"
TED = "https://api.ted.europa.eu/v3/notices/search"
IZA_PLANS = ("https://www.zorgakkoorden.nl/programmas/integraal-zorgakkoord/iza-onderdelen/regionale-samenwerking/"
             "regiobeelden-en-plannen/")  # every region's IZA profile and plan, linked from one page
GAZETTES = {"gmb": "Gemeenteblad", "prb": "Provinciaal blad", "wsb": "Waterschapsblad",
            "bgr": "Blad gemeenschappelijke regeling", "stcrt": "Staatscourant", "stb": "Staatsblad",
            "kst": "Kamerstuk", "ah": "Kamervragen (Aanhangsel)", "h": "Handelingen"}  # attachments are under kst

SCOPE = {
    "woo": "Documents government bodies published under the Woo on open.overheid.nl. Not every body publishes "
           "there yet; many still use their own site. The search matches word forms, not exact phrases: check that "
           "a hit is about your subject before relying on it.",
    "gazettes": "Official publications (officielebekendmakingen.nl): what was formally published, as published. "
                "Results come by relevance, not date. A rule's current text is in CVDR (search_regulations).",
    "cvdr": "Regulations of municipalities, provinces, water boards and joint arrangements (CVDR), one record per "
            "version. in_force is computed from the version's own dates against today.",
    "ted": "EU-wide tender and award notices (TED). Only contracts above the EU threshold (for social and health "
           "services € 750.000 in 2026) have to be published here; smaller ones are on TenderNed or nowhere.",
    "read": "The document as fetched from its URL. Each page says whether its text came from the PDF's text layer "
            "('text', exact) or OCR (model name); for OCR pages check figures against totals on the page.",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS pub_docs(
  id TEXT PRIMARY KEY, url TEXT, file_url TEXT, kind TEXT, size INT, sha256 TEXT, fetched_at TEXT, pages INT, v INT);
CREATE VIRTUAL TABLE IF NOT EXISTS pub_pages_fts USING fts5(
  md, doc UNINDEXED, page UNINDEXED, tokenize='unicode61 remove_diacritics 2');
"""


def connect(path=None):
    db = digimv.connect(path)
    db.executescript(SCHEMA)
    return db


# ---------------------------------------------------------------- fetching any public URL

def _check(url):
    """The model picks these URLs, so it must not reach the API container, the homelab LAN or a cloud metadata
    endpoint: every address the host resolves to has to be a public one."""
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
        raise ValueError(f"only public http(s) URLs can be read: {url}")
    try:
        addrs = {i[4][0] for i in socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80))}
    except socket.gaierror as e:
        raise ValueError(f"cannot resolve {u.hostname}") from e
    if not all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs):
        raise ValueError(f"{u.hostname} is not a public address")


class _Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, robots):
        self.robots = robots

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check(newurl)  # a public page must not redirect us to a private address
        if self.robots:
            _allowed(newurl)  # nor to a site that opted out
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_Redirects(robots=True))
_plain = urllib.request.build_opener(_Redirects(robots=False))  # for robots.txt itself

# KOOP's documented APIs (Woo search, SRU) hand out these hosts' file URLs to download; their robots.txt keeps
# search engines out of the portal, not API clients out of the files
ROBOTS_EXEMPT = {"open.overheid.nl", "repository.overheid.nl"}
# Government platforms whose robots.txt itself errors while their pages answer: there a 5xx means no rules, not
# stay away. Rules they do serve still apply. puc.overheid.nl (where the NZa and others publish Woo decisions):
# robots.txt has answered HTTP 500 since at least 2026-11-13.
ROBOTS_BROKEN = {"puc.overheid.nl"}
_robots, _next_slot = {}, {}


def _robots_for(origin):
    """origin's robots.txt, read once a day. RFC 9309: a 4xx means no rules, a 5xx or no answer means stay away."""
    with _guard:
        hit = _robots.get(origin)
    if hit and time.monotonic() - hit[0] < 86400:
        return hit[1]
    rp = urllib.robotparser.RobotFileParser()
    try:
        with _plain.open(urllib.request.Request(origin + "/robots.txt", headers={"User-Agent": digimv.UA}), timeout=20) as r:
            rp.parse(r.read(512 * 1024).decode("utf-8-sig", "replace").splitlines())  # some files start with a BOM
    except urllib.error.HTTPError as e:
        if e.code >= 500 and urllib.parse.urlsplit(origin).hostname not in ROBOTS_BROKEN:
            raise RuntimeError(f"{origin}/robots.txt answers HTTP {e.code}, so the site is not read now; try later") from e
        rp.parse([])
    except OSError as e:
        raise RuntimeError(f"{origin} cannot be reached: {e}") from e
    with _guard:
        _robots[origin] = (time.monotonic(), rp)
    return rp


def _allowed(url):
    """Honour the site's robots.txt, including its Crawl-delay between our requests."""
    u = urllib.parse.urlsplit(url)
    if u.hostname in ROBOTS_EXEMPT:
        return
    origin = f"{u.scheme}://{u.netloc}"
    rp = _robots_for(origin)
    if not rp.can_fetch(digimv.UA, url):
        raise ValueError(f"{u.hostname} asks automated clients not to fetch this (robots.txt), so it is not read here")
    if delay := rp.crawl_delay(digimv.UA):
        with _guard:
            now = time.monotonic()
            slot = _next_slot[origin] = max(now, _next_slot.get(origin, 0) + float(delay))
        time.sleep(slot - now)


# ponytail: hosts whose old name no longer resolves while catalogues still link it; add one when a source moves.
# Always https: the new Open DIS host redirects http to its home page, dropping the path.
MOVED = {"opendisdata.nl": "opendisdata.nza.nl", "www.opendisdata.nl": "opendisdata.nza.nl"}


def _safe_url(url):
    """Percent-encode what a page or the model left raw (spaces, accents): urllib refuses those. '%' is kept, so an
    encoded URL stays as it is; a moved host is replaced by its new name."""
    u = urllib.parse.urlsplit(urllib.parse.quote(url.strip(), safe=":/?#[]@!$&'()*+,;=%~"))
    if u.hostname in MOVED:
        u = u._replace(scheme="https", netloc=MOVED[u.hostname])
    return urllib.parse.urlunsplit(u)


def _stream(url, out, limit=MAX_BYTES, timeout=120):
    """Write a public URL's body to the file object `out`, at most `limit` bytes. Returns (content type, final URL)."""
    # ponytail: urllib resolves the host again after _check (DNS-rebinding window); pin the checked address if the
    # API is ever reachable by untrusted users instead of only through Cloudflare Access
    url = _safe_url(url)
    _check(url)
    _allowed(url)
    req = urllib.request.Request(url, headers={"User-Agent": digimv.UA, "Accept": "*/*"})
    try:
        with _opener.open(req, timeout=timeout) as r:
            n = 0
            while chunk := r.read(1 << 20):
                n += len(chunk)
                if n > limit:
                    raise ValueError(f"{url} is larger than {limit // 2**20} MB")
                out.write(chunk)
            return r.headers.get_content_type(), r.geturl()
    except urllib.error.HTTPError as e:
        if 400 <= e.code < 500:  # a wrong or moved link, not a broken service
            raise ValueError(f"{url} answers HTTP {e.code} ({e.reason})") from e
        raise


def fetch(url, timeout=120):
    """(body, content type, final URL) of a public URL, at most MAX_BYTES."""
    buf = io.BytesIO()
    ctype, final = _stream(url, buf, MAX_BYTES, timeout)
    return buf.getvalue(), ctype, final


# ---------------------------------------------------------------- reading

def doc_id(url):
    return hashlib.sha1(url.encode()).hexdigest()[:20]


def _gazette_pdf(url):
    """zoek.officielebekendmakingen.nl/gmb-2026-312503.html -> its .pdf: the same publication, with pages to cite."""
    m = re.match(r"https?://zoek\.officielebekendmakingen\.nl/([a-z]+-[\w.-]+?)\.html?$", url)
    return f"https://zoek.officielebekendmakingen.nl/{m[1]}.pdf" if m else None


def kind_of(body, ctype=""):
    if body[:5] == b"%PDF-":
        return "pdf"
    if body.startswith(b"7z\xbc\xaf\x27\x1c"):
        raise ValueError("a 7-Zip archive: read its data files with read_table")
    if body[:2] == b"PK":
        names = zipfile.ZipFile(io.BytesIO(body)).namelist()
        if "word/document.xml" in names:
            return "docx"
        if "xl/workbook.xml" in names:
            raise ValueError("this is a spreadsheet: read it with read_table")
        raise ValueError("a ZIP archive: read its data files with read_table")
    head = body[:2000].lstrip().lower()
    if "html" in ctype or head.startswith((b"<!doctype html", b"<html")):
        return "html"
    if "xml" in ctype or head.startswith(b"<?xml"):
        return "xml"
    if ctype.startswith("text/"):
        return "text"
    raise ValueError(f"cannot read a {ctype or 'file of unknown type'}")


BLOCK = (r"p|div|li|tr|row|h[1-6]|br|table|section|article|al|lid|artikel|kop|tussenkop|intitule|hoofdstuk|"
         r"paragraaf|afdeling|lijst|aanhef|preambule|regeling-tekst|w:p")


def markup_text(s, xml=False):
    """HTML or XML (CVDR, gazettes, Word's document.xml) -> plain text, a line per block, headings as '## '.
    In XML every element is a word of its own (<label>Artikel</label><nr>1</nr> is 'Artikel 1'); in HTML inline
    tags sit inside words, so they vanish without a space."""
    if not xml:
        # HTML whitespace means nothing, so a table written over many source lines stays one line per row, its
        # cells apart by tabs (Zorgcijfersdatabank). ponytail: <pre> is flattened too; keep it if a source needs it
        s = re.sub(r"\s+", " ", s)
    if xml:
        if "<body" in s:  # CVDR and gazette XML: the metadata comes first, the text in <body>
            s = s[s.index("<body"):]
        s = re.sub(r"(?is)<meta\b.*?</meta>", " ", s)
        s = re.sub(r"(?i)<kop\b[^>]*>", "\n## ", s)
        # '<li nr="a."><al>text' -> 'a. text': the number on the line of its own text
        s = re.sub(r"""(?i)<li\b[^>]*\bnr=(["'])(.*?)\1[^>]*>\s*(?:<al\b[^>]*>)?""", r"\n\2 ", s)
    s = re.sub(r"(?is)<(script|style|nav|footer|header|noscript)\b.*?</\1>", " ", s)
    s = re.sub(r"(?i)<h[1-6][^>]*>", "\n## ", s)
    s = re.sub(r"(?i)</kop>", "\n", s)
    s = re.sub(rf"(?i)</?({BLOCK})\b[^>]*>", "\n", s)
    s = re.sub(r"(?i)<w:tab/>|</t[dh]>|</entry>", "\t", s)
    s = html.unescape(re.sub(r"<[^>]+>", " " if xml else "", s))
    # a tab separates table cells (and Word tab stops): kept, so a row's columns stay apart
    lines = (re.sub(r" *\t *", "\t", re.sub(r"[ \xa0]+", " ", ln)).strip(" ").rstrip("\t") for ln in s.splitlines())
    return "\n".join(ln for ln in lines if ln and ln != "##")


def parts(text, size=PART):
    """Text -> parts of about `size` characters, cut at line ends; a document without text has no parts."""
    out, cur = [], ""
    for line in text.splitlines(keepends=True):
        if cur and len(cur) + len(line) > size:
            out.append(cur.strip())
            cur = ""
        cur += line
    return out + ([cur.strip()] if cur.strip() else [])


def _text_pages(kind, body):
    if kind == "docx":
        xml = zipfile.ZipFile(io.BytesIO(body)).read("word/document.xml").decode("utf-8")
        text = markup_text(xml, xml=True)
    else:
        raw = body.decode("utf-8", "replace")
        text = markup_text(raw, xml=kind == "xml") if kind in ("html", "xml") else raw
    return [{"markdown": t, "source": kind} for t in parts(text)]


_locks, _guard = {}, threading.Lock()


def _lock(did):
    with _guard:
        return _locks.setdefault(did, threading.Lock())


def _cite(d, n):
    return f"{d['file_url']}#page={n}" if d["kind"] == "pdf" else d["file_url"]


def _href(did, d, n):
    """The in-app citation of a page (PDF) or part (web page, Word, XML): the evidence panel shows our cached copy
    with the quote marked. The original URL can't be the citation: many sites send PDFs as a download (Menzis does),
    forbid framing, or change the page later."""
    return f"/bron/doc/{did}/{n}" if d["kind"] == "pdf" else f"/bron/tekst/{did}/{n}"


def _title(did, d):
    """A human title: the PDF's own title when it is a real one, else its first heading, else the file name."""
    if d["kind"] == "pdf" and (PUB / f"{did}.pdf").exists():
        import pymupdf
        with pymupdf.open(PUB / f"{did}.pdf") as pdf:
            t = (pdf.metadata or {}).get("title", "").strip()
        if len(t.split()) >= 2 and not re.match(r"(?i)microsoft|untitled|\w+\.(docx?|pdf)$", t):
            return t[:200]
    first = next((p["markdown"] or p.get("text") or "" for p in d["pages"] if p["markdown"] or p.get("text")), "")
    line = first.strip().split("\n", 1)[0].strip()
    if d["kind"] == "html" and len(line.split()) >= 2 and len(line) <= 200 and not line.startswith("#"):
        return line  # the page's <title>, which comes first; its headings are often the site's menus
    name = urllib.parse.unquote(urllib.parse.urlsplit(d["file_url"]).path.rstrip("/").rsplit("/", 1)[-1])
    return digimv.page_heading(first) or re.sub(r"\.(pdf|docx?|html?|xml)$", "", name, flags=re.I) or d["file_url"]


def _cached(did):
    if not re.fullmatch(r"[0-9a-f]{20}", did or ""):  # also keeps a path out of the file name
        raise KeyError(f"no public document {did!r}")
    cache = PUB / f"{did}.pages.json"
    if not cache.exists():
        raise KeyError(f"public document {did} is not in the cache here; read its URL again")
    return json.loads(cache.read_text())


def document_meta(did):
    """What a /bron/doc/ citation shows: the document's title, where it came from and when, and its size."""
    d = _cached(did)
    return {"id": did, "title": _title(did, d) if d["kind"] == "html" else d.get("title") or _title(did, d), "url": d["url"], "file_url": d["file_url"],
            "host": urllib.parse.urlsplit(d["file_url"]).hostname.removeprefix("www."), "kind": d["kind"], "page_count": len(d["pages"]),
            "fetched_at": d["fetched_at"],
            "file_name": urllib.parse.unquote(urllib.parse.urlsplit(d["file_url"]).path.rsplit("/", 1)[-1]) or f"{did}.pdf"}


def document_part(did, n):
    """One page or part of a cached public document as text: what a /bron/tekst/ citation shows."""
    d = _cached(did)
    if not 1 <= n <= len(d["pages"]):
        raise KeyError(f"public document {did} has {len(d['pages'])} parts, not {n}")
    return {**document_meta(did), "page": n, "text": d["pages"][n - 1]["markdown"]}


def document_pdf(did):
    """Path of a cached public PDF, for the evidence panel's page image and the inline PDF."""
    if _cached(did)["kind"] != "pdf":
        raise KeyError(f"public document {did} is not a PDF")
    return PUB / f"{did}.pdf"


def _index(db, did, d, texts):
    with db:
        db.execute("DELETE FROM pub_pages_fts WHERE doc=?", (did,))
        db.executemany("INSERT INTO pub_pages_fts VALUES (?,?,?)", [(t, did, i) for i, t in enumerate(texts, 1)])
        db.execute("INSERT OR REPLACE INTO pub_docs VALUES (?,?,?,?,?,?,?,?,?)",
                   (did, d["url"], d["file_url"], d["kind"], d["size"], d["sha256"], d["fetched_at"], len(texts), _v(d["kind"])))


def read(url, pages="1-5", refresh=False, db=None):
    """A public document by URL: fetched and read on first use, cached afterwards. `pages` ("1-5", "12", "all") are
    the pages (parts, for Word/HTML/XML) to return. refresh=True fetches it again."""
    db = db or connect()
    url = url.strip()
    did = doc_id(url)
    cache = PUB / f"{did}.pages.json"
    with _lock(did):
        d = json.loads(cache.read_text()) if cache.exists() else None
        new = refresh or not d or d.get("v") != _v(d.get("kind"))
        if new:
            body, ctype, final = fetch(url)
            if (pdf := _gazette_pdf(final)) and kind_of(body, ctype) == "html":
                body, ctype, final = fetch(pdf)
            kind = kind_of(body, ctype)
            PUB.mkdir(parents=True, exist_ok=True)
            d = {"url": url, "file_url": final, "kind": kind, "size": len(body), "v": _v(kind),
                 "sha256": hashlib.sha256(body).hexdigest(), "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            if kind == "pdf":
                pdf_file = PUB / f"{did}.pdf"
                tmp = pdf_file.with_suffix(".part")
                tmp.write_bytes(body)
                tmp.replace(pdf_file)
                d["pages"] = digimv.extract_pages(pdf_file, prompt=SCAN_PROMPT)
            else:
                d["pages"] = _text_pages(kind, body)
            d["title"] = _title(did, d)
        todo = []
        if d["kind"] == "pdf":
            todo = [n for n in digimv.parse_pages(pages, len(d["pages"])) if d["pages"][n - 1]["markdown"] is None]
            for n, md in zip(todo, digimv.convert_pages(PUB / f"{did}.pdf", todo) if todo else []):
                d["pages"][n - 1]["markdown"] = md
        if new or todo:
            tmp = cache.with_suffix(".part")
            tmp.write_text(json.dumps(d, ensure_ascii=False))
            tmp.replace(cache)
        texts = [p["markdown"] if p["markdown"] is not None else p.get("text", "") for p in d["pages"]]
        indexed = db.execute("SELECT sha256, v FROM pub_docs WHERE id=?", (did,)).fetchone()
        if new or not indexed or tuple(indexed) != (d["sha256"], _v(d["kind"])):
            _index(db, did, d, texts)
        elif todo:
            with db:
                db.executemany("UPDATE pub_pages_fts SET md=? WHERE doc=? AND page=?", [(texts[n - 1], did, n) for n in todo])
    sel = digimv.parse_pages(pages, len(texts))
    return {"id": did, "title": _title(did, d) if d["kind"] == "html" else d.get("title") or _title(did, d), "url": url, "file_url": d["file_url"],
            "kind": d["kind"], "fetched_at": d["fetched_at"],
            "page_count": len(texts), "unit": "page" if d["kind"] == "pdf" else f"part of ~{PART} characters",
            "pages": [{"page": n, "source": d["pages"][n - 1]["source"], "href": _href(did, d, n), "cite": _cite(d, n),
                       "markdown": texts[n - 1]} for n in sel],
            "scope": SCOPE["read"]}


FILE_TYPES = {"pdf", "doc", "docx", "odt", "xls", "xlsx", "ods", "csv", "json", "xml", "zip", "7z", "ppt", "pptx"}


class _Anchors(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title, self.links, self._a, self._in_title = "", [], None, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self._a = [a["href"], [], a.get("title") or a.get("aria-label") or ""]
        self._in_title |= tag == "title"

    def handle_data(self, data):
        if self._a:
            self._a[1].append(data)
        if self._in_title:
            self.title += data

    def handle_endtag(self, tag):
        if tag == "a" and self._a:
            href, text, alt = self._a
            self.links.append((href, " ".join("".join(text).split()) or alt.strip()))
            self._a = None
        if tag == "title":
            self._in_title = False


def page_links(body, base):
    """(page title, [{text, url, type}]) of an HTML page: absolute URLs, each once, in page order. type is the file
    extension when the URL has one of FILE_TYPES, else 'page'."""
    p = _Anchors()
    p.feed(body.decode("utf-8", "replace"))
    out, seen = [], set()
    for href, text in p.links:
        url = urllib.parse.urldefrag(urllib.parse.urljoin(base, href.strip()))[0]
        if not url.startswith(("http://", "https://")):
            continue
        url = _safe_url(url)
        if url in seen:
            continue
        seen.add(url)
        ext = urllib.parse.urlsplit(url).path.rsplit(".", 1)[-1].lower()
        if ext in FILE_TYPES:
            kind = ext
        else:
            # portals like zorginzicht.nl serve files at query endpoints without an extension, typing them in the link text
            m = re.search(r"(?i)\b(PDF|Excel|CSV|ZIP|7-Zip|7z|Word)[ -](file|bestand|archive|archief)\b", text)
            kind = {"pdf": "pdf", "excel": "xlsx", "csv": "csv", "zip": "zip", "7-zip": "7z", "7z": "7z", "word": "docx"}.get(m.group(1).lower(), "page") if m else "page"
        out.append({"text": text, "url": url, "type": kind})
    return " ".join(p.title.split()), out


def links(url, query=None, limit=100):
    """The links on a public web page, files (PDF, Word, Excel, CSV) first: the way to a document whose page is
    known but whose link is not. query keeps links whose text or URL contains every word (accents ignored)."""
    body, ctype, final = fetch(url.strip())
    if kind_of(body, ctype) != "html":
        raise ValueError("not a web page: read it with read_document")
    title, found = page_links(body, final)
    words = [sources._fold(w) for w in (query or "").split()]
    hits = [x for x in found if all(w in sources._fold(f"{x['text']} {x['url']}") for w in words)]
    hits.sort(key=lambda x: x["type"] == "page")  # stable: files first, each group in page order
    return {"url": url, "page_url": final, "title": title, "links_total": len(found), "matched": len(hits),
            "returned": min(len(hits), limit), "truncated": len(hits) > limit, "links": hits[:limit],
            "scope": "Links as the page has them when fetched without running its scripts: a site that builds its "
                     "menus in the browser shows few. A link without a file extension can still be a file."}


def search_text(q, url=None, limit=20, db=None):
    """Word-prefix search in public documents read before; with `url`, that document (read first if needed)."""
    db = db or connect()
    match = digimv._text_query(q)
    if not match:
        return {"query": q, "results": []}
    if url:
        read(url, pages="0", db=db)  # page 0 selects nothing: makes it searchable without converting pages
    sql = """SELECT d.id, d.url, d.file_url, d.kind, p.page, p.md, snippet(pub_pages_fts, 0, '«', '»', ' … ', 24) AS snippet
             FROM pub_pages_fts p JOIN pub_docs d ON d.id = p.doc WHERE pub_pages_fts MATCH ?"""
    args = [match]
    if url:
        sql += " AND p.doc = ?"
        args.append(doc_id(url.strip()))
    out = []
    for r in db.execute(sql + " ORDER BY rank LIMIT ?", (*args, limit)):
        r = dict(r)
        out.append({"url": r["url"], "page": r["page"], "href": _href(r["id"], r, r["page"]), "cite": _cite(r, r["page"]),
                    "heading": digimv.page_heading(r.pop("md")), "snippet": r["snippet"]})
    return {"query": q, "results": out,
            "scope": "Only documents read before are searched; pass url to search one document." if not url else SCOPE["read"]}


# ---------------------------------------------------------------- finders

def _get_json(url, body=None):
    """JSON from a portal; a 4xx answer becomes a ValueError carrying the portal's own explanation."""
    try:
        raw = digimv._http(url, data=json.dumps(body).encode() if body is not None else None,
                           headers={"Content-Type": "application/json", "Accept": "application/json"})
    except urllib.error.HTTPError as e:
        if 400 <= e.code < 500:
            try:
                err = json.loads(e.read())
            except ValueError:
                err = {}
            raise ValueError(err.get("detail") or err.get("message") or f"HTTP {e.code}") from e
        raise
    return json.loads(raw)


def _dmy(d):
    """YYYY-MM-DD -> dd-mm-yyyy, the format open.overheid.nl wants."""
    return date.fromisoformat(d).strftime("%d-%m-%Y") if d else None


def _cql(s):
    return re.sub(r'["\\]', " ", s).strip()


def search_woo(q, organisatie=None, documentsoort=None, since=None, until=None, limit=20, start=0):
    """Documents released under the Woo on open.overheid.nl. organisatie/documentsoort: a value from the
    `organisations`/`document_types` lists a search returns, e.g. 'Nederlandse Zorgautoriteit', 'beslisnota'."""
    rows = 10 if limit <= 10 else 20 if limit <= 20 else 50  # the API refuses any other page size
    # a comma separates organisations, so one inside a name ("ministerie van Volksgezondheid, Welzijn en Sport") is
    # sent encoded twice; checked live: the filter then matches the facet's count exactly
    org = organisatie.replace(",", "%2C") if organisatie else None
    params = {"zoektekst": q, "start": start, "aantalResultaten": rows, "organisatie": org,
              "documentsoort": documentsoort, "publicatiedatumVan": _dmy(since), "publicatiedatumTot": _dmy(until)}
    try:
        d = _get_json(f"{WOO}/zoek?" + urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")}))
    except OSError as e:
        raise RuntimeError(f"open.overheid.nl search failed: {e}") from e
    if "resultaten" not in d:
        raise ValueError(d.get("detail") or f"unexpected answer from open.overheid.nl: {str(d)[:200]}")
    hits = []
    for r in d["resultaten"][:limit]:
        doc = r["document"]
        # most archive hits carry no pid; it is the id without its version suffix (checked: it serves the file)
        url = doc.get("pid") or "https://open.overheid.nl/documenten/" + re.sub(r"_\d+$", "", doc["id"])
        snippet = r.get("highlightedText") or ""
        hits.append({"title": doc.get("titel"), "description": doc.get("omschrijving"), "publisher": doc.get("publisher"),
                     "date": doc.get("openbaarmakingsdatum"), "url": url, "file_type": r.get("bestandsType"),
                     "pages": r.get("aantalPaginas"), "size": r.get("bestandsgrootte"), "web_page": doc.get("weblocatie"),
                     "snippet": html.unescape(re.sub(r"</?b>", lambda m: "»" if m[0][1] == "/" else "«", snippet))[:300]})
    facets = d.get("filters") or {}
    top = lambda k: [f"{x['naam']} ({x['aantal']})" for x in sorted(facets.get(k, []), key=lambda x: -x["aantal"])[:15]]
    return {"query": q, "total": d["totaal"], "returned": len(hits), "truncated": d["totaal"] > start + len(hits),
            "results": hits, "organisations": top("organisatie"), "document_types": top("documentsoort"),
            "source": "https://open.overheid.nl", "scope": SCOPE["woo"]}


def _records(xml):
    """SRU XML -> (total, [ {local tag name: [texts]} per record ], diagnostics)."""
    root = ET.fromstring(xml)
    local = lambda el: el.tag.rsplit("}", 1)[-1]
    total = next((int(el.text) for el in root.iter() if local(el) == "numberOfRecords"), 0)
    diag = [el.text for el in root.iter() if local(el) == "message"]
    recs = []
    for rec in (el for el in root.iter() if local(el) == "recordData"):
        f = {}
        for el in rec.iter():
            if el.text and el.text.strip():
                f.setdefault(local(el), []).append(el.text.strip())
            if local(el) == "itemUrl" and el.get("manifestation"):
                f.setdefault("item_" + el.get("manifestation"), []).append(el.text.strip())
        recs.append(f)
    return total, recs, diag


def _first(f, k):
    return (f.get(k) or [None])[0]


def _text_cql(q):
    """'jeugdhulp tarief "zorg in natura"' -> every loose word and each quoted phrase must occur. Checked live: the
    SRU matches cql.textAndIndexes="a b" as the phrase "a b" ("zorg in natura" 9,173, "natura in zorg" 0)."""
    phrases = [p for p in map(_cql, re.findall(r'"([^"]*)"', q)) if p]
    words = " ".join(_cql(re.sub(r'"[^"]*"?', " ", q)).split())
    cql = [f'cql.textAndIndexes="{p}"' for p in phrases] + ([f'cql.textAndIndexes all "{words}"'] if words else [])
    if not cql:
        raise ValueError("give at least one word to search for")
    return cql


def search_publications(q, creator=None, gazette=None, since=None, limit=20, start=1):
    """Official publications by full text: every word must occur; "quoted words" must occur as that phrase.
    creator: the publishing body, e.g. 'Leiden', 'Nederlandse Zorgautoriteit'. gazette: gmb, prb, wsb, bgr, stcrt,
    stb, kst, ah, h. since: YYYY-MM-DD."""
    cql = _text_cql(q)
    if creator:
        cql.append(f'dt.creator="{_cql(creator)}"')
    if gazette:
        if gazette not in GAZETTES:
            raise ValueError(f"gazette must be one of {', '.join(GAZETTES)}")
        cql.append(f'w.publicatienaam="{GAZETTES[gazette]}"')
    if since:
        date.fromisoformat(since)
        cql.append(f'dt.date>="{since}"')
    url = OB_SRU + "?" + urllib.parse.urlencode({"query": " AND ".join(cql), "maximumRecords": min(limit, 50),
                                                 "startRecord": start})
    try:
        total, recs, diag = _records(digimv._http(url))
    except (OSError, ET.ParseError) as e:
        raise RuntimeError(f"officielebekendmakingen.nl search failed: {e}") from e
    if diag:
        raise ValueError("; ".join(diag))
    hits = [{"id": _first(f, "identifier"), "title": _first(f, "title"), "type": _first(f, "type"),
             "creator": _first(f, "creator"), "date": _first(f, "date"), "gazette": _first(f, "publicatienaam"),
             "url": _first(f, "item_pdf") or _first(f, "preferredUrl"), "web_page": _first(f, "preferredUrl"),
             "regulation": _first(f, "betreftRegeling")} for f in recs]
    return {"query": q, "total": total, "returned": len(hits), "truncated": total > start - 1 + len(hits),
            "results": hits, "source": "https://www.officielebekendmakingen.nl", "scope": SCOPE["gazettes"]}


def search_regulations(q, creator=None, limit=20, start=1, today=None):
    """Regulations (CVDR) containing every word (no phrase search: checked live, "natura in zorg" finds what "zorg in
    natura" finds), optionally of one body ('Leiden'), with in_force per version."""
    cql = [f'keyword="{_cql(q)}"'] + ([f'creator="{_cql(creator)}"'] if creator else [])
    url = CVDR_SRU + "?" + urllib.parse.urlencode({"x-connection": "cvdr", "operation": "searchRetrieve", "version": "1.2",
                                                   "query": " and ".join(cql), "maximumRecords": min(limit, 50),
                                                   "startRecord": start})
    try:
        total, recs, diag = _records(digimv._http(url))
    except (OSError, ET.ParseError) as e:
        raise RuntimeError(f"CVDR search failed: {e}") from e
    if diag:
        raise ValueError("; ".join(diag))
    today = today or date.today().isoformat()
    hits = []
    for f in recs:
        start_d, end_d = _first(f, "inwerkingtredingDatum"), _first(f, "uitwerkingtredingDatum")
        rid = _first(f, "identifier") or ""
        m = re.match(r"CVDR(\d+)_(\d+)$", rid)
        hits.append({"id": rid, "title": _first(f, "title"), "creator": _first(f, "creator"),
                     "in_force_from": start_d, "in_force_until": end_d,
                     "in_force": bool(start_d and start_d <= today and (not end_d or end_d > today)),
                     "url": _first(f, "publicatieurl_xml"), "gazette": _first(f, "isFormatOf"),
                     "web_page": f"https://lokaleregelgeving.overheid.nl/CVDR{m[1]}/{m[2]}" if m else None})
    return {"query": q, "total": total, "returned": len(hits), "truncated": total > start - 1 + len(hits),
            "results": hits, "source": "https://lokaleregelgeving.overheid.nl", "scope": SCOPE["cvdr"]}


def _lang(v):
    """TED's multilingual fields: Dutch, else English, else any."""
    if isinstance(v, dict):
        v = v.get("nld") or v.get("eng") or next(iter(v.values()), None)
    return v[0] if isinstance(v, list) and len(v) == 1 else v


AWARDS = "can-standard can-social can-desg can-tran can-modif veat"  # eForms result notices, and direct awards


def search_tenders(q=None, buyer=None, cpv="85000000", country="NLD", since=None, limit=20, page=1, place=None,
                   awarded=False):
    """Tender and award notices on TED. cpv: a CPV code; a top code matches its subcodes (85000000 = health and
    social work). q: words in the notice text. since: YYYY-MM-DD. place: NUTS codes where the work is done, each
    matching its subregions (Zuid-Holland is NL33 before NUTS 2024, NL36 after). awarded: only award notices."""
    query = [f"buyer-country={country}"]
    if place:
        codes = place.split()
        if not all(re.fullmatch(r"[A-Z]{2}[0-9A-Z]{0,3}", c) for c in codes):
            raise ValueError("place is NUTS codes, e.g. 'NL33 NL36' for Zuid-Holland")
        query.append(f"place-of-performance IN ({' '.join(codes)})")
    if awarded:
        query.append(f"notice-type IN ({AWARDS})")
    if cpv:
        if not re.fullmatch(r"\d{8}", cpv):
            raise ValueError("cpv is 8 digits, e.g. 85000000")
        query.append(f"classification-cpv={cpv}")
    if q:
        query.append(f'FT~"{_cql(q)}"')
    if buyer:
        query.append(f'buyer-name~"{_cql(buyer)}"')
    if since:
        query.append(f"publication-date>={date.fromisoformat(since).strftime('%Y%m%d')}")
    body = {"query": " AND ".join(query) + " SORT BY publication-date DESC", "limit": min(limit, 50), "page": page,
            "fields": ["publication-number", "notice-title", "buyer-name", "publication-date", "notice-type",
                       "classification-cpv", "winner-name", "organisation-name-tenderer", "place-of-performance"]}
    try:
        d = _get_json(TED, body)
    except OSError as e:
        raise RuntimeError(f"TED search failed: {e}") from e
    if "notices" not in d:
        raise ValueError(str(d.get("message") or d)[:300])
    hits = []
    for n in d["notices"]:
        num = n.get("publication-number")
        cpvs = n.get("classification-cpv") or []
        # winner-name repeats per lot; a direct award (veat) names its contractor only as tenderer. Tenderers in a
        # result notice also include those who lost, so they are never read as winners.
        names = lambda field, n=n: list(dict.fromkeys(x for v in (n.get(field) or {}).values() for x in v))
        winners = names("winner-name") or (names("organisation-name-tenderer") if n.get("notice-type") == "veat" else [])
        hits.append({"id": num, "title": _lang(n.get("notice-title")), "buyer": _lang(n.get("buyer-name")),
                     "date": (n.get("publication-date") or "")[:10], "type": n.get("notice-type"),
                     "cpv": list(dict.fromkeys(cpvs)), "url": f"https://ted.europa.eu/nl/notice/{num}/pdf",
                     "web_page": f"https://ted.europa.eu/nl/notice/-/detail/{num}",
                     "place": [c for c in dict.fromkeys(n.get("place-of-performance") or []) if len(c) > 3],
                     "winners": winners[:25], "winners_total": len(winners)})
    total = d.get("totalNoticeCount", len(hits))
    return {"query": body["query"], "total": total, "returned": len(hits),
            "truncated": total > (page - 1) * body["limit"] + len(hits), "results": hits,
            "source": "https://ted.europa.eu", "scope": SCOPE["ted"]}


# ---------------------------------------------------------------- CLI

def check():
    """One live call per finder plus one read: the services' shapes still match what this module expects."""
    probes = {
        "woo search": lambda: search_woo("jeugdhulp")["total"] > 0,
        "gazettes": lambda: any(h["url"].endswith(".pdf") for h in search_publications("jeugdhulp", creator="Leiden")["results"]),
        "cvdr": lambda: any(h["in_force"] for h in search_regulations("jeugdhulp", creator="Leiden", limit=50)["results"]),
        "ted": lambda: search_tenders("jeugdhulp", since="2025-01-01")["total"] > 0,
        "links": lambda: sum(x["type"] == "pdf" for x in links(IZA_PLANS, limit=500)["links"]) > 50,
        "read pdf": lambda: read(search_publications("jeugdhulp", creator="Leiden", gazette="gmb")["results"][0]["url"],
                                 pages="1")["pages"][0]["markdown"] != "",
        # a link with spaces (Vektis) must still be readable
        "pdf link with spaces": lambda: read(next(x["url"] for x in links(
            "https://www.vektis.nl/zorgprisma/zorgkosten-en-aantallen/publicatie-zorgthermometer", "pdf")["links"]),
            pages="1")["page_count"] > 1,
        # an HTML table keeps its rows: a row label and its amounts on one line
        "html table rows": lambda: any(ln.startswith("Gehandicaptenzorg\t€ ") for p in read(
            "https://www.zorgcijfersdatabank.nl/databank?infotype=wlz&label=00-totaal&tabel=B_basis&geg=ko&item=",
            pages="all", refresh=True)["pages"] for ln in p["markdown"].splitlines()),
        "file type from link text": lambda: any(x["type"] == "xlsx" for x in links(
            "https://www.zorginzicht.nl/algemeen/open-data-wijkverpleging")["links"]),
    }
    ok = True
    for name, probe in probes.items():
        try:
            good = bool(probe())
        except Exception as e:  # report every probe, not just the first failure
            good, name = False, f"{name}: {e}"
        ok &= good
        print(f"{'ok  ' if good else 'FAIL'} {name}")
    return ok


def main(argv=None):
    import argparse
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("woo"); s.add_argument("q"); s.add_argument("--org")
    s = sub.add_parser("gazettes"); s.add_argument("q"); s.add_argument("--creator"); s.add_argument("--gazette")
    s = sub.add_parser("regulations"); s.add_argument("q"); s.add_argument("--creator")
    s = sub.add_parser("tenders"); s.add_argument("q", nargs="?"); s.add_argument("--buyer"); s.add_argument("--since")
    s = sub.add_parser("read"); s.add_argument("url"); s.add_argument("--pages", default="1-3")
    s = sub.add_parser("search"); s.add_argument("q"); s.add_argument("--url")
    sub.add_parser("check")
    a = p.parse_args(argv)
    if a.cmd == "check":
        sys.exit(0 if check() else 1)
    r = {"woo": lambda: search_woo(a.q, a.org), "gazettes": lambda: search_publications(a.q, a.creator, a.gazette),
         "regulations": lambda: search_regulations(a.q, a.creator), "tenders": lambda: search_tenders(a.q, a.buyer, since=a.since),
         "read": lambda: read(a.url, a.pages), "search": lambda: search_text(a.q, a.url)}[a.cmd]()
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
