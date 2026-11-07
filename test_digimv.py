"""Offline check of flattening, keys, search and the knowledge-base index. Run: python test_digimv.py"""

import json

import digimv


def doc(i, name, type_="Jaarrekening", size=1000):
    return {"name": name, "type": type_, "id": i, "fileName": f"{name} {type_}.pdf", "fileSize": size,
            "publishedDate": "2025-06-01T10:00:00Z", "description": None, "locationSummary": None}


def org(oid, name, town, docs=(), locations=(), desaveu=()):
    return {"externalOrganizationId": oid, "name": name, "town": town, "concernId": f"C-{oid}",
            "documents": list(docs), "locations": list(locations), "desaveuElements": list(desaveu)}


Y2023 = [
    org("82905347", "Zorggroep Exact B.V.", "Arnhem", [doc(1, "Zorggroep Exact B.V.")]),
    org("11111111", "Stichting Thuiszorg Één", "Zwolle", [],
        locations=[{"externalOrganizationId": "11111111", "name": "Stichting Thuiszorg Één", "town": "Zwolle",
                    "documents": [doc(2, "Stichting Thuiszorg Één")]},  # location reusing the parent's KvK
                   {"externalOrganizationId": "22222222", "name": "Thuiszorg Één Noord", "town": "Assen",
                    "documents": [doc(3, "Thuiszorg Één Noord", "Overig")]}],
        desaveu=[{"title": "Désaveuverklaring, gedeponeerd op 30 mei 2025", "order": 0,
                  "documents": [doc(4, "Notulen AvA", "Désaveu (zelf): bestuursverslag")]}]),
    org("GeenKvK012", "Praktijk Zonder Stukken", "Utrecht"),  # listed, no documents, non-KvK id
]
Y2024 = [org("11111111", "Stichting Thuiszorg Één", "Zwolle", [doc(1, "Stichting Thuiszorg Één")])]  # id 1 again


