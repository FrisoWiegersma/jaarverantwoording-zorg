"""Generate the jaarverslag Presenton templates (light and dark) from one layout definition.

Run: uv run python presenton/build_templates.py
Writes presenton/templates/jaarverslag-{licht,donker}/template.json. Edit this file, not the JSON.

Slides are 1280x720. Content sits between x=80 and x=1200; y>=630 is kept free for the source
footer that api/presentations.py adds. Text boxes are sized so max_length fits at the designed size.
"""

import json
from pathlib import Path

W, H, M = 1280, 720, 80
CW = W - 2 * M
FONT = "Inter"
FONT_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"

THEMES = {
    "jaarverslag-licht": {
        "name": "Jaarverslag licht",
        "description": "Rustig redactioneel ontwerp op wit: grote kerncijfers, één accentkleur en veel witruimte. Voor rapportages, bestuur en print.",
        "bg": "#FFFFFF",
        "panel": "#F3F7F8",
        "ink": "#142B3C",
        "body": "#3A5266",
        "muted": "#5F7383",
        "line": "#D8E5E9",
        "accent": "#087F8C",
        "accent_soft": "#E3F1F2",
        "on_accent": "#FFFFFF",
        "context": "#AFC6CF",
        "glow_opacity": 1.0,
    },
    "jaarverslag-donker": {
        "name": "Jaarverslag donker",
        "description": "Donker schermontwerp met heldere accentcijfers en zachte gloed. Voor presentaties op een scherm of pitch.",
        "bg": "#0E1217",
        "panel": "#161D25",
        "ink": "#F3F6F9",
        "body": "#C3CDD7",
        "muted": "#8E9CAB",
        "line": "#26313C",
        "accent": "#2EC4B6",
        "accent_soft": "#12302F",
        "on_accent": "#0E1217",
        "context": "#3A4A5A",
        "glow_opacity": 0.55,
    },
}


def font(t, size, color, bold=False, lh=1.2, ls=0.0):
    return {"size": size, "family": FONT, "color": t[color], "bold": bold, "italic": False, "line_height": lh, "letter_spacing": ls}


def text(t, name, x, y, w, h, size, color, sample, max_len, min_len=1, bold=False, lh=1.2, ls=0.0, align="left", valign="top"):
    f = font(t, size, color, bold, lh, ls)
    return {
        "type": "text",
        "position": {"x": x, "y": y},
        "size": {"width": w, "height": h},
        "font": f,
        "alignment": {"horizontal": align, "vertical": valign},
        "runs": [{"text": sample, "font": dict(f)}],
        "decorative": False,
        "name": name,
        "max_length": max_len,
        "min_length": min_len,
    }


def rect(x, y, w, h, color, radius=0.0, stroke=None, opacity=None, name=None):
    v = {
        "type": "vector",
        "shape": "polygon",
        "points": [{"x": x, "y": y}, {"x": x + w, "y": y}, {"x": x + w, "y": y + h}, {"x": x, "y": y + h}],
        "closed": True,
        "fill": {"color": color, **({"opacity": opacity} if opacity is not None else {})},
    }
    if radius:
        v["corner_radii"] = [radius] * 4
    if stroke:
        v["stroke"] = {"color": stroke, "width": 1}
    if name:
        v["name"] = name
    return v


def ellipse(cx, cy, r, color, opacity):
    return {
        "type": "vector",
        "shape": "ellipse",
        "points": [{"x": cx, "y": cy - r}, {"x": cx + r, "y": cy}, {"x": cx, "y": cy + r}, {"x": cx - r, "y": cy}],
        "closed": True,
        "fill": {"color": color, "opacity": opacity},
        "name": "decorative_glow",
    }


def comp(cid, description, elements, x=0, y=0):
    return {"id": cid, "description": description, "position": {"x": x, "y": y}, "elements": elements}


def background(t, glow=False):
    els = [rect(0, 0, W, H, t["bg"], name="slide_background")]
    if glow:
        els.append(ellipse(1180, 40, 300, t["accent_soft"], t["glow_opacity"]))
    return comp("background", "Vaste effen achtergrond van de slide.", els)


def heading(t, title_sample, kicker_sample="Basalt · jaarverslag 2025", title_max=64):
    return comp(
        "heading",
        "Kleine bovenregel (organisatie · onderwerp) en een slidetitel die de conclusie geeft.",
        [
            text(t, "kicker", M, 52, CW, 24, 16, "accent", kicker_sample, 40, 3, bold=True, ls=1.2),
            text(t, "title", M, 84, CW, 112, 44, "ink", title_sample, title_max, 12, bold=True, lh=1.12, ls=-0.6),
        ],
    )


