"""Public sources next to DigiMV: the care-provider register (LRZa), the accounts of municipalities, joint
arrangements, provinces and water boards (CBS Iv3), and court rulings (Rechtspraak).

Same rules as digimv.py: values verbatim with their source, cached once fetched, and anything missing reported as
missing, never filled in. Checked against the live services on 2026-11-12:
  LRZa     GET  https://zoeken.zorgaanbiedersportaal.nl/api/v1/Organisatie/{kvk}  -> JSON; 404 for an unknown KvK
           POST https://zoeken.zorgaanbiedersportaal.nl/api/v1/Zoeken {naam|postcode|kvknummer} -> aantal + <= 50 hits
  Iv3      https://dataderden.cbs.nl/ODataCatalog/Tables lists one OData v3 table per kind and year. Keys are
           space-padded per dimension ('GM0546   ', '6.711 '), and a query over 10,000 rows is refused, not paged.
  Rulings  text: https://data.rechtspraak.nl/uitspraken/content?id={ECLI} (official open data, CC0)
           search: https://uitspraken.rechtspraak.nl/api/zoek, the JSON behind rechtspraak.nl's own search. The open
           data API has no text search; this one is undocumented and may change.
"""

import argparse
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import digimv

SCHEMA = """
CREATE TABLE IF NOT EXISTS lrza(kvk TEXT PRIMARY KEY, fetched_at TEXT, found INT, raw TEXT);
CREATE TABLE IF NOT EXISTS iv3_tables(id TEXT PRIMARY KEY, kind TEXT, year INT, title TEXT, modified TEXT);
CREATE TABLE IF NOT EXISTS iv3_dims(tbl TEXT PRIMARY KEY, modified TEXT, dims TEXT);
CREATE TABLE IF NOT EXISTS iv3_rows(tbl TEXT, body TEXT, report TEXT, taakveld TEXT, categorie TEXT, v1 REAL, v2 REAL);
CREATE INDEX IF NOT EXISTS iv3_rows_key ON iv3_rows(tbl, body, report);
CREATE TABLE IF NOT EXISTS iv3_log(tbl TEXT, body TEXT, report TEXT, modified TEXT, n INT, PRIMARY KEY(tbl, body, report));
CREATE TABLE IF NOT EXISTS rulings(ecli TEXT PRIMARY KEY, fetched_at TEXT, v INT, parsed TEXT);
CREATE TABLE IF NOT EXISTS sources_log(name TEXT PRIMARY KEY, fetched_at TEXT);
"""


def connect(path=None):
    db = digimv.connect(path)
    db.executescript(SCHEMA)
    return db


def _now():
    return datetime.now(timezone.utc)


def _iso(t):
    return t.isoformat(timespec="seconds")


def _older(stamp, age):
    return datetime.fromisoformat(stamp) < _now() - age


def _json(url, body=None, timeout=60):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    return json.loads(digimv._http(url, data=data, headers=headers, timeout=timeout))


def _fold(s):
    """'Één Zorg' -> 'een zorg': case and accents ignored, as in the DigiMV search."""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


# ---------------------------------------------------------------- LRZa (Landelijk Register Zorgaanbieders)

LRZA = "https://zoeken.zorgaanbiedersportaal.nl"
LRZA_TTL = timedelta(days=7)  # the register follows the Handelsregister; a week old is recent enough to cite
LRZA_MISSING_TTL = timedelta(days=1)
LRZA_SCOPE = ("Landelijk Register Zorgaanbieders (CIBG), as the public portal shows it. Legal facts come from the "
              "Handelsregister, AGB codes from Vektis. A provider that is not listed may still exist: only "
              "organisations that registered as a care provider are in it.")


def _kvk(kvk):
    kvk = str(kvk).strip()
    if not re.fullmatch(r"\d{8}", kvk):
        raise ValueError(f"a KvK number has 8 digits, got {kvk!r}")
    return kvk


def register_url(kvk, name=""):
    """The portal's own page for an organisation. Its router reads only the KvK; the name part is decoration."""
    slug = re.sub(r"[^a-z0-9]+", "-", _fold(name.replace("&", " en "))).strip("-") or "zorgaanbieder"
    return f"{LRZA}/zorgaanbieder/{slug}/{kvk}"


def _lrza_date(d):
    """{"jaar": 2004, "maand": 1, "dag": 1} -> "2004-01-01". The register has partial dates; they stay partial."""
    if not d or not d.get("jaar"):
        return None
    out = f"{d['jaar']:04d}"
    if d.get("maand"):
        out += f"-{d['maand']:02d}"
        if d.get("dag"):
            out += f"-{d['dag']:02d}"
    return out


def _lrza_address(a):
    """The portal's own wording: a shielded address is 'Adres niet openbaar', never an empty one."""
    if not a:
        return None
    if a.get("isafgeschermd"):
        return "Adres niet openbaar"
    return ", ".join(x.strip() for x in a.get("adresRegels") or [] if x and x.strip()) or "Adres onbekend"


def _agb(items):
    return [f"{a['code']} {a['omschrijving']}".strip() for a in items or []]