def run():
    db = digimv.connect(":memory:")
    assert digimv.load_year(db, 2023, Y2023) == (5, 5, 4, 4)  # 3 orgs + 2 locations, 4 docs incl. désaveu
    assert digimv.load_year(db, 2024, Y2024) == (1, 1, 1, 1)

    # doc ids restart per year: (2023, 1) and (2024, 1) are different documents of different orgs
    assert digimv.get_doc(2023, 1, db)["org_id"] == "82905347"
    assert digimv.get_doc(2024, 1, db)["org_id"] == "11111111"
    assert digimv.get_doc(2023, 4, db)["desaveu"].startswith("Désaveuverklaring")
    assert digimv.get_doc(2023, 1, db)["url"].endswith("documentId=1&year=2023")

    # substring tokens over name + town, across years; mid-word for Dutch compounds
    assert [o["org_id"] for o in digimv.search("zorgg arnh", db=db)] == ["82905347"]
    assert "11111111" in [o["org_id"] for o in digimv.search("huiszorg", db=db)]
    # exact org id, also for non-KvK ids
    assert digimv.search("82905347", db=db)[0]["name"] == "Zorggroep Exact B.V."
    assert digimv.search("GeenKvK012", db=db)[0]["documents"] == []
    # diacritics folded both ways; FTS syntax in user input is harmless
    assert "11111111" in [o["org_id"] for o in digimv.search('een "thuisz', db=db)]
    # self-location docs + désaveu merge into one org; the other location is its own org with a parent
    b = next(o for o in digimv.search("thuiszorg", db=db) if o["org_id"] == "11111111")
    assert {(d["year"], d["id"]) for d in b["documents"]} == {(2023, 2), (2023, 4), (2024, 1)}
    assert b["years"] == [2023, 2024] and b["parents"] == []  # own self-location is not a parent
    noord = next(o for o in digimv.search("noord", db=db))
    assert (noord["org_id"], noord["parents"]) == ("22222222", ["11111111"])
    # filters
    assert [d["id"] for d in digimv.search("thuiszorg", doc_type="désaveu", db=db)[0]["documents"]] == [4]
    assert [d["id"] for d in digimv.search("thuiszorg", year=2024, db=db)[0]["documents"]] == [1]
    assert digimv.search("   ", db=db) == []

    # an empty API response never wipes a year we hold
    try:
        digimv.load_year(db, 2024, [])
        raise AssertionError("empty response wiped 2024")
    except ValueError:
        pass
    assert digimv.search("thuiszorg", year=2024, db=db)
    # re-sync replaces the year instead of duplicating it
    assert digimv.load_year(db, 2023, Y2023) == (5, 5, 4, 4)

    # knowledge base: markdown build + full-text index with org/year filters
    d = digimv.get_doc(2023, 1, db)
    pages = ["# Jaarrekening 2023", "## Balans\n| Eigen vermogen | 1.234 |"]
    md = digimv.build_md(d, pages)
    assert md.startswith("---\norg: \"Zorggroep Exact B.V.\"\n") and "<!-- page 2 -->\n## Balans" in md
    digimv.index_pages(db, d, pages)
    digimv.index_pages(db, d, pages)  # re-index must not duplicate
    hits = digimv.search_text("eigen vermogen", db=db)
    assert [(h["year"], h["doc_id"], h["page"]) for h in hits] == [(2023, 1, 2)], hits
    assert "«Eigen»" in hits[0]["snippet"]
    assert digimv.search_text("balans", org_id="82905347", year=2023, db=db)
    assert not digimv.search_text("balans", org_id="11111111", db=db)
    assert digimv.parse_pages("1-3,2,9", 5) == [1, 2, 3] and digimv.parse_pages("all", 2) == [1, 2]
    assert digimv.parse_pages("", 3) == [1, 2, 3] and digimv.parse_pages("4", 3) == []

    # scan detection + local extraction keeps page order (text page, blank page, image-only scan page)
    import tempfile
    from pathlib import Path
    import pymupdf
    pdf = pymupdf.open()
    pdf.new_page().insert_text((72, 72), "Balans per 31 december 2023, eigen vermogen 108.256")
    pdf.new_page()
    img = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    scan = pdf.new_page()
    scan.insert_image(scan.rect, pixmap=img)
    # Basalt-style: full-page scan + invisible scanner OCR layer + short visible auditor stamp
    stamped = pdf.new_page()
    stamped.insert_image(stamped.rect, pixmap=img)
    stamped.insert_textbox(stamped.rect, "Som der bedrijfsopbrengsten 123.456 " * 40, render_mode=3)
    stamped.insert_text((72, 800), "Deloitte Accountants B.V. Voor identificatiedoeleinden.")
    # designed page: background photo with real visible text stays local
    designed = pdf.new_page()
    designed.insert_image(designed.rect, pixmap=img)
    designed.insert_textbox(designed.rect + (36, 36, -36, -36), "Wij leverden in 2025 zorg aan veel patienten. " * 8)
    assert [digimv._is_scan(p) for p in pdf] == [False, False, True, True, False]
    pdf.delete_pages([2, 3, 4])  # extracting scan pages would call Gemini
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "t.pdf"
        pdf.save(path)
        pages = digimv.extract_pages(path)
        assert digimv.convert_pages(path, [2, 1])[1].count("108.256") == 1
        # evidence panel: Markdown table quote, label + figure apart, a figure not on the page, wrong page
        png, mark, found = digimv.render_page(path, 1, ["|**Eigen vermogen**|108.256|"])
        assert png[:4] == b"\x89PNG" and found == "all" and 0 <= mark[0] < mark[2] <= 1 and 0 <= mark[1] < mark[3] <= 1
        assert digimv.render_page(path, 1, ["Balans | 108.256"])[2] == "all"
        assert digimv.render_page(path, 1, ["eigen vermogen 999.999"])[2] == "partial"
        assert digimv.render_page(path, 2, ["108.256"])[1:] == (None, "none")
        try:
            digimv.render_page(path, 3, [])
            raise AssertionError("rendered page 3 of 2")
        except KeyError:
            pass
        # first open keeps plain text for search; a page gets its Markdown when read, and the index follows
        digimv.DATA, data = Path(tmp), digimv.DATA
        try:
            digimv.pdf_path(2023, 1).parent.mkdir(parents=True)
            digimv.pdf_path(2023, 1).write_bytes(path.read_bytes())
            db.execute("UPDATE docs SET file_size=? WHERE year=2023 AND id=1", (path.stat().st_size,))
            r = digimv.get_document(2023, 1, "2", db=db)
            cached = json.loads((digimv.md_dir(r) / "1.pages.json").read_text())["pages"]
            assert cached[0]["markdown"] is None and cached[1]["markdown"] == "" and r["page_count"] == 2
            assert [h["page"] for h in digimv.search_text("eigen vermogen", doc_id=1, db=db)] == [1]
            r = digimv.get_document(2023, 1, "1", db=db)
            assert "108.256" in r["pages"][0] and digimv.search_text("108", doc_id=1, db=db)
            assert json.loads((digimv.md_dir(r) / "1.pages.json").read_text())["pages"][0]["markdown"] == r["pages"][0]
        finally:
            digimv.DATA = data
    assert [p["source"] for p in pages] == ["text", "text"] and pages[0]["markdown"] is None, pages
    assert "108.256" in pages[0]["text"] and pages[1]["text"] == ""

    # structured figures: labels show every template branch, never a guessed one; HTML stripped
    r = digimv.render_label
    assert r("${isTrue(q.isRp) ? 'Som der bedrijfsopbrengsten' : 'Som der bedrijfsbaten'}") == \
        "Som der bedrijfsopbrengsten / Som der bedrijfsbaten"
    assert r("Totaal activa${isTrue(q.isGroepshoofd) ? ' - enkelvoudig' : ''}") == "Totaal activa [- enkelvoudig]"
    # nested ternary as in the real 'WMG - ...' menus; a brace inside a quoted branch doesn't end the block
    assert r("WMG - ${isTrue(a) ? (isTrue(b) ? 'Beperkte W&V' : 'W&V') : 'Staat {x}'} na") == \
        "WMG - Beperkte W&V / W&V / Staat {x} na"
    assert r("Aantal fte's <br/>in <strong>boekjaar</strong> &amp; meer") == "Aantal fte's in boekjaar & meer"

    def node(i, parent, text, var, cats=(), hidden=False, unit=None):
        return {"id": i, "parentId": parent, "text": text, "typescriptVariable": var,
                "categories": [{"id": c, "text": t} for c, t in cats],
                "reportSettings": {"archiveHidden": "1"} if hidden else None,
                "frontendSettings": {"prefix": unit} if unit else {}}

    def answer(cat, value, visible=True, rgi=None):
        return {"categoryId": cat, "value": value, "isVisible": visible, "repeatingGroupIndexes": rgi}

    arch = {"sampleCandidateModel": {"name": "Stichting Basalt", "dateFinished": "2026-05-29T12:00:00Z"},
            "nodes": [node(1, None, "Winst- en verliesrekening", "mnu"),
                      node(2, 1, "${isTrue(x) ? 'Som der bedrijfsopbrengsten' : 'Som der bedrijfsbaten'}", "grpSom"),
                      node(3, 2, "Bedrag in euro's boekjaar", "qSom_0", [(10, None)], unit="€ "),
                      node(4, 1, "Contactpersoon", "qContact", [(11, None)], hidden=True),
                      node(5, 1, "WNT topfunctionaris", "qWnt", [(12, None)])],
            "responses": [answer(10, "108179322"), answer(10, "999", visible=False, rgi=[1]),  # stale branch
                          answer(11, "J. Jansen"), answer(12, "Bestuurder A", rgi=[0]), answer(12, "Bestuurder B", rgi=[1]),
                          answer(99, "42"), answer(12, None)]}
    rows = digimv.figure_rows(arch)
    assert [(c, g, v) for c, g, _, _, _, v in rows] == [(10, "", "108179322"), (12, "0", "Bestuurder A"),
                                                       (12, "1", "Bestuurder B"), (99, "", "42")], rows
    assert rows[0][3] == "Winst- en verliesrekening › Som der bedrijfsopbrengsten / Som der bedrijfsbaten › " \
                         "Bedrag in euro's boekjaar" and rows[0][4] == "€"
    assert rows[3][3] == "(unlabelled field 99)"  # never dropped silently

    calls = []
    real_http = digimv._http
    digimv._http = lambda url, **kw: calls.append(url) or json.dumps(arch).encode()
    try:
        db.execute("INSERT INTO docs VALUES (2025, 50, '28099814', '', 'Jaarrekening', 'j.pdf', 1, "
                   "'2026-05-29T12:00:00Z', NULL, NULL, NULL)")
        f = digimv.get_figures("28099814", 2025, "bedrijfsopbr", db=db)
        assert (f["found"], f["matched"], f["figures"][0]["value"]) == (True, 1, "108179322")
        assert f["filed"] == "2026-05-29T12:00:00Z" and len(calls) == 1 and f["consolidated"] is False
        assert digimv.get_figures("28099814", 2025, "wnt", db=db)["matched"] == 2 and len(calls) == 1  # cached, labels
        db.execute("UPDATE docs SET published='2099-01-01T00:00:00Z' WHERE year=2025 AND id=50")  # re-filed
        digimv.get_figures("28099814", 2025, db=db)
        assert len(calls) == 2
        # groups also fill a consolidated set; everyone else files it as zeros
        arch["nodes"].append(node(6, 1, "Financiële gegevens - geconsolideerde jaarrekening", "qSom_0Cons", [(13, None)]))
        arch["responses"].append(answer(13, "0"))
        assert digimv.get_figures("28099814", 2025, refresh=True, db=db)["consolidated"] is False
        arch["responses"][-1]["value"] = "1286254000"
        assert digimv.get_figures("28099814", 2025, refresh=True, db=db)["consolidated"] is True
        digimv._http = lambda url, **kw: b""  # no questionnaire for this org/year
        assert digimv.get_figures("11111111", 2024, db=db)["found"] is False
        for bad in ((2019, None), (2025, "ab")):
            try:
                digimv.get_figures("28099814", bad[0], bad[1], db=db)
                raise AssertionError(f"accepted {bad}")
            except ValueError:
                pass
    finally:
        digimv._http = real_http

    # organisation page: groups show the group, older and micro forms their own names, empty staff tables nothing
    def row(var, value):
        return {"label": var, "value": value, "unit": "€", "var": var}
    filed = [row("qSomBedrijfsopbrengsten_0", "59720000"), row("qSomBedrijfsopbrengsten_0Cons", "533923000"),
             row("qResultaatNaBelastingen_0", "-205000"), row("qPersTotTotAantalFte", "0.00"),
             row("jeu09700MicroJeu09700Micro", "9342"), row("qPersTotTotGemiddeldPers", "6350.50")]
    key = {k: r["value"] for k, r in digimv.pick_key_figures(filed, True).items()}
    assert key == {"omzet": "533923000", "resultaat": "-205000", "eigen_vermogen": "9342", "personen": "6350.50"}, key
    assert digimv.pick_key_figures(filed, False)["omzet"]["value"] == "59720000"
    assert digimv.pick_key_figures([row("qSomBedrijfsopbrengsten_0", "0"), row("jeu10800Jeu10800", "504577000")],
                                   False)["omzet"]["value"] == "504577000"  # a micro filer leaves the new field at 0
    assert digimv.pick_key_figures([row("jeu10800Jeu10800", "0"), row("jeu10800MicroJeu10800Micro", "532058")],
                                   False)["omzet"]["value"] == "532058"  # 2020-2021 micro form

    # saved conversations: per Cloudflare Access user, never another's
    from fastapi.testclient import TestClient
    import api
    with tempfile.TemporaryDirectory() as tmp:
        digimv.DATA, data = Path(tmp), digimv.DATA
        try:
            c, me, other = TestClient(api.app), {"cf-access-authenticated-user-email": "a@x"}, {"cf-access-authenticated-user-email": "b@x"}
            body = {"title": "Omzet Basalt", "messages": [{"id": "m1", "role": "user", "parts": []}]}
            assert c.put("/chats/m1", json=body, headers=me).status_code == 200
            assert [x["title"] for x in c.get("/chats", headers=me).json()] == ["Omzet Basalt"]
            assert c.get("/chats", headers=other).json() == [] and c.get("/chats/m1", headers=other).status_code == 404
            assert c.get("/chats/m1", headers=me).json()["messages"] == body["messages"]
            assert c.put("/chats/m1", json={**body, "messages": []}, headers=me).status_code == 422
            assert c.delete("/chats/m1", headers=me).status_code == 204 and c.get("/chats", headers=me).json() == []
        finally:
            digimv.DATA = data
    print("ok")


if __name__ == "__main__":
    run()
