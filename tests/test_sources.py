"""Offline check of the LRZa, CBS Iv3, Rechtspraak, GLEIF and EU sanctions parsing and caching. Run: PYTHONPATH=api uv run python tests/test_sources.py

Fixtures have the shapes the live services returned on 2026-11-12; `uv run python api/sources.py check` tests the live services.
"""

import io
import json
import urllib.error

import digimv
import sources


def basalt(**over):
    raw = {
        "kvknummer": "28099814",
        "naam": "Stichting Basalt",
        "rechtsvorm": "Stichting",
        "agbregistraties": [{"code": "06160802", "omschrijving": "Ziekenhuizen"}],
        "adres": {"isafgeschermd": False, "adresRegels": ["Vrederustlaan 180", "2543 SW 's-Gravenhage"]},
        "datumInschrijving": {"jaar": 2004, "maand": 1, "dag": 1},
        "datumUitschrijving": None,
        "sbicodes": ["Overige ziekenhuiszorg (86.10.3)"],
        "meldplicht": 0,
        "melding": {"isZorgaanbieder": True, "isJeugdhulpaanbieder": False},
        "toelatingsvergunning": 1,
        "vestigingen": [
            {
                "kvknummer": "28099814",
                "naam": "Basalt Leiderdorp",
                "handelsnamen": [],
                "vestigingsnummer": "000041820118",
                "isHoofdvestiging": False,
                "adres": {"isafgeschermd": True, "adresRegels": []},
                "sbicodes": [],
                "datumInschrijving": {"jaar": 2019, "maand": None, "dag": None},
                "agbregistraties": [{"code": "71194189", "omschrijving": "Ziekenhuizen"}],
            }
        ],
        "verantwoordingen": [{"url": "https://toezichtdocumenten.igj.nl/", "tekst": "Inspectierapportages IGJ"}],
        "isLocatieregisterOnbeschikbaar": False,
        "locaties": [],
    }
    return raw | over


def fake_http(responses):
    """digimv._http stand-in: url substring -> bytes, or an int for that HTTP error. Records the calls."""
    calls = []

    def http(url, data=None, headers=None, timeout=120):
        calls.append((url, data))
        for part, r in responses.items():
            if part in url:
                if isinstance(r, int):
                    raise urllib.error.HTTPError(url, r, "error", {}, io.BytesIO(b'{"title":"error"}'))
                return r
        raise AssertionError(f"unexpected request {url}")

    return http, calls


def lrza():
    r = sources.normalise_register(basalt())
    assert (r["naam"], r["adres"], r["ingeschreven"]) == ("Stichting Basalt", "Vrederustlaan 180, 2543 SW 's-Gravenhage", "2004-01-01")
    assert r["agb"] == ["06160802 Ziekenhuizen"] and r["toelatingsvergunning"] == "ja"
    assert r["wtza_melding"].endswith("als zorgaanbieder: ja, als jeugdhulpaanbieder: nee")
    v = r["vestigingen"][0]
    assert v["adres"] == "Adres niet openbaar" and v["ingeschreven"] == "2019"  # shielded; partial date stays partial
    assert r["source"] == "https://zoeken.zorgaanbiedersportaal.nl/zorgaanbieder/stichting-basalt/28099814"
    assert sources.register_url("1", "Zorg & Welzijn Één").endswith("/zorg-en-welzijn-een/1")
    # the portal's permit rules: 2 before 2025 is transition law, not 'no permit'; 0 is unknown, never 'no'
    assert "overgangsrecht" in sources.normalise_register(basalt(toelatingsvergunning=2))["toelatingsvergunning"]
    late = basalt(toelatingsvergunning=2, datumInschrijving={"jaar": 2025, "maand": 3, "dag": 1})
    assert sources.normalise_register(late)["toelatingsvergunning"].startswith("nee (niet alle")
    assert sources.normalise_register(basalt(toelatingsvergunning=0))["toelatingsvergunning"].startswith("onbekend")
    assert sources.normalise_register(basalt(melding=None))["wtza_melding"].startswith("niet gemeld")
    assert sources.normalise_register(basalt(isLocatieregisterOnbeschikbaar=True))["locaties_wzd_wvggz"].startswith("onbekend")

    db = sources.connect(":memory:")
    http, calls = fake_http(
        {
            "/Organisatie/28099814": json.dumps(basalt()).encode(),
            "/Organisatie/12345678": 404,
            "/Organisatie/87654321": json.dumps(basalt()).encode(),
            "/Organisatie/11111111": 500,
        }
    )
    digimv._http = http
    assert sources.register("28099814", db=db)["found"] is True
    assert sources.register("28099814", db=db)["naam"] == "Stichting Basalt" and len(calls) == 1  # cached
    missing = sources.register("12345678", db=db)
    assert missing["found"] is False and "zegt niet" in missing["note"]
    for kvk, err in (("87654321", RuntimeError), ("11111111", RuntimeError), ("1234", ValueError)):
        try:  # another org's record for this KvK, an upstream error, a malformed KvK: never a silent answer
            sources.register(kvk, db=db)
            raise AssertionError(kvk)
        except err:
            pass
    assert not db.execute("SELECT 1 FROM lrza WHERE kvk IN ('87654321','11111111')").fetchone()  # errors not cached

    http, calls = fake_http({"/Zoeken": json.dumps({"aantal": 39211, "zorgaanbieders": [{"kvknummer": "28099814", "naam": "Stichting Basalt"}]}).encode()})
    digimv._http = http
    s = sources.search_register(naam=" zorg ")
    assert (s["total"], s["returned"], s["truncated"]) == (39211, 1, True)
    assert json.loads(calls[0][1]) == {"naam": "zorg"}
    for bad in ({}, {"postcode": "0123"}, {"kvk": "abc"}):
        try:
            sources.search_register(**bad)
            raise AssertionError(bad)
        except ValueError:
            pass