def _permit(code, registered):
    """toelatingsvergunning as the portal reads it (its enum: 0 Onbekend, 1 Ja, 2 Nee). The portal adds that a 'Nee'
    for an organisation registered before 2025 falls under the Wtza transition rules, so it says so too."""
    if code == 1:
        return "ja"
    if code == 2:
        if not registered or int(registered[:4]) < 2025:  # portal: unknown registration date counts as before 2025
            return ("nee volgens het register; de Wtza is per 1 januari 2025 gewijzigd en voor organisaties van voor "
                    "2025 geldt overgangsrecht (zie toetredingzorgaanbieders.nl), dus dit is geen bewijs dat een "
                    "vergunning ontbreekt")
        return "nee (niet alle zorgaanbieders zijn vergunningplichtig)"
    return "onbekend: het register kon de vergunningsgegevens niet ophalen"


def _notification(melding):
    if not melding:
        return "niet gemeld onder de Wtza (niet alle zorgaanbieders hebben meldplicht)"
    yes = lambda v: "ja" if v is True else "nee"  # noqa: E731
    return (f"gemeld onder de Wtza; als zorgaanbieder: {yes(melding.get('isZorgaanbieder'))}, "
            f"als jeugdhulpaanbieder: {yes(melding.get('isJeugdhulpaanbieder'))}")


def normalise_register(raw):
    """One LRZa organisation, in the portal's own terms."""
    registered = _lrza_date(raw.get("datumInschrijving"))
    # ponytail: the numeric `meldplicht` field is left out; the portal never shows it, the `melding` object is the fact
    return {
        "kvk": raw["kvknummer"],
        "naam": raw.get("naam"),
        "rechtsvorm": raw.get("rechtsvorm"),
        "adres": _lrza_address(raw.get("adres")),
        "ingeschreven": registered,
        "uitgeschreven": _lrza_date(raw.get("datumUitschrijving")),
        "sbi": raw.get("sbicodes") or [],
        "agb": _agb(raw.get("agbregistraties")),
        "wtza_melding": _notification(raw.get("melding")),
        "toelatingsvergunning": _permit(raw.get("toelatingsvergunning"), registered),
        "vestigingen": [{
            "naam": v.get("naam"),
            "handelsnamen": v.get("handelsnamen") or [],
            "vestigingsnummer": v.get("vestigingsnummer"),
            "hoofdvestiging": bool(v.get("isHoofdvestiging")),
            "adres": _lrza_address(v.get("adres")),
            "ingeschreven": _lrza_date(v.get("datumInschrijving")),
            "uitgeschreven": _lrza_date(v.get("datumUitschrijving")),
            "sbi": v.get("sbicodes") or [],
            "agb": _agb(v.get("agbregistraties")),
        } for v in raw.get("vestigingen") or []],
        "locaties_wzd_wvggz": "onbekend: het locatieregister was niet beschikbaar"
                              if raw.get("isLocatieregisterOnbeschikbaar") else raw.get("locaties") or [],
        "verantwoordingen": [{"tekst": x.get("tekst"), "url": x.get("url")} for x in raw.get("verantwoordingen") or []],
        "source": register_url(raw["kvknummer"], raw.get("naam") or ""),
    }


def register(kvk, refresh=False, db=None):
    """An organisation's entry in the LRZa, by KvK number. Cached for a week; 'not in the register' for a day."""
    kvk = _kvk(kvk)
    db = db or connect()
    row = db.execute("SELECT fetched_at, found, raw FROM lrza WHERE kvk=?", (kvk,)).fetchone()
    if refresh or not row or _older(row["fetched_at"], LRZA_TTL if row["found"] else LRZA_MISSING_TTL):
        try:
            raw, found = _json(f"{LRZA}/api/v1/Organisatie/{kvk}"), 1
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise RuntimeError(f"LRZa answered HTTP {e.code} for {kvk}") from e
            raw, found = None, 0
        if found and raw.get("kvknummer") != kvk:
            raise RuntimeError(f"LRZa returned {raw.get('kvknummer')!r} when asked for {kvk}")
        stamp = _iso(_now())
        with db:
            db.execute("INSERT OR REPLACE INTO lrza VALUES (?,?,?,?)", (kvk, stamp, found, json.dumps(raw, ensure_ascii=False)))
        row = {"fetched_at": stamp, "found": found, "raw": json.dumps(raw)}
    base = {"found": bool(row["found"]), "fetched": row["fetched_at"], "scope": LRZA_SCOPE}
    if not row["found"]:
        return {**base, "kvk": kvk, "source": f"{LRZA}/",
                "note": "Deze KvK staat niet in het LRZa. Dat zegt niet dat de organisatie geen zorg levert."}
    return {**base, **normalise_register(json.loads(row["raw"]))}