def chart(t, name, x, y, w, h, chart_type, categories, values, series_name="Waarde"):
    return {
        "type": "chart",
        "position": {"x": x, "y": y},
        "size": {"width": w, "height": h},
        "chart_type": chart_type,
        "colors": [t["context"], t["accent"]] if chart_type in ("bar", "horizontal_bar") else [t["accent"]],
        "text_color": t["muted"],
        # Bars show their value as a label, so only the category axis is drawn; lines keep a value axis.
        "x_axis": chart_type != "horizontal_bar",
        "y_axis": chart_type in ("horizontal_bar", "line", "area"),
        "axis_color": t["muted"],
        "categories": categories,
        "series": [{"name": series_name, "values": values}],
        "data_labels": "outside" if chart_type in ("bar", "horizontal_bar") else "top",
        "legend": False,
        "x_axis_grid": False,
        "y_axis_grid": chart_type in ("line", "area"),
        "grid_color": t["line"],
        "decorative": False,
        "name": name,
    }


def cell(t, sample, fill, color, bold=False, align="left", rule="line", rule_width=1):
    none = {"color": t[fill], "width": 0}
    return {
        "color": {"color": t[fill], "opacity": 1},
        "font": font(t, 20, color, bold),
        "alignment": align,
        # Only a thin rule under each row; no cell grid.
        "borders": {"top": none, "left": none, "right": none, "bottom": {"color": t[rule], "width": rule_width}},
        "runs": [{"text": sample}],
    }