# The 2025 municipal table's real layout, cut down: keys padded per dimension as CBS sends them.
AREA = [
    ("6.711 ", "6.711 Huishoudelijke hulp (WMO)", "Taakveld - 6.711 - Huishoudelijke hulp (WMO)"),
    ("6.712 ", "6.712 Begeleiding (WMO)", "Taakveld - 6.712 - Begeleiding (WMO)"),
    ("0.1   ", "0.1 Bestuur", "Taakveld - 0.1 - Bestuur"),
    ("A121  ", "A121 Gronden en terreinen", "Balanspost activa - A121 - Gronden en terreinen"),
]
CATS = [
    ("L3.4.1  ", "L3.4.1 Sociale uitkeringen in natura", "Lasten - 3.4.1 - Sociale uitkeringen in natura"),
    ("L4.3.3  ", "L4.3.3 Inkomensoverdrachten - gemeensc..", "Lasten - 4.3.3 - Inkomensoverdrachten - gemeenschappelijke regelingen"),
    ("B3.4.2  ", "B3.4.2 Eigen bijdragen en verhaal soci..", "Baten - 3.4.2 - Eigen bijdragen en verhaal sociale uitkeringen in natura"),
    ("Primo   ", "Primo", "Standen - Primo"),
]


def item(k, t, d=""):
    return {"key": k, "title": t, "description": d}


def iv3_db():
    db = sources.connect(":memory:")
    modified = "2026-09-22T02:00:00"
    dims = {
        "v": sources.IV3_DIMS_V,
        "area_dim": "TaakveldBalanspost",
        "geo_dim": "Gemeenten",
        "v1": "k_1ePlaatsing_1",
        "v2": "k_2ePlaatsing_2",
        "area": [item(*a) for a in AREA],
        "categorie": [item(*c) for c in CATS],
        "report": [item("2025X005", "Jaarrekening"), item("2025X001", "1e kwartaal")],
        "bodies": [item("GM0546   ", "Leiden", "Begindatum voor 1830")],
    }
    cells = {
        ("6.711 ", "L3.4.1  "): (11314.0, 11314.0),
        ("6.711 ", "B3.4.2  "): (1000.0, 1011.0),
        ("6.712 ", "L3.4.1  "): (16646.0, None),
        ("6.712 ", "L4.3.3  "): (None, None),
        ("A121  ", "Primo   "): (900.0, 900.0),
        ("A121  ", "L3.4.1  "): (50.0, 50.0),
    }
    cells |= {(a[0], "Primo   "): (None, None) for a in AREA if a[2].startswith("Taakveld")}  # no position on an area
    with db:
        db.execute("INSERT INTO iv3_tables VALUES ('45071NED','gemeenten',2025,'Gemeenten 2025 onbewerkte Iv3-data',?)", (modified,))
        db.execute("INSERT INTO sources_log VALUES ('iv3_catalog', ?)", (sources._iso(sources._now()),))
        db.execute("INSERT INTO iv3_dims VALUES ('45071NED', ?, ?)", (modified, json.dumps(dims)))
        rows = [(a[0], c[0], *cells.get((a[0], c[0]), (0.0, 0.0))) for a in AREA for c in CATS]
        db.executemany("INSERT INTO iv3_rows VALUES ('45071NED','GM0546   ','2025X005',?,?,?,?)", rows)
        db.execute("INSERT INTO iv3_log VALUES ('45071NED','GM0546   ','2025X005',?,?)", (modified, len(rows)))
        db.executemany(
            "INSERT INTO iv3_rows VALUES ('45071NED','GM0546   ','2025X001',?,?,NULL,NULL)", [(a[0], c[0]) for a in AREA for c in CATS]
        )  # a quarter the municipality did not deliver
        db.execute("INSERT INTO iv3_log VALUES ('45071NED','GM0546   ','2025X001',?,?)", (modified, len(rows)))
    return db