def search_register(naam=None, postcode=None, kvk=None):
    """Live LRZa search by (part of a) name, postcode or KvK number. The register returns at most 50 hits and the
    total; `truncated` says when the list is not complete."""
    body = {k: v.strip() for k, v in (("naam", naam), ("postcode", postcode), ("kvknummer", kvk)) if v and v.strip()}
    if not body:
        raise ValueError("give a name, a postcode or a KvK number")
    if "kvknummer" in body:
        body["kvknummer"] = _kvk(body["kvknummer"])
    if "postcode" in body and not re.fullmatch(r"[1-9]\d{3}( ?[A-Za-z]{2})?", body["postcode"]):
        raise ValueError(f"a postcode looks like 2543 or 2543 SW, got {body['postcode']!r}")
    try:
        d = _json(f"{LRZA}/api/v1/Zoeken", body)
    except urllib.error.HTTPError as e:
        if e.code == 400:
            raise ValueError(f"LRZa refused the search: {e.read()[:300].decode(errors='replace')}") from e
        raise RuntimeError(f"LRZa search answered HTTP {e.code}") from e
    hits = [{"kvk": z["kvknummer"], "naam": z["naam"], "source": register_url(z["kvknummer"], z["naam"] or "")}
            for z in d.get("zorgaanbieders") or []]
    total = d.get("aantal", len(hits))
    return {"total": total, "returned": len(hits), "truncated": total > len(hits), "results": hits,
            "source": LRZA, "scope": LRZA_SCOPE}


# ---------------------------------------------------------------- CBS Iv3 (Informatie voor derden)

CBS = "https://dataderden.cbs.nl"
IV3_KINDS = {"Gemeenten": "gemeenten", "Gemeenschappelijke regelingen": "gemeenschappelijke-regelingen",
             "Provincies": "provincies", "Waterschappen": "waterschappen"}
IV3_TITLE = re.compile(r"^(.+?) (\d{4}) onbewerkte Iv3-data\s*$")
IV3_CAP = 10_000  # CBS refuses a query that would return this many rows
IV3_DIMS_V = 2  # bump when the cached dimension layout changes
IV3_UNIT = "x € 1.000"
IV3_SCOPE = ("Onbewerkte Iv3-data: what the body itself reported to CBS, not checked by CBS. Amounts are x € 1.000. "
             "Lasten (charges) and baten (income) are separate categories and are never added together. "
             "The table holds every combination of area and category; a cell without a value ('.', waarde null) "
             "had nothing entered, often because the combination does not apply: it is not 0 and not a figure. "
             "delivered=false: the whole report is empty. On a balance-sheet post (Balanspost) the lasten and baten "
             "categories are mutations (a charge raises an asset, lowers a liability) and Standen are the opening "
             "(Primo) and closing (Ultimo) positions. Water boards report no split by function to CBS: only "
             "operating totals (Expl), result appropriation (Result), extra information (Info) and the balance "
             "sheet. plaatsing: the 2nd publication includes corrections sent up to two months after the deadline; "
             "the 1st is used until the 2nd is out.")


def parse_catalog(tables):
    """CBS catalog entries -> [(id, kind, year, title, modified)] for the Iv3 tables. Two tables for one kind and
    year would make every lookup ambiguous, so that fails loudly."""
    out, seen = [], set()
    for t in tables:
        m = IV3_TITLE.match(t["Title"])
        if not m or m[1] not in IV3_KINDS:
            continue
        key = (IV3_KINDS[m[1]], int(m[2]))
        if key in seen:
            raise ValueError(f"CBS lists two Iv3 tables for {key}")
        seen.add(key)
        out.append((t["Identifier"], *key, t["Title"].strip(), t["Modified"]))
    return out


def iv3_tables(refresh=False, db=None):
    """The Iv3 tables CBS publishes, refreshed daily. A failed refresh keeps the tables we know."""
    db = db or connect()
    last = db.execute("SELECT fetched_at FROM sources_log WHERE name='iv3_catalog'").fetchone()
    if refresh or not last or _older(last[0], timedelta(days=1)):
        try:
            q = urllib.parse.urlencode({"$format": "json", "$filter": "substringof('onbewerkte Iv3',Title)",
                                        "$select": "Identifier,Title,Modified"})
            rows = parse_catalog(_json(f"{CBS}/ODataCatalog/Tables?{q}")["value"])
            if not rows:
                raise RuntimeError("the CBS catalog lists no Iv3 tables")
            with db:
                db.execute("DELETE FROM iv3_tables")
                db.executemany("INSERT INTO iv3_tables VALUES (?,?,?,?,?)", rows)
                db.execute("INSERT OR REPLACE INTO sources_log VALUES ('iv3_catalog', ?)", (_iso(_now()),))
        except (OSError, RuntimeError, ValueError) as e:
            if not db.execute("SELECT 1 FROM iv3_tables LIMIT 1").fetchone():
                raise RuntimeError(f"CBS Iv3 catalog unavailable: {e}") from e
            print(f"iv3: catalog refresh failed, using the cached list: {e}", file=sys.stderr)
    return [dict(r) for r in db.execute("SELECT * FROM iv3_tables ORDER BY kind, year")]


