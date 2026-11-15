"""Render sample decks through the real create path to judge templates by eye.

Run inside the api container (Presenton must be up):
  sudo docker compose cp scripts/render_samples.py api:/tmp/render_samples.py
  sudo docker compose exec -w /app/api api /app/.venv/bin/python /tmp/render_samples.py [template,...] [sample,...]
Copy /tmp/samples out and look at the PDFs. The figures below are FICTITIOUS test data, not real
annual-report figures; the test decks are deleted again afterwards.
"""

import json
import os
import shutil
import sys
import time

sys.path.insert(0, "/app/api")
import presentations as p

OWNER = "sample-render"
SAMPLES = {
    "zorginstelling": (
        "Zorginstelling groeit met 10% omzet (fictief)",
        """Fictieve zorginstelling (revalidatiezorg), testcijfers 2025.
- Totale bedrijfsopbrengsten 2025: € 108,2 mln (2024: € 98,3 mln), +10,0%. Bron: /bron/test/opbrengsten
- Baten zorgverlening: € 108,0 mln. Zvw revalidatiezorg € 99,96 mln; overige zorgbaten € 5,92 mln; Wlz/VWS € 1,54 mln; beschikbaarheidbijdrage € 0,55 mln. Bron: /bron/test/baten
- Personeelskosten: € 74,1 mln (2024: € 68,9 mln). Bron: /bron/test/personeel
- Personeel: 1.012 fte (2024: 968 fte). Bron: /bron/test/fte
- Nettoresultaat: € 6,8 mln (2024: € 4,4 mln). Bron: /bron/test/resultaat
- Solvabiliteit: 37,6% (2024: 34,1%); current ratio 2,07. Bron: /bron/test/ratios""",
    ),
    "gemeente": (
        "Wmo-begeleiding kost meer dan begroot (fictief)",
        """Fictieve gemeente, Wmo-begeleiding taakveld 6.712, testcijfers 2025.
- Gerealiseerde lasten 2025: € 17,05 mln; begroting 2025: € 11,83 mln; overschrijding € 5,22 mln. Bron: /bron/test/lasten
- Lasten per jaar: 2021 € 11,2 mln; 2022 € 12,6 mln; 2023 € 14,1 mln; 2024 € 15,4 mln; 2025 € 17,05 mln. Bron: /bron/test/reeks
- Opbouw 2025: sociale uitkeringen in natura € 16,65 mln; inkomensoverdrachten € 0,34 mln; overige goederen en diensten € 0,07 mln. Bron: /bron/test/opbouw
- PGB Wmo 2025: € 1,84 mln (begroot € 2,15 mln). Bron: /bron/test/pgb
- Aantal cliënten met begeleiding: 2.410 (2024: 2.180). Bron: /bron/test/clienten""",
    ),
    "ziekenhuis": (
        "Ziekenhuis: opbrengsten stijgen, marge blijft dun (fictief)",
        """Fictief academisch ziekenhuis, testcijfers 2021-2025.
- Bedrijfsopbrengsten: 2021 € 1.102 mln; 2022 € 1.148 mln; 2023 € 1.215 mln; 2024 € 1.291 mln; 2025 € 1.356 mln. Bron: /bron/test/opbrengsten
- Opbouw 2025: zorgverzekeringswet € 842 mln; rijksbijdrage onderwijs en onderzoek € 318 mln; subsidies € 121 mln; overige opbrengsten € 75 mln. Bron: /bron/test/opbouw
- Resultaat: 2024 € 9,8 mln; 2025 € 7,1 mln; resultaatmarge 2025 0,5%. Bron: /bron/test/resultaat
- Personeelskosten 2025: € 812 mln (2024: € 764 mln); 7.940 fte. Bron: /bron/test/personeel""",
    ),
}


def render(name, template, n_slides=7):
    title, content = SAMPLES[name]
    result = p.call("create_presentation", {"title": title, "content": content, "n_slides": n_slides, "template": template}, OWNER)
    pid = result["presentation_id"]
    for _ in range(90):
        time.sleep(8)
        status = p.call("get_presentation_async_job", {"presentation_id": pid}, OWNER)
        if status.get("status") != "pending":
            break
    row = p.owned(pid, OWNER)
    pdf = json.loads(row["assets"]).get("pdf")
    if pdf:
        shutil.copy(p.directory(pid) / pdf, f"/tmp/samples/{name}-{template}.pdf")
    issues = status.get("quality_issues")
    print(name, template, status.get("status"), json.dumps(issues, ensure_ascii=False), flush=True)
    return pid


def cleanup():
    with p.database() as db:
        ids = [r[0] for r in db.execute("SELECT id FROM presentations WHERE owner=?", (OWNER,))]
        for i in ids:
            for table in ("presentation_versions", "presentation_operations"):
                db.execute(f"DELETE FROM {table} WHERE presentation_id=?", (i,))
            db.execute("DELETE FROM presentations WHERE id=?", (i,))
    for i in ids:
        shutil.rmtree(p.directory(i), ignore_errors=True)


if __name__ == "__main__":
    templates = sys.argv[1].split(",") if len(sys.argv) > 1 else list(p.OWN_TEMPLATES)
    shutil.rmtree("/tmp/samples", ignore_errors=True)
    os.makedirs("/tmp/samples")
    try:
        # One at a time: Presenton fails requests when several decks generate at once.
        for name in sys.argv[2].split(",") if len(sys.argv) > 2 else SAMPLES:
            for template in templates:
                render(name, template)
    finally:
        cleanup()