def iv3():
    def no_network(*a, **k):
        raise AssertionError("cached data must not hit the network")

    digimv._http = no_network
    db = iv3_db()
    r = sources.iv3("gemeenten", 2025, "gm0546", "6.71", db=db)  # code matched without its padding, any case
    assert (r["naam"], r["code"], r["verslagsoort"], r["delivered"]) == ("Leiden", "GM0546", "Jaarrekening", True)
    by = {(c["taakveld"], c["categorie"]): c for c in r["cells"]}
    assert set(by) == {("6.711", "L3.4.1"), ("6.711", "B3.4.2"), ("6.712", "L3.4.1")}  # zeros out, 0.1 filtered
    assert by[("6.711", "B3.4.2")]["waarde"] == 1011 and by[("6.711", "B3.4.2")]["plaatsing"] == "2e plaatsing"
    assert by[("6.712", "L3.4.1")]["plaatsing"] == "1e plaatsing"  # 2nd publication not out for this cell
    assert (
        by[("6.711", "B3.4.2")]["soort"] == "Baten" and by[("6.711", "B3.4.2")]["categorie_naam"] == "Eigen bijdragen en verhaal sociale uitkeringen in natura"
    )
    assert r["empty_cells"] == 1 and r["zero_cells_left_out"] == 2  # empty is not 0; no Primo on a policy area
    assert by[("6.712", "L3.4.1")]["href"] == "/bron/iv3/45071NED/GM0546/2025X005/6.712/L3.4.1"
    totals = {t["taakveld"]: t for t in r["totals_computed"]}
    assert (totals["6.711"]["lasten"], totals["6.711"]["baten"]) == (11314, 1011)  # never added together
    assert (totals["6.712"]["lasten"], totals["6.712"]["lasten_empty"], totals["6.712"]["baten"]) == (16646, 1, 0)
    whole = sources.iv3("gemeenten", 2025, "GM0546", db=db)
    assert {(c["taakveld"], c["soort"], c["waarde"]) for c in whole["cells"] if c["taakveld"] == "A121"} == {
        ("A121", "Standen", 900),
        ("A121", "Lasten", 50),
    }  # a balance post keeps its position and mutations ...
    assert "A121" not in {t["taakveld"] for t in whole["totals_computed"]}  # ... but they are no charges total
    assert sources.iv3_label({"title": "L1.1 Externe rente - ..", "description": "Lasten - 1.1 - Externe rente - \r\nNB indien een last is geboekt"}) == (
        "Lasten",
        "Externe rente",
    )
    assert sources.iv3("gemeenten", 2025, "GM0546", verslagsoort="1e kwartaal", db=db)["totals_computed"][0]["lasten"] is None
    assert [c["taakveld"] for c in sources.iv3("gemeenten", 2025, "Leiden", "begeleiding", db=db)["cells"]] == ["6.712"]
    assert len(sources.iv3("gemeenten", 2025, "GM0546", "6.711", include_zero=True, db=db)["cells"]) == 3
    q = sources.iv3("gemeenten", 2025, "GM0546", verslagsoort="1e kwartaal", db=db)
    assert q["delivered"] is False and q["cells"] == [] and q["empty_cells"] == 4 * 4 - 3  # Primo on areas skipped
    cell = sources.iv3_value("45071NED", "GM0546", "2025X005", "6.712", "L3.4.1", db=db)
    assert (cell["waarde"], cell["eenheid"], cell["naam"]) == (16646, "x € 1.000", "Leiden")
    for call, err in (
        (lambda: sources.iv3("gemeenten", 2024, "GM0546", db=db), KeyError),
        (lambda: sources.iv3("dorpen", 2025, "GM0546", db=db), ValueError),
        (lambda: sources.iv3("gemeenten", 2025, "GM9999", db=db), KeyError),
        (lambda: sources.iv3("gemeenten", 2025, "GM0546", verslagsoort="Begroting", db=db), KeyError),
    ):
        try:
            call()
            raise AssertionError("expected an error")
        except err as e:
            assert err is not KeyError or "Begroting" not in str(e) or "Jaarrekening" in str(e)  # lists the options

    # catalog titles; two tables for one kind and year would be ambiguous
    cat = [
        {"Identifier": "45071NED", "Title": "Gemeenten 2025 onbewerkte Iv3-data", "Modified": "m"},
        {"Identifier": "45050NED", "Title": "Gemeenten 2020 onbewerkte Iv3-data ", "Modified": "m"},
        {"Identifier": "81551NED", "Title": "BIG-geregistreerden", "Modified": "m"},
    ]
    assert [r[:3] for r in sources.parse_catalog(cat)] == [("45071NED", "gemeenten", 2025), ("45050NED", "gemeenten", 2020)]
    try:
        sources.parse_catalog(cat + [{"Identifier": "X", "Title": "Gemeenten 2025 onbewerkte Iv3-data", "Modified": "m"}])
        raise AssertionError("duplicate table accepted")
    except ValueError:
        pass

    # labels: CBS cuts titles; the description has the full name
    assert sources.iv3_label(item(*CATS[1])) == ("Lasten", "Inkomensoverdrachten - gemeenschappelijke regelingen")
    assert sources.iv3_label(item("Primo   ", "Primo", "Standen - Primo")) == ("Standen", "Primo")
    assert sources.iv3_label(item("X", "Titel")) == (None, "Titel")
    assert (
        sources.body_name(item("GR0030", "Dienst Gezondheid & Jeugd Zuid-Holland..", "Dienst Gezondheid & Jeugd Zuid-Holland Zuid"))
        == "Dienst Gezondheid & Jeugd Zuid-Holland Zuid"
    )
    assert sources.body_name(item("GM0546", "Leiden", "Begindatum voor 1830")) == "Leiden"


