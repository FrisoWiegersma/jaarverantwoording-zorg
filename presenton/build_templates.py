"""Generate the app's Presenton templates: five design families, each in light and dark.

Run: uv run python presenton/build_templates.py
Writes presenton/templates/<family>-<licht|donker>/ (template.json plus static/ SVG art) and
presenton/templates/manifest.json, which api/presentations.py reads. Edit this file, not the output.

Every family fills the same eleven layouts with the same slot names, so the API's restyling and
figure checks work for all of them; the families differ in type, grid treatment, cards and the
signature slides (cover, statement, hero figure, closing). Slides are 1280x720; y>=630 stays free for
the source footer the API adds. Text boxes are sized so max_length fits at the designed size.
"""

import json
import math
import shutil
from pathlib import Path

W, H, M = 1280, 720, 80
CW = W - 2 * M

# Must match _PALETTES / _DARK_ACCENTS in api/presentations.py (tests/test_presenton_templates.py checks).
PALETTE_ACCENTS = {
    "editorial_teal": ("#087F8C", "#2EC4B6"),
    "warm_paper": ("#B45309", "#F59E0B"),
    "civic_navy": ("#1D4ED8", "#60A5FA"),
    "forest_ink": ("#166534", "#4ADE80"),
    "burgundy_editorial": ("#881337", "#FB7185"),
}


def gfont(family, weights="400;500;600;700;800"):
    return f"https://fonts.googleapis.com/css2?family={family.replace(' ', '+')}:ital,wght@0,{weights.replace(';', ';0,')};1,400&display=swap"


FAMILIES = {
    "jaarverslag": {
        "name": "Jaarverslag",
        "description": "Rustig en helder: grote kerncijfers, één accentkleur en veel witruimte. Voor jaarrapportages en raden van toezicht.",
        "palette": "editorial_teal",
        "head_font": "Inter",
        "body_font": "Inter",
        "title_size": 44,
        "title_ls": -0.6,
        "kicker_upper": False,
        "kicker_color": "accent",
        "card": "panel",
        "radius": 16,
        "light": {"bg": "#FFFFFF", "panel": "#F3F7F8", "ink": "#142B3C", "body": "#3A5266", "muted": "#5F7383", "line": "#D8E5E9", "context": "#AFC6CF"},
        "dark": {"bg": "#0E1217", "panel": "#161D25", "ink": "#F3F6F9", "body": "#C3CDD7", "muted": "#8E9CAB", "line": "#26313C", "context": "#3A4A5A"},
    },
    "swiss": {
        "name": "Swiss",
        "description": "Gedurfd en grafisch: enorme cijfers, strak raster, vlakken in volle accentkleur. Voor keynotes en strategiesessies.",
        "palette": "civic_navy",
        "head_font": "Inter Tight",
        "body_font": "Inter",
        "title_size": 50,
        "title_ls": -1.6,
        "kicker_upper": True,
        "kicker_color": "ink",
        "card": "rule",
        "radius": 0,
        "light": {"bg": "#FFFFFF", "panel": "#F2F2EF", "ink": "#0A0A0A", "body": "#2B2B2B", "muted": "#6B6B6B", "line": "#0A0A0A", "context": "#C9C9C4"},
        "dark": {"bg": "#0A0A0A", "panel": "#171717", "ink": "#FAFAFA", "body": "#D4D4D4", "muted": "#8A8A8A", "line": "#FAFAFA", "context": "#3D3D3D"},
    },
    "consulting": {
        "name": "Consulting",
        "description": "Adviesrapport-stijl: conclusie als titel, rustige dichte opbouw, kaders en voetnoten. Voor bestuur, directie en opdrachtgevers.",
        "palette": "forest_ink",
        "head_font": "IBM Plex Sans",
        "body_font": "IBM Plex Sans",
        "title_size": 34,
        "title_ls": -0.3,
        "kicker_upper": True,
        "kicker_color": "muted",
        "card": "outline",
        "radius": 4,
        "light": {"bg": "#FFFFFF", "panel": "#F4F6F8", "ink": "#0B1F33", "body": "#33475B", "muted": "#64788B", "line": "#D5DEE8", "context": "#B9C6D3"},
        "dark": {"bg": "#0B1621", "panel": "#12202E", "ink": "#EEF3F8", "body": "#C2CEDA", "muted": "#8597A8", "line": "#24364A", "context": "#34495F"},
    },
    "editorial": {
        "name": "Editorial",
        "description": "Tijdschriftstijl: serif koppen, grote citaten, dunne lijnen en warm papier. Voor verhalende analyses en publieksrapporten.",
        "palette": "burgundy_editorial",
        "head_font": "Fraunces",
        "body_font": "Inter",
        "title_size": 46,
        "title_ls": -0.8,
        "kicker_upper": True,
        "kicker_color": "accent",
        "card": "rule",
        "radius": 0,
        "light": {"bg": "#FBF8F3", "panel": "#F2ECE2", "ink": "#1A1814", "body": "#3D3A36", "muted": "#7A736A", "line": "#D9D0C3", "context": "#D2C7B8"},
        "dark": {"bg": "#15130F", "panel": "#201D18", "ink": "#F4EFE7", "body": "#D2CBC0", "muted": "#958C80", "line": "#3A342C", "context": "#4A4238"},
    },
    "zorg": {
        "name": "Zorg",
        "description": "Warm en menselijk: zachte ronde vormen, warme tinten, uitnodigend. Voor zorginstellingen, gemeenten en publieke verantwoording.",
        "palette": "warm_paper",
        "head_font": "Plus Jakarta Sans",
        "body_font": "Plus Jakarta Sans",
        "title_size": 44,
        "title_ls": -0.8,
        "kicker_upper": False,
        "kicker_color": "accent",
        "card": "panel",
        "radius": 28,
        "light": {"bg": "#FFFBF6", "panel": "#F6EEE4", "ink": "#2A2522", "body": "#4A423C", "muted": "#857A70", "line": "#EADFD2", "context": "#E3D3C1"},
        "dark": {"bg": "#1C1714", "panel": "#28211C", "ink": "#F7EFE6", "body": "#D8CCBF", "muted": "#A0938A", "line": "#3A3029", "context": "#4C4037"},
    },
}
THEMES = ("licht", "donker")