def layouts(t):
    out = []

    out.append({
        "id": "cover",
        "description": "Openingsslide: grote titel met de kernboodschap van het hele deck, organisatie en jaar, één ondertitelzin. Alleen als eerste slide.",
        "components": [
            background(t, glow=True),
            comp("cover_text", "Titelblok links met accentstreep, titel en ondertitel.", [
                rect(M, 236, 72, 6, t["accent"], radius=3, name="accent_rule"),
                text(t, "kicker", M, 196, 900, 28, 18, "accent", "Stichting Basalt · jaarverslag 2025", 48, 3, bold=True, ls=1.2),
                text(t, "title", M, 266, 1040, 220, 68, "ink", "Omzet groeit met 10% naar € 108,2 mln", 52, 10, bold=True, lh=1.06, ls=-1.6),
                text(t, "subtitle", M, 500, 860, 70, 24, "body", "Kerncijfers over baten, personeel, resultaat en vermogen in 2025.", 110, 0, lh=1.35),
            ]),
        ],
    })

    out.append({
        "id": "statement",
        "description": "Eén krachtige conclusie of sectie-overgang in grote tekst, met één korte toelichting. Geen cijferreeks.",
        "components": [
            background(t, glow=True),
            comp("statement_text", "Grote conclusiezin met korte toelichting eronder.", [
                text(t, "kicker", M, 168, CW, 24, 16, "accent", "Conclusie", 40, 3, bold=True, ls=1.2),
                text(t, "statement", M, 206, 1040, 240, 52, "ink", "De groei komt vrijwel volledig uit Zvw-revalidatiezorg.", 96, 20, bold=True, lh=1.12, ls=-1.0),
                text(t, "supporting", M, 476, 820, 100, 24, "body", "Overige zorgbaten en subsidies zijn samen minder dan 8% van de baten.", 150, 0, lh=1.4),
            ]),
        ],
    })

    out.append({
        "id": "hero_metric",
        "description": "Eén kerncijfer heel groot met wat het is en de vergelijking met vorig jaar; rechts een korte duiding. Voor het belangrijkste getal van een onderwerp.",
        "components": [
            background(t),
            heading(t, "Bedrijfsopbrengsten stijgen naar recordniveau"),
            comp("hero_value", "Groot kerncijfer met label en vergelijkingsregel.", [
                text(t, "metric_value", M, 240, 720, 130, 112, "accent", "€ 108,2 mln", 11, 1, bold=True, lh=1.0, ls=-3.5),
                text(t, "metric_label", M, 396, 600, 76, 28, "ink", "Totale bedrijfsopbrengsten 2025", 52, 3, bold=True, lh=1.25),
                rect(M, 492, 300, 48, t["accent_soft"], radius=24, name="comparison_pill"),
                text(t, "comparison", M + 20, 503, 268, 28, 20, "accent", "+10,0% t.o.v. 2024", 22, 3, bold=True),
            ]),
            comp("hero_context", "Smalle duidingskolom rechts met een dunne scheidingslijn.", [
                rect(840, 236, 1, 300, t["line"], name="divider"),
                text(t, "context", 872, 236, 328, 330, 22, "body", "In 2024 waren de opbrengsten € 98,3 mln. De groei van € 9,9 mln komt vooral uit revalidatiezorg via de Zorgverzekeringswet.", 190, 0, lh=1.45),
            ]),
        ],
    })

    out.append({
        "id": "metric_trio",
        "description": "Drie kerncijfers naast elkaar, elk met label en één korte toelichting. Voor drie samenhangende cijfers zoals omzet, resultaat en solvabiliteit.",
        "components": [
            background(t),
            heading(t, "Groei, winst en buffer nemen alle drie toe"),
            comp("metric_columns", "Drie kolommen met accentlijn boven elk kerncijfer.", [{
                "type": "grid",
                "position": {"x": M, "y": 250},
                "size": {"width": CW, "height": 330},
                "columns": 3,
                "rows": 1,
                "gap": 48,
                "align_items": "stretch",
                "justify_items": "stretch",
                "children": [{
                    "type": "group",
                    "size": {"width": 341, "height": 330},
                    "children": [
                        rect(0, 0, 341, 4, t["accent"], name="column_rule"),
                        text(t, "value", 0, 28, 341, 80, 60, "ink", sample, 10, 1, bold=True, lh=1.05, ls=-1.8),
                        text(t, "label", 0, 120, 341, 64, 24, "accent", label, 40, 3, bold=True, lh=1.25),
                        text(t, "detail", 0, 196, 341, 120, 20, "body", detail, 90, 0, lh=1.45),
                    ],
                    "name": "metric_item",
                } for sample, label, detail in (
                    ("€ 108,2 mln", "Bedrijfsopbrengsten", "Tegen € 98,3 mln in 2024, een stijging van 10,0%."),
                    ("€ 6,8 mln", "Nettoresultaat", "Tegen € 4,4 mln in 2024."),
                    ("37,6%", "Solvabiliteit", "Tegen 34,1% in 2024; current ratio 2,07."),
                )],
                "name": "metrics",
                "max_children": 3,
                "min_children": 3,
            }]),
        ],
    })

    out.append({
        "id": "chart_commentary",
        "description": "Staafdiagram links met twee korte bevindingen rechts. Voor een vergelijking van enkele waarden (jaren, posten) met duiding.",
        "components": [
            background(t),
            heading(t, "Nettoresultaat stijgt met € 2,4 mln"),
            comp("chart_panel", "Grafiekvlak links.", [
                chart(t, "main_chart", M, 220, 700, 390, "bar", ["2024", "2025"], [4.4, 6.8], "Nettoresultaat (€ mln)"),
            ]),
            comp("findings", "Twee of drie korte bevindingen rechts, gestapeld.", [{
                "type": "flex",
                "position": {"x": 828, "y": 236},
                "size": {"width": 372, "height": 374},
                "direction": "column",
                "gap": 28,
                "align_items": "stretch",
                "justify_content": "flex-start",
                "children": [{
                    "type": "group",
                    "size": {"width": 372, "height": 150},
                    "children": [
                        rect(0, 0, 4, 150, t["accent"], name="finding_rule"),
                        text(t, "finding_title", 24, 0, 348, 34, 24, "ink", head, 24, 3, bold=True),
                        text(t, "finding_body", 24, 42, 348, 104, 20, "body", body, 80, 0, lh=1.45),
                    ],
                    "name": "finding",
                } for head, body in (
                    ("+€ 2,4 mln", "Van € 4,4 mln in 2024 naar € 6,8 mln in 2025."),
                    ("Groei uit zorg", "Hogere baten zorgverlening dragen het resultaat."),
                )],
                "name": "finding_list",
                "max_children": 2,
                "min_children": 1,
            }]),
        ],
    })

    out.append({
        "id": "trend",
        "description": "Brede lijn- of kolomgrafiek over meerdere jaren met één bijschrift. Voor ontwikkelingen over drie of meer jaren.",
        "components": [
            background(t),
            heading(t, "Personeelskosten stijgen vijf jaar op rij"),
            comp("trend_caption", "Eén bijschrift onder de titel.", [
                text(t, "caption", M, 204, CW, 34, 22, "body", "Personeelskosten in € mln per boekjaar.", 90, 0),
            ]),
            comp("trend_chart", "Brede grafiek over de volle breedte.", [
                chart(t, "trend_chart", M, 252, CW, 360, "line", ["2021", "2022", "2023", "2024", "2025"], [58.2, 61.0, 64.7, 68.9, 74.1], "Personeelskosten (€ mln)"),
            ]),
        ],
    })

    out.append({
        "id": "comparison",
        "description": "Twee waarden naast elkaar (bijvoorbeeld 2024 tegenover 2025, of begroting tegenover realisatie) met het verschil in het midden.",
        "components": [
            background(t),
            heading(t, "Personeelsbestand groeit naar 1.012 fte"),
            comp("comparison_panels", "Twee panelen met periode, groot cijfer en toelichting.", [
                rect(M, 236, 500, 330, t["panel"], radius=16, name="left_panel"),
                text(t, "left_label", M + 40, 268, 420, 30, 22, "muted", "2024", 24, 1, bold=True),
                text(t, "left_value", M + 40, 312, 420, 96, 76, "ink", "968 fte", 10, 1, bold=True, lh=1.05, ls=-2.2),
                text(t, "left_detail", M + 40, 428, 420, 110, 20, "body", "Gemiddelde formatie in het voorgaande boekjaar.", 90, 0, lh=1.45),
                rect(700, 236, 500, 330, t["accent_soft"], radius=16, name="right_panel"),
                text(t, "right_label", 740, 268, 420, 30, 22, "accent", "2025", 24, 1, bold=True),
                text(t, "right_value", 740, 312, 420, 96, 76, "accent", "1.012 fte", 10, 1, bold=True, lh=1.05, ls=-2.2),
                text(t, "right_detail", 740, 428, 420, 110, 20, "body", "Gemiddelde formatie in 2025.", 90, 0, lh=1.45),
                rect(560, 371, 160, 60, t["accent"], radius=30, name="delta_badge"),
                text(t, "delta", 570, 386, 140, 30, 22, "on_accent", "+44 fte", 10, 1, bold=True, align="center"),
            ]),
        ],
    })

    out.append({
        "id": "breakdown",
        "description": "Horizontale balken van groot naar klein met directe labels, plus één uitgelicht aandeel rechts. Voor de opbouw van baten of kosten.",
        "components": [
            background(t),
            heading(t, "Zvw-revalidatiezorg levert 93% van de baten"),
            comp("breakdown_chart", "Gesorteerde horizontale balken.", [
                chart(t, "breakdown_chart", M, 220, 760, 390, "horizontal_bar",
                      ["Zvw-revalidatiezorg", "Overige zorgbaten", "Wlz en VWS", "Beschikbaarheidbijdrage"], [99.96, 5.92, 1.54, 0.55], "Baten (€ mln)"),
            ]),
            comp("breakdown_highlight", "Uitgelicht aandeel met toelichting.", [
                text(t, "highlight_value", 892, 250, 308, 90, 72, "accent", "93%", 8, 1, bold=True, lh=1.0, ls=-2.0),
                text(t, "highlight_label", 892, 350, 308, 64, 24, "ink", "aandeel Zvw in de baten", 40, 3, bold=True, lh=1.25),
                text(t, "highlight_body", 892, 426, 308, 150, 20, "body", "€ 99,96 mln van de € 108,0 mln baten zorgverlening.", 110, 0, lh=1.45),
            ]),
        ],
    })

    header = [cell(t, h, "bg", "muted", True, "left" if i == 0 else "right", "accent", 2) for i, h in enumerate(("Post", "2024", "2025", "Verschil"))]
    rows = [
        [cell(t, a, "bg", "ink"), cell(t, b, "bg", "body", False, "right"), cell(t, c, "bg", "body", False, "right"), cell(t, d, "bg", "body", False, "right")]
        for a, b, c, d in (
            ("Personeelskosten", "€ 68,9 mln", "€ 74,1 mln", "+€ 5,2 mln"),
            ("Nettoresultaat", "€ 4,4 mln", "€ 6,8 mln", "+€ 2,4 mln"),
            ("Bedrijfsopbrengsten", "€ 98,3 mln", "€ 108,2 mln", "+€ 9,9 mln"),
        )
    ]
    out.append({
        "id": "table",
        "description": "Strakke tabel met hoogstens zes rijen en vier kolommen, getallen rechts uitgelijnd. Alleen voor rijen met aangeleverde cijfers.",
        "components": [
            background(t),
            heading(t, "Kosten stijgen minder hard dan de opbrengsten"),
            comp("table_intro", "Eén inleidende zin boven de tabel.", [
                text(t, "intro", M, 204, CW, 34, 22, "body", "Bedragen in € mln, boekjaar 2024 en 2025.", 90, 0),
            ]),
            comp("data_table", "Tabel over de volle breedte.", [{
                "type": "table",
                "position": {"x": M, "y": 256},
                "size": {"width": CW, "height": 300},
                "font": font(t, 20, "body"),
                "columns": header,
                "rows": rows,
                "decorative": False,
                "name": "data_table",
                "max_columns": 4,
                "min_columns": 2,
                "max_rows": 6,
                "min_rows": 2,
            }]),
        ],
    })

    out.append({
        "id": "points",
        "description": "Korte inleiding met drie of vier puntsgewijze bevindingen. Voor context, aanpak of kwalitatieve punten zonder cijferreeks.",
        "components": [
            background(t),
            heading(t, "Drie ontwikkelingen bepalen 2025"),
            comp("points_body", "Inleiding links, puntenlijst rechts.", [
                text(t, "lead", M, 236, 400, 300, 26, "ink", "De groei is breed gedragen, maar leunt op één financieringsstroom.", 110, 0, bold=True, lh=1.35),
                {
                    "type": "text-list",
                    "position": {"x": 560, "y": 236},
                    "size": {"width": 640, "height": 360},
                    "font": font(t, 22, "body", lh=1.4),
                    "marker": "bullet",
                    "gap": 22,
                    "marker_gap": 14,
                    "items": [[{"text": s}] for s in (
                        "Zvw-revalidatiezorg groeit en levert het grootste deel van de baten.",
                        "Personeel groeit naar 1.012 fte, de kosten stijgen mee.",
                        "Solvabiliteit en liquiditeit verbeteren.",
                    )],
                    "decorative": False,
                    "name": "point_list",
                    "max_items": 4,
                    "min_items": 2,
                    "max_item_length": 90,
                    "min_item_length": 10,
                },
            ]),
        ],
    })

    out.append({
        "id": "conclusion",
        "description": "Afsluiting met drie genummerde kernconclusies naast elkaar. Alleen als laatste slide.",
        "components": [
            background(t, glow=True),
            heading(t, "Wat de cijfers over 2025 laten zien", "Samenvatting"),
            comp("takeaways", "Drie genummerde conclusies naast elkaar.", [{
                "type": "grid",
                "position": {"x": M, "y": 250},
                "size": {"width": CW, "height": 330},
                "columns": 3,
                "rows": 1,
                "gap": 48,
                "align_items": "stretch",
                "justify_items": "stretch",
                "children": [{
                    "type": "group",
                    "size": {"width": 341, "height": 330},
                    "children": [
                        rect(0, 0, 341, 330, t["panel"], radius=16, name="takeaway_card"),
                        text(t, "takeaway_title", 32, 32, 277, 96, 26, "ink", head, 40, 3, bold=True, lh=1.22),
                        text(t, "takeaway_body", 32, 140, 277, 160, 20, "body", body, 100, 0, lh=1.45),
                    ],
                    "name": "takeaway",
                } for head, body in (
                    ("Omzet +10%", "Bedrijfsopbrengsten stijgen naar € 108,2 mln."),
                    ("Resultaat € 6,8 mln", "Een stijging van € 2,4 mln ten opzichte van 2024."),
                    ("Sterkere buffer", "Solvabiliteit stijgt naar 37,6%."),
                )],
                "name": "takeaway_grid",
                "max_children": 3,
                "min_children": 3,
            }]),
        ],
    })
    return out


def template(template_id):
    t = THEMES[template_id]
    graph = [t["accent"], t["ink"], t["muted"], t["context"], t["body"]]
    return {
        "id": template_id,
        "name": t["name"],
        "description": t["description"],
        "fonts": {FONT: FONT_URL},
        "theme": {
            "colors": {
                "primary": t["accent"],
                "background": t["bg"],
                "card": t["panel"],
                "stroke": t["line"],
                "primary_text": t["ink"],
                "background_text": t["ink"],
                **{f"graph_{i}": c for i, c in enumerate(graph + [t["accent_soft"], t["panel"], t["line"], t["bg"], t["on_accent"]])},
            },
            "fonts": {"textFont": {"name": FONT, "url": FONT_URL}},
        },
        "layouts": layouts(t),
    }


def main():
    root = Path(__file__).resolve().parent / "templates"
    for template_id in THEMES:
        target = root / template_id / "template.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(template(template_id), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {target.relative_to(root.parent.parent)}")


if __name__ == "__main__":
    main()