def chunks():
    # The real 2025 policy-area keys: 69 numbered (main functions 0-8) and 89 balance posts; 78 categories.
    counts = {"0": 14, "1": 2, "2": 5, "3": 4, "4": 3, "5": 7, "6": 26, "7": 5, "8": 3}
    keys = [f"{h}.{i}" for h, n in counts.items() for i in range(1, n + 1)]
    keys += [f"A{i:03d}" for i in range(56)] + [f"P{i:03d}" for i in range(33)]
    plan = sources.iv3_chunks(keys, 78)
    for k in keys:
        assert sum(k.startswith(p) for p in plan) == 1, k  # every key in exactly one query
    for p in plan:
        assert sum(k.startswith(p) for k in keys) * 78 < sources.IV3_CAP, p
    big = sources.iv3_chunks([f"6.{i}" for i in range(10, 40)], 900)  # forces a split on longer prefixes
    assert all(sum(k.startswith(p) for k in [f"6.{i}" for i in range(10, 40)]) * 900 < 10_000 for p in big)
    try:  # '0.1' cannot be split away from '0.10' with startswith: refuse rather than count it twice
        sources.iv3_chunks(["0.1", "0.10"], 6000)
        raise AssertionError("ambiguous plan accepted")
    except ValueError:
        pass