def mix(a, b, t):
    ra = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    rb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(ra, rb, strict=True))


def tokens(family_id, theme, palette=None):
    f = FAMILIES[family_id]
    dark = theme == "donker"
    palette = palette or f["palette"]
    t = {**f, **f["dark" if dark else "light"], "family": family_id, "theme": theme, "dark": dark, "palette": palette}
    t["accent"] = PALETTE_ACCENTS[palette][1 if dark else 0]
    t["accent_soft"] = mix(t["accent"], t["bg"], 0.82 if dark else 0.88)
    t["on_accent"] = t["bg"] if dark else "#FFFFFF"
    t["id"] = f"{family_id}-{theme}"
    return t


# ---------------------------------------------------------------- element helpers


def font(t, size, color, bold=False, lh=1.2, ls=0.0, role="body", italic=False):
    return {
        "size": size,
        "family": t["head_font" if role == "head" else "body_font"],
        "color": t[color],
        "bold": bold,
        "italic": italic,
        "line_height": lh,
        "letter_spacing": ls,
    }


def text(t, name, x, y, w, h, size, color, sample, max_len, min_len=1, bold=False, lh=1.2, ls=0.0, align="left", valign="top", role="body", italic=False):
    f = font(t, size, color, bold, lh, ls, role, italic)
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


def ellipse(cx, cy, r, color, opacity=1.0, name="decorative_shape"):
    return {
        "type": "vector",
        "shape": "ellipse",
        "points": [{"x": cx, "y": cy - r}, {"x": cx + r, "y": cy}, {"x": cx, "y": cy + r}, {"x": cx - r, "y": cy}],
        "closed": True,
        "fill": {"color": color, "opacity": opacity},
        "name": name,
    }


def art(name, x, y, w, h):
    """A fixed SVG from static/; style_deck swaps the palette suffix for the deck's palette."""
    return {
        "type": "image",
        "position": {"x": x, "y": y},
        "size": {"width": w, "height": h},
        "data": f"static/{name}",
        "fit": "fill",
        "decorative": True,
        "name": "decorative_art",
        "is_icon": False,
    }


def comp(cid, description, elements, x=0, y=0):
    return {"id": cid, "description": description, "position": {"x": x, "y": y}, "elements": elements}


def background(t, *extra, fill="bg"):
    return comp("background", "Vaste achtergrond van de slide.", [rect(0, 0, W, H, t[fill], name="slide_background"), *extra])


def kicker(t, x, y, w, sample, max_len=40, color=None):
    return text(
        t,
        "kicker",
        x,
        y,
        w,
        24,
        15 if t["kicker_upper"] else 16,
        color or t["kicker_color"],
        sample,
        max_len,
        3,
        bold=True,
        ls=2.0 if t["kicker_upper"] else 1.0,
    )


def heading(t, title_sample, kicker_sample="Zorginstelling · jaarverslag 2025", title_max=64):
    size = t["title_size"]
    els = [
        kicker(t, M, 52, CW, kicker_sample),
        text(t, "title", M, 84, CW, round(size * 1.14 * 2 + 4), size, "ink", title_sample, title_max, 12, bold=True, lh=1.12, ls=t["title_ls"], role="head"),
    ]
    if t["family"] == "consulting":
        els.append(rect(M, 192, CW, 1, t["line"], name="title_rule"))
    if t["family"] == "swiss":
        els.insert(0, rect(M, 40, 48, 6, t["accent"], name="accent_rule"))
    return comp("heading", "Kleine bovenregel (organisatie · onderwerp) en een slidetitel die de conclusie geeft.", els)


def card(t, x, y, w, h, fill="panel", name="card"):
    """The family's card treatment: soft panel, outlined box or a rule on top."""
    if t["card"] == "panel":
        return [rect(x, y, w, h, t[fill], radius=t["radius"], name=name)]
    if t["card"] == "outline":
        return [rect(x, y, w, h, t["bg"] if fill == "panel" else t[fill], radius=t["radius"], stroke=t["line"], name=name)]
    weight = 6 if t["family"] == "swiss" else 1
    return [rect(x, y, w, weight, t["accent"] if fill == "accent_soft" else t["ink"], name=name)]


def pad(t):
    return 0 if t["card"] == "rule" else 32


