import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "presenton"))

import build_templates
import presentations


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
        self.templates = {t: build_templates.template(t) for t in build_templates.THEMES}

    def test_committed_json_matches_generator(self):
        for template_id, generated in self.templates.items():
            on_disk = json.loads((ROOT / "presenton" / "templates" / template_id / "template.json").read_text(encoding="utf-8"))
            self.assertEqual(on_disk, json.loads(json.dumps(generated)), f"run presenton/build_templates.py for {template_id}")

    def test_themes_share_layouts_and_api_knows_them(self):
        ids = [[layout["id"] for layout in t["layouts"]] for t in self.templates.values()]
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(set(self.templates), set(presentations.OWN_TEMPLATES))
        for template_id, t in self.templates.items():
            defaults = presentations._OWN_DEFAULTS[template_id]
            self.assertEqual(t["theme"]["colors"]["primary"], defaults["accent"])
            self.assertEqual(t["theme"]["colors"]["background"], defaults["bg"])

    def test_text_fits_its_box_and_stays_on_the_slide(self):
        for t in self.templates.values():
            for layout in t["layouts"]:
                for el, x, y in elements(layout):
                    size = el.get("size") or {}
                    if el["type"] in ("text", "chart", "table", "grid", "flex") and size:
                        self.assertLessEqual(x + size["width"], 1280.5, f"{layout['id']}/{el.get('name')}")
                        # Keep y >= 630 free for the source footer.
                        self.assertLessEqual(y + size["height"], 630.5, f"{layout['id']}/{el.get('name')}")
                    self.assertNotEqual(el["type"], "image", "image generation is off; no image slots")
                    if el["type"] != "text":
                        continue
                    font = el["font"]
                    # Figure slots hold figures like "€ 108,2 mln"; other slots get ordinary words.
                    sample = "€ 888,8 mln 88" if font["size"] >= 56 else "lorem ipsum " * 40
                    worst = sample[: el["max_length"]]
                    lines = presentations._wrapped_lines(worst, size["width"], font["size"], font["bold"], font["family"], font["letter_spacing"])
                    needed = lines * font["size"] * font["line_height"]
                    with self.subTest(slot=f"{layout['id']}/{el['name']}"):
                        self.assertLessEqual(needed, size["height"] + 2, f"needs {needed:.0f}px for {lines} lines")
                    if el["name"] != "kicker":
                        self.assertGreaterEqual(font["size"], 20, f"{layout['id']}/{el['name']} too small")


if __name__ == "__main__":
    unittest.main()