RULING = b"""<?xml version="1.0" encoding="utf-8"?>
<open-rechtspraak>
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcterms="http://purl.org/dc/terms/"
           xmlns:psi="http://psi.rechtspraak.nl/" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#">
    <rdf:Description>
      <dcterms:identifier>ECLI:NL:CBB:2024:41</dcterms:identifier>
      <dcterms:modified>2024-02-01T10:00:00</dcterms:modified>
      <dcterms:issued rdfs:label="Publicatiedatum">2024-01-31</dcterms:issued>
      <dcterms:creator rdfs:label="Instantie">College van Beroep voor het bedrijfsleven</dcterms:creator>
      <dcterms:date rdfs:label="Uitspraakdatum">2024-01-30</dcterms:date>
      <psi:zaaknummer rdfs:label="Zaaknr">23/931</psi:zaaknummer>
      <dcterms:type>Uitspraak</dcterms:type>
      <dcterms:subject rdfs:label="Rechtsgebied">Bestuursrecht</dcterms:subject>
      <dcterms:subject rdfs:label="Rechtsgebied">Bestuursrecht; Economisch publiekrecht</dcterms:subject>
    </rdf:Description>
    <rdf:Description><dcterms:identifier>http://deeplink.rechtspraak.nl/uitspraak?id=ECLI:NL:CBB:2024:41</dcterms:identifier></rdf:Description>
  </rdf:RDF>
  <inhoudsindicatie><para>Wet marktordening gezondheidszorg. Beroep van <emphasis>de ziekenhuizen</emphasis>.</para></inhoudsindicatie>
  <uitspraak>
    <uitspraak.info><para>in de zaak tussen Stichting Basalt en de minister</para></uitspraak.info>
    <section><title><nr>1</nr>Procesverloop</title>
      <parablock><nr>1.1</nr><para>Bij besluit van 1 maart 2023 heeft de minister   het verdeelplan vastgesteld.</para></parablock>
      <itemizedlist><listitem><para>eerste punt</para></listitem></itemizedlist>
    </section>
  </uitspraak>
</open-rechtspraak>"""


def rulings():
    r = sources.parse_ruling(RULING)
    assert (r["ecli"], r["instantie"], r["uitspraakdatum"], r["zaaknummer"]) == (
        "ECLI:NL:CBB:2024:41",
        "College van Beroep voor het bedrijfsleven",
        "2024-01-30",
        "23/931",
    )
    assert r["rechtsgebieden"] == ["Bestuursrecht", "Bestuursrecht; Economisch publiekrecht"]
    assert r["inhoudsindicatie"] == "Wet marktordening gezondheidszorg. Beroep van de ziekenhuizen."
    assert r["paragraphs"] == [
        "in de zaak tussen Stichting Basalt en de minister",
        "## 1 Procesverloop",
        "1.1 Bij besluit van 1 maart 2023 heeft de minister het verdeelplan vastgesteld.",
        "eerste punt",
    ]
    assert sources.ruling_parts(["a" * 10, "b" * 10, "c" * 10], size=25) == ["a" * 10 + "\n\n" + "b" * 10, "c" * 10]
    assert sources.ruling_parts([]) == []

    db = sources.connect(":memory:")
    http, calls = fake_http({"ECLI%3ANL%3ACBB%3A2024%3A41": RULING, "ECLI%3ANL%3ARBAMS%3A2019%3A9": 404})
    digimv._http = http
    g = sources.get_ruling(" ecli:nl:cbb:2024:41 ", db=db)
    assert g["text_available"] and g["parts"] == 1 and g["text"].startswith("in de zaak")
    assert g["source"] == "https://deeplink.rechtspraak.nl/uitspraak?id=ECLI:NL:CBB:2024:41"
    sources.get_ruling("ECLI:NL:CBB:2024:41", db=db)
    assert len(calls) == 1  # cached
    for ecli, err in (("ECLI:NL:RBAMS:2019:9", KeyError), ("garbage", ValueError)):
        try:
            sources.get_ruling(ecli, db=db)
            raise AssertionError(ecli)
        except err:
            pass
    try:
        sources.get_ruling("ECLI:NL:CBB:2024:41", part=2, db=db)
        raise AssertionError("part out of range accepted")
    except ValueError:
        pass

    http, calls = fake_http(
        {
            "/api/zoek": json.dumps(
                {
                    "ResultCount": 3,
                    "Results": [
                        {
                            "TitelEmphasis": "ECLI:NL:CBB:2024:41",
                            "Titel": "College van Beroep voor het bedrijfsleven, 30-01-2024, 23/931",
                            "Uitspraakdatum": "30-01-2024",
                            "Publicatiedatum": "31-01-2024",
                            "Rechtsgebieden": ["Bestuursrecht"],
                            "Tekstfragment": "Wet marktordening gezondheidszorg.",
                            "GerechtelijkProductType": "uitspraak",
                            "DeeplinkUrl": "https://deeplink.rechtspraak.nl/uitspraak?id=ECLI:NL:CBB:2024:41",
                        }
                    ],
                }
            ).encode()
        }
    )
    digimv._http = http
    s = sources.search_rulings('Stichting "Basalt"', limit=1)
    assert (s["total"], s["truncated"], s["results"][0]["uitspraakdatum"]) == (3, True, "2024-01-30")
    assert json.loads(calls[0][1])["SearchTerms"][0]["Term"] == '"Stichting Basalt"'  # exact phrase, quotes folded
    digimv._http, _ = fake_http({"/api/zoek": b"<html>moved</html>"})
    try:  # the site's search changed: say so, never an empty list
        sources.search_rulings("Basalt")
        raise AssertionError("broken search returned results")
    except RuntimeError as e:
        assert "get_ruling" in str(e)


