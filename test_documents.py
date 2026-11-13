"""Offline check of public-document finding and reading (documents.py) and open data (datasets.py).
Run: python test_documents.py

Fixtures have the shapes the live services returned on 2026-11-12; `python documents.py check` and
`python datasets.py check` test the live services.
"""

import io
import json
import os
import pathlib
import socket
import tempfile
import time
import urllib.error
import zipfile

os.environ["DATA_DIR"] = tempfile.mkdtemp()  # before digimv is imported: caches go to a scratch directory

import datasets  # noqa: E402
import digimv  # noqa: E402
import documents as d  # noqa: E402
import sources  # noqa: E402

# unittest discover imports test_digimv first, which fixes digimv.DATA to the real data/ before the line above
assert str(digimv.DATA) == os.environ["DATA_DIR"], "run on its own: python test_documents.py"


def raises(exc, fn, *a, **kw):
    try:
        fn(*a, **kw)
    except exc as e:
        return str(e)
    raise AssertionError(f"{fn.__name__} did not raise {exc.__name__}")


def zipped(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


# ---------------------------------------------------------------- private addresses are never fetched

real_getaddrinfo = socket.getaddrinfo
hosts = {"public.example": "93.184.216.34", "lan.example": "192.168.1.10", "api": "172.18.0.2",
         "meta.example": "169.254.169.254", "tail.example": "100.114.142.121", "v6.example": "::1"}
socket.getaddrinfo = lambda host, port, *a, **k: [(None, None, None, "", (hosts.get(host, "127.0.0.1"), port))]
d._check("https://public.example/x.pdf")
for h in ("lan.example", "api", "meta.example", "tail.example", "v6.example", "localhost"):
    assert "not a public address" in raises(ValueError, d._check, f"http://{h}/"), h
for bad in ("file:///etc/passwd", "ftp://public.example/x", "https://user:pw@public.example/", "https:///x"):
    raises(ValueError, d._check, bad)
socket.getaddrinfo = real_getaddrinfo


# ---------------------------------------------------------------- robots.txt

class Answer:
    def __init__(self, body=b"", code=200):
        self.body, self.code = body, code

    def __enter__(self):
        if self.code != 200:
            raise urllib.error.HTTPError("u", self.code, "x", {}, None)
        return self

    def __exit__(self, *a):
        return False

    def read(self, n=-1):
        return self.body


answers = {}
d._plain = type("Fake", (), {"open": lambda self, req, timeout=None: answers[req.full_url]})()
answers["https://bom.example/robots.txt"] = Answer("﻿User-agent: *\nCrawl-delay: 1\nDisallow: /private\n".encode())
answers["https://gone.example/robots.txt"] = Answer(code=404)
answers["https://down.example/robots.txt"] = Answer(code=503)
d._allowed("https://bom.example/open/page")
assert "robots.txt" in raises(ValueError, d._allowed, "https://bom.example/private/x")  # the BOM must not hide the rules
t = time.monotonic()
d._allowed("https://bom.example/a")
assert time.monotonic() - t >= 0.9, "Crawl-delay is honoured between requests to one site"
d._allowed("https://gone.example/anything")  # RFC 9309: no robots.txt (4xx) means no rules
assert "503" in raises(RuntimeError, d._allowed, "https://down.example/x")  # 5xx: stay away for now
assert "https://down.example" not in d._robots, "a failed robots.txt is not cached, so the next call tries again"
d._allowed("https://open.overheid.nl/documenten/oep-1")  # KOOP's API file host: exempt, never fetched


# ---------------------------------------------------------------- recognising and reading files

assert d.kind_of(b"%PDF-1.7 ...") == "pdf"
assert d.kind_of(zipped({"word/document.xml": "<w:document/>"})) == "docx"
assert "read_table" in raises(ValueError, d.kind_of, zipped({"xl/workbook.xml": "<workbook/>"}))
assert d.kind_of(b"  <!DOCTYPE html><html>", "application/octet-stream") == "html"
assert d.kind_of(b"<?xml version='1.0'?><regeling/>") == "xml"
assert d.kind_of(b"plain", "text/plain") == "text"
raises(ValueError, d.kind_of, b"\x00\x01", "image/png")
assert d._gazette_pdf("https://zoek.officielebekendmakingen.nl/gmb-2026-312503.html") == \
    "https://zoek.officielebekendmakingen.nl/gmb-2026-312503.pdf"
assert d._gazette_pdf("https://example.org/gmb-2026-1.html") is None

page = d.markup_text("<html><head><style>p{}</style></head><body><nav>menu</nav><h2>Tarieven</h2>"
                     "<p>Het tarief is <b>€&nbsp;72,40</b> per uur.</p><table><tr><td>A</td><td>1</td></tr></table></body></html>")
assert page == "## Tarieven\nHet tarief is € 72,40 per uur.\nA\t1", page
# Zorgcijfersdatabank writes each cell on its own source line: a row must still come out as one line
zcd = """<table class="table hd"><thead><tr>
  <th class="l kop">Kosten</th>
  <th class="c kop">2024 *</th>
  <th class="c kop">2025 *</th>
</tr></thead><tbody><tr>
  <td class="l data">A Verzorgingsmiddelen</td>
  <td class="r data">€ 511.862.965</td>
  <td class="r data">.</td>
</tr></tbody></table>"""
assert d.markup_text(zcd) == "Kosten\t2024 *\t2025 *\nA Verzorgingsmiddelen\t€ 511.862.965\t.", d.markup_text(zcd)
cvdr = ("<?xml version='1.0'?><cvdr><meta><title>Verordening jeugdhulp</title></meta><body><regeling-tekst>"
        "<artikel><kop><label>Artikel</label><nr>1</nr><titel>Begrippen</titel></kop><al>In deze verordening:</al>"
        "<lijst><li nr='a.'><al>jeugdhulp: hulp</al></li><li nr=\"b.\"><al>Wmo</al></li></lijst></artikel></regeling-tekst></body></cvdr>")
text = d.markup_text(cvdr, xml=True)
assert text == "## Artikel 1 Begrippen\nIn deze verordening:\na. jeugdhulp: hulp\nb. Wmo", text  # no metadata, words apart
assert d.parts("") == [] and d.parts("a\nb\nc\n", size=3) == ["a", "b", "c"]
assert d.parts("x" * 5 + "\n" + "y" * 5, size=100) == ["xxxxx\nyyyyy"]
docx = zipped({"word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Zorginkoopbeleid</w:t></w:r><w:tab/>"
                                    "<w:r><w:t>2027</w:t></w:r></w:p><w:p><w:r><w:t>Tweede alinea</w:t></w:r></w:p></w:body></w:document>"})
assert d._text_pages("docx", docx) == [{"markdown": "Zorginkoopbeleid\t2027\nTweede alinea", "source": "docx"}]


# ---------------------------------------------------------------- read + search: cached, indexed, citable

calls = []


def fake_fetch(url, timeout=120):
    calls.append(url)
    return (b"<html><body><h1>Inkoopbeleid wijkverpleging</h1><p>Het tarief per uur bedraagt 72,40.</p></body></html>",
            "text/html", url)


d.fetch = fake_fetch
db = d.connect(os.path.join(os.environ["DATA_DIR"], "t.db"))
url = "https://insurer.example/beleid"
r = d.read(url, pages="all", db=db)
assert r["kind"] == "html" and r["page_count"] == 1 and r["pages"][0]["cite"] == url, r
assert r["pages"][0]["markdown"] == "## Inkoopbeleid wijkverpleging\nHet tarief per uur bedraagt 72,40."
d.read(url, db=db)
assert calls == [url], "a second read comes from the cache"
s = d.search_text("tarief", url=url, db=db)
assert [(h["page"], h["cite"]) for h in s["results"]] == [(1, url)] and "«tarief»" in s["results"][0]["snippet"], s
assert d._cite({"kind": "pdf", "file_url": "https://x.example/a.pdf"}, 4) == "https://x.example/a.pdf#page=4"
# Every page or part is cited by our own copy, which opens in the evidence panel: a PDF as its page, the rest as text.
assert r["pages"][0]["href"] == s["results"][0]["href"] == f"/bron/tekst/{r['id']}/1", (r["pages"][0], s["results"][0])
assert d._href(r["id"], {"kind": "pdf"}, 4) == f"/bron/doc/{r['id']}/4"
p = d.document_part(r["id"], 1)
assert (p["page"], p["kind"], p["url"], p["text"]) == (1, "html", url, r["pages"][0]["markdown"]), p
raises(KeyError, d.document_part, r["id"], 2)
page = {"kind": "html", "file_url": "https://a.example/p", "pages": [{"markdown": "Kosten Wlz | Zorgcijfers\n## Menu\n## Tabel vinden"}]}
assert d._title("x", page) == "Kosten Wlz | Zorgcijfers", "a web page is named by its <title>, not its menu headings"
m = d.document_meta(r["id"])
assert (m["title"], m["host"], m["url"], m["page_count"]) == ("Inkoopbeleid wijkverpleging", "insurer.example", url, 1), m
for bad in ["../../etc/passwd", "0" * 20, r["id"].upper()]:  # a path, an id not in the cache, not our id shape
    try:
        d.document_meta(bad)
        raise AssertionError(bad)
    except KeyError:
        pass
try:
    d.document_pdf(r["id"])
    raise AssertionError("an HTML document has no PDF")
except KeyError:
    pass


# ---------------------------------------------------------------- links on a page

title, found = d.page_links(
    b"<html><head><title> Zorginkoop\n Menzis </title></head><body>"
    b"<a href='/downloads/Beleid%202027.PDF#p2'>Zorginkoopbeleid <b>2027</b></a>"
    b"<a href=\"sub/page\">Wijkverpleging</a><a href='mailto:x@y.nl'>mail</a><a href='javascript:void(0)'>js</a>"
    b"<a href='/downloads/Beleid%202027.PDF'>again</a><a href='https://other.example/data.xlsx' title='Prognose'></a>"
    b"</body></html>", "https://www.insurer.example/zorgaanbieders/")
assert title == "Zorginkoop Menzis", title
assert found == [
    {"text": "Zorginkoopbeleid 2027", "url": "https://www.insurer.example/downloads/Beleid%202027.PDF", "type": "pdf"},
    {"text": "Wijkverpleging", "url": "https://www.insurer.example/zorgaanbieders/sub/page", "type": "page"},
    {"text": "Prognose", "url": "https://other.example/data.xlsx", "type": "xlsx"},
], found  # absolute, each once, fragments and mailto/javascript dropped, extension case ignored
d.fetch = lambda url, timeout=120: (b"<html><a href='/a'>Visie</a><a href='/b.pdf'>Beleid GGZ 2027</a>"
                                    b"<a href='/c.pdf'>Beleid wijk 2026</a></html>", "text/html", url)
r = d.links("https://insurer.example/", query="beleid")
assert [x["url"] for x in r["links"]] == ["https://insurer.example/b.pdf", "https://insurer.example/c.pdf"], r
assert d.links("https://insurer.example/")["links"][0]["type"] == "pdf", "files come first"
assert d._safe_url("https://www.vektis.nl/a b/Zorgthermometer 2026.pdf?v=1") == "https://www.vektis.nl/a%20b/Zorgthermometer%202026.pdf?v=1"
assert d._safe_url("https://x.example/Beleid%202027.pdf") == "https://x.example/Beleid%202027.pdf"  # already encoded: unchanged
assert d._safe_url("http://www.opendisdata.nl/download/csv/01_DBC.csv") == "https://opendisdata.nza.nl/download/csv/01_DBC.csv"  # moved host, and always https: its http redirect drops the path
_, links = d.page_links(
    b"<a href='/services/file/get?key=abc'>Openbaar databestand Wijkverpleging verslagjaar 2024 Excel file 1.1 MB</a>"
    b"<a href='/services/file/get?key=def'>Rapport 2022 PDF file 157.7 KB</a>"
    b"<a href='/up/Zorgthermometer 2026.pdf'>Zorgthermometer</a>"
    b"<a href='/over'>Over de PDF</a>",
    "https://www.zorginzicht.nl/algemeen/open-data-wijkverpleging")
assert [(x["type"], x["url"]) for x in links] == [
    ("xlsx", "https://www.zorginzicht.nl/services/file/get?key=abc"),
    ("pdf", "https://www.zorginzicht.nl/services/file/get?key=def"),
    ("pdf", "https://www.zorginzicht.nl/up/Zorgthermometer%202026.pdf"),
    ("page", "https://www.zorginzicht.nl/over"),
]


# ---------------------------------------------------------------- Woo search

seen = []
woo = {"totaal": 1, "resultaten": [{
    "document": {"id": "oep-0a1b_2", "titel": "Beslisnota jeugdzorg", "publisher": "ministerie van VWS",
                 "openbaarmakingsdatum": "2026-03-01", "weblocatie": None},
    "highlightedText": "de <b>jeugdzorg</b> &amp; Wmo", "bestandsType": "pdf", "aantalPaginas": 4}],
    "filters": {"organisatie": [{"naam": "b", "aantal": 1}, {"naam": "a", "aantal": 9}], "documentsoort": []}}
d._get_json = lambda url, body=None: seen.append(url) or woo
r = d.search_woo("jeugdzorg", organisatie="ministerie van Volksgezondheid, Welzijn en Sport", since="2026-01-31", limit=7)
assert "organisatie=ministerie+van+Volksgezondheid%252C+Welzijn" in seen[0], seen  # a comma in a name: encoded twice
assert "aantalResultaten=10" in seen[0] and "publicatiedatumVan=31-01-2026" in seen[0], seen
h = r["results"][0]
assert h["url"] == "https://open.overheid.nl/documenten/oep-0a1b", h  # no pid: the id without its version
assert h["snippet"] == "de «jeugdzorg» & Wmo" and r["organisations"] == ["a (9)", "b (1)"] and not r["truncated"], r
raises(ValueError, d.search_woo, "x", since="1-1-2026")


# ---------------------------------------------------------------- gazettes and CVDR (SRU)

SRU = """<?xml version="1.0"?><sru:searchRetrieveResponse xmlns:sru="http://docs.oasis-open.org/ns/search-ws/sruResponse"
 xmlns:dcterms="http://purl.org/dc/terms/" xmlns:gzd="http://standaarden.overheid.nl/sru"><sru:numberOfRecords>3</sru:numberOfRecords>
<sru:records>{}</sru:records></sru:searchRetrieveResponse>"""
# TED: a region in one search; winners from winner-name (once each, not per lot), a direct award's contractor from its
# tenderer, and never the losing tenderers of a result notice
sent = []
d._get_json = lambda url, body=None: sent.append(body) or {"totalNoticeCount": 3, "notices": [
    {"publication-number": "1-2025", "notice-type": "can-social", "place-of-performance": ["NL366", "NLD"],
     "winner-name": {"nld": ["Fort Jeugd B.V.", "Fort Jeugd B.V."]}, "organisation-name-tenderer": {"nld": ["Fort Jeugd B.V.", "Verliezer B.V."]}},
    {"publication-number": "2-2025", "notice-type": "veat", "organisation-name-tenderer": {"nld": ["Zorggroep Katwijk"]}},
    {"publication-number": "3-2025", "notice-type": "cn-social", "organisation-name-tenderer": {"nld": ["Nog niemand"]}}]}
r = d.search_tenders("jeugd", place="NL33 NL36", awarded=True)
assert "place-of-performance IN (NL33 NL36)" in sent[0]["query"] and "notice-type IN (can-standard" in sent[0]["query"], sent
assert [(h["winners"], h["winners_total"]) for h in r["results"]] == [(["Fort Jeugd B.V."], 1), (["Zorggroep Katwijk"], 1), ([], 0)], r
assert r["results"][0]["place"] == ["NL366"]
assert "NUTS" in raises(ValueError, d.search_tenders, place="Zuid-Holland")

rec = lambda body: f"<sru:record><sru:recordData><gzd:gzd>{body}</gzd:gzd></sru:recordData></sru:record>"
pub = rec("<dcterms:identifier>gmb-2026-1</dcterms:identifier><dcterms:title>Beleidsregels jeugdhulp</dcterms:title>"
          "<dcterms:creator>Leiden</dcterms:creator><dcterms:date>2026-02-01</dcterms:date>"
          "<publicatienaam>Gemeenteblad</publicatienaam><preferredUrl>https://zoek.officielebekendmakingen.nl/gmb-2026-1.html</preferredUrl>"
          "<itemUrl manifestation='xml'>https://repository.overheid.nl/x.xml</itemUrl>"
          "<itemUrl manifestation='pdf'>https://zoek.officielebekendmakingen.nl/gmb-2026-1.pdf</itemUrl>")
urls = []
digimv._http = lambda url, **k: urls.append(url) or SRU.format(pub).encode()
r = d.search_publications('"jeugdhulp"', creator="Leiden", gazette="gmb", since="2026-01-01", limit=1)
assert r["results"][0]["url"].endswith("gmb-2026-1.pdf") and r["results"][0]["gazette"] == "Gemeenteblad", r
assert r["total"] == 3 and r["truncated"], r
assert "w.publicatienaam%3D%22Gemeenteblad%22" in urls[0] and "cql.textAndIndexes%3D%22jeugdhulp%22" in urls[0], urls
assert d._text_cql('tarief "zorg in natura" Leiden') == ['cql.textAndIndexes="zorg in natura"', 'cql.textAndIndexes all "tarief Leiden"']
assert d._text_cql('jeugdhulp "open') == ['cql.textAndIndexes all "jeugdhulp"'] and d._text_cql('a\\b') == ['cql.textAndIndexes all "a b"']
raises(ValueError, d._text_cql, '"" ')
raises(ValueError, d.search_publications, "x", gazette="nope")
cv = lambda i, frm, until: rec(f"<dcterms:identifier>CVDR7001_{i}</dcterms:identifier><dcterms:title>Verordening</dcterms:title>"
                               f"<inwerkingtredingDatum>{frm}</inwerkingtredingDatum>"
                               + (f"<uitwerkingtredingDatum>{until}</uitwerkingtredingDatum>" if until else "")
                               + f"<publicatieurl_xml>https://repository.overheid.nl/cvdr/{i}.xml</publicatieurl_xml>")
digimv._http = lambda url, **k: SRU.format(cv(1, "2020-01-01", "2026-01-01") + cv(2, "2026-01-01", None) + cv(3, "2027-01-01", None)).encode()
r = d.search_regulations("jeugdhulp", today="2026-11-12")
assert [h["in_force"] for h in r["results"]] == [False, True, False], r  # expired, current, not yet in force
assert r["results"][1]["web_page"] == "https://lokaleregelgeving.overheid.nl/CVDR7001/2"
digimv._http = lambda url, **k: SRU.format("").replace("</sru:records>", "</sru:records><diagnostics><message>bad query</message></diagnostics>").encode()
assert raises(ValueError, d.search_regulations, "x") == "bad query"


# ---------------------------------------------------------------- data files

xlsx = zipped({
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.'
                       'openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Subsidies" r:id="rId1"/>'
                       '<sheet name="Toelichting" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                  '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml": '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Subsidieregister 2025</t></si>'
                            '<si><t>Ontvanger</t></si><si><t>Bedrag</t></si><si><r><t>St. </t></r><r><t>Overweeghuis</t></r></si></sst>',
    "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                                '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
                                '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>1</v></c></row>'
                                '<row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4"><v>95000</v></c><c r="D4"><v>0.1</v></c></row>'
                                '<row r="5"><c r="B5" t="inlineStr"><is><t>n.v.t.</t></is></c><c r="C5" t="b"><v>1</v></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                                '<row r="1"><c r="A1" t="str"><v>uitleg</v></c></row></sheetData></worksheet>'})
name, names, rows = datasets.xlsx_rows(xlsx)
assert (name, names) == ("Subsidies", ["Subsidies", "Toelichting"])
assert rows == [["Subsidieregister 2025"], [], ["Ontvanger", "Bedrag", "Ontvanger"], ["St. Overweeghuis", 95000, None, 0.1],
                [None, "n.v.t.", True]], rows  # a gap keeps its column, rich text is joined, numbers are numbers
assert datasets.xlsx_rows(xlsx, "Toelichting")[2] == [["uitleg"]]  # a target with an absolute path
raises(KeyError, datasets.xlsx_rows, xlsx, "Nope")
assert datasets.xlsx_rows(xlsx, "toelichting")[0] == "Toelichting", "a sheet name matches ignoring case"
assert datasets._number("16646") == 16646 and datasets._number("1E-3") == 0.001 and datasets._number("2.0") == 2.0
assert datasets._header_row(rows) == 3
assert datasets._columns(["Ontvanger", "", "Ontvanger", "row", None]) == ["Ontvanger", "column 2", "Ontvanger'", "row'", "column 5"]
assert datasets.csv_rows("naam;bedrag\nZorg één;1.234\n".encode("cp1252")) == [["naam", "bedrag"], ["Zorg één", "1.234"]]
assert datasets.csv_rows(b"\xef\xbb\xbfa,b\n1,2\n") == [["a", "b"], ["1", "2"]]  # BOM gone
assert datasets.csv_rows(b"a,b\n\x81,2\n")[1] == ["\x81", "2"]  # bytes no code page knows still read
assert datasets.json_rows(b'{"value": [{"a": 1}, {"b": 2}]}') == [["a", "b"], [1, None], [None, 2]]
raises(ValueError, datasets.json_rows, b'{"a": 1}')

def serve(body, ctype="application/octet-stream"):
    """read_table reads its file from disk: write the fixture there and hand out its path."""
    path = pathlib.Path(tempfile.mkstemp(dir=os.environ["DATA_DIR"])[1])
    path.write_bytes(body)
    datasets._file = lambda url, refresh=False: (path, ctype, url, "2026-11-12T10:00:00+00:00")


serve(xlsx)
t = datasets.read_table("https://gemeente.example/subsidies.xlsx", query="overweeghuis")
assert (t["header_row"], t["title_rows"], t["rows_total"], t["rows_matched"]) == (3, [["Subsidieregister 2025"]], 2, 1), t
assert t["rows"] == [{"row": 4, "Ontvanger": "St. Overweeghuis", "Bedrag": 95000, "Ontvanger'": None, "column 4": 0.1}], t
assert [x["row"] for x in datasets.read_table("https://gemeente.example/subsidies.xlsx")["rows"]] == [4, 5]  # as Excel shows
assert datasets.read_table("https://gemeente.example/subsidies.xlsx", header_row=1)["columns"][:2] == ["Subsidieregister 2025", "column 2"]
# no sheet asked, and the first lacks the filter column: the sheet that has it (a cover or version history comes first)
assert datasets.read_table("https://gemeente.example/subsidies.xlsx", filters={"uitleg": ["x"]})["sheet"] == "Toelichting"
assert "uitleg" in raises(KeyError, datasets.read_table, "https://gemeente.example/subsidies.xlsx", sheet="Subsidies",
                          filters={"uitleg": ["x"]}), "a sheet asked for is never swapped"
assert "Nope" in raises(KeyError, datasets.read_table, "https://gemeente.example/subsidies.xlsx", filters={"Nope": ["x"]})
z = zipfile.ZipFile(io.BytesIO(xlsx))
serve(zipped({**{n: z.read(n).decode() for n in z.namelist()},
              "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'}))
assert datasets.read_table("https://x.example/leeg-voorblad.xlsx")["sheet"] == "Toelichting", "an empty first sheet is passed over"
serve(b"", "text/csv")
assert "empty" in raises(KeyError, datasets.read_table, "https://x.example/leeg.csv")
serve(b'[{"a": 1}, {"a": 2}]', "application/json")
assert [x["row"] for x in datasets.read_table("https://x.example/a.json")["rows"]] == [1, 2]  # JSON: the record number
serve(b"<!doctype html><html>", "text/html")
assert "read_document" in raises(ValueError, datasets.read_table, "https://x.example/")
serve(b"\xd0\xcf\x11\xe0rest", "application/vnd.ms-excel")
assert ".xls" in raises(ValueError, datasets.read_table, "https://x.example/a.xls")
serve(b"7z\xbc\xaf\x27\x1c rest")
assert "7-Zip" in raises(ValueError, datasets.read_table, "https://x.example/a.7z")

# A CSV is streamed: same rows and numbers as reading it whole, a non-utf-8 byte at the very end still read as cp1252
big = ("Overzicht DBC\n\nJAAR;DIAGNOSE_CD;AANTAL\n" + "".join(f"{2024 if i % 3 == 0 else 2023};{i % 3000:04};{i}\n" for i in range(30000))
       + "2024;1101;Zorg één\n").encode("cp1252")
serve(big, "text/csv")
t = datasets.read_table("https://x.example/dbc.csv", filters={"jaar": "2024", "DIAGNOSE_CD": ["1101", "9999"]}, limit=2)
whole = datasets.csv_rows(big)
want = [n for n, r in enumerate(whole, 1) if r[:2] == ["2024", "1101"]]
assert (t["header_row"], t["title_rows"], t["rows_total"]) == (3, [["Overzicht DBC"]], 30001), t
assert [x["row"] for x in t["rows"]] == want[:2] and t["rows_matched"] == len(want) and t["truncated"], (t, want)
assert t["rows"][0]["DIAGNOSE_CD"] == "1101", "a code keeps its leading zeros and is never a number"
t = datasets.read_table("https://x.example/dbc.csv", filters={"DIAGNOSE_CD": ["1101"]}, query="één")
assert [x["row"] for x in t["rows"]] == [len(whole)] and t["rows"][0]["AANTAL"] == "Zorg één", t  # the cp1252 tail
assert datasets.read_table("https://x.example/dbc.csv", query="1101")["rows_matched"] > len(want), \
    "query hits amounts too: that is why filters exist"
assert "AANTAL" in raises(KeyError, datasets.read_table, "https://x.example/dbc.csv", filters={"Nope": ["1"]})
# sort: the most first over every matched row in one pass, text after numbers, paging the same order; ties keep file order
rank = lambda **kw: [x["AANTAL"] for x in datasets.read_table("https://x.example/dbc.csv", filters={"JAAR": "2024"}, **kw)["rows"]]
assert rank(sort="-AANTAL", limit=3) == ["29997", "29994", "29991"]
assert rank(sort="AANTAL", limit=2) == ["0", "3"] and rank(sort="-AANTAL", offset=10000, limit=5)[-1] == "Zorg één"
assert rank(sort="-AANTAL", offset=2, limit=2) == ["29991", "29988"]
assert [datasets._sort_key(v) for v in ("1.234,5", "94691", 7, "", "n.v.t.")] == [(1, 1234.5), (1, 94691.0), (1, 7), (0,), (0,)]
assert "AANTAL" in raises(KeyError, datasets.read_table, "https://x.example/dbc.csv", sort="-Nope")
serve(b"a,b\n" + b"1,2\n" * 40 + b"3,4,5\n", "text/csv")  # the wide row comes after the 30 rows read up front
t = datasets.read_table("https://x.example/w.csv", filters={"a": ["3"]})
assert t["columns"] == ["a", "b", "column 3"] and t["rows"][0]["column 3"] == "5", "a cell past the header keeps a column"

# A ZIP: its only data file is read; with more than one, member picks
serve(zipped({"lees mij.txt.pdf": "x", "data/kwaliteit.csv": "KvkNummer;Waarde\n41179297;12\n61354740;7\n"}))
t = datasets.read_table("https://x.example/n.zip", filters={"KvkNummer": ["61354740"]})
assert (t["format"], t["members"], [r["Waarde"] for r in t["rows"]]) == ("csv", ["data/kwaliteit.csv"], ["7"]), t
serve(zipped({"a.csv": "x\n1\n", "b.json": '[{"x": 2}]'}))
assert "member" in raises(ValueError, datasets.read_table, "https://x.example/two.zip")
assert datasets.read_table("https://x.example/two.zip", member="b.json")["rows"] == [{"row": 1, "x": 2}]
raises(KeyError, datasets.read_table, "https://x.example/two.zip", member="c.csv")

# A /bron/rij/ citation opens one row of our cached copy, by its number in the file, in the sheet or member it names
tables = d.PUB / "tables"
tables.mkdir(parents=True, exist_ok=True)


def cached(did, body, ctype, url):
    (tables / did).write_bytes(body)
    (tables / f"{did}.json").write_text(json.dumps({"content_type": ctype, "file_url": url, "fetched_at": "2026-11-12T10:00:00+00:00"}))


cached("a" * 20, big, "text/csv", "https://x.example/services/file/get?key=abc")
r = datasets.table_row("a" * 20, want[0])
assert r["row"] == {"row": want[0], "JAAR": "2024", "DIAGNOSE_CD": "1101", "AANTAL": whole[want[0] - 1][2]}, r
assert (r["columns"], r["title_rows"], r["file_name"]) == (["JAAR", "DIAGNOSE_CD", "AANTAL"], [["Overzicht DBC"]], "x.example-aaaaaaaa.csv"), r
assert datasets.table_row("a" * 20, len(whole))["row"]["AANTAL"] == "Zorg één", "the cp1252 row itself"
for n in (2, 3, len(whole) + 1):  # a blank row, the header, past the end
    raises(KeyError, datasets.table_row, "a" * 20, n)
sheet = datasets.xlsx_rows(xlsx)[0]
cached("b" * 20, xlsx, "application/octet-stream", "https://gemeente.example/subsidies.xlsx")
r = datasets.table_row("b" * 20, 4, [sheet])
assert (r["row"]["Ontvanger"], r["row"]["Bedrag"], r["sheet"], r["member"], r["file_name"]) == \
    ("St. Overweeghuis", 95000, sheet, None, "subsidies.xlsx"), r
raises(KeyError, datasets.table_row, "b" * 20, 4, ["Nope"])
cached("c" * 20, zipped({"a.csv": "x\n1\n", "b.json": '[{"x": 2}]'}), "application/zip", "https://x.example/two.zip")
r = datasets.table_row("c" * 20, 1, ["b.json"])
assert (r["row"], r["member"], r["format"]) == ({"row": 1, "x": 2}, "b.json", "json"), r
raises(ValueError, datasets.table_row, "c" * 20, 1)  # two data files, the citation names none
for bad in ["../../etc/passwd", "0" * 20, "A" * 20]:
    raises(KeyError, datasets.table_row, bad, 1)


# ---------------------------------------------------------------- CBS: padded keys, the row cap, symbols

table = {"id": "40100NED", "host": "https://dataderden.cbs.nl", "modified": "2026-10-01"}
dims = {"title": "Wmo-cliënten", "description": "", "period": "2024-2025", "modified": "2026-10-01", "topics": [
            {"key": "Clienten_1", "title": "Cliënten", "unit": "aantal", "group": "", "decimals": 0},
            {"key": "Aandeel_2", "title": "Aandeel", "unit": "%", "group": "", "decimals": 1}],
        "dims": [{"key": "RegioS", "title": "Regio's", "type": "GeoDimension",
                  "codes": [{"key": "GM0546    ", "title": "Leiden"}, {"key": "GM0518    ", "title": "'s-Gravenhage"}]
                           + [{"key": f"GM9{i:03}    ", "title": f"G{i}"} for i in range(400)]},
                 {"key": "Perioden", "title": "Perioden", "type": "TimeDimension",
                  "codes": [{"key": "2024JJ00", "title": "2024"}, {"key": "2025JJ00", "title": "2025*"}]},
                 {"key": "Voorziening", "title": "Voorziening", "type": "Dimension",
                  "codes": [{"key": f"V{i:02}", "title": f"v{i}"} for i in range(13)]}]}
datasets.cbs_catalog = lambda refresh=False, db=None: None
datasets._cbs_table = lambda db, table_id: table
datasets._cbs_dims = lambda db, t: dims
asked = []
sources._all = lambda url: asked.append(url) or [
    {"RegioS": "GM0546    ", "Perioden": "2024JJ00", "Voorziening": "V00", "Clienten_1": "8575", "Aandeel_2": "  6.4"},
    {"RegioS": "GM0546    ", "Perioden": "2025JJ00", "Voorziening": "V00", "Clienten_1": "x", "Aandeel_2": "."}]
r = datasets.get_cbs("40100NED", {"RegioS": ["leiden"], "perioden": "2024JJ00"}, ["Clienten_1", "aandeel_2"])
assert "RegioS%20eq%20%27GM0546%20%20%20%20%27" in asked[0], asked  # the padded key as CBS has it, matched by title
assert r["rows"][0] == {"RegioS": "GM0546 = Leiden", "Perioden": "2024JJ00 = 2024", "Voorziening": "V00 = v0",
                        "Clienten_1": 8575, "Aandeel_2": 6.4}, r["rows"][0]
assert r["rows"][1]["Clienten_1"] == {"value": None, "symbol": "x"} and set(r["symbols"]) == {".", "x"}, r
assert r["source"] == asked[0] and r["topics"]["Clienten_1"] == "Cliënten (aantal)"
assert "10,000" in raises(ValueError, datasets.get_cbs, "40100NED")  # 402 regions x 2 periods x 13 = 10,452 rows
asked.clear()
datasets.get_cbs("40100NED", {"RegioS": ["GM0546"]})  # 26 rows: fine
assert "%27GM0546%20%20%20%20%27" in asked[0]
assert "describe_cbs_table" in raises(KeyError, datasets.get_cbs, "40100NED", {"RegioS": ["Leide"]})  # no fuzzy guess
raises(KeyError, datasets.get_cbs, "40100NED", {"Gemeente": ["GM0546"]})
raises(KeyError, datasets.get_cbs, "40100NED", {"RegioS": ["GM0546"]}, ["Nope"])
assert datasets._cbs_value(" 12 ") == (12, None) and datasets._cbs_value("-") == (None, "-") and datasets._cbs_value(None) == (None, None)

# A /bron/cbs/{table}/{code per dimension}/{topic} citation: the one value, read from CBS again, with its labels
c = datasets.cbs_cell("40100NED", ["GM0546", "2024JJ00", "V00"], "Clienten_1")
assert (c["value"], c["symbol"], c["topic"], c["unit"], c["page"]) == (8575, None, "Cliënten", "aantal", "https://dataderden.cbs.nl"), c
assert c["dimensions"] == [{"title": "Regio's", "value": "GM0546 = Leiden"}, {"title": "Perioden", "value": "2024JJ00 = 2024"},
                           {"title": "Voorziening", "value": "V00 = v0"}] and "%27GM0546%20%20%20%20%27" in c["source"], c
sources._all = lambda url: [{"RegioS": "GM0546    ", "Perioden": "2025JJ00", "Voorziening": "V00", "Clienten_1": "x"}]
c = datasets.cbs_cell("40100NED", ["GM0546", "2025JJ00", "V00"], "Clienten_1")
assert c["value"] is None and c["symbol"] == "x" and c["symbol_meaning"], "a value CBS withholds is never 0"
assert "3 dimensions" in raises(KeyError, datasets.cbs_cell, "40100NED", ["GM0546", "2024JJ00"], "Clienten_1")
raises(KeyError, datasets.cbs_cell, "40100NED", ["GM0546", "2024JJ00", "V99"], "Clienten_1")


# ---------------------------------------------------------------- Swing: a key per site, sent only to that site

os.environ.pop("PMZW_API_KEY", None)
assert "PMZW_API_KEY" in raises(RuntimeError, datasets.search_swing, "prognosemodelzw", "tekort")  # no key: not connected
raises(KeyError, datasets.search_swing, "nope", "tekort")
os.environ["PMZW_API_KEY"] = "k"
B = "https://prognosemodelzw.nl/ods/odata"
ind = lambda code, name: {"Code": code, "Name": name, "Description": "", "Unit": "aantal", "Source": "abf",
                          "StartPeriodCode": "2024", "EndPeriodCode": "2034"}
cube = lambda p: {"Indicator": "pmzw_tekort", "Period": p, "GeoLevel": "regio", "DimensionLevels": "", "DimensionLevelNames": ""}
swing = {
    f"{B}/Indicators": {"value": [ind("pmzw_tekort", "Tekort aan werknemers")], "@odata.nextLink": f"{B}/Indicators?$skip=1"},
    f"{B}/Indicators?$skip=1": {"value": [ind("pmzw_wn", "Werknemers in zorg en welzijn")]},
    f"{B}/Indicators/pmzw_tekort/DataCubes": {"value": [cube("year_2025"), cube("year_2026")]},
    f"{B}/DataCubes(Dimensionlevels='',GeoLevel='regio',Indicator='pmzw_tekort',Period='year_2025')/Data": {"value": [
        {"GeoItem": "regio_1", "Period": "year_2025", "Value": 1200, "ValueType": "Regular", "DimensionLevelMembers": ""},
        {"GeoItem": "regio_2", "Period": "year_2025", "Value": None, "ValueType": "Missing", "DimensionLevelMembers": ""}]},
    f"{B}/GeoLevels/regio/GeoLevelMembers": {"value": [{"Code": "regio_1", "Name": "Holland Rijnland"},
                                                        {"Code": "regio_2", "Name": "Rijnmond"}]},
    f"{B}/Leak": {"value": [], "@odata.nextLink": "https://other.example/steal"},
}
sent = []
sources._json = lambda url, body=None, timeout=60, headers=None: sent.append((url, headers)) or swing[url]
r = datasets.search_swing("prognosemodelzw", "zorg welzijn")
assert [h["code"] for h in r["results"]] == ["pmzw_wn"] and r["total"] == 1, r  # found on the next page
assert all(h == {"apikey": "k"} for _, h in sent), sent
r = datasets.get_swing("prognosemodelzw", "pmzw_tekort")
assert r["combinations"] == [{"geo_level": "regio", "dimension_levels": "", "dimensions": "", "periods": ["year_2025", "year_2026"]}], r
r = datasets.get_swing("prognosemodelzw", "pmzw_tekort", "regio", "year_2025")
assert r["rows"] == [{"area": "regio_1 = Holland Rijnland", "period": "year_2025", "value": 1200, "value_type": "Regular"},
                     {"area": "regio_2 = Rijnmond", "period": "year_2025", "value": None, "value_type": "Missing"}], r
assert r["source_url"].endswith("Period='year_2025')/Data") and r["unit"] == "aantal"
geo = lambda q: [x["area"] for x in datasets.get_swing("prognosemodelzw", "pmzw_tekort", "regio", "year_2025", q)["rows"]]
assert geo("rijn") == ["regio_1 = Holland Rijnland", "regio_2 = Rijnmond"] and geo("mond") == [] and geo("2") == ["regio_2 = Rijnmond"], \
    "a word matches the start of a word, as 'assen' must find Assen and not Wassenaar"
assert "get_swing without" in raises(KeyError, datasets.get_swing, "prognosemodelzw", "pmzw_tekort", "regio", "year_1999")
raises(KeyError, datasets.get_swing, "prognosemodelzw", "nope")
sent.clear()
raises(RuntimeError, datasets._swing_all, B, "k", "Leak")
assert [u for u, _ in sent] == [f"{B}/Leak"], "the key never goes to another host"
os.environ.pop("PMZW_API_KEY")
raises(RuntimeError, datasets.search_swing, "prognosemodelzw", "zorg")  # key removed: off, though the cache is filled
raises(RuntimeError, datasets.get_swing, "prognosemodelzw", "pmzw_tekort")

print("documents ok")
