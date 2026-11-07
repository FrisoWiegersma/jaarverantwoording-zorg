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
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

BASE = "https://digimv13.desan.nl/api/ArchiveSearch"
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
CREATE TABLE IF NOT EXISTS sync_log(year INT, synced_at TEXT, orgs INT, docs INT);
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

def _doc_dict(r):
    d = dict(r)
    d["url"] = doc_url(d["year"], d["id"])
    return d


def get_doc(year, doc_id, db=None):
    """Index metadata for one document, joined with its organisation's name."""
    db = db or connect()
    r = db.execute("""SELECT d.*, o.name AS org_name FROM docs d
                      LEFT JOIN orgs o ON o.year=d.year AND o.org_id=d.org_id AND o.parent_id=d.parent_id
                      WHERE d.year=? AND d.id=?""", (year, doc_id)).fetchone()
    if not r:
        raise KeyError(f"document {year}/{doc_id} is not in the index (run: digimv.py sync)")
    return _doc_dict(r)


# ---------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync", help="download the full index for every year")
    s.add_argument("--year", type=int, action="append", help="only these years (repeatable)")
    a = ap.parse_args(argv)

    if a.cmd == "sync":
        return 0 if sync(a.year or YEARS) else 1


if __name__ == "__main__":
    sys.exit(main())