ASML, CYMER, PARENT = "724500Y6DUVHQD6OXN27", "724500LOHLW87RGDPK21", "724500ETWED87NSA6T26"  # real, valid LEIs


def lei_rec(lei, name, kvk, status="ISSUED", ra=sources.KVK_RA, direct=None, ultimate=None):
    """An LEI record as GLEIF's JSON:API gives it; direct/ultimate are its parent links."""
    base = f"{sources.GLEIF}/lei-records/{lei}"
    links = lambda which, kind: (
        {"reporting-exception": f"{base}/{which}-parent-reporting-exception"}
        if kind == "exception"
        else {"lei-record": f"{base}/{which}-parent", "relationship-record": f"{base}/{which}-parent-relationship"}
        if kind == "parent"
        else {}
    )
    address = {"addressLines": ["De Run 6501"], "postalCode": "5504DR", "city": "Veldhoven", "country": "NL"}
    return {
        "type": "lei-records",
        "id": lei,
        "attributes": {
            "lei": lei,
            "registration": {
                "status": status,
                "initialRegistrationDate": "2014-02-09T23:00:00Z",
                "lastUpdateDate": "2026-02-10T06:10:40Z",
                "nextRenewalDate": "2027-02-10T11:30:37Z",
                "corroborationLevel": "FULLY_CORROBORATED",
            },
            "entity": {
                "legalName": {"name": name},
                "otherNames": [],
                "registeredAt": {"id": ra},
                "registeredAs": kvk,
                "legalAddress": address,
                "headquartersAddress": address,
                "jurisdiction": "NL",
                "legalForm": {"id": "B5PM"},
                "status": "ACTIVE",
                "creationDate": "1994-10-02T23:00:00Z",
            },
        },
        "relationships": {"direct-parent": {"links": links("direct", direct)}, "ultimate-parent": {"links": links("ultimate", ultimate)}},
    }