def chart(t, name, x, y, w, h, chart_type, categories, values, series_name="Waarde"):
    return {
        "type": "chart",
        "position": {"x": x, "y": y},
        "size": {"width": w, "height": h},
        "chart_type": chart_type,
        "colors": [t["context"], t["accent"]] if chart_type in ("bar", "horizontal_bar") else [t["accent"]],
        "text_color": t["muted"],
        # Bars carry their value as a label, so only the category axis is drawn; lines keep a value axis.
        "x_axis": chart_type != "horizontal_bar",
        "y_axis": chart_type in ("horizontal_bar", "line", "area"),
        "axis_color": t["muted"],
        "categories": categories,
        "series": [{"name": series_name, "values": values}],
        "data_labels": "outside" if chart_type in ("bar", "horizontal_bar") else "top",
        "legend": False,
        "x_axis_grid": False,
        "y_axis_grid": chart_type in ("line", "area"),
        "grid_color": t["line"] if t["family"] != "swiss" else t["context"],
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


# ---------------------------------------------------------------- signature layouts per family

COVER_DESC = "Openingsslide: grote titel met de kernboodschap van het hele deck, organisatie en jaar, één ondertitelzin. Alleen als eerste slide."
STATEMENT_DESC = "Eén krachtige conclusie of sectie-overgang in grote tekst, met één korte toelichting. Geen cijferreeks."
HERO_DESC = (
    "Eén kerncijfer heel groot met wat het is en de vergelijking met vorig jaar; een korte duiding ernaast. Voor het belangrijkste getal van een onderwerp."
)
CONCLUSION_DESC = "Afsluiting met drie kernconclusies naast elkaar. Alleen als laatste slide."


def cover(t):
    f = t["family"]
    k, ti, sub = (
        "Zorginstelling · jaarverslag 2025",
        "Omzet groeit met 10% naar € 108,2 mln",
        "Kerncijfers over baten, personeel, resultaat en vermogen in 2025.",
    )
    if f == "swiss":
        els = [
            art(f"swiss-cover-{t['theme']}.svg", 0, 0, W, H),
            kicker(t, M, 72, 900, k, 48, color="on_accent"),
            text(t, "title", M, 300, 1080, 260, 84, "on_accent", ti, 48, 10, bold=True, lh=1.0, ls=-3.0, role="head"),
            text(t, "subtitle", M, 572, 760, 60, 22, "on_accent", sub, 100, 0, lh=1.35),
        ]
        return background(t, fill="accent"), comp("cover_text", "Poster-omslag in volle accentkleur.", els)
    if f == "consulting":
        els = [
            rect(0, 0, 24, H, t["accent"], name="accent_band"),
            art(f"consulting-hatch-{t['theme']}.svg", 760, 0, 520, H),
            kicker(t, 120, 200, 600, k, 48),
            text(t, "title", 120, 240, 640, 200, 48, "ink", ti, 64, 10, bold=True, lh=1.1, ls=-0.8, role="head"),
            rect(120, 470, 96, 3, t["accent"], name="accent_rule"),
            text(t, "subtitle", 120, 496, 600, 100, 22, "body", sub, 110, 0, lh=1.4),
        ]
        return background(t), comp("cover_text", "Titelblok links met accentband, arcering rechts.", els)
    if f == "editorial":
        els = [
            art(f"editorial-contours-{t['theme']}-{t['palette']}.svg", 0, 0, W, H),
            kicker(t, M, 120, 900, k, 48),
            rect(M, 156, CW, 1, t["ink"], name="top_rule"),
            text(t, "title", M, 196, 1000, 260, 76, "ink", ti, 52, 10, bold=True, lh=1.04, ls=-2.0, role="head"),
            text(t, "subtitle", M, 490, 720, 112, 26, "body", sub, 110, 0, lh=1.4, italic=True, role="head"),
        ]
        return background(t), comp("cover_text", "Tijdschriftomslag met serif titel en contourlijnen.", els)
    if f == "zorg":
        els = [
            art(f"zorg-blobs-{t['theme']}-{t['palette']}.svg", 640, 0, 640, H),
            kicker(t, M, 200, 600, k, 48),
            text(t, "title", M, 240, 620, 240, 60, "ink", ti, 60, 10, bold=True, lh=1.08, ls=-1.4, role="head"),
            text(t, "subtitle", M, 500, 560, 100, 22, "body", sub, 110, 0, lh=1.45),
        ]
        return background(t), comp("cover_text", "Warme omslag met zachte vormen rechts.", els)
    els = [
        rect(M, 236, 72, 6, t["accent"], radius=3, name="accent_rule"),
        kicker(t, M, 196, 900, k, 48),
        text(t, "title", M, 266, 1040, 220, 68, "ink", ti, 52, 10, bold=True, lh=1.06, ls=-1.6, role="head"),
        text(t, "subtitle", M, 500, 860, 70, 24, "body", sub, 110, 0, lh=1.35),
    ]
    return background(t, ellipse(1180, 40, 300, t["accent_soft"], 1.0 if not t["dark"] else 0.55, "decorative_glow")), comp(
        "cover_text", "Titelblok links met accentstreep.", els
    )


def statement(t):
    f = t["family"]
    st, sup = "De groei komt vrijwel volledig uit Zvw-revalidatiezorg.", "Overige zorgbaten en subsidies zijn samen minder dan 8% van de baten."
    if f == "swiss":
        els = [
            rect(M, 140, 120, 12, t["accent"], name="accent_rule"),
            kicker(t, M, 176, CW, "Conclusie"),
            text(t, "statement", M, 214, 1120, 260, 64, "ink", st, 80, 20, bold=True, lh=1.02, ls=-2.2, role="head"),
            text(t, "supporting", M, 496, 760, 100, 24, "body", sup, 140, 0, lh=1.4),
        ]
        return background(t), comp("statement_text", "Grote conclusie met dikke accentbalk.", els)
    if f == "consulting":
        els = [
            kicker(t, M, 160, CW, "Kernboodschap"),
            rect(M, 196, 6, 220, t["accent"], name="accent_bar"),
            text(t, "statement", M + 40, 196, 1040, 220, 42, "ink", st, 110, 20, bold=True, lh=1.18, ls=-0.6, role="head"),
            text(t, "supporting", M + 40, 440, 900, 120, 22, "body", sup, 160, 0, lh=1.45),
        ]
        return background(t), comp("statement_text", "Kernboodschap met accentbalk links.", els)
    if f == "editorial":
        els = [
            text(t, "quote_mark", M - 8, 70, 200, 220, 220, "accent", "“", 1, 1, bold=True, lh=1.0, role="head"),
            kicker(t, 200, 150, 900, "Conclusie"),
            text(t, "statement", 200, 190, 960, 270, 54, "ink", st, 96, 20, bold=False, lh=1.12, ls=-1.0, role="head", italic=True),
            rect(200, 486, 80, 2, t["accent"], name="accent_rule"),
            text(t, "supporting", 200, 506, 800, 100, 22, "body", sup, 140, 0, lh=1.45),
        ]
        comp_ = comp("statement_text", "Groot citaat in serif met aanhalingsteken.", els)
        comp_["elements"][0]["decorative"] = True
        return background(t), comp_
    if f == "zorg":
        els = [
            rect(M, 120, CW, 480, t["panel"], radius=40, name="statement_panel"),
            art(f"zorg-blobs-{t['theme']}-{t['palette']}.svg", 900, 120, 300, 480),
            kicker(t, 140, 180, 700, "Conclusie"),
            text(t, "statement", 140, 220, 760, 250, 50, "ink", st, 96, 20, bold=True, lh=1.12, ls=-1.0, role="head"),
            text(t, "supporting", 140, 486, 700, 100, 22, "body", sup, 130, 0, lh=1.45),
        ]
        return background(t), comp("statement_text", "Conclusie in een zacht afgerond vlak.", els)
    els = [
        kicker(t, M, 168, CW, "Conclusie"),
        text(t, "statement", M, 206, 1040, 240, 52, "ink", st, 96, 20, bold=True, lh=1.12, ls=-1.0, role="head"),
        text(t, "supporting", M, 476, 820, 100, 24, "body", sup, 150, 0, lh=1.4),
    ]
    return background(t, ellipse(1180, 40, 300, t["accent_soft"], 1.0 if not t["dark"] else 0.55, "decorative_glow")), comp(
        "statement_text", "Grote conclusiezin met toelichting.", els
    )


def hero(t):
    f = t["family"]
    v, lab, cmp_, ctx = (
        "€ 108,2 mln",
        "Totale bedrijfsopbrengsten 2025",
        "+10,0% t.o.v. 2024",
        "In 2024 waren de opbrengsten € 98,3 mln. De groei van € 9,9 mln komt vooral uit revalidatiezorg via de Zorgverzekeringswet.",
    )
    if f == "swiss":
        block = comp(
            "hero_block",
            "Accentvlak links met het kerncijfer.",
            [
                # Stops above the footer so the source line stays on the page colour.
                rect(0, 0, 760, 630, t["accent"], name="accent_block"),
                art(f"swiss-cover-{t['theme']}.svg", 0, 0, 760, 630),
                kicker(t, M, 72, 600, "Zorginstelling · 2025", color="on_accent"),
                text(t, "metric_value", M, 250, 680, 170, 112, "on_accent", v, 11, 1, bold=True, lh=1.0, ls=-4.2, role="head"),
                text(t, "metric_label", M, 440, 600, 76, 28, "on_accent", lab, 52, 3, bold=True, lh=1.25),
            ],
        )
        side = comp(
            "hero_context",
            "Titel, vergelijking en duiding rechts.",
            [
                text(t, "title", 820, 72, 380, 230, 34, "ink", "Opbrengsten op recordniveau", 56, 12, bold=True, lh=1.12, ls=-0.8, role="head"),
                rect(820, 330, 380, 6, t["ink"], name="rule"),
                text(t, "comparison", 820, 352, 380, 34, 26, "accent", cmp_, 22, 3, bold=True),
                text(t, "context", 820, 404, 380, 210, 20, "body", ctx, 150, 0, lh=1.45),
            ],
        )
        return [background(t), block, side]
    big = {"editorial": {"size": 124, "role": "head", "bold": False}, "zorg": {"size": 104, "role": "head", "bold": True}}.get(
        f, {"size": 112, "role": "head", "bold": True}
    )
    vcolor = "ink" if f == "editorial" else "accent"
    els = [text(t, "metric_value", M, 240, 720, 160, big["size"], vcolor, v, 11, 1, bold=big["bold"], lh=1.0, ls=-3.5, role=big["role"])]
    x, label_y, pill_y, pill_fill = M, 412, 504, t["accent_soft"]
    if f == "zorg":
        # A soft rounded panel holds figure, label and pill, like the family's cards.
        x, label_y, pill_y, pill_fill = M + 40, 392, 488, t["bg"]
        els = [
            rect(M, 228, 720, 344, t["panel"], radius=40, name="hero_panel"),
            text(t, "metric_value", x, 262, 640, 120, 92, "accent", v, 11, 1, bold=True, lh=1.0, ls=-2.5, role="head"),
        ]
    els += [
        text(t, "metric_label", x, label_y, 640, 76, 28, "ink", lab, 52, 3, bold=True, lh=1.25),
        rect(x, pill_y, 300, 48, pill_fill, radius=24 if t["radius"] else 0, name="comparison_pill"),
        text(t, "comparison", x + 20, pill_y + 10, 268, 28, 20, "accent", cmp_, 22, 3, bold=True),
    ]
    divider = rect(840, 236, 1, 330, t["line"] if f != "editorial" else t["ink"], name="divider")
    return [
        background(t),
        heading(t, "Bedrijfsopbrengsten stijgen naar recordniveau"),
        comp("hero_value", "Groot kerncijfer met label en vergelijking.", els),
        comp(
            "hero_context",
            "Duidingskolom rechts met scheidingslijn.",
            [
                divider,
                text(t, "context", 872, 236, 328, 330, 22, "body", ctx, 190, 0, lh=1.45, italic=f == "editorial", role="head" if f == "editorial" else "body"),
            ],
        ),
    ]


def conclusion(t):
    f = t["family"]
    items = (
        ("Omzet +10%", "Bedrijfsopbrengsten stijgen naar € 108,2 mln."),
        ("Resultaat € 6,8 mln", "Een stijging van € 2,4 mln ten opzichte van 2024."),
        ("Sterkere buffer", "Solvabiliteit stijgt naar 37,6%."),
    )
    if f == "consulting":
        rows = {
            "type": "flex",
            "position": {"x": M, "y": 232},
            "size": {"width": CW, "height": 384},
            "direction": "column",
            "gap": 16,
            "align_items": "stretch",
            "justify_content": "flex-start",
            "children": [
                {
                    "type": "group",
                    "size": {"width": CW, "height": 116},
                    "children": [
                        rect(0, 0, CW, 116, t["bg"], radius=t["radius"], stroke=t["line"], name="row_box"),
                        rect(0, 0, 8, 116, t["accent"], name="row_bar"),
                        text(t, "takeaway_title", 40, 26, 360, 64, 24, "ink", head, 40, 3, bold=True, lh=1.25, role="head"),
                        text(t, "takeaway_body", 440, 26, 640, 64, 20, "body", body, 100, 0, lh=1.45),
                    ],
                    "name": "takeaway",
                }
                for head, body in items
            ],
            "name": "takeaway_grid",
            "max_children": 3,
            "min_children": 3,
        }
        return [background(t), heading(t, "Wat de cijfers over 2025 laten zien", "Samenvatting"), comp("takeaways", "Drie conclusies als rijen.", [rows])]
    group_children = {
        "swiss": lambda head, body: [
            rect(0, 0, 341, 6, t["accent"], name="takeaway_rule"),
            text(t, "takeaway_title", 0, 30, 341, 120, 34, "ink", head, 40, 3, bold=True, lh=1.1, ls=-0.8, role="head"),
            text(t, "takeaway_body", 0, 170, 341, 140, 20, "body", body, 100, 0, lh=1.45),
        ],
        "editorial": lambda head, body: [
            rect(0, 0, 341, 1, t["ink"], name="takeaway_rule"),
            text(t, "takeaway_title", 0, 24, 341, 110, 30, "ink", head, 40, 3, bold=True, lh=1.15, role="head"),
            text(t, "takeaway_body", 0, 150, 341, 160, 20, "body", body, 100, 0, lh=1.45),
        ],
    }.get(
        f,
        lambda head, body: [
            rect(0, 0, 341, 330, t["panel"], radius=t["radius"], name="takeaway_card"),
            ellipse(48, 52, 12, t["accent"], 1.0, "takeaway_dot") if f == "zorg" else rect(32, 32, 40, 4, t["accent"], name="takeaway_rule"),
            text(t, "takeaway_title", 32, 80, 277, 96, 26, "ink", head, 40, 3, bold=True, lh=1.22, role="head"),
            text(t, "takeaway_body", 32, 186, 277, 120, 20, "body", body, 90, 0, lh=1.45),
        ],
    )
    grid = {
        "type": "grid",
        "position": {"x": M, "y": 250},
        "size": {"width": CW, "height": 330},
        "columns": 3,
        "rows": 1,
        "gap": 48,
        "align_items": "stretch",
        "justify_items": "stretch",
        "children": [
            {"type": "group", "size": {"width": 341, "height": 330}, "children": group_children(head, body), "name": "takeaway"} for head, body in items
        ],
        "name": "takeaway_grid",
        "max_children": 3,
        "min_children": 3,
    }
    extra = []
    if f == "zorg":
        extra = [art(f"zorg-blobs-{t['theme']}-{t['palette']}.svg", 1040, 0, 240, 200)]
    return [
        background(t, *extra),
        heading(t, "Wat de cijfers over 2025 laten zien", "Samenvatting"),
        comp("takeaways", "Drie kernconclusies naast elkaar.", [grid]),
    ]


# ---------------------------------------------------------------- shared data layouts


def metric_trio(t):
    p = pad(t)
    top = 28 if t["card"] == "rule" else p
    children = []
    for sample, label, detail in (
        ("€ 108,2 mln", "Bedrijfsopbrengsten", "Tegen € 98,3 mln in 2024, een stijging van 10,0%."),
        ("€ 6,8 mln", "Nettoresultaat", "Tegen € 4,4 mln in 2024."),
        ("37,6%", "Solvabiliteit", "Tegen 34,1% in 2024; current ratio 2,07."),
    ):
        w = 341 - 2 * p
        # Room for 11 characters, so "€ 108,2 mln" keeps its unit.
        size = 44 if t["card"] != "rule" else 56
        children.append(
            {
                "type": "group",
                "size": {"width": 341, "height": 330},
                "children": [
                    *card(t, 0, 0, 341, 330, name="metric_card"),
                    text(t, "value", p, top, w, 76, size, "ink", sample, 11, 1, bold=t["family"] != "editorial", lh=1.05, ls=-1.8, role="head"),
                    text(t, "label", p, top + 92, w, 64, 22, "accent", label, 40 if w > 300 else 34, 3, bold=True, lh=1.25),
                    text(t, "detail", p, top + 164, w, 120, 20, "body", detail, 90 if w > 300 else 70, 0, lh=1.45),
                ],
                "name": "metric_item",
            }
        )
    grid = {
        "type": "grid",
        "position": {"x": M, "y": 250},
        "size": {"width": CW, "height": 330},
        "columns": 3,
        "rows": 1,
        "gap": 48 if t["card"] == "rule" else 24,
        "align_items": "stretch",
        "justify_items": "stretch",
        "children": children,
        "name": "metrics",
        "max_children": 3,
        "min_children": 3,
    }
    return {
        "id": "metric_trio",
        "description": "Drie kerncijfers naast elkaar, elk met label en één korte toelichting. Voor drie samenhangende cijfers zoals omzet, resultaat en solvabiliteit.",
        "components": [
            background(t),
            heading(t, "Groei, winst en buffer nemen alle drie toe"),
            comp("metric_columns", "Drie kolommen met elk een kerncijfer.", [grid]),
        ],
    }


def chart_commentary(t):
    rule = t["accent"] if t["family"] != "swiss" else t["ink"]
    return {
        "id": "chart_commentary",
        "description": "Staafdiagram links met twee korte bevindingen rechts. Voor een vergelijking van enkele waarden (jaren, posten) met duiding.",
        "components": [
            background(t),
            heading(t, "Nettoresultaat stijgt met € 2,4 mln"),
            comp(
                "chart_panel", "Grafiekvlak links.", [chart(t, "main_chart", M, 220, 700, 390, "bar", ["2024", "2025"], [4.4, 6.8], "Nettoresultaat (€ mln)")]
            ),
            comp(
                "findings",
                "Twee korte bevindingen rechts, gestapeld.",
                [
                    {
                        "type": "flex",
                        "position": {"x": 828, "y": 236},
                        "size": {"width": 372, "height": 374},
                        "direction": "column",
                        "gap": 28,
                        "align_items": "stretch",
                        "justify_content": "flex-start",
                        "children": [
                            {
                                "type": "group",
                                "size": {"width": 372, "height": 150},
                                "children": [
                                    rect(0, 0, 4 if t["family"] != "swiss" else 6, 150, rule, name="finding_rule"),
                                    text(t, "finding_title", 24, 0, 348, 34, 24, "ink", head, 22, 3, bold=True, role="head"),
                                    text(t, "finding_body", 24, 42, 348, 104, 20, "body", body, 76, 0, lh=1.45),
                                ],
                                "name": "finding",
                            }
                            for head, body in (
                                ("+€ 2,4 mln", "Van € 4,4 mln in 2024 naar € 6,8 mln in 2025."),
                                ("Groei uit zorg", "Hogere baten zorgverlening dragen het resultaat."),
                            )
                        ],
                        "name": "finding_list",
                        "max_children": 2,
                        "min_children": 1,
                    }
                ],
            ),
        ],
    }


def trend(t):
    return {
        "id": "trend",
        "description": "Brede lijn- of kolomgrafiek over meerdere jaren met één bijschrift. Voor ontwikkelingen over drie of meer jaren.",
        "components": [
            background(t),
            heading(t, "Personeelskosten stijgen vijf jaar op rij"),
            comp(
                "trend_caption",
                "Eén bijschrift onder de titel.",
                [text(t, "caption", M, 212, CW, 34, 22, "body", "Personeelskosten in € mln per boekjaar.", 90, 0)],
            ),
            comp(
                "trend_chart",
                "Brede grafiek over de volle breedte.",
                [
                    chart(
                        t,
                        "trend_chart",
                        M,
                        252,
                        CW,
                        360,
                        "line",
                        ["2021", "2022", "2023", "2024", "2025"],
                        [58.2, 61.0, 64.7, 68.9, 74.1],
                        "Personeelskosten (€ mln)",
                    ),
                ],
            ),
        ],
    }


def comparison(t):
    p = 40 if t["card"] != "rule" else 0
    left_fill, right_fill = "panel", "accent_soft"
    els = [
        *card(t, M, 236, 500, 330, left_fill, "left_panel"),
        text(t, "left_label", M + p, 236 + 28, 420, 30, 22, "muted", "2024", 24, 1, bold=True),
        text(t, "left_value", M + p, 304, 440, 96, 64, "ink", "968 fte", 12, 1, bold=True, lh=1.05, ls=-2.2, role="head"),
        text(t, "left_detail", M + p, 414, 420, 110, 20, "body", "Gemiddelde formatie in het voorgaande boekjaar.", 90, 0, lh=1.45),
        *card(t, 700, 236, 500, 330, right_fill, "right_panel"),
        text(t, "right_label", 700 + p, 236 + 28, 420, 30, 22, "accent", "2025", 24, 1, bold=True),
        text(t, "right_value", 700 + p, 304, 440, 96, 64, "accent", "1.012 fte", 12, 1, bold=True, lh=1.05, ls=-2.2, role="head"),
        text(t, "right_detail", 700 + p, 414, 420, 110, 20, "body", "Gemiddelde formatie in 2025.", 90, 0, lh=1.45),
    ]
    # Panels leave a gap to straddle; open rule columns put the badge under the right column instead.
    bx, by = (560, 371) if p else (700, 536)
    els += [
        rect(bx, by, 160, 60, t["accent"], radius=30 if t["radius"] else 0, name="delta_badge"),
        text(t, "delta", bx + 10, by + 15, 140, 30, 22, "on_accent", "+44 fte", 10, 1, bold=True, align="center"),
    ]
    return {
        "id": "comparison",
        "description": "Twee waarden naast elkaar (bijvoorbeeld 2024 tegenover 2025, of begroting tegenover realisatie) met het verschil in het midden.",
        "components": [
            background(t),
            heading(t, "Personeelsbestand groeit naar 1.012 fte"),
            comp("comparison_panels", "Twee panelen met periode, groot cijfer en toelichting.", els),
        ],
    }


def breakdown(t):
    return {
        "id": "breakdown",
        "description": "Horizontale balken van groot naar klein met directe labels, plus één uitgelicht aandeel rechts. Voor de opbouw van baten of kosten.",
        "components": [
            background(t),
            heading(t, "Zvw-revalidatiezorg levert 93% van de baten"),
            comp(
                "breakdown_chart",
                "Gesorteerde horizontale balken.",
                [
                    chart(
                        t,
                        "breakdown_chart",
                        M,
                        220,
                        760,
                        390,
                        "horizontal_bar",
                        ["Zvw-revalidatiezorg", "Overige zorgbaten", "Wlz en VWS", "Beschikbaarheidbijdrage"],
                        [99.96, 5.92, 1.54, 0.55],
                        "Baten (€ mln)",
                    ),
                ],
            ),
            comp(
                "breakdown_highlight",
                "Uitgelicht aandeel met toelichting.",
                [
                    text(t, "highlight_value", 892, 250, 308, 90, 72, "accent", "93%", 8, 1, bold=t["family"] != "editorial", lh=1.0, ls=-2.0, role="head"),
                    text(t, "highlight_label", 892, 350, 308, 64, 22, "ink", "aandeel Zvw in de baten", 40, 3, bold=True, lh=1.25),
                    text(t, "highlight_body", 892, 426, 308, 150, 20, "body", "€ 99,96 mln van de € 108,0 mln baten zorgverlening.", 110, 0, lh=1.45),
                ],
            ),
        ],
    }


def table(t):
    header_fill = "panel" if t["family"] == "consulting" else "bg"
    header = [
        cell(t, h, header_fill, "muted", True, "left" if i == 0 else "right", "accent" if t["family"] != "swiss" else "ink", 2)
        for i, h in enumerate(("Post", "2024", "2025", "Verschil"))
    ]
    rows = [
        [cell(t, a, "bg", "ink"), cell(t, b, "bg", "body", False, "right"), cell(t, c, "bg", "body", False, "right"), cell(t, d, "bg", "body", False, "right")]
        for a, b, c, d in (
            ("Personeelskosten", "€ 68,9 mln", "€ 74,1 mln", "+€ 5,2 mln"),
            ("Nettoresultaat", "€ 4,4 mln", "€ 6,8 mln", "+€ 2,4 mln"),
            ("Bedrijfsopbrengsten", "€ 98,3 mln", "€ 108,2 mln", "+€ 9,9 mln"),
        )
    ]
    return {
        "id": "table",
        "description": "Strakke tabel met hoogstens zes rijen en vier kolommen, getallen rechts uitgelijnd. Alleen voor rijen met aangeleverde cijfers.",
        "components": [
            background(t),
            heading(t, "Kosten stijgen minder hard dan de opbrengsten"),
            comp(
                "table_intro",
                "Eén inleidende zin boven de tabel.",
                [text(t, "intro", M, 212, CW, 34, 22, "body", "Bedragen in € mln, boekjaar 2024 en 2025.", 90, 0)],
            ),
            comp(
                "data_table",
                "Tabel over de volle breedte.",
                [
                    {
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
                    }
                ],
            ),
        ],
    }


def points(t):
    return {
        "id": "points",
        "description": "Korte inleiding met drie of vier puntsgewijze bevindingen. Voor context, aanpak of kwalitatieve punten zonder cijferreeks.",
        "components": [
            background(t),
            heading(t, "Drie ontwikkelingen bepalen 2025"),
            comp(
                "points_body",
                "Inleiding links, puntenlijst rechts.",
                [
                    text(
                        t,
                        "lead",
                        M,
                        236,
                        400,
                        300,
                        26,
                        "ink",
                        "De groei is breed gedragen, maar leunt op één financieringsstroom.",
                        110,
                        0,
                        bold=True,
                        lh=1.35,
                        role="head",
                    ),
                    {
                        "type": "text-list",
                        "position": {"x": 560, "y": 236},
                        "size": {"width": 640, "height": 360},
                        "font": font(t, 22, "body", lh=1.4),
                        "marker": "bullet",
                        "gap": 22,
                        "marker_gap": 14,
                        "items": [
                            [{"text": s}]
                            for s in (
                                "Zvw-revalidatiezorg groeit en levert het grootste deel van de baten.",
                                "Personeel groeit naar 1.012 fte, de kosten stijgen mee.",
                                "Solvabiliteit en liquiditeit verbeteren.",
                            )
                        ],
                        "decorative": False,
                        "name": "point_list",
                        "max_items": 4,
                        "min_items": 2,
                        "max_item_length": 90,
                        "min_item_length": 10,
                    },
                ],
            ),
        ],
    }


def layouts(t):
    c_bg, c_text = cover(t)
    s_bg, s_text = statement(t)
    return [
        {"id": "cover", "description": COVER_DESC, "components": [c_bg, c_text]},
        {"id": "statement", "description": STATEMENT_DESC, "components": [s_bg, s_text]},
        {"id": "hero_metric", "description": HERO_DESC, "components": hero(t)},
        metric_trio(t),
        chart_commentary(t),
        trend(t),
        comparison(t),
        breakdown(t),
        table(t),
        points(t),
        {"id": "conclusion", "description": CONCLUSION_DESC, "components": conclusion(t)},
    ]


# ---------------------------------------------------------------- abstract art (SVG)


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>\n'


def swiss_art(t):
    """Geometric overlay for accent-coloured blocks: drawn in the on-accent colour, so palette-independent."""
    c = t["on_accent"]
    dots = "".join(f'<circle cx="{940 + 36 * i}" cy="{80 + 36 * j}" r="4" fill="{c}" fill-opacity="0.35"/>' for i in range(8) for j in range(5))
    body = (
        f'<circle cx="1120" cy="640" r="430" fill="none" stroke="{c}" stroke-opacity="0.18" stroke-width="2"/>'
        f'<circle cx="1120" cy="640" r="300" fill="{c}" fill-opacity="0.08"/>'
        f'<path d="M1280 260 A380 380 0 0 0 900 640 L1280 640 Z" fill="{c}" fill-opacity="0.10"/>' + dots
    )
    return svg(W, H, body)


def consulting_art(t):
    lines = "".join(f'<line x1="{x}" y1="0" x2="{x - 720}" y2="720" stroke="{t["line"]}" stroke-width="1.2"/>' for x in range(0, 1300, 22))
    return svg(520, H, f'<rect width="520" height="720" fill="{t["panel"]}"/>{lines}')


def editorial_art(t):
    a = t["accent"]
    paths = []
    for k in range(14):
        r = 120 + k * 46
        pts = []
        for s in range(0, 361, 10):
            ang = math.radians(s)
            wobble = 1 + 0.07 * math.sin(3 * ang + k * 0.6) + 0.04 * math.cos(5 * ang - k)
            pts.append(f"{1060 + r * 1.25 * wobble * math.cos(ang):.1f},{560 + r * 0.8 * wobble * math.sin(ang):.1f}")
        paths.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{a}" stroke-opacity="{0.10 + 0.012 * (14 - k):.3f}" stroke-width="1.4"/>')
    return svg(W, H, "".join(paths))


def zorg_art(t):
    a, soft = t["accent"], t["accent_soft"]
    body = (
        f'<path d="M420 40 C600 20 700 180 640 330 C580 480 700 620 560 700 C420 780 240 690 230 540 C220 390 90 330 150 200 C210 70 300 50 420 40 Z" fill="{soft}"/>'
        f'<path d="M520 300 C610 290 650 380 610 450 C570 520 470 540 420 480 C370 420 430 310 520 300 Z" fill="{a}" fill-opacity="0.85"/>'
        f'<circle cx="300" cy="610" r="46" fill="{a}" fill-opacity="0.35"/>'
        f'<circle cx="590" cy="120" r="22" fill="{a}" fill-opacity="0.6"/>'
    )
    return svg(640, H, body)


def write_art(family_id, theme, static):
    t = tokens(family_id, theme)
    if family_id == "swiss":
        (static / f"swiss-cover-{theme}.svg").write_text(swiss_art(t), encoding="utf-8")
    elif family_id == "consulting":
        (static / f"consulting-hatch-{theme}.svg").write_text(consulting_art(t), encoding="utf-8")
    elif family_id in ("editorial", "zorg"):
        for palette in PALETTE_ACCENTS:
            tp = tokens(family_id, theme, palette)
            name = "editorial-contours" if family_id == "editorial" else "zorg-blobs"
            (static / f"{name}-{theme}-{palette}.svg").write_text(editorial_art(tp) if family_id == "editorial" else zorg_art(tp), encoding="utf-8")


# ---------------------------------------------------------------- output


def template(template_id):
    family_id, theme = template_id.rsplit("-", 1)
    t = tokens(family_id, theme)
    graph = [t["accent"], t["ink"], t["muted"], t["context"], t["body"]]
    fonts = {t["head_font"]: gfont(t["head_font"])}
    fonts[t["body_font"]] = gfont(t["body_font"])
    return {
        "id": template_id,
        "name": f"{t['name']} {'donker' if t['dark'] else 'licht'}",
        "description": t["description"],
        "fonts": fonts,
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
            "fonts": {"textFont": {"name": t["body_font"], "url": gfont(t["body_font"])}},
        },
        "layouts": layouts(t),
    }


def template_ids():
    return [f"{f}-{theme}" for f in FAMILIES for theme in THEMES]


def manifest():
    out = {}
    for template_id in template_ids():
        family_id, theme = template_id.rsplit("-", 1)
        t = tokens(family_id, theme)
        out[template_id] = {
            "family": family_id,
            "dark": t["dark"],
            "bg": t["bg"],
            "accent": t["accent"],
            "accent_soft": t["accent_soft"],
            "palette": t["palette"],
            "body_font": t["body_font"],
            "kicker_upper": t["kicker_upper"],
            "description": t["description"],
        }
    return out


def main():
    root = Path(__file__).resolve().parent / "templates"
    for old in root.iterdir() if root.exists() else []:
        if old.is_dir() and old.name not in template_ids():
            shutil.rmtree(old)
    for template_id in template_ids():
        target = root / template_id
        static = target / "static"
        shutil.rmtree(static, ignore_errors=True)
        static.mkdir(parents=True)
        (target / "template.json").write_text(json.dumps(template(template_id), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        write_art(*template_id.rsplit("-", 1), static)
    (root / "manifest.json").write_text(json.dumps(manifest(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(template_ids())} templates to {root.relative_to(root.parent.parent)}")


if __name__ == "__main__":
    main()