def _table(db, kind=None, year=None, table_id=None):
    iv3_tables(db=db)
    if table_id:
        r = db.execute("SELECT * FROM iv3_tables WHERE id=?", (table_id,)).fetchone()
        if not r:
            raise KeyError(f"{table_id} is not a CBS Iv3 table")
        return dict(r)
    if kind not in IV3_KINDS.values():
        raise ValueError(f"kind is one of: {', '.join(IV3_KINDS.values())}")
    r = db.execute("SELECT * FROM iv3_tables WHERE kind=? AND year=?", (kind, int(year))).fetchone()
    if not r:
        years = [y for y, in db.execute("SELECT year FROM iv3_tables WHERE kind=? ORDER BY year", (kind,))]
        raise KeyError(f"CBS has no Iv3 table for {kind} {year}" + (f" (available {years[0]}-{years[-1]})" if years else ""))
    return dict(r)


def _all(url):
    """Every row of an OData feed, following nextLink pages."""
    out = []
    while url:
        d = _json(url, timeout=120)
        out += d["value"]
        url = d.get("odata.nextLink")
    return out


def iv3_label(item):
    """CBS cuts titles at ~40 characters ('Inkomensoverdrachten - gemeensc..'); the description has the full name:
    'Lasten - 4.3.3 - Inkomensoverdrachten - gemeenschappelijke regelingen' -> ('Lasten', 'Inkomensoverdrachten -
    gemeenschappelijke regelingen'). 'Standen - Primo' -> ('Standen', 'Primo'). No description: the title."""
    # water boards append a note to every category: 'Lasten - 1.1 - Externe rente - \r\nNB indien een last ...'
    parts = (item.get("description") or "").split("\n")[0].strip().rstrip("-").strip().split(" - ", 2)
    if len(parts) == 3:
        return parts[0], parts[2]
    if len(parts) == 2:
        return parts[0], parts[1]
    return None, item["title"]


def _dims(db, table):
    """Each dimension of a table, keys verbatim (with their padding), cached until the table changes. The policy-area
    dimension is 'TaakveldBalanspost' for most kinds and 'FunctieKostenplaatsBalanspost' for water boards."""
    r = db.execute("SELECT modified, dims FROM iv3_dims WHERE tbl=?", (table["id"],)).fetchone()
    if r and r[0] == table["modified"] and json.loads(r[1]).get("v") == IV3_DIMS_V:
        return json.loads(r[1])
    base = f"{CBS}/ODataApi/OData/{table['id']}"
    props = _all(f"{base}/DataProperties")
    names = [p["Key"] for p in props if p["Type"] in ("Dimension", "GeoDimension")]
    area = [n for n in names if n.endswith("Balanspost")]
    geo = [n for n in names if n not in ("Categorie", "Verslagsoort", *area)]
    first = [p["Key"] for p in props if p["Type"] == "Topic" and p["Title"].strip().startswith("1")]
    second = [p["Key"] for p in props if p["Type"] == "Topic" and p["Title"].strip().startswith("2")]
    if len(area) != 1 or len(geo) != 1 or len(first) != 1 or len(second) != 1 or \
            not {"Categorie", "Verslagsoort"} <= set(names):
        raise RuntimeError(f"{table['id']}: unexpected Iv3 layout {sorted(p['Key'] for p in props)}")

    def items(name):
        return [{"key": x["Key"], "title": x["Title"].strip(), "description": (x.get("Description") or "").strip()}
                for x in _all(f"{base}/{name}")]

    dims = {"v": IV3_DIMS_V, "area_dim": area[0], "geo_dim": geo[0], "v1": first[0], "v2": second[0],
            "area": items(area[0]), "categorie": items("Categorie"), "report": items("Verslagsoort"),
            "bodies": items(geo[0])}
    with db:
        db.execute("INSERT OR REPLACE INTO iv3_dims VALUES (?,?,?)", (table["id"], table["modified"], json.dumps(dims)))
    return dims


def iv3_chunks(keys, per_key, cap=IV3_CAP):
    """startswith() prefixes over the policy-area keys such that each query selects fewer than `cap` rows. The feed is
    dense (every policy area x category), so a prefix selects (its keys) x per_key rows. Groups start at the main
    function ('6.' for social domain) or the letter of a balance post ('A', 'P'), and split on a longer prefix when
    too large."""
    keys = [k.strip() for k in keys]
    if per_key >= cap:
        raise ValueError(f"one policy area already has {per_key} rows")

    def plan(prefix, group):
        if len(group) * per_key < cap:
            return [prefix]
        subs = {}
        for k in group:
            subs.setdefault(k[:len(prefix) + 1], []).append(k)
        return [p for sub, g in subs.items() for p in plan(sub, g)]

    groups = {}
    for k in keys:
        top = k.split(".")[0] + "." if "." in k else k[0]
        groups.setdefault(top, []).append(k)
    prefixes = [p for top, g in groups.items() for p in plan(top, g)]
    # ponytail: a split down to '0.1' would also match '0.10'; real tables (78 categories) never split that far, so
    # refuse such a plan instead of handling it (the upgrade: an eq filter for the shorter key)
    for k in keys:
        if sum(k.startswith(p) for p in prefixes) != 1:
            raise ValueError(f"no clean prefix plan for policy area {k!r} at {per_key} categories")
    return prefixes