def gleif():
    for bad in ["724500Y6DUVHQD6OXN28", "724500Y6DUVHQD6OXN2", "17085815"]:  # wrong check digits, too short, a KvK
        try:
            sources._lei(bad)
            raise AssertionError(bad)
        except ValueError:
            pass
    assert sources._lei(" 724500y6duvhqd6oxn27 ") == ASML
    try:  # a link in a response may only lead back to GLEIF
        sources._gleif("https://evil.example/api/v1/lei-records")
        raise AssertionError("followed a link off GLEIF")
    except ValueError:
        pass

    page = lambda *recs, total=None: json.dumps({"data": list(recs), "meta": {"pagination": {"total": total or len(recs)}}}).encode()
    one = lambda rec: json.dumps({"data": rec}).encode()
    main = lei_rec(ASML, "ASML Holding N.V.", "17085815", direct="exception", ultimate="parent")
    db = sources.connect(":memory:")
    http, calls = fake_http(
        {
            "registeredAs%5D=17085815": page(
                lei_rec(CYMER, "Old record", "17085815", status="LAPSED"), main, lei_rec(PARENT, "Registered elsewhere", "17085815", ra="RA000999")
            ),
            "registeredAs%5D=28099814": page(),
            f"{ASML}/direct-children": page(lei_rec(CYMER, "Cymer B.V.", "33302949"), total=11),
            f"{ASML}/direct-parent-reporting-exception": one({"attributes": {"reason": "NO_KNOWN_PERSON"}}),
            f"{ASML}/ultimate-parent-relationship": one(
                {
                    "attributes": {
                        "relationship": {
                            "type": "IS_ULTIMATELY_CONSOLIDATED_BY",
                            "status": "ACTIVE",
                            "periods": [{"startDate": "2013-05-29T22:00:00Z", "type": "RELATIONSHIP_PERIOD"}],
                        }
                    }
                }
            ),
            f"{ASML}/ultimate-parent": one(lei_rec(PARENT, "Parent B.V.", "62375644")),
        }
    )
    digimv._http = http
    r = sources.lei_record(kvk="17085815", db=db)
    e = r["entity"]
    assert (e["lei"], e["kvk"], e["registration_status"], e["legal_form_code"]) == (ASML, "17085815", "ISSUED", "B5PM"), e
    assert e["legal_address"] == "De Run 6501, 5504DR Veldhoven, NL" and e["last_update"] == "2026-02-10"
    assert [o["name"] for o in r["other_records"]] == ["Old record"]  # lapsed: named, not chosen; RA000999 dropped
    assert r["direct_parent"] == {"entity": None, "exception": "NO_KNOWN_PERSON", "meaning": sources.PARENT_EXCEPTIONS["NO_KNOWN_PERSON"]}
    u = r["ultimate_parent"]
    assert (u["entity"]["lei"], u["entity"]["kvk"], u["relationship_status"]) == (PARENT, "62375644", "ACTIVE")
    assert u["periods"] == [{"startDate": "2013-05-29", "type": "RELATIONSHIP_PERIOD"}]
    assert (r["direct_children"]["total"], r["direct_children"]["truncated"]) == (11, True)
    n = len(calls)
    assert sources.lei_record(kvk="17085815", db=db)["entity"]["lei"] == ASML and len(calls) == n  # cached
    assert sources.lei_record(kvk="28099814", db=db)["found"] is False
    try:
        sources.lei_record(kvk="17085815", lei=ASML, db=db)
        raise AssertionError("both keys accepted")
    except ValueError:
        pass


SANCTIONS_CSV = (
    "﻿"
    + "\r\n".join(
        ";".join(r)
        for r in [
            [
                "fileGenerationDate",
                "Entity_LogicalId",
                "Entity_EU_ReferenceNumber",
                "Entity_UnitedNationId",
                "Entity_DesignationDate",
                "Entity_Remark",
                "Entity_SubjectType_ClassificationCode",
                "Entity_Regulation_NumberTitle",
                "Entity_Regulation_Programme",
                "Entity_Regulation_PublicationUrl",
                "NameAlias_WholeName",
                "NameAlias_Function",
                "Address_CountryDescription",
                "BirthDate_BirthDate",
                "Identification_Number",
                "Identification_TypeCode",
                "Citizenship_CountryDescription",
            ],
            [
                "23/10/2026",
                "2220",
                "EU.1338.4",
                "",
                "2006-07-06",
                "(Date of UN designation: 2006-07-06)",
                "enterprise",
                "2023/329 (OJ L43I)",
                "TAQA",
                "https://eur-lex.europa.eu/x",
                "Al-Haramain (The Netherlands branch)",
                "",
                "NETHERLANDS",
                "",
                "",
                "",
                "",
            ],
            [
                "23/10/2026",
                "2220",
                "EU.1338.4",
                "",
                "2006-07-06",
                "(Date of UN designation: 2006-07-06)",
                "enterprise",
                "2023/329 (OJ L43I)",
                "TAQA",
                "https://eur-lex.europa.eu/x",
                "Al-Haramain (Nederlandse tak)",
                "",
                "NETHERLANDS",
                "",
                "",
                "",
                "",
            ],
            [
                "23/10/2026",
                "2220",
                "EU.1338.4",
                "",
                "2006-07-06",
                "(Date of UN designation: 2006-07-06)",
                "enterprise",
                "2023/329 (OJ L43I)",
                "TAQA",
                "https://eur-lex.europa.eu/x",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ],
            [
                "23/10/2026",
                "9001",
                "EU.9.1",
                "",
                "2022-03-15",
                "",
                "person",
                "2022/336",
                "UKR",
                "",
                "Jürgen Müller",
                "Director",
                "",
                "1960-01-02",
                "AB123",
                "passport",
                "Russian Federation",
            ],
        ]
    )
    + "\r\n"
)


