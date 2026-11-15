import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "presenton"))

import build_templates
import presentations

TEMPLATES = ROOT / "presenton" / "templates"


def elements(node, offset=(0.0, 0.0)):
    """Yield (element, absolute x, absolute y) for every element, descending into groups and grids."""
    if isinstance(node, dict):
        pos = node.get("position") or {}
        x, y = offset[0] + float(pos.get("x") or 0), offset[1] + float(pos.get("y") or 0)
        if node.get("type"):
            yield node, x, y
        for key in ("components", "elements", "children"):
            for child in node.get(key) or []:
                yield from elements(child, (x, y) if node.get("type") or key == "elements" else offset)


class PresentonTemplatesTest(unittest.TestCase):
    def setUp(self):
        self.templates = {t: build_templates.template(t) for t in build_templates.template_ids()}

    def test_committed_output_matches_generator(self):
        for template_id, generated in self.templates.items():
            on_disk = json.loads((TEMPLATES / template_id / "template.json").read_text(encoding="utf-8"))
            self.assertEqual(on_disk, json.loads(json.dumps(generated)), f"run presenton/build_templates.py for {template_id}")
        manifest = json.loads((TEMPLATES / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest, json.loads(json.dumps(build_templates.manifest())))

    def test_api_knows_every_template_and_palette(self):
        self.assertEqual(set(self.templates), set(presentations.OWN_TEMPLATES))
        self.assertIn(presentations.DEFAULT_TEMPLATE, self.templates)
        for name, (light, dark) in build_templates.PALETTE_ACCENTS.items():
            self.assertEqual(presentations._PALETTES[name]["accent"], light)
            self.assertEqual(presentations._DARK_ACCENTS[name], dark)
        for template_id, t in self.templates.items():
            info = presentations.OWN_TEMPLATE_INFO[template_id]
            self.assertEqual(t["theme"]["colors"]["primary"], info["accent"])
            self.assertEqual(t["theme"]["colors"]["background"], info["bg"])

    def test_families_share_slots_so_styling_and_checks_apply(self):
        def slots(t):
            return {layout["id"]: sorted({el["name"] for el, _, _ in elements(layout) if el.get("type") == "text" and not el["decorative"]}) for layout in t["layouts"]}

        reference = slots(self.templates["jaarverslag-licht"])
        for template_id, t in self.templates.items():
            self.assertEqual(slots(t), reference, template_id)

    def test_art_exists_and_is_decorative(self):
        for template_id, t in self.templates.items():
            for layout in t["layouts"]:
                for el, _, _ in elements(layout):
                    if el.get("type") != "image":
                        continue
                    self.assertTrue(el["decorative"], f"{template_id}/{layout['id']}: image generation is off; no image slots")
                    self.assertTrue((TEMPLATES / template_id / el["data"]).is_file(), el["data"])
                    if presentations._ART_PALETTE_RE.search(el["data"]):
                        for palette in build_templates.PALETTE_ACCENTS:
                            swapped = presentations._ART_PALETTE_RE.sub(f"-{palette}.svg", el["data"])
                            self.assertTrue((TEMPLATES / template_id / swapped).is_file(), swapped)

    def test_text_fits_its_box_and_stays_on_the_slide(self):
        for template_id, t in self.templates.items():
            for layout in t["layouts"]:
                for el, x, y in elements(layout):
                    size = el.get("size") or {}
                    where = f"{template_id}/{layout['id']}/{el.get('name')}"
                    if el["type"] in ("text", "chart", "table", "grid", "flex") and size:
                        self.assertLessEqual(x + size["width"], 1280.5, where)
                        # Keep y >= 630 free for the source footer; the cover never gets one.
                        if layout["id"] != "cover":
                            self.assertLessEqual(y + size["height"], 630.5, where)
                    if el["type"] != "text" or el["decorative"]:
                        continue
                    font = el["font"]
                    # Figure slots hold figures like "€ 108,2 mln"; other slots get ordinary words.
                    sample = "€ 888,8 mln 88" if font["size"] >= 56 else "lorem ipsum " * 40
                    worst = sample[: el["max_length"]]
                    lines = presentations._wrapped_lines(worst, size["width"], font["size"], font["bold"], font["family"], font["letter_spacing"])
                    needed = lines * font["size"] * font["line_height"]
                    with self.subTest(slot=where):
                        self.assertLessEqual(needed, size["height"] + 2, f"needs {needed:.0f}px for {lines} lines")
                    if el["name"] != "kicker":
                        self.assertGreaterEqual(font["size"], 20, f"{where} too small")


if __name__ == "__main__":
    unittest.main()