def _quote(key):
    return key.replace("'", "''")


def _fetch_rows(db, table, dims, body_key, report_key):
    """One body's report (e.g. Leiden's 2025 jaarrekening), every cell, in chunks under the CBS row cap. Each chunk
    must return exactly the cells it covers (the feed is dense), as digimv.load_year reconciles its counts."""
    feed = f"{CBS}/ODataApi/OData/{table['id']}/TypedDataSet"
    keys = [x["key"] for x in dims["area"]]
    per_key = len(dims["categorie"])
    rows = []
    for prefix in iv3_chunks(keys, per_key):
        flt = (f"{dims['geo_dim']} eq '{_quote(body_key)}' and Verslagsoort eq '{_quote(report_key)}' "
               f"and startswith({dims['area_dim']},'{_quote(prefix)}')")
        q = urllib.parse.urlencode({"$filter": flt, "$select": f"{dims['area_dim']},Categorie,{dims['v1']},{dims['v2']}"})
        got = _all(f"{feed}?{q}")
        want = sum(1 for k in keys if k.strip().startswith(prefix)) * per_key
        if len(got) != want:
            raise RuntimeError(f"{table['id']} {body_key.strip()} {prefix}: CBS returned {len(got)} cells, expected {want}")
        rows += [(r[dims["area_dim"]], r["Categorie"], r[dims["v1"]], r[dims["v2"]]) for r in got]
    if len({(t, c) for t, c, *_ in rows}) != len(rows):
        raise RuntimeError(f"{table['id']} {body_key.strip()}: duplicate cells in the CBS response")
    with db:
        db.execute("DELETE FROM iv3_rows WHERE tbl=? AND body=? AND report=?", (table["id"], body_key, report_key))
        db.executemany("INSERT INTO iv3_rows VALUES (?,?,?,?,?,?,?)",
                       [(table["id"], body_key, report_key, *r) for r in rows])
        db.execute("INSERT OR REPLACE INTO iv3_log VALUES (?,?,?,?,?)",
                   (table["id"], body_key, report_key, table["modified"], len(rows)))


def _pick(dim_items, wanted, what):
    """The verbatim key whose stripped form (or title) matches `wanted`, case-insensitive."""
    w = _fold(wanted.strip())
    for x in dim_items:
        if _fold(x["key"].strip()) == w or _fold(x["title"]) == w or _fold(body_name(x)) == w:
            return x
    options = f" (this table has: {', '.join(x['title'] for x in dim_items)})" if len(dim_items) <= 12 else ""
    raise KeyError(f"no {what} {wanted!r} in this table{options}")


def _amount(v):
    """CBS sends 16646.0 for 16646 (x € 1.000); amounts are whole thousands, so show them that way."""
    if v is None:
        return None
    return int(v) if float(v).is_integer() else v


def _cell(table, body, report, tv, cat, v1, v2):
    soort, cat_name = iv3_label(cat)
    _, tv_name = iv3_label(tv)
    value, placement = (v2, "2e plaatsing") if v2 is not None else (v1, "1e plaatsing") if v1 is not None else (None, None)
    code = body["key"].strip()
    return {
        "taakveld": tv["key"].strip(), "taakveld_naam": tv_name,
        "categorie": cat["key"].strip(), "categorie_naam": cat_name, "soort": soort,
        "waarde": _amount(value), "eenheid": IV3_UNIT, "plaatsing": placement,
        "href": "/bron/iv3/" + "/".join(urllib.parse.quote(p, safe="") for p in
                                        (table["id"], code, report["key"].strip(), tv["key"].strip(), cat["key"].strip())),
    }


def _report(db, table, dims, body, report):
    log = db.execute("SELECT modified FROM iv3_log WHERE tbl=? AND body=? AND report=?",
                     (table["id"], body["key"], report["key"])).fetchone()
    if not log or log[0] != table["modified"]:
        _fetch_rows(db, table, dims, body["key"], report["key"])
    return db.execute("SELECT taakveld, categorie, v1, v2 FROM iv3_rows WHERE tbl=? AND body=? AND report=?",
                      (table["id"], body["key"], report["key"])).fetchall()


