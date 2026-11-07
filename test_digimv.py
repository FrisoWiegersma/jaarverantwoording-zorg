"""Offline check of flattening, keys and search. Run: python test_digimv.py"""

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

    print("ok")


if __name__ == "__main__":
    run()