def sanctions():
    lt, ents = sources.parse_sanctions(SANCTIONS_CSV)
    assert lt == "2026-10-23" and len(ents) == 2
    assert ents["2220"]["names"] == ["Al-Haramain (The Netherlands branch)", "Al-Haramain (Nederlandse tak)"]  # no empties
    assert ents["2220"]["address_countries"] == ["NETHERLANDS"] and ents["9001"]["identifications"] == ["passport AB123"]

    db = sources.connect(":memory:")
    http, calls = fake_http({"csvFullSanctionsList": SANCTIONS_CSV.encode()})
    digimv._http = http
    r = sources.search_sanctions("al haramain", db=db)
    assert (r["total"], r["list_date"], r["entities_on_list"]) == (1, "2026-10-23", 2), r
    assert r["results"][0]["matched_names"] == ["Al-Haramain (The Netherlands branch)", "Al-Haramain (Nederlandse tak)"]
    assert sources.search_sanctions("haram", db=db)["total"] == 0  # whole words only
    assert sources.search_sanctions("MULLER jurgen", db=db)["results"][0]["birth_dates"] == ["1960-01-02"]  # accents, order
    assert sources.search_sanctions("muller", kind="enterprise", db=db)["total"] == 0
    assert len(calls) == 1, "the list is downloaded once a day"
    for bad in ["", "al", "?!"]:
        try:
            sources.search_sanctions(bad, db=db)
            raise AssertionError(bad)
        except ValueError:
            pass

    # A day later the download is cut short: the last good list stays, with a warning.
    db.execute("UPDATE sanctions_meta SET fetched_at='2000-01-01T00:00:00+00:00'")
    digimv._http, _ = fake_http({"csvFullSanctionsList": SANCTIONS_CSV.split("\r\n", 4)[0].encode() + b"\r\n" + SANCTIONS_CSV.split("\r\n")[4].encode()})
    r = sources.search_sanctions("haramain", db=db)
    assert r["total"] == 1 and "Could not refresh" in r["warning"], r
    digimv._http, _ = fake_http({"csvFullSanctionsList": 503})
    try:  # no list at all: an error, never "no match"
        sources.search_sanctions("haramain", db=sources.connect(":memory:"))
        raise AssertionError("searched without a list")
    except RuntimeError:
        pass


def kvk():
    db = sources.connect(":memory:")
    sources.KVK_SPACING = 0
    digimv._http, calls = fake_http(
        {
            "/95255524": json.dumps(
                {
                    "datumAanvang": "20241015",
                    "actief": "J",
                    "rechtsvormCode": "BV",
                    "postcodeRegio": 38,
                    "activiteiten": [{"sbiCode": "70102", "soortActiviteit": "Hoofdactiviteit"}],
                    "lidstaat": "NL",
                }
            ).encode(),
            "/59581883": json.dumps({"datumAanvang": "00000000", "actief": "N", "rechtsvormCode": "NV", "insolventieCode": "FAIL"}).encode(),
            "/41150213": 404,
            "/12345678": 429,
        }
    )
    r = sources.kvk_basics("95255524", db=db)
    assert (r["found"], r["actief"], r["rechtsvormCode"], r["datumAanvang"], r["activiteiten"][0]["sbiCode"]) == (True, "J", "BV", "2024-10-15", "70102"), r
    assert r["kvk_search"].endswith("q=95255524") and "naam" not in r
    assert sources.kvk_basics("95255524", db=db)["found"] and len(calls) == 1  # cached
    r = sources.kvk_basics("59581883", db=db)
    assert (r["datumAanvang"], r["insolventie"]) == (None, "faillissement"), r  # zeros are an unknown date
    r = sources.kvk_basics("41150213", db=db)
    assert r["found"] is False and "alleen BV's en NV's" in r["note"], r  # not "does not exist"
    n = len(calls)
    try:  # rate-limited twice: an error, never "not found"
        sources.kvk_basics("12345678", db=db)
        raise AssertionError("429 read as an answer")
    except RuntimeError:
        pass
    assert len(calls) == n + 2, calls  # retried once
    assert db.execute("SELECT count(*) FROM kvk_open WHERE kvk='12345678'").fetchone()[0] == 0


def run():
    real = digimv._http
    try:
        kvk()
        lrza()
        iv3()
        chunks()
        rulings()
        gleif()
        sanctions()
    finally:
        digimv._http = real
    print("sources ok")


if __name__ == "__main__":
    run()