def iv3(kind, year, code, taakveld=None, verslagsoort="Jaarrekening", include_zero=False, db=None):
    """A body's Iv3 report cells: per policy area (taakveld) and category, charges and income separately.

    `taakveld` narrows to a code prefix ("6.7", "6.712") or words in its name ("begeleiding"). Zeros are left out
    unless include_zero; cells that were not delivered are counted, never shown as 0. Totals per policy area are
    computed here (sum of its lasten, sum of its baten) and labelled as such."""
    db = db or connect()
    table = _table(db, kind, year)
    dims = _dims(db, table)
    body = _pick(dims["bodies"], code, "body")
    report = _pick(dims["report"], verslagsoort, "report type")
    tvs = {x["key"]: x for x in dims["area"]}
    cats = {x["key"]: x for x in dims["categorie"]}
    want = _fold(taakveld.strip()) if taakveld else None
    rows = _report(db, table, dims, body, report)
    cells, empty, zeros, totals = [], 0, 0, {}
    for tv, cat, v1, v2 in rows:
        if want and not (_fold(tv.strip()).startswith(want) or want in _fold(iv3_label(tvs[tv])[1])):
            continue
        c = _cell(table, body, report, tvs[tv], cats[cat], v1, v2)
        balance = tvs[tv]["description"].startswith("Balanspost")
        if c["soort"] == "Standen" and not balance:
            continue  # the feed is dense, but a position (primo/ultimo) only exists for a balance-sheet post
        if c["soort"] in ("Lasten", "Baten") and not balance:  # on a balance post they are mutations, not a total
            # None = no cell of that soort has a value: unknown, which is not 0
            t = totals.setdefault(c["taakveld"], {"taakveld": c["taakveld"], "taakveld_naam": c["taakveld_naam"],
                                                  "lasten": None, "baten": None, "lasten_empty": 0, "baten_empty": 0})
            k = c["soort"].lower()
            if c["waarde"] is None:
                t[k + "_empty"] += 1
            else:
                t[k] = (t[k] or 0) + c["waarde"]
        if c["waarde"] is None:
            empty += 1
        elif c["waarde"] == 0 and not include_zero:
            zeros += 1
        else:
            cells.append(c)
    return {
        "kind": kind, "year": int(year), "code": body["key"].strip(), "naam": body_name(body),
        "verslagsoort": report["title"], "table": table["id"], "table_modified": table["modified"],
        # every cell '.' (null) in the whole report: the body did not deliver it (small municipalities skip quarters)
        "delivered": any(v1 is not None or v2 is not None for _, _, v1, v2 in rows),
        "cells": cells, "zero_cells_left_out": zeros, "empty_cells": empty,
        "totals_computed": list(totals.values()),
        "unit": IV3_UNIT, "scope": IV3_SCOPE,
        "source": f"{CBS}/ODataApi/OData/{table['id']}",
    }


def iv3_value(table_id, code, report, taakveld, categorie, db=None):
    """One cell, for the evidence panel behind a /bron/iv3/ citation."""
    db = db or connect()
    table = _table(db, table_id=table_id)
    dims = _dims(db, table)
    body = _pick(dims["bodies"], code, "body")
    rep = _pick(dims["report"], report, "report type")
    tv = _pick(dims["area"], taakveld, "policy area")
    cat = _pick(dims["categorie"], categorie, "category")
    for t, c, v1, v2 in _report(db, table, dims, body, rep):
        if t == tv["key"] and c == cat["key"]:
            return {"kind": table["kind"], "year": table["year"], "code": code, "naam": body_name(body),
                    "verslagsoort": rep["title"], **_cell(table, body, rep, tv, cat, v1, v2),
                    "source": f"{CBS}/ODataApi/OData/{table['id']}"}
    raise KeyError("cell not in the CBS table")


def body_name(x):
    """Joint arrangements' titles are cut too ('Dienst Gezondheid & Jeugd Zuid-Holland..'), their description is the
    full name; a municipality's description is its history ('Begindatum voor 1830'), so only a cut title is replaced."""
    t, d = x["title"], x["description"]
    return d if t.endswith("..") and d.startswith(t[:-2]) else t


def find_body(q, kind=None, year=None, db=None):
    """Municipalities, joint arrangements, provinces or water boards by (part of a) name or code. Searches `year`, or
    the two newest tables of each kind (bodies come and go, and the newest year may hold only budgets); each hit
    lists the years it is in."""
    db = db or connect()
    w = _fold(q.strip())
    if len(w) < 2:
        raise ValueError("give at least 2 characters")
    iv3_tables(db=db)
    kinds = [kind] if kind else list(IV3_KINDS.values())
    found, unavailable = {}, []
    for k in kinds:
        try:
            tables = [_table(db, k, year)] if year else [dict(r) for r in db.execute(
                "SELECT * FROM iv3_tables WHERE kind=? ORDER BY year DESC LIMIT 2", (k,))]
            for table in tables:
                for x in _dims(db, table)["bodies"]:
                    name, code = body_name(x), x["key"].strip()
                    if w in _fold(name) or w == _fold(code):
                        hit = found.setdefault((k, code), {"kind": k, "code": code, "naam": name, "years": []})
                        hit["years"].append(table["year"])
        except (KeyError, RuntimeError, OSError) as e:
            if kind:
                raise
            unavailable.append(f"{k}: {e}")  # one kind failing must not hide the others
    return {"results": list(found.values()), "unavailable": unavailable}


# ---------------------------------------------------------------- Rechtspraak

RS_SEARCH = "https://uitspraken.rechtspraak.nl/api/zoek"
RS_CONTENT = "https://data.rechtspraak.nl/uitspraken/content"
ECLI = re.compile(r"ECLI:[A-Z]{2}:[A-Z0-9]{1,7}:\d{4}:[A-Z0-9.]{1,25}")
RULING_V = 1  # bump when parsing changes: cached rulings are fetched again
RULING_TTL = timedelta(days=30)  # rulings are corrected now and then
RULING_PART = 8000  # characters per part
RULINGS_SCOPE = ("Published Dutch court rulings (rechtspraak.nl, open data CC0). Not every ruling is published, "
                 "natural persons are pseudonymised, and a name in a ruling does not make that organisation a party: "
                 "read the ruling before saying what it was about.")
NS = {"dcterms": "http://purl.org/dc/terms/", "psi": "http://psi.rechtspraak.nl/",
      "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#"}


def _dmy(s):
    """'15-01-2019' -> '2019-01-15'."""
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", s or "")
    return f"{m[3]}-{m[2]}-{m[1]}" if m else s


def search_rulings(q, limit=10, exact=True):
    """Rulings that mention `q` (an exact phrase by default, e.g. an organisation's name), newest relevance first."""
    q = " ".join(q.replace('"', " ").split())
    if len(q) < 3:
        raise ValueError("give at least 3 characters")
    body = {"StartRow": 0, "PageSize": max(1, min(int(limit), 50)), "ShouldReturnHighlights": False,
            "ShouldCountFacets": False, "SortOrder": "Relevance",
            "SearchTerms": [{"Term": f'"{q}"' if exact else q, "Field": "AlleVelden"}],
            "Contentsoorten": [], "Rechtsgebieden": [], "Instanties": [], "DatumPublicatie": [], "DatumUitspraak": [],
            "Advanced": {"PublicatieStatus": "AlleenGepubliceerd"}, "CorrelationId": "jaarverantwoording-zorg",
            "Proceduresoorten": []}
    try:
        d = _json(RS_SEARCH, body)
        results, total = d["Results"], d["ResultCount"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise RuntimeError(f"the rechtspraak.nl search did not answer as expected ({type(e).__name__}: {e}). It is the "
                           "site's own search and may have changed; get_ruling still reads a ruling by ECLI.") from e
    hits = [{"ecli": r["TitelEmphasis"], "titel": r["Titel"], "type": r.get("GerechtelijkProductType"),
             "uitspraakdatum": _dmy(r.get("Uitspraakdatum")), "publicatiedatum": _dmy(r.get("Publicatiedatum")),
             "rechtsgebieden": r.get("Rechtsgebieden") or [], "procedures": r.get("Proceduresoorten") or [],
             "fragment": r.get("Tekstfragment"), "source": r.get("DeeplinkUrl")} for r in results]
    return {"query": q, "exact": exact, "total": total, "returned": len(hits), "truncated": total > len(hits),
            "results": hits, "scope": RULINGS_SCOPE}


def _local(e):
    return e.tag.rsplit("}", 1)[-1]


def _blocks(el):
    """A ruling's XML body -> paragraphs as text; headings as '## …'. A numbered paragraph keeps its number."""
    for n in el.iter():
        if _local(n) == "nr":
            n.text = (n.text or "").strip() + " "
    out = []

    def text(e):
        return " ".join("".join(e.itertext()).split())

    def walk(e):
        tag = _local(e)
        if tag in ("title", "bridgehead"):
            if s := text(e):
                out.append(f"## {s}")
        elif tag in ("para", "parablock"):
            if s := text(e):
                out.append(s)
        else:
            for c in e:
                walk(c)

    walk(el)
    return out


def parse_ruling(xml):
    """Open-data XML -> metadata, summary and paragraphs. A ruling can be listed with metadata only (no text)."""
    root = ET.fromstring(xml)
    desc = root.find("rdf:RDF/rdf:Description", NS)
    if desc is None:
        raise ValueError("no metadata in the ruling XML")

    def one(path):
        e = desc.find(path, NS)
        return e.text.strip() if e is not None and e.text else None

    body = next((c for c in root if _local(c) in ("uitspraak", "conclusie")), None)
    summary = next((c for c in root if _local(c) == "inhoudsindicatie"), None)
    return {
        "ecli": one("dcterms:identifier"), "modified": one("dcterms:modified"),
        "instantie": one("dcterms:creator"), "uitspraakdatum": one("dcterms:date"),
        "publicatiedatum": one("dcterms:issued"), "zaaknummer": one("psi:zaaknummer"),
        "type": one("dcterms:type"), "procedure": one("psi:procedure"), "zittingsplaats": one("dcterms:spatial"),
        "rechtsgebieden": [e.text.strip() for e in desc.findall("dcterms:subject", NS) if e.text],
        "inhoudsindicatie": " ".join(_blocks(summary)) if summary is not None else None,
        "paragraphs": _blocks(body) if body is not None else [],
    }


def ruling_parts(paragraphs, size=RULING_PART):
    """Paragraphs -> parts of about `size` characters, split between paragraphs only."""
    parts, cur = [], ""
    for p in paragraphs:
        if cur and len(cur) + len(p) + 2 > size:
            parts.append(cur)
            cur = ""
        cur = f"{cur}\n\n{p}" if cur else p
    return parts + [cur] if cur else parts


def get_ruling(ecli, part=1, db=None):
    """A ruling's metadata, summary and text (one part at a time), from the official open data."""
    m = ECLI.fullmatch(ecli.strip().upper())
    if not m:
        raise ValueError(f"an ECLI looks like ECLI:NL:RBAMS:2019:441, got {ecli!r}")
    ecli = m[0]
    db = db or connect()
    row = db.execute("SELECT fetched_at, v, parsed FROM rulings WHERE ecli=?", (ecli,)).fetchone()
    if not row or row["v"] != RULING_V or _older(row["fetched_at"], RULING_TTL):
        try:
            xml = digimv._http(f"{RS_CONTENT}?" + urllib.parse.urlencode({"id": ecli}))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise KeyError(f"{ecli} is not in the Rechtspraak open data") from e
            raise RuntimeError(f"Rechtspraak open data answered HTTP {e.code} for {ecli}") from e
        parsed = parse_ruling(xml)
        if parsed["ecli"] != ecli:
            raise RuntimeError(f"Rechtspraak returned {parsed['ecli']!r} when asked for {ecli}")
        with db:
            db.execute("INSERT OR REPLACE INTO rulings VALUES (?,?,?,?)",
                       (ecli, _iso(_now()), RULING_V, json.dumps(parsed, ensure_ascii=False)))
        row = {"parsed": json.dumps(parsed)}
    r = json.loads(row["parsed"])
    parts = ruling_parts(r.pop("paragraphs"))
    n = int(part)
    if parts and not 1 <= n <= len(parts):
        raise ValueError(f"part is 1-{len(parts)}")
    return {**r, "part": n if parts else 0, "parts": len(parts), "text": parts[n - 1] if parts else None,
            "text_available": bool(parts), "source": f"https://deeplink.rechtspraak.nl/uitspraak?id={ecli}",
            "scope": RULINGS_SCOPE}


# ---------------------------------------------------------------- live check + CLI

def check():
    """One live call per source with a known answer. Run by hand: it needs the network."""
    tests = {
        "lrza": lambda: register("28099814", refresh=True)["naam"] == "Stichting Basalt",
        "lrza search": lambda: any(h["kvk"] == "28099814" for h in search_register(naam="Basalt")["results"]),
        "iv3 bodies": lambda: (lambda r: not r["unavailable"] and any(b["code"] == "GM0546" for b in r["results"]))(
            find_body("Leiden")),
        "iv3 water board": lambda: iv3("waterschappen", 2025, find_body("Rijnland", "waterschappen")["results"][0]["code"],
                                       include_zero=True)["delivered"],
        "iv3 joint arr.": lambda: any(b["kind"] == "gemeenschappelijke-regelingen" and 2025 in b["years"]
                                      for b in find_body("Jeugdhulp Rijnmond")["results"]),
        "iv3 cells": lambda: (lambda r: r["naam"] == "Leiden" and r["cells"] and all(
            c["eenheid"] == IV3_UNIT for c in r["cells"]))(iv3("gemeenten", 2025, "GM0546", "6.7")),
        "rulings search": lambda: search_rulings("Stichting Basalt")["total"] >= 1,
        "ruling text": lambda: get_ruling("ECLI:NL:RBAMS:2019:441")["text_available"],
    }
    ok = True
    for name, t in tests.items():
        try:
            passed = bool(t())
            print(f"{name:<16} {'ok' if passed else 'FAILED: unexpected answer'}")
        except Exception as e:  # report every source, then fail the run
            passed = False
            print(f"{name:<16} FAILED: {type(e).__name__}: {e}")
        ok &= passed
    return ok


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("register", help="LRZa entry by KvK number").add_argument("kvk")
    s = sub.add_parser("register-search", help="search the LRZa by name or postcode")
    s.add_argument("--naam")
    s.add_argument("--postcode")
    s = sub.add_parser("bodies", help="find a municipality, joint arrangement, province or water board")
    s.add_argument("q")
    s.add_argument("--kind", choices=list(IV3_KINDS.values()))
    s = sub.add_parser("iv3", help="a body's Iv3 cells")
    s.add_argument("kind", choices=list(IV3_KINDS.values()))
    s.add_argument("year", type=int)
    s.add_argument("code")
    s.add_argument("taakveld", nargs="?")
    s.add_argument("--verslagsoort", default="Jaarrekening")
    sub.add_parser("rulings", help="rulings mentioning a phrase").add_argument("q")
    s = sub.add_parser("ruling", help="read a ruling")
    s.add_argument("ecli")
    s.add_argument("--part", type=int, default=1)
    sub.add_parser("check", help="one live call per source")
    a = ap.parse_args(argv)
    if a.cmd == "check":
        return 0 if check() else 1
    out = {
        "register": lambda: register(a.kvk),
        "register-search": lambda: search_register(naam=a.naam, postcode=a.postcode),
        "bodies": lambda: find_body(a.q, a.kind),
        "iv3": lambda: iv3(a.kind, a.year, a.code, a.taakveld, a.verslagsoort),
        "rulings": lambda: search_rulings(a.q),
        "ruling": lambda: get_ruling(a.ecli, a.part),
    }[a.cmd]()
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
